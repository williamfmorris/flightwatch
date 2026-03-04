require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cron = require("node-cron");
const path = require("path");

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
const TURNAROUND_MINUTES = 60;

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

// IATA airline code → ICAO airline code mapping
const IATA_TO_ICAO = { AC: "ACA" }; // Air Canada

function toIcaoIdent(flightNumber) {
  const f = flightNumber.trim().toUpperCase();
  for (const [iata, icao] of Object.entries(IATA_TO_ICAO)) {
    if (f.startsWith(iata) && !f.startsWith(icao)) {
      return icao + f.slice(iata.length);
    }
  }
  return f;
}

async function getFlightInfo(flightNumber, date) {
  const icao = toIcaoIdent(flightNumber);
  if (!trackApiCall(`/flights/${icao}`)) throw new Error("Budget limit reached");
  console.log(`[API] Fetching ${icao} (from ${flightNumber}) for ${date} with key ${FLIGHTAWARE_API_KEY ? FLIGHTAWARE_API_KEY.slice(0,6) + '...' : 'MISSING'}`);
  // Use Eastern Time boundaries: 05:00Z = midnight EST (UTC-5), covering all ET departures on the given calendar date
  const startET = new Date(date + 'T05:00:00Z');
  const endET   = new Date(startET.getTime() + 86400000);
  const response = await axios.get(`${FLIGHTAWARE_BASE}/flights/${icao}`, {
    headers: { "x-apikey": FLIGHTAWARE_API_KEY },
    params: { start: startET.toISOString(), end: endET.toISOString() }
  });
  const flights = response.data.flights || [];
  if (!flights.length) throw new Error(`No flights found for ${flightNumber} on ${date}`);
  return flights[0];
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
  const scheduledDep = new Date(flight.scheduled_out);
  const estimatedArr = new Date(inbound.estimated_in || inbound.scheduled_in);
  const gapMinutes = (scheduledDep - estimatedArr) / 60000;
  const bufferMinutes = gapMinutes - TURNAROUND_MINUTES;
  let risk, message;
  if (bufferMinutes >= 15) {
    risk = "safe";
    message = `Inbound ${inbound.ident} arrives ${formatTime(estimatedArr)}, leaving ${Math.round(bufferMinutes)} min buffer after turnaround.`;
  } else if (bufferMinutes >= 0) {
    risk = "tight";
    message = `Inbound ${inbound.ident} arrives ${formatTime(estimatedArr)}. Only ${Math.round(bufferMinutes)} min buffer — could be tight.`;
  } else {
    risk = "delay_likely";
    message = `DELAY LIKELY: Inbound ${inbound.ident} arrives ${formatTime(estimatedArr)}, only ${Math.round(gapMinutes)} min before departure — not enough for ${TURNAROUND_MINUTES} min turnaround.`;
  }
  return { risk, message, gapMinutes: Math.round(gapMinutes), bufferMinutes: Math.round(bufferMinutes), inboundETA: estimatedArr.toISOString() };
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
    const flight = await getFlightInfo(flightNumber, date);
    let inbound = null;
    if (flight.inbound_fa_flight_id) inbound = await getInboundFlight(flight.inbound_fa_flight_id);
    const analysis = analyzeRisk(flight, inbound);
    const watch = watchedFlights.get(watchId);
    accuracyLog.push({ flightNumber, date, route: `${flight.origin?.code_iata} → ${flight.destination?.code_iata}`, scheduledDep: flight.scheduled_out, actualDep: flight.actual_out, checkedAt: new Date().toISOString(), risk: analysis.risk });
    if (phone && watch && watch.lastRisk !== analysis.risk && (analysis.risk === "delay_likely" || analysis.risk === "tight")) {
      await sendSMS(phone, `FlightWatch: ${flightNumber} (${flight.origin?.code_iata}→${flight.destination?.code_iata}) ${analysis.message}`);
      watch.lastRisk = analysis.risk;
    }
    if (flight.actual_off) {
      const job = activeCronJobs.get(watchId);
      if (job) { job.stop(); activeCronJobs.delete(watchId); }
      watchedFlights.delete(watchId);
      if (phone) await sendSMS(phone, `FlightWatch: ${flightNumber} has departed. Safe travels!`);
    }
    return { flight, inbound, analysis, apiCallCount };
  } catch (err) {
    console.error(`[Poll] Error:`, err.message);
    throw err;
  }
}

app.get("/api/flight/:flightNumber", async (req, res) => {
  try {
    const { flightNumber } = req.params;
    const { date } = req.query;
    const flightDate = date || new Date().toISOString().split("T")[0];
    const flight = await getFlightInfo(flightNumber.toUpperCase(), flightDate);
    let inbound = null;
    if (flight.inbound_fa_flight_id) inbound = await getInboundFlight(flight.inbound_fa_flight_id);
    const analysis = analyzeRisk(flight, inbound);
    res.json({ success: true, flightNumber: flight.ident, route: `${flight.origin?.code_iata} → ${flight.destination?.code_iata}`, scheduledDeparture: flight.scheduled_out, estimatedDeparture: flight.estimated_out, actualDeparture: flight.actual_out, gate: flight.gate_origin, status: flight.status, inbound: inbound ? { flightNumber: inbound.ident, origin: inbound.origin?.code_iata, scheduledArrival: inbound.scheduled_in, estimatedArrival: inbound.estimated_in, actualArrival: inbound.actual_in, departed: !!inbound.actual_off, departedAt: inbound.actual_off, progressPercent: inbound.progress_percent } : null, analysis, apiCallCount, budgetRemaining: BUDGET_LIMIT - apiCallCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/watch", async (req, res) => {
  try {
    const { flightNumber, date, phone } = req.body;
    if (!flightNumber || !date) return res.status(400).json({ error: "flightNumber and date required" });
    const watchId = `${flightNumber}-${date}-${Date.now()}`;
    watchedFlights.set(watchId, { flightNumber, date, phone, lastRisk: null, startedAt: new Date().toISOString() });
    const result = await checkFlight(flightNumber.toUpperCase(), date, phone, watchId);
    const job = cron.schedule("*/5 * * * *", async () => { await checkFlight(flightNumber.toUpperCase(), date, phone, watchId); });
    activeCronJobs.set(watchId, job);
    if (phone) await sendSMS(phone, `FlightWatch activated for ${flightNumber} on ${date}. You'll get alerts if a delay is likely.`);
    res.json({ success: true, watchId, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/watch/:watchId", (req, res) => {
  const job = activeCronJobs.get(req.params.watchId);
  if (job) { job.stop(); activeCronJobs.delete(req.params.watchId); }
  watchedFlights.delete(req.params.watchId);
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
app.listen(PORT, () => console.log(`FlightWatch server running on port ${PORT}`));
