import { useEffect, useState } from "react";

interface HealthData {
  status: string;
  timestamp: string;
  service: string;
  version: string;
  dataRegion: string;
  compliance: Record<string, string>;
  database: string;
}

export default function Home() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://localhost:3001/api/health")
      .then((r) => r.json())
      .then((d) => { setHealth(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(135deg, #006B3F 0%, #FCD116 50%, #CE1126 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "white", borderRadius: 16, padding: 40, maxWidth: 720, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🇬🇭</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#006B3F", marginBottom: 4 }}>Ghana Savings & Loans</h1>
          <p style={{ color: "#666", fontSize: 15 }}>Production-Ready BoG-Regulated Fintech Platform</p>
        </div>

        {/* API Status */}
        <div style={{ background: loading ? "#f0f0f0" : health ? "#f0fdf4" : "#fef2f2", borderRadius: 12, padding: 20, marginBottom: 24, border: `2px solid ${loading ? "#ddd" : health ? "#22c55e" : "#ef4444"}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>{loading ? "⏳" : health ? "✅" : "❌"}</span>
            <strong style={{ fontSize: 16 }}>Back-Office API</strong>
            <span style={{ marginLeft: "auto", fontSize: 13, color: "#888" }}>localhost:3001</span>
          </div>
          {health && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Stat label="Status" value={health.status.toUpperCase()} green />
              <Stat label="Database" value={health.database.toUpperCase()} green={health.database === "ok"} />
              <Stat label="Version" value={health.version} />
              <Stat label="Data Region" value={health.dataRegion} />
            </div>
          )}
          {!loading && !health && <p style={{ color: "#dc2626", fontSize: 14 }}>API not reachable — check back-office is running on port 3001</p>}
          {loading && <p style={{ color: "#888", fontSize: 14 }}>Connecting to API...</p>}
        </div>

        {/* Compliance Status */}
        {health?.compliance && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#333", marginBottom: 12 }}>Regulatory Compliance</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {Object.entries(health.compliance).map(([key, val]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#f0fdf4", borderRadius: 8 }}>
                  <span style={{ color: "#22c55e", fontSize: 16 }}>✓</span>
                  <span style={{ fontSize: 13, color: "#333" }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Links */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
          <a href="http://localhost:3001/api/docs" target="_blank" rel="noreferrer" style={linkStyle("#006B3F")}>
            📋 Swagger API Docs
          </a>
          <a href="http://localhost:3003" target="_blank" rel="noreferrer" style={linkStyle("#1d4ed8")}>
            📊 Grafana Dashboards
          </a>
          <a href="http://localhost:9091" target="_blank" rel="noreferrer" style={linkStyle("#e85d04")}>
            🗄 MinIO Storage
          </a>
          <a href="https://github.com/KofiBusia/SAVINGS-AND-LOANS" target="_blank" rel="noreferrer" style={linkStyle("#1f2937")}>
            💻 GitHub Repository
          </a>
        </div>

        {/* Module Overview */}
        <div style={{ borderTop: "1px solid #eee", paddingTop: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#333", marginBottom: 12 }}>Platform Modules</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[
              { icon: "📱", label: "Mobile App", desc: "React Native, 5 languages, USSD fallback" },
              { icon: "🏢", label: "Front Office", desc: "Field officer PWA, offline-capable" },
              { icon: "⚙️", label: "Back Office", desc: "NestJS compliance engine" },
              { icon: "🔐", label: "KYC/AML", desc: "12-step Ghana Card state machine" },
              { icon: "💰", label: "GhIPSS MMI", desc: "MoMo / Telecel / AirtelTigo" },
              { icon: "📜", label: "BoG Reports", desc: "Daily / monthly automated" },
            ].map((m) => (
              <div key={m.label} style={{ background: "#f8fafc", borderRadius: 10, padding: 14, textAlign: "center" }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>{m.icon}</div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#1f2937", marginBottom: 3 }}>{m.label}</div>
                <div style={{ fontSize: 11, color: "#888", lineHeight: 1.4 }}>{m.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <p style={{ textAlign: "center", color: "#aaa", fontSize: 11, marginTop: 20 }}>
          Regulated by Bank of Ghana · Data Protection Act 843 · AML Act 1044 · Digital Credit Directive 2025
        </p>
      </div>
    </main>
  );
}

function Stat({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div style={{ background: "white", borderRadius: 8, padding: "8px 12px" }}>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 13, color: green ? "#16a34a" : "#1f2937" }}>{value}</div>
    </div>
  );
}

function linkStyle(bg: string) {
  return {
    display: "flex", alignItems: "center", justifyContent: "center",
    background: bg, color: "white", borderRadius: 10, padding: "12px 16px",
    textDecoration: "none", fontSize: 14, fontWeight: 600, gap: 6,
  };
}
