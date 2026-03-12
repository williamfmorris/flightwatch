require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cron = require("node-cron");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const FLIGHTAWARE_API_KEY = process.env.FLIGHTAWARE_API_KEY;
const FLIGHTAWARE_BASE = "https://aeroapi.flightaware.com/aeroapi";
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;

const BUDGET_LIMIT = 2000;
const REVIEW_WARNING = 1500;
const TURNAROUND_MINUTES = 60; // default

// Turnaround by aircraft type (ICAO type codes)
const TURNAROUND_BY_AIRCRAFT = {
  // Turboprops / regional jets — 30 min
  DH8A: 30, DH8B: 30, DH8C: 30, DH8D: 30, // Q100/200/300/400
  CRJ1: 30, CRJ2: 30, CRJ7: 30, CRJ9: 30, CRJX: 30, // CRJ family
  E135: 30, E145: 30, // Embraer regional
  AT43: 30, AT72: 30, AT75: 30, // ATR family
  // Narrowbody — 60 min (default, listed for clarity)
  B737: 60, B738: 60, B739: 60, B38M: 60, B39M: 60,
  A319: 60, A320: 60, A321: 60,
  E170: 60, E175: 60, E190: 60, E195: 60,
  // Widebody — 90 min
  B763: 90, B764: 90, B77W: 90, B788: 90, B789: 90, B78X: 90,
  A332: 90, A333: 90, A359: 90, A35K: 90,
};

// --- Database setup ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS watches (
      id TEXT PRIMARY KEY,
      flight_number TEXT NOT NULL,
      date TEXT NOT NULL,
      phone TEXT,
      last_risk TEXT,
      started_at TEXT NOT NULL
    )
  `);
}

async function dbSaveWatch(watchId, { flightNumber, date, phone, lastRisk, startedAt }) {
  await pool.query(
    `INSERT INTO watches (id, flight_number, date, phone, last_risk, started_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET last_risk = EXCLUDED.last_risk`,
    [watchId, flightNumber, date, phone || null, lastRisk || null, startedAt]
  );
}

async function dbUpdateRisk(watchId, risk) {
  await pool.query("UPDATE watches SET last_risk = $1 WHERE id = $2", [risk, watchId]);
}

async function dbDeleteWatch(watchId) {
  await pool.query("DELETE FROM watches WHERE id = $1", [watchId]);
}

// --- In-memory state ---
let apiCallCount = 0;
let apiCallLog = [];
const watchedFlights = new Map();
const accuracyLog = [];
const activeCronJobs = new Map();

function trackApiCall(endpoint) {
  apiCallCount++;
  apiCallLog.push({ time: new Date().toISOString(), endpoint, total: apiCallCount });
  if (apiCallCount >= BUDGET_LIMIT) {
    console.error(`BUDGET LIMIT REACHED (${apiCallCount} calls). Pausing all polling.`);
    activeCronJobs.forEach(job => job.stop());
    activeCronJobs.clear();
    return false;
  }
  if (apiCallCount === REVIEW_WARNING) {
    console.warn(`WARNING: ${apiCallCount} API calls used (~$15). Approaching $20 limit.`);
  }
  return true;
}

// AC flights can be operated by mainline (ACA), Rouge (ROU), or Jazz/Express (JZA)
const AC_ICAO_CANDIDATES = ["ACA", "ROU", "JZA"];

// Returns all flights matching flightNumber on date (across all AC operators if applicable)
async function findFlights(flightNumber, date) {
  const f = flightNumber.trim().toUpperCase().replace(/\s/g, "");
  const flightNum = f.replace(/^(ACA|ROU|JZA|AC)/, "");
  const candidates = f.startsWith("AC") && !f.match(/^(ACA|ROU|JZA)/)
    ? AC_ICAO_CANDIDATES.map(prefix => prefix + flightNum)
    : [f];

  // Wide window covering any timezone (UTC-14 to UTC+14)
  const start = new Date(date + 'T00:00:00Z');
  start.setTime(start.getTime() - 14 * 3600000);
  const end = new Date(date + 'T00:00:00Z');
  end.setTime(end.getTime() + 38 * 3600000);

  const allMatching = [];
  for (const icao of candidates) {
    if (!trackApiCall(`/flights/${icao}`)) throw new Error("Budget limit reached");
    console.log(`[API] Trying ${icao} for ${date}`);
    const response = await axios.get(`${FLIGHTAWARE_BASE}/flights/${icao}`, {
      headers: { "x-apikey": FLIGHTAWARE_API_KEY },
      params: { start: start.toISOString(), end: end.toISOString() }
    });
    const flights = response.data.flights || [];
    const matching = flights.filter(f => {
      const tz = f.origin?.timezone;
      return !tz || !f.scheduled_out ||
        new Date(f.scheduled_out).toLocaleDateString('en-CA', { timeZone: tz }) === date;
    });
    allMatching.push(...matching);
    // AC operators are mutually exclusive — stop at first one with results
    if (f.startsWith("AC") && matching.length) break;
  }

  if (allMatching.length === 0) throw new Error(`No flights found for ${flightNumber} on ${date}`);
  return allMatching;
}

async function getInboundFlight(inboundFaFlightId) {
  if (!trackApiCall(`/flights/${inboundFaFlightId}`)) throw new Error("Budget limit reached");
  const response = await axios.get(`${FLIGHTAWARE_BASE}/flights/${inboundFaFlightId}`, {
    headers: { "x-apikey": FLIGHTAWARE_API_KEY }
  });
  const flights = response.data.flights || [];
  return flights[0] || null;
}

function analyzeRisk(flight, inbound) {
  if (!inbound) return { risk: "unknown", message: "Could not determine inbound flight" };
  const aircraftType = flight.aircraft_type?.toUpperCase();
  const turnaround = TURNAROUND_BY_AIRCRAFT[aircraftType] ?? TURNAROUND_MINUTES;
  const scheduledDep = new Date(flight.estimated_out || flight.scheduled_out);
  const estimatedArr = new Date(inbound.estimated_in || inbound.scheduled_in);
  const gapMinutes = (scheduledDep - estimatedArr) / 60000;
  const bufferMinutes = gapMinutes - turnaround;
  let risk, message;
  if (bufferMinutes >= 15) {
    risk = "safe";
    message = `Inbound ${inbound.ident} arrives ${formatTime(estimatedArr)}, leaving ${Math.round(bufferMinutes)} min buffer after turnaround.`;
  } else if (bufferMinutes >= 0) {
    risk = "tight";
    message = `Inbound ${inbound.ident} arrives ${formatTime(estimatedArr)}. Only ${Math.round(bufferMinutes)} min buffer — could be tight.`;
  } else {
    risk = "delay_likely";
    message = `DELAY LIKELY: Inbound ${inbound.ident} arrives ${formatTime(estimatedArr)}, only ${Math.round(gapMinutes)} min before departure — not enough for ${turnaround} min turnaround.`;
  }

  // Tarmac delay check: inbound pushed back but hasn't taken off
  let tarmacAlert = null;
  if (inbound.actual_out && !inbound.actual_off) {
    const tarmacMinutes = (Date.now() - new Date(inbound.actual_out)) / 60000;
    if (tarmacMinutes >= 30 && risk !== "delay_likely") {
      risk = "delay_likely";
      message = `DELAY LIKELY: Inbound ${inbound.ident} pushed back ${Math.round(tarmacMinutes)} min ago but hasn't taken off — possible tarmac hold.`;
      tarmacAlert = "red";
    } else if (tarmacMinutes >= 20 && risk === "safe") {
      risk = "tight";
      message = `Inbound ${inbound.ident} pushed back ${Math.round(tarmacMinutes)} min ago with no takeoff yet — possible tarmac delay.`;
      tarmacAlert = "amber";
    }
  }

  return { risk, message, gapMinutes: Math.round(gapMinutes), bufferMinutes: Math.round(bufferMinutes), turnaroundMinutes: turnaround, inboundETA: estimatedArr.toISOString(), tarmacAlert };
}

function formatTime(date) {
  return date.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", timeZone: "America/Toronto" });
}

async function sendSMS(to, message) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    console.log(`[SMS would send to ${to}]: ${message}`);
    return;
  }
  const twilio = require("twilio")(TWILIO_SID, TWILIO_TOKEN);
  await twilio.messages.create({ body: message, from: TWILIO_FROM, to });
}

async function checkFlight(flightNumber, date, phone, watchId) {
  try {
    const matches = await findFlights(flightNumber, date);
    const flight = matches[0];
    let inbound = null;
    if (flight.inbound_fa_flight_id) inbound = await getInboundFlight(flight.inbound_fa_flight_id);
    const analysis = analyzeRisk(flight, inbound);
    const watch = watchedFlights.get(watchId);
    accuracyLog.push({ flightNumber, date, route: `${flight.origin?.code_iata} → ${flight.destination?.code_iata}`, scheduledDep: flight.scheduled_out, actualDep: flight.actual_out, checkedAt: new Date().toISOString(), risk: analysis.risk });
    if (phone && watch && watch.lastRisk !== analysis.risk && (analysis.risk === "delay_likely" || analysis.risk === "tight")) {
      await sendSMS(phone, `FlightWatch: ${flightNumber} (${flight.origin?.code_iata}→${flight.destination?.code_iata}) ${analysis.message}`);
      watch.lastRisk = analysis.risk;
      await dbUpdateRisk(watchId, analysis.risk);
    }
    if (flight.actual_off) {
      const job = activeCronJobs.get(watchId);
      if (job) { job.stop(); activeCronJobs.delete(watchId); }
      watchedFlights.delete(watchId);
      await dbDeleteWatch(watchId);
      if (phone) await sendSMS(phone, `FlightWatch: ${flightNumber} has departed. Safe travels!`);
    }
    return { flight, inbound, analysis, apiCallCount };
  } catch (err) {
    console.error(`[Poll] Error:`, err.message);
    throw err;
  }
}

function startWatchJob(watchId, flightNumber, date, phone) {
  let consecutiveErrors = 0;
  const job = cron.schedule("*/5 * * * *", async () => {
    // Stop if the flight date is more than 12 hours in the past
    const flightDateEnd = new Date(date + 'T12:00:00Z').getTime() + 86400000;
    if (Date.now() > flightDateEnd) {
      console.log(`[Watch] ${flightNumber} date ${date} has passed — stopping watch`);
      job.stop(); activeCronJobs.delete(watchId); watchedFlights.delete(watchId); dbDeleteWatch(watchId);
      return;
    }
    try {
      await checkFlight(flightNumber.toUpperCase(), date, phone, watchId);
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      console.error(`[Poll] Error (${consecutiveErrors}):`, err.message);
      if (consecutiveErrors >= 5) {
        console.error(`[Watch] ${flightNumber} — 5 consecutive errors, stopping watch`);
        job.stop(); activeCronJobs.delete(watchId); watchedFlights.delete(watchId); dbDeleteWatch(watchId);
      }
    }
  });
  activeCronJobs.set(watchId, job);
}

// Restore watches from DB on startup
async function loadWatchesFromDB() {
  try {
    const { rows } = await pool.query("SELECT * FROM watches");
    let restored = 0;
    for (const row of rows) {
      const flightDateEnd = new Date(row.date + 'T12:00:00Z').getTime() + 86400000;
      if (Date.now() > flightDateEnd) {
        await dbDeleteWatch(row.id);
        continue;
      }
      const watchData = { flightNumber: row.flight_number, date: row.date, phone: row.phone, lastRisk: row.last_risk, startedAt: row.started_at };
      watchedFlights.set(row.id, watchData);
      startWatchJob(row.id, row.flight_number, row.date, row.phone);
      restored++;
    }
    if (restored > 0) console.log(`[DB] Restored ${restored} active watch(es) from database`);
  } catch (err) {
    console.error("[DB] Failed to restore watches:", err.message);
  }
}

app.get("/api/flight/:flightNumber", async (req, res) => {
  try {
    const { flightNumber } = req.params;
    const { date, from } = req.query;
    const flightDate = date || new Date().toISOString().split("T")[0];
    const matches = await findFlights(flightNumber.toUpperCase(), flightDate);

    // Apply FROM filter if user selected from disambiguation
    let pool = from ? matches.filter(f => f.origin?.code_iata === from.toUpperCase()) : matches;
    if (pool.length === 0) pool = matches; // FROM didn't match anything, fall back

    // Multiple flights — ask user to disambiguate
    if (pool.length > 1) {
      return res.json({
        success: true,
        ambiguous: true,
        options: pool.map(f => ({
          origin: f.origin?.code_iata,
          destination: f.destination?.code_iata,
          scheduledDeparture: f.scheduled_out,
          timezone: f.origin?.timezone,
        }))
      });
    }

    const flight = pool[0];
    let inbound = null;
    if (flight.inbound_fa_flight_id) inbound = await getInboundFlight(flight.inbound_fa_flight_id);
    const analysis = analyzeRisk(flight, inbound);
    res.json({ success: true, flightNumber: flightNumber.toUpperCase(), route: `${flight.origin?.code_iata} → ${flight.destination?.code_iata}`, scheduledDeparture: flight.scheduled_out, estimatedDeparture: flight.estimated_out, actualDeparture: flight.actual_out, gate: flight.gate_origin, status: flight.status, timezone: flight.origin?.timezone, inbound: inbound ? { flightNumber: inbound.ident, origin: inbound.origin?.code_iata, scheduledArrival: inbound.scheduled_in, estimatedArrival: inbound.estimated_in, actualArrival: inbound.actual_in, departed: !!inbound.actual_off, departedAt: inbound.actual_off, progressPercent: inbound.progress_percent } : null, analysis, apiCallCount, budgetRemaining: BUDGET_LIMIT - apiCallCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/watch", async (req, res) => {
  try {
    const { flightNumber, date, phone } = req.body;
    if (!flightNumber || !date) return res.status(400).json({ error: "flightNumber and date required" });

    // Prevent duplicate watches for same flight+date+phone
    const existing = Array.from(watchedFlights.values()).find(
      w => w.flightNumber === flightNumber && w.date === date && w.phone === phone
    );
    if (existing) return res.json({ success: true, alreadyWatching: true });

    const watchId = `${flightNumber}-${date}-${Date.now()}`;
    const watchData = { flightNumber, date, phone, lastRisk: null, startedAt: new Date().toISOString() };
    watchedFlights.set(watchId, watchData);
    await dbSaveWatch(watchId, watchData);
    const result = await checkFlight(flightNumber.toUpperCase(), date, phone, watchId);
    startWatchJob(watchId, flightNumber, date, phone);
    if (phone) await sendSMS(phone, `FlightWatch activated for ${flightNumber} on ${date}. You'll get alerts if a delay is likely.`);
    res.json({ success: true, watchId, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/watch/:watchId", async (req, res) => {
  const job = activeCronJobs.get(req.params.watchId);
  if (job) { job.stop(); activeCronJobs.delete(req.params.watchId); }
  watchedFlights.delete(req.params.watchId);
  await dbDeleteWatch(req.params.watchId);
  res.json({ success: true, message: "Watch stopped" });
});

app.get("/api/watches", (req, res) => {
  res.json({ watches: Array.from(watchedFlights.entries()).map(([id, w]) => ({ id, ...w })), apiCallCount, budgetRemaining: BUDGET_LIMIT - apiCallCount });
});

app.get("/api/accuracy", (req, res) => {
  const { route } = req.query;
  const data = route ? accuracyLog.filter(r => r.route === route) : accuracyLog;
  const byRoute = {};
  data.forEach(r => {
    if (!r.actualDep || !r.scheduledDep) return;
    if (!byRoute[r.route]) byRoute[r.route] = { total: 0, onTime: 0, delays: [] };
    const delay = (new Date(r.actualDep) - new Date(r.scheduledDep)) / 60000;
    byRoute[r.route].total++;
    if (delay <= 15) byRoute[r.route].onTime++;
    else byRoute[r.route].delays.push({ flight: r.flightNumber, date: r.date, delayMinutes: Math.round(delay) });
  });
  const summary = Object.entries(byRoute).map(([route, d]) => ({ route, flightsTracked: d.total, onTimePercent: Math.round((d.onTime / d.total) * 100) }));
  res.json({ success: true, summary, rawLog: data.slice(-100), apiCallCount });
});

app.get("/api/budget", (req, res) => {
  res.json({ apiCallCount, budgetLimit: BUDGET_LIMIT, estimatedCost: `$${(apiCallCount * 0.01).toFixed(2)}`, budgetRemaining: BUDGET_LIMIT - apiCallCount, recentCalls: apiCallLog.slice(-20) });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", apiCallCount, activeWatches: watchedFlights.size });
});

// Serve React frontend
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));
app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`FlightWatch server running on port ${PORT}`);
  if (process.env.DATABASE_URL) {
    await initDB();
    await loadWatchesFromDB();
  } else {
    console.warn("[DB] DATABASE_URL not set — watches will not persist across restarts");
  }
});
