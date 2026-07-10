import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

export async function downloadVideo(
  url: string,
  outputDir: string,
  videoId: string
): Promise<{ videoPath: string; audioPath?: string }> {
  const outputTemplate = path.join(outputDir, `${videoId}.%(ext)s`);

  // yt-dlp command to download best video+audio (up to 4K), merge, no watermark
  const command = `yt-dlp -f "bestvideo[height<=2160]+bestaudio/best[height<=2160]" --merge-output-format mp4 -o "${outputTemplate}" ${url}`;

  await execAsync(command);

  const videoPath = path.join(outputDir, `${videoId}.mp4`);
  // Optionally extract audio if needed later
  return { videoPath };
}

export async function getVideoInfo(url: string): Promise<any> {
  const command = `yt-dlp --dump-json ${url}`;
  const { stdout } = await execAsync(command);
  return JSON.parse(stdout);
}
