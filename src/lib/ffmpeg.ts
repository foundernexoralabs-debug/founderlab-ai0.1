import ffmpeg from "fluent-ffmpeg";
import path from "path";

/**
* Split a video into equal-length segments (in seconds).
* Returns array of { start, end, filePath }.
*/
export function splitVideo(
  inputPath: string,
  outputDir: string,
  segmentDurationSec: number = 60
): Promise<Array<{ start: number; end: number; filePath: string }>> {
  return new Promise((resolve, reject) => {
    const segments: Array<{ start: number; end: number; filePath: string }> = [];
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata.format.duration!;
      let start = 0;
      const jobs: Promise<void>[] = [];
      let index = 0;
      while (start < duration) {
        const end = Math.min(start + segmentDurationSec, duration);
        const outputFile = path.join(outputDir, `seg_${index}.mp4`);
        segments.push({ start, end, filePath: outputFile });
        const job = new Promise<void>((res, rej) => {
          ffmpeg(inputPath)
            .seekInput(start)
            .duration(segmentDurationSec)
            .output(outputFile)
            .on("end", res)
            .on("error", rej)
            .run();
        });
        jobs.push(job);
        start = end;
        index++;
      }
      Promise.all(jobs)
        .then(() => resolve(segments))
        .catch(reject);
    });
  });
}

/**
* Trim a clip from the original video between start and end time.
*/
export function trimClip(
  inputPath: string,
  outputPath: string,
  startSec: number,
  durationSec: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(startSec)
      .duration(durationSec)
      .output(outputPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}
