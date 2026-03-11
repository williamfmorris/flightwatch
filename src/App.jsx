import { useState, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";

function getRiskLevel(analysis) {
  if (!analysis) return "unknown";
  if (analysis.risk === "safe") return "safe";
  if (analysis.risk === "tight") return "tight";
  if (analysis.risk === "delay_likely") return "risk";
  return "unknown";
}

const riskConfig = {
  safe:    { label: "LOOKS GOOD",       color: "#00e5a0", bg: "rgba(0,229,160,0.08)",  icon: "✓" },
  tight:   { label: "TIGHT TURNAROUND", color: "#f5c518", bg: "rgba(245,197,24,0.08)", icon: "⚠" },
  risk:    { label: "DELAY LIKELY",     color: "#ff4757", bg: "rgba(255,71,87,0.08)",  icon: "⚡" },
  unknown: { label: "CHECKING…",        color: "#888",    bg: "rgba(136,136,136,0.08)", icon: "?" },
};

function PulsingDot({ color }) {
  return (
    <span style={{ position: "relative", display: "inline-block", width: 10, height: 10, marginRight: 8, verticalAlign: "middle" }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, animation: "ping 1.4s ease-in-out infinite", opacity: 0.5 }} />
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color }} />
    </span>
  );
}

function ProgressBar({ value, color }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 4, height: 4, overflow: "hidden", marginTop: 8 }}>
      <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, value))}%`, background: color, borderRadius: 4, transition: "width 1s ease", boxShadow: `0 0 8px ${color}` }} />
    </div>
  );
}

function formatTime(isoString, timezone = "America/Toronto") {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
}

function FlightCard({ data, onWatch }) {
  const riskKey = getRiskLevel(data.analysis);
  const cfg = riskConfig[riskKey];
  const inb = data.inbound;
  const tz = data.timezone || "America/Toronto";

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${cfg.color}33`, borderRadius: 12, padding: "24px 28px", marginTop: 24, position: "relative", overflow: "hidden", animation: "fadeIn 0.4s ease" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${cfg.color}, transparent)` }} />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: "#fff", fontFamily: "'DM Mono', monospace", letterSpacing: -1 }}>{data.flightNumber}</span>
            <span style={{ fontSize: 13, color: "#888", letterSpacing: 1 }}>{data.route}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#666" }}>
            {data.gate ? `Gate ${data.gate} · ` : ""}Departs {formatTime(data.scheduledDeparture, tz)}
            {data.estimatedDeparture && data.estimatedDeparture !== data.scheduledDeparture &&
              <span style={{ color: "#f5c518", marginLeft: 8 }}>Est. {formatTime(data.estimatedDeparture, tz)}</span>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, marginBottom: 4 }}>RISK LEVEL</div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <PulsingDot color={cfg.color} />
            <span style={{ color: cfg.color, fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>{cfg.icon} {cfg.label}</span>
          </div>
        </div>
      </div>

      {/* Analysis message */}
      {data.analysis?.message && (
        <div style={{ marginTop: 16, padding: "12px 16px", background: `${cfg.bg}`, border: `1px solid ${cfg.color}22`, borderRadius: 8, fontSize: 13, color: "#ccc", lineHeight: 1.6 }}>
          {data.analysis.message}
        </div>
      )}

      {/* Inbound flight */}
      {inb && (
        <div style={{ marginTop: 16, padding: "14px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: "#555", marginBottom: 10 }}>INBOUND AIRCRAFT · {inb.flightNumber} FROM {inb.origin}</div>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>SCHED ARR</div>
              <div style={{ fontSize: 14, color: "#aaa", fontFamily: "monospace", marginTop: 2 }}>{formatTime(inb.scheduledArrival, tz)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>EST ARR</div>
              <div style={{ fontSize: 14, fontFamily: "monospace", marginTop: 2, color: inb.estimatedArrival !== inb.scheduledArrival ? "#f5c518" : "#00e5a0" }}>
                {formatTime(inb.estimatedArrival || inb.scheduledArrival, tz)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>DEPARTED</div>
              <div style={{ fontSize: 13, color: inb.departed ? "#00e5a0" : "#666", marginTop: 2, fontFamily: "monospace" }}>
                {inb.departed ? formatTime(inb.departedAt, tz) : "Not yet"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>PROGRESS</div>
              <div style={{ fontSize: 13, color: "#aaa", marginTop: 2 }}>{inb.progressPercent ?? "—"}%</div>
            </div>
          </div>
          <ProgressBar value={inb.progressPercent || 0} color={riskKey === "safe" ? "#00e5a0" : riskKey === "tight" ? "#f5c518" : "#ff4757"} />
        </div>
      )}

      {/* Buffer info */}
      {data.analysis?.gapMinutes != null && (
        <div style={{ marginTop: 16, display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div style={{ padding: "10px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 8, flex: 1, minWidth: 120 }}>
            <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>TIME GAP</div>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: "#ddd", marginTop: 2 }}>{data.analysis.gapMinutes}m</div>
          </div>
          <div style={{ padding: "10px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 8, flex: 1, minWidth: 120 }}>
            <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>TURNAROUND NEEDED</div>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: "#ddd", marginTop: 2 }}>{data.analysis?.turnaroundMinutes ?? 60}m</div>
          </div>
          <div style={{ padding: "10px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 8, flex: 1, minWidth: 120, border: `1px solid ${cfg.color}33` }}>
            <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>BUFFER</div>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: cfg.color, marginTop: 2 }}>{data.analysis.bufferMinutes}m</div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        <button onClick={() => onWatch(data)} style={{ flex: 1, padding: "11px 0", background: `linear-gradient(135deg, ${cfg.color}22, ${cfg.color}11)`, border: `1px solid ${cfg.color}55`, borderRadius: 8, color: cfg.color, fontSize: 12, fontWeight: 700, letterSpacing: 2, cursor: "pointer" }}>
          WATCH · GET SMS ALERTS
        </button>
      </div>
    </div>
  );
}

function SMSModal({ flightData, onClose }) {
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activate = async () => {
    if (!phone) return setError("Please enter a phone number");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/watch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flightNumber: flightData.flightNumber, date: flightData.date, phone })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      if (data.alreadyWatching) setError("Already watching this flight for this number.");
      else setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, backdropFilter: "blur(8px)" }}>
      <div style={{ background: "#0d0d0f", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 36, maxWidth: 420, width: "90%", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: "#666", fontSize: 20, cursor: "pointer" }}>✕</button>
        {!sent ? (
          <>
            <div style={{ fontSize: 11, letterSpacing: 3, color: "#555", marginBottom: 12 }}>SMS ALERTS</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 6 }}>{flightData.flightNumber}</div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 28, lineHeight: 1.6 }}>We'll check every 5 minutes and text you immediately if a delay becomes likely.</div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: "#555", marginBottom: 4 }}>YOUR PHONE NUMBER</div>
              <div style={{ fontSize: 11, color: "#444", marginBottom: 8 }}>Include country code · North America: +1 416 555 0100 · UK: +44 7911 123456</div>
              <input type="tel" placeholder="+1 416 555 0100" value={phone} onChange={e => setPhone(e.target.value)}
                style={{ width: "100%", padding: "12px 16px", boxSizing: "border-box", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff", fontSize: 15, fontFamily: "monospace", outline: "none" }} />
            </div>
            {error && <div style={{ marginBottom: 12, fontSize: 12, color: "#ff4757" }}>{error}</div>}
            <button onClick={activate} disabled={loading} style={{ width: "100%", padding: "13px", background: "linear-gradient(135deg, #00e5a0, #00b87a)", border: "none", borderRadius: 8, color: "#000", fontSize: 13, fontWeight: 800, letterSpacing: 2, cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
              {loading ? "ACTIVATING…" : "ACTIVATE WATCH"}
            </button>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#00e5a0", marginBottom: 8 }}>Watch Active</div>
            <div style={{ fontSize: 13, color: "#666", lineHeight: 1.7 }}>Monitoring {flightData.flightNumber} every 5 minutes.<br />You'll get a text if anything changes.</div>
            <button onClick={onClose} style={{ marginTop: 24, padding: "10px 28px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#aaa", fontSize: 12, cursor: "pointer" }}>CLOSE</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AccuracyTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/accuracy`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const mockSummary = [
    { route: "YYZ → YVR", flightsTracked: 142, onTimePercent: 61 },
    { route: "YYZ → YUL", flightsTracked: 98, onTimePercent: 78 },
    { route: "YVR → YYC", flightsTracked: 67, onTimePercent: 54 },
    { route: "YYZ → YEG", flightsTracked: 51, onTimePercent: 69 },
  ];

  const summary = data?.summary?.length ? data.summary : mockSummary;

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: "#fff", lineHeight: 1.15, letterSpacing: -1 }}>
          Hold airlines<br /><span style={{ color: "#f5c518" }}>accountable.</span>
        </h1>
        <p style={{ marginTop: 12, fontSize: 14, color: "#555", lineHeight: 1.7 }}>ETD accuracy tracked across routes. Every flight you check contributes to this dataset.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
        {summary.map(r => (
          <div key={r.route} style={{ padding: "18px 20px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#ddd", fontFamily: "monospace", marginBottom: 8 }}>{r.route}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: r.onTimePercent < 60 ? "#ff4757" : r.onTimePercent < 75 ? "#f5c518" : "#00e5a0" }}>{r.onTimePercent}%</div>
            <div style={{ fontSize: 11, color: "#444", marginTop: 4, letterSpacing: 1 }}>{r.flightsTracked} FLIGHTS TRACKED</div>
            <ProgressBar value={r.onTimePercent} color={r.onTimePercent < 60 ? "#ff4757" : r.onTimePercent < 75 ? "#f5c518" : "#00e5a0"} />
          </div>
        ))}
      </div>
      <div style={{ padding: "20px 24px", background: "rgba(245,197,24,0.05)", border: "1px solid rgba(245,197,24,0.15)", borderRadius: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#f5c518", letterSpacing: 2, marginBottom: 8 }}>COMING SOON</div>
        <div style={{ fontSize: 13, color: "#666", lineHeight: 1.7 }}>Export CSV · Public dashboard · Compare vs CRTC published stats · Social sharing</div>
      </div>
    </div>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [watchData, setWatchData] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const [activeTab, setActiveTab] = useState("watch");
  const [budget, setBudget] = useState(null);

  const handleSearch = async () => {
    const flight = query.trim().toUpperCase();
    if (!flight) return;
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/flight/${flight}?date=${date}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setResult({ ...data, date });
      setLastChecked(new Date());
      setBudget({ used: data.apiCallCount, remaining: data.budgetRemaining });
    } catch (err) {
      setError(err.message.includes("fetch") ? "Cannot connect to server. Is it running?" : err.message);
    } finally {
      setLoading(false);
    }
  };

  const today = new Date().toISOString().split("T")[0];

  return (
    <div style={{ minHeight: "100vh", background: "#080809", color: "#eee", fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes ping { 0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(2);opacity:0} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        input::placeholder{color:#333}
        button:hover{opacity:.85}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:#333;border-radius:4px}
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0 24px", position: "sticky", top: 0, background: "rgba(8,8,9,0.95)", backdropFilter: "blur(12px)", zIndex: 50 }}>
        <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>✈</span>
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 2, color: "#fff" }}>FLIGHTWATCH</span>
            <span style={{ fontSize: 10, letterSpacing: 1, color: "#444" }}>FLIGHT DELAY RISK</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {budget && (
              <span style={{ fontSize: 10, color: budget.remaining < 500 ? "#ff4757" : "#444", letterSpacing: 1 }}>
                {budget.used} API CALLS USED
              </span>
            )}
            <div style={{ display: "flex", background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 3 }}>
              {["watch", "track"].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: "5px 14px", borderRadius: 6, border: "none", background: activeTab === tab ? "rgba(255,255,255,0.08)" : "transparent", color: activeTab === tab ? "#fff" : "#555", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, cursor: "pointer" }}>
                  {tab === "watch" ? "WATCH" : "TRACK"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px 80px" }}>
        {activeTab === "watch" ? (
          <>
            <div style={{ marginBottom: 32 }}>
              <h1 style={{ fontSize: 32, fontWeight: 800, color: "#fff", lineHeight: 1.15, letterSpacing: -1 }}>
                Will your flight<br /><span style={{ color: "#00e5a0" }}>actually leave on time?</span>
              </h1>
              <p style={{ marginTop: 12, fontSize: 14, color: "#555", lineHeight: 1.7 }}>
                Checks if the inbound aircraft has enough turnaround time. Polls FlightAware every 5 minutes. Texts you if it doesn't.
              </p>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ position: "relative", flex: 1 }}>
                <input value={query} onChange={e => setQuery(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && handleSearch()} placeholder="AC123" maxLength={7}
                  style={{ width: "100%", padding: "14px 16px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#fff", fontSize: 18, fontFamily: "monospace", fontWeight: 700, outline: "none", letterSpacing: 2 }} />
              </div>
              <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)}
                style={{ padding: "14px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#aaa", fontSize: 13, outline: "none", colorScheme: "dark" }} />
              <button onClick={handleSearch} style={{ padding: "14px 24px", background: "#00e5a0", border: "none", borderRadius: 10, color: "#000", fontSize: 13, fontWeight: 800, letterSpacing: 1.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                CHECK
              </button>
            </div>

            {loading && (
              <div style={{ textAlign: "center", padding: "48px 0" }}>
                <div style={{ width: 32, height: 32, border: "2px solid #333", borderTopColor: "#00e5a0", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
                <div style={{ fontSize: 12, color: "#555", letterSpacing: 2 }}>QUERYING FLIGHTAWARE…</div>
              </div>
            )}
            {error && <div style={{ marginTop: 20, padding: "14px 18px", background: "rgba(255,71,87,0.08)", border: "1px solid rgba(255,71,87,0.2)", borderRadius: 10, fontSize: 13, color: "#ff6b7a" }}>{error}</div>}
            {result && !loading && (
              <>
                <FlightCard data={result} onWatch={setWatchData} />
                {lastChecked && <div style={{ marginTop: 12, fontSize: 11, color: "#444", letterSpacing: 1, textAlign: "right" }}>LIVE DATA · LAST FETCHED {lastChecked.toLocaleTimeString()}</div>}
              </>
            )}
          </>
        ) : <AccuracyTab />}
      </div>

      {watchData && <SMSModal flightData={watchData} onClose={() => setWatchData(null)} />}
    </div>
  );
}
