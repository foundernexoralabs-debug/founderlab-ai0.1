import { useState, useRef } from "react";
import { formatTime } from "@/lib/clipUtils";

const C = {
  bg: "#09090f",
  surf: "#0f0f1a",
  surfHigh: "#15152a",
  border: "rgba(255,255,255,.07)",
  borderHov: "rgba(255,255,255,.12)",
  borderFocus: "rgba(99,102,241,.5)",
  accent: "#6366f1",
  accentM: "rgba(99,102,241,.12)",
  green: "#10b981",
  greenM: "rgba(16,185,129,.12)",
  yellow: "#f59e0b",
  yellowM: "rgba(245,158,11,.12)",
  red: "#ef4444",
  redM: "rgba(239,68,68,.12)",
  t1: "#eeeef8",
  t2: "#8888b0",
  t3: "#44445a",
};

export default function ViralClipStudio() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("idle"); // idle | downloading | splitting | analyzing | done
  const [bestClip, setBestClip] = useState(null);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState(null);
  const videoRef = useRef(null);

  const handleAnalyze = async () => {
    if (!url.trim()) return;
    setError("");
    setBestClip(null);
    try {
      // 1. Initiate download
      setStatus("downloading");
      const resDownload = await fetch("/api/youtube/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!resDownload.ok) throw new Error("Download failed");
      const { sessionId: sid } = await resDownload.json();
      setSessionId(sid);

      // 2. Split video
      setStatus("splitting");
      const resSplit = await fetch("/api/youtube/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, segmentDuration: 60 }),
      });
      if (!resSplit.ok) throw new Error("Segmentation failed");
      const { segments } = await resSplit.json();

      // 3. Analyze with Groq (for Phase 1, pick first segment as a demonstration)
      setStatus("analyzing");
      const resAnalyze = await fetch("/api/youtube/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, segmentIndex: 0 }),
      });
      if (!resAnalyze.ok) throw new Error("Analysis failed");
      const analysis = await resAnalyze.json();
      setBestClip(analysis.bestClip);
      setStatus("done");
    } catch (err) {
      setError(err.message);
      setStatus("idle");
    }
  };

  const handleDownloadClip = async () => {
    if (!bestClip || !sessionId) return;
    const res = await fetch("/api/youtube/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        start: bestClip.start,
        end: bestClip.end,
      }),
    });
    if (!res.ok) {
      alert("Clip download failed");
      return;
    }
    const blob = await res.blob();
    const urlObj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = urlObj;
    a.download = `viral_clip_${Date.now()}.mp4`;
    a.click();
    URL.revokeObjectURL(urlObj);
  };

  return (
    <div style={{ padding: "32px 32px 48px", maxWidth: 900, height: "100%", overflowY: "auto" }}>
      <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
        <h2
          style={{
            margin: "0 0 8px",
            fontSize: 22,
            fontWeight: 700,
            background: "linear-gradient(to right, rgb(99,102,241), rgb(168,85,247))",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Viral Clip Studio
        </h2>
        <p style={{ margin: "0 0 24px", color: C.t2, fontSize: 14 }}>
          Paste a YouTube link, get the most viral-worthy clip instantly.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            style={{
              flex: 1,
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              padding: "10px 14px",
              background: "rgba(255,255,255,.02)",
              color: C.t1,
              fontSize: 14,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
          <button
            onClick={handleAnalyze}
            disabled={status !== "idle" && status !== "done"}
            style={{
              background: C.accent,
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 500,
              cursor: status !== "idle" && status !== "done" ? "not-allowed" : "pointer",
              opacity: status !== "idle" && status !== "done" ? 0.5 : 1,
            }}
          >
            {status === "idle" || status === "done" ? "Analyze" : "Working..."}
          </button>
        </div>

        {/* Status messages */}
        {status !== "idle" && status !== "done" && (
          <div style={{ fontSize: 13, color: C.t2, marginBottom: 16, animation: "pulse 1.5s infinite" }}>
            {status === "downloading" && "⏳ Downloading video..."}
            {status === "splitting" && "⏳ Splitting into segments..."}
            {status === "analyzing" && "⏳ AI analyzing segment..."}
          </div>
        )}

        {error && (
          <div style={{ color: C.red, fontSize: 13, marginBottom: 16 }}>
            ⚠️ {error}
          </div>
        )}

        {bestClip && (
          <div style={{ marginTop: 24, animation: "fadeIn 0.4s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontSize: 32, fontWeight: 700, color: C.accent }}>
                {bestClip.viralityScore}/100
              </span>
              <span style={{ fontSize: 12, color: C.t2 }}>
                {formatTime(bestClip.start)} – {formatTime(bestClip.end)}
              </span>
            </div>
            <p style={{ fontSize: 14, color: C.t1, fontStyle: "italic", margin: "0 0 8px" }}>
              "{bestClip.transcript}"
            </p>
            <p style={{ fontSize: 12, color: C.t2, margin: "0 0 16px" }}>
              {bestClip.reason}
            </p>

            {/* In-browser preview */}
            <div style={{ borderRadius: 12, overflow: "hidden", background: "#000", marginBottom: 16 }}>
              <video
                ref={videoRef}
                src={`/api/youtube/stream?sessionId=${sessionId}&start=${bestClip.start}&end=${bestClip.end}`}
                controls
                style={{ width: "100%", display: "block" }}
              />
            </div>

            <button
              onClick={handleDownloadClip}
              style={{
                background: "transparent",
                border: `1px solid ${C.borderFocus}`,
                color: C.accent,
                borderRadius: 10,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              ⬇ Download Clip (No Watermark)
            </button>
          </div>
        )}

        {/* Empty state */}
        {status === "idle" && !bestClip && (
          <div style={{ textAlign: "center", padding: "40px 0", color: C.t3 }}>
            <p style={{ fontSize: 32, margin: "0 0 12px" }}>🎬</p>
            <p>Paste a URL and hit Analyze to find your viral moment.</p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
