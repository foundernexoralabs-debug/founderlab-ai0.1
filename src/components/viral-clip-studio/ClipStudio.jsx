import { useState, useRef } from "react";
import { formatTime } from "@/lib/clipUtils";
import KaraokePreview from "./KaraokePreview";
import ReframePanel from "./ReframePanel";
import SafetyBadge from "./SafetyBadge";
import AudioReplaceUI from "./AudioReplaceUI";
import ThumbnailGenerator from "./ThumbnailGenerator";
import ExportProSettings from "./ExportProSettings";

const C = {
  bg:"#09090f", surf:"#0f0f1a", surfHigh:"#15152a",
  border:"rgba(255,255,255,.07)", borderHov:"rgba(255,255,255,.12)", borderFocus:"rgba(99,102,241,.5)",
  accent:"#6366f1", accentM:"rgba(99,102,241,.12)",
  green:"#10b981", greenM:"rgba(16,185,129,.12)",
  yellow:"#f59e0b", red:"#ef4444",
  t1:"#eeeef8", t2:"#8888b0", t3:"#44445a",
};

const DEFAULT_EXPORT = { resolution:"1080p", fps:30, codec:"h264", bitrateControl:"CBR", includeCaptions:true, includeAudioDub:false };

export default function ViralClipStudio() {
  const [url, setUrl]               = useState("");
  const [status, setStatus]         = useState("idle");
  const [clips, setClips]           = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [error, setError]           = useState("");
  const [sessionId, setSessionId]   = useState(null);
  const videoRef                    = useRef(null);

  // Phase 3 state
  const [karaokeStyle, setKaraokeStyle]   = useState("highlight");
  const [aspectRatio, setAspectRatio]     = useState("9:16");
  const [safetyStatus, setSafetyStatus]   = useState(null);
  const [exportSettings, setExportSettings] = useState(DEFAULT_EXPORT);
  const [thumbnailUrl, setThumbnailUrl]   = useState(null);
  const [thumbGenerating, setThumbGen]    = useState(false);
  const [dubStatus, setDubStatus]         = useState(null);
  const [exporting, setExporting]         = useState(false);

  const selectedClip = clips[selectedIdx] ?? null;
  const words        = selectedClip?.words ?? [];

  // ── Pipeline ─────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!url.trim()) return;
    setError(""); setClips([]); setSelectedIdx(null); setSafetyStatus(null); setThumbnailUrl(null);
    try {
      setStatus("downloading");
      const r1 = await fetch("/api/youtube/download", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ url }) });
      if (!r1.ok) throw new Error("Download failed — check the URL and try again");
      const { sessionId: sid } = await r1.json();
      setSessionId(sid);

      setStatus("splitting");
      const r2 = await fetch("/api/youtube/segment", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ sessionId: sid, segmentDuration: 60 }) });
      if (!r2.ok) throw new Error("Video splitting failed");

      setStatus("analyzing");
      const r3 = await fetch("/api/youtube/analyze-all", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ sessionId: sid }) });
      if (!r3.ok) throw new Error("Analysis failed");
      const { clips: found } = await r3.json();
      setClips(found ?? []);
      if (found?.length) { setSelectedIdx(0); setSafetyStatus(!found[0].copyrightRiskFlag); }
      setStatus("done");
    } catch (err) {
      setError(err.message);
      setStatus("idle");
    }
  };

  const handleDownloadClip = async () => {
    if (!selectedClip || !sessionId) return;
    const res = await fetch("/api/youtube/clip", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ sessionId, start:selectedClip.start, end:selectedClip.end }) });
    if (!res.ok) { alert("Clip download failed"); return; }
    const blob = await res.blob();
    const a = Object.assign(document.createElement("a"), { href:URL.createObjectURL(blob), download:`viral_clip_${Date.now()}.mp4` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  const handleAudioDub = async (provider, gender) => {
    if (!selectedClip || !sessionId) return;
    setDubStatus("dubbing");
    const res = await fetch("/api/youtube/ai-dub", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ transcript: selectedClip.transcript, provider, gender }) });
    setDubStatus(res.ok ? "done" : "error");
  };

  const handleGenerateThumbnail = async (title) => {
    if (!sessionId || !selectedClip) return;
    setThumbGen(true); setThumbnailUrl(null);
    const res = await fetch("/api/youtube/generate-thumbnail", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ sessionId, start:selectedClip.start, title, aspectRatio }) });
    if (res.ok) { const blob = await res.blob(); setThumbnailUrl(URL.createObjectURL(blob)); }
    setThumbGen(false);
  };

  const handleExportPro = async () => {
    if (!sessionId || !selectedClip) return;
    setExporting(true);
    const res = await fetch("/api/youtube/export-pro", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ sessionId, start:selectedClip.start, end:selectedClip.end, words, captionStyle:karaokeStyle, aspectRatio, exportSettings, includeAudioDub:exportSettings.includeAudioDub }),
    });
    if (!res.ok) { alert("Export failed: " + (await res.json().catch(()=>({error:"Unknown"}))).error); setExporting(false); return; }
    const blob = await res.blob();
    const a = Object.assign(document.createElement("a"), { href:URL.createObjectURL(blob), download:"pro_clip.mp4" });
    a.click(); URL.revokeObjectURL(a.href);
    setExporting(false);
  };

  // ── Virality score ring ───────────────────────────────────────
  function ScoreRing({ score }) {
    const c = score >= 80 ? C.green : score >= 60 ? C.yellow : C.red;
    return (
      <div style={{ position:"relative", width:72, height:72, flexShrink:0 }}>
        <svg width={72} height={72} style={{ transform:"rotate(-90deg)" }}>
          <circle cx={36} cy={36} r={30} fill="none" stroke={C.border} strokeWidth={6} />
          <circle cx={36} cy={36} r={30} fill="none" stroke={c} strokeWidth={6} strokeLinecap="round"
            strokeDasharray={`${2*Math.PI*30}`} strokeDashoffset={`${2*Math.PI*30*(1-score/100)}`}
            style={{ transition:"stroke-dashoffset .6s ease" }} />
        </svg>
        <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, fontWeight:700, color:c }}>{score}</span>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ padding:"32px 32px 48px", maxWidth:900 }}>
      {/* Header */}
      <div style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:14, padding:24, marginBottom:20 }}>
        <h2 style={{ margin:"0 0 6px", fontSize:22, fontWeight:700, background:"linear-gradient(to right,#6366f1,#a855f7)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>
          🎬 Viral Clip Studio
        </h2>
        <p style={{ margin:"0 0 20px", color:C.t2, fontSize:14 }}>Paste a YouTube URL → AI finds viral moments, adds karaoke captions, reframes for Shorts, and exports in 4K.</p>

        <div style={{ display:"flex", gap:8 }}>
          <input value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAnalyze()} placeholder="https://www.youtube.com/watch?v=..."
            style={{ flex:1, borderRadius:10, border:`1px solid ${C.border}`, padding:"10px 14px", background:"rgba(255,255,255,.02)", color:C.t1, fontSize:14, fontFamily:"inherit", outline:"none" }} />
          <button onClick={handleAnalyze} disabled={status!=="idle"&&status!=="done"}
            style={{ background:C.accent, color:"#fff", border:"none", borderRadius:10, padding:"10px 22px", fontSize:14, fontWeight:600, cursor:status!=="idle"&&status!=="done"?"not-allowed":"pointer", opacity:status!=="idle"&&status!=="done"?0.5:1, transition:"all .15s" }}>
            {status==="idle"||status==="done" ? "Analyze" : "Working…"}
          </button>
        </div>

        {status!=="idle"&&status!=="done"&&(
          <div style={{ marginTop:14, display:"flex", alignItems:"center", gap:10, fontSize:13, color:C.t2 }}>
            <span style={{ animation:"spin 1s linear infinite", display:"inline-block" }}>⏳</span>
            {status==="downloading"&&"Downloading video…"}
            {status==="splitting"&&"Splitting into 60-second segments…"}
            {status==="analyzing"&&"AI analyzing every segment for virality…"}
          </div>
        )}
        {error&&<p style={{ margin:"12px 0 0", color:C.red, fontSize:13 }}>⚠ {error}</p>}
      </div>

      {/* Clips list */}
      {clips.length>0&&(
        <div style={{ marginBottom:20 }}>
          <p style={{ margin:"0 0 10px", fontSize:12, fontWeight:600, color:C.t3, textTransform:"uppercase", letterSpacing:".06em" }}>Viral Segments — ranked by score</p>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {clips.map((clip,i)=>(
              <button key={i} onClick={()=>{setSelectedIdx(i);setSafetyStatus(!clip.copyrightRiskFlag);setThumbnailUrl(null);}}
                style={{ display:"flex", alignItems:"center", gap:16, padding:"14px 16px", borderRadius:12, border:`2px solid ${selectedIdx===i?C.accent:C.border}`, background:selectedIdx===i?C.accentM:C.surf, cursor:"pointer", fontFamily:"inherit", textAlign:"left", transition:"all .15s" }}>
                <ScoreRing score={clip.viralityScore} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                    <span style={{ fontSize:13, fontWeight:700, color:C.t1 }}>{formatTime(clip.start)} – {formatTime(clip.end)}</span>
                    {clip.copyrightRiskFlag&&<span style={{ fontSize:10, color:C.red, background:"rgba(239,68,68,.12)", border:"1px solid rgba(239,68,68,.3)", borderRadius:99, padding:"1px 8px" }}>⚠ Music</span>}
                  </div>
                  {clip.suggestedTitle&&<p style={{ margin:0, fontSize:12, color:C.accent, fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{clip.suggestedTitle}</p>}
                  {clip.reason&&<p style={{ margin:"2px 0 0", fontSize:11, color:C.t3, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{clip.reason}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected clip detail */}
      {selectedClip&&(
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {/* Safety badge */}
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <SafetyBadge safe={safetyStatus} />
            {selectedClip.hook&&<span style={{ fontSize:12, color:C.t2, fontStyle:"italic" }}>Hook: "{selectedClip.hook}"</span>}
          </div>

          {/* Video preview */}
          <div style={{ background:"#000", borderRadius:12, overflow:"hidden", border:`1px solid ${C.border}` }}>
            <video ref={videoRef} src={`/api/youtube/stream?sessionId=${sessionId}`} controls
              style={{ width:"100%", display:"block", maxHeight:360 }} />
          </div>

          {/* Quick download */}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={handleDownloadClip}
              style={{ padding:"9px 18px", borderRadius:10, border:`1px solid ${C.borderFocus}`, background:C.accentM, color:C.accent, cursor:"pointer", fontSize:13, fontWeight:500, fontFamily:"inherit", transition:"all .15s" }}>
              ⬇ Download Clip
            </button>
            {selectedClip.hashtags?.length>0&&(
              <div style={{ display:"flex", gap:4, flexWrap:"wrap", alignItems:"center" }}>
                {selectedClip.hashtags.slice(0,5).map((h,i)=>(
                  <span key={i} style={{ fontSize:11, color:C.accent, background:C.accentM, borderRadius:99, padding:"2px 8px" }}>{h}</span>
                ))}
              </div>
            )}
          </div>

          {/* Karaoke captions */}
          <KaraokePreview words={words} style={karaokeStyle} onChangeStyle={setKaraokeStyle} />

          {/* Smart reframe */}
          <ReframePanel ratio={aspectRatio} onChange={setAspectRatio} />

          {/* AI voice dub */}
          <AudioReplaceUI voiceProvider="elevenlabs" voiceGender="male" onDub={handleAudioDub} dubStatus={dubStatus} />

          {/* Thumbnail */}
          <ThumbnailGenerator onGenerate={handleGenerateThumbnail} thumbnailUrl={thumbnailUrl} generating={thumbGenerating} />

          {/* Export settings */}
          <ExportProSettings settings={exportSettings} onChange={setExportSettings} />

          {/* Pro export button */}
          <button onClick={handleExportPro} disabled={exporting}
            style={{ padding:"13px 24px", borderRadius:12, border:"none", background:exporting?"rgba(99,102,241,.5)":`linear-gradient(135deg,${C.accent},#a855f7)`, color:"#fff", cursor:exporting?"not-allowed":"pointer", fontSize:15, fontWeight:700, fontFamily:"inherit", boxShadow:`0 4px 20px rgba(99,102,241,.35)`, transition:"all .2s", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
            {exporting ? "⏳ Exporting…" : "🚀 Export Pro Clip"}
          </button>

          <p style={{ margin:0, fontSize:11, color:C.t3, textAlign:"center" }}>
            Applies: {aspectRatio} reframe · Karaoke captions ({karaokeStyle}) · {exportSettings.resolution} {exportSettings.fps}fps · {exportSettings.codec.toUpperCase()} · {exportSettings.bitrateControl} · No watermark
          </p>
        </div>
      )}

      {/* Empty state */}
      {status==="idle"&&!clips.length&&!error&&(
        <div style={{ textAlign:"center", padding:"48px 0", color:C.t3 }}>
          <p style={{ fontSize:40, margin:"0 0 12px" }}>🎬</p>
          <p style={{ margin:0, fontSize:14 }}>Paste a YouTube URL and hit Analyze to find viral moments.</p>
          <p style={{ margin:"6px 0 0", fontSize:12 }}>Supports any public video · Powered by Groq Whisper + AI analysis</p>
        </div>
      )}

      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
