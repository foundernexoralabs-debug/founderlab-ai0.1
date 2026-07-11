export async function getMicrophoneStream(): Promise<MediaStream> {
  // Pre-flight: on non-HTTPS/non-localhost origins, browsers hide the whole API.
  // A confusing "not available" error usually means this — surface the real reason.
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      throw new Error(
        "Microphone requires a secure connection (https://). Open FounderLab over HTTPS and try again."
      );
    }
    throw new Error(
      "Microphone is not supported in this browser. Try Chrome, Edge, or Safari."
    );
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true, // simple constraint avoids OverconstrainedError
    });
    return stream;
  } catch (err: any) {
    // getUserMedia has a well-defined set of DOMException names — map each one
    // to a clear, actionable message instead of leaking the browser's raw error.
    switch (err?.name) {
      case "NotAllowedError":
      case "PermissionDeniedError": // older Safari/Chrome alias for NotAllowedError
        throw new Error(
          "Microphone access was blocked. Click the mic/lock icon in your browser's address bar to allow it, then try again."
        );
      case "NotFoundError":
      case "DevicesNotFoundError":
        throw new Error(
          "No microphone was found. Please connect one and try again."
        );
      case "NotReadableError":
      case "TrackStartError":
        // Hardware in use by another app (Zoom, Teams, Discord, another tab)
        throw new Error(
          "Your microphone is being used by another app. Close it (Zoom, Teams, another browser tab) and try again."
        );
      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        // Retry with the barest possible constraint
        try {
          return await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          throw new Error(
            "Your microphone doesn't support the required settings."
          );
        }
      case "SecurityError":
        throw new Error(
          "Microphone blocked for security. Open FounderLab over HTTPS (or on localhost) and try again."
        );
      case "AbortError":
        throw new Error(
          "Microphone request was interrupted. Please try again."
        );
      case "TypeError":
        throw new Error(
          "Microphone request was invalid. Please refresh the page and try again."
        );
      default:
        // Real fallback — surface the actual reason instead of a generic message
        throw new Error(
          `Could not start microphone: ${err?.message || err?.name || 'unknown error'}`
        );
    }
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
