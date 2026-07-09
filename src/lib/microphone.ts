export async function getMicrophoneStream(): Promise<MediaStream> {
  // Only request audio after explicit user gesture (call on click)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true, // simple constraint avoids OverconstrainedError
    });
    return stream;
  } catch (err: any) {
    if (err.name === "NotAllowedError") {
      throw new Error(
        "Microphone permission denied. Please allow access in browser settings."
      );
    } else if (err.name === "NotFoundError") {
      throw new Error(
        "No microphone found. Please connect one and try again."
      );
    } else if (err.name === "OverconstrainedError") {
      // Fallback in case of device-specific issues
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (fallbackErr) {
        throw new Error("Microphone not available. Check permissions.");
      }
    }
    throw err;
  }
}

export async function createAudioContext(): Promise<AudioContext> {
  return new (window.AudioContext || (window as any).webkitAudioContext)();
}

export async function recordChunk(
  stream: MediaStream,
  onChunk: (blob: Blob) => void,
  mimeType = "audio/webm"
) {
  const mediaRecorder = new MediaRecorder(stream, { mimeType });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) onChunk(e.data);
  };
  mediaRecorder.start(250); // 250ms chunks for smooth UX
  return mediaRecorder;
}
