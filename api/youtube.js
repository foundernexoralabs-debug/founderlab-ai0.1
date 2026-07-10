import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessions = new Map();

// Ensure temp directory exists
const tmpDir = path.join(os.tmpdir(), "founderlab-viral");
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// Helper: Download video
async function downloadVideo(url, sessionId) {
  const outputDir = path.join(tmpDir, sessionId);
  fs.mkdirSync(outputDir, { recursive: true });

  const outputTemplate = path.join(outputDir, "source.%(ext)s");
  const command = `yt-dlp -f "bestvideo[height<=2160]+bestaudio/best[height<=2160]" --merge-output-format mp4 -o "${outputTemplate}" "${url}"`;

  try {
    execSync(command, { stdio: "inherit" });
    const videoPath = path.join(outputDir, "source.mp4");
    return videoPath;
  } catch (error) {
    throw new Error(`yt-dlp download failed: ${error.message}`);
  }
}

// Helper: Split video
async function splitVideo(videoPath, sessionId, segmentDuration = 60) {
  const outputDir = path.join(path.dirname(videoPath));
  const segments = [];

  try {
    const ffprobeCmd = `ffprobe -v error -show_format -of default=noprint_wrappers=1:nokey=1:noprint_wrappers=1 -show_entries format=duration "${videoPath}"`;
    const durationStr = execSync(ffprobeCmd, { encoding: "utf8" }).trim();
    const duration = parseFloat(durationStr);

    let start = 0;
    let index = 0;

    while (start < duration) {
      const end = Math.min(start + segmentDuration, duration);
      const outputFile = path.join(outputDir, `seg_${index}.mp4`);

      const ffmpegCmd = `ffmpeg -i "${videoPath}" -ss ${start} -t ${segmentDuration} -c copy "${outputFile}"`;
      execSync(ffmpegCmd, { stdio: "inherit" });

      segments.push({ start, end, filePath: outputFile, index });
      start = end;
      index++;
    }

    return segments;
  } catch (error) {
    throw new Error(`FFmpeg split failed: ${error.message}`);
  }
}

// Helper: Extract audio and transcribe
async function transcribeSegment(segmentPath, sessionId, segmentIndex) {
  const audioPath = path.join(os.tmpdir(), `${sessionId}_seg${segmentIndex}.wav`);

  try {
    // Extract audio
    const ffmpegCmd = `ffmpeg -i "${segmentPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}"`;
    execSync(ffmpegCmd, { stdio: "inherit" });

    // Use Groq transcription API
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      throw new Error("GROQ_API_KEY not set");
    }

    // Simple fallback: use a placeholder transcript for Phase 1
    const transcript = "[Transcription would happen here via Groq Whisper API]";

    // Clean up audio
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }

    return transcript;
  } catch (error) {
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
    throw new Error(`Transcription failed: ${error.message}`);
  }
}

// API route handlers
export default async function handler(req, res) {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  // Download endpoint
  if (pathname === "/api/youtube/download" && req.method === "POST") {
    const { url } = await req.json();
    if (!url) return res.status(400).json({ error: "No URL" });

    try {
      const sessionId = crypto.randomUUID();
      const videoPath = await downloadVideo(url, sessionId);
      sessions.set(sessionId, { videoPath });
      return res.json({ sessionId });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Segment endpoint
  if (pathname === "/api/youtube/segment" && req.method === "POST") {
    const { sessionId, segmentDuration = 60 } = await req.json();
    const session = sessions.get(sessionId);
    if (!session) return res.status(400).json({ error: "Invalid session" });

    try {
      const segments = await splitVideo(session.videoPath, sessionId, segmentDuration);
      session.segments = segments;
      sessions.set(sessionId, session);
      return res.json({ segments: segments.map((s) => ({ start: s.start, end: s.end })) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Analyze endpoint
  if (pathname === "/api/youtube/analyze" && req.method === "POST") {
    const { sessionId, segmentIndex = 0 } = await req.json();
    const session = sessions.get(sessionId);
    if (!session || !session.segments) {
      return res.status(400).json({ error: "Segments not found" });
    }

    const segment = session.segments[segmentIndex];
    if (!segment) return res.status(400).json({ error: "Segment not found" });

    try {
      const transcript = await transcribeSegment(segment.filePath, sessionId, segmentIndex);

      // Mock Groq analysis for Phase 1
      const viralityScore = Math.floor(Math.random() * 40) + 60; // 60-100
      const reason = "This segment has strong engagement potential with clear hooks and value delivery.";

      return res.json({
        bestClip: {
          start: segment.start,
          end: segment.end,
          transcript,
          viralityScore,
          reason,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Clip download endpoint
  if (pathname === "/api/youtube/clip" && req.method === "POST") {
    const { sessionId, start, end } = await req.json();
    const session = sessions.get(sessionId);
    if (!session) return res.status(400).json({ error: "Invalid session" });

    try {
      const outputFile = path.join(os.tmpdir(), `clip_${sessionId}.mp4`);
      const duration = end - start;

      const ffmpegCmd = `ffmpeg -i "${session.videoPath}" -ss ${start} -t ${duration} -c copy "${outputFile}"`;
      execSync(ffmpegCmd, { stdio: "inherit" });

      const fileStream = fs.createReadStream(outputFile);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", 'attachment; filename="viral_clip.mp4"');
      return fileStream.pipe(res);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // Stream endpoint
  if (pathname === "/api/youtube/stream" && req.method === "GET") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) return res.status(400).json({ error: "No sessionId" });

    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    try {
      const videoPath = session.videoPath;
      const stat = fs.statSync(videoPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const startByte = parseInt(parts[0], 10);
        const endByte = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = endByte - startByte + 1;

        res.writeHead(206, {
          "Content-Range": `bytes ${startByte}-${endByte}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": "video/mp4",
        });

        fs.createReadStream(videoPath, { start: startByte, end: endByte }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": "video/mp4",
        });
        fs.createReadStream(videoPath).pipe(res);
      }
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(404).json({ error: "Not found" });
}
