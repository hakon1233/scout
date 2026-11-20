// Voice input for the hosted setup chat: whether this browser can record, and
// the recording limits. The clip goes to the Worker's POST /voice
// (hosted.ts `transcribe`), which turns it into text for the chat input.

// A clip stops by itself after a minute; the Worker refuses longer ones.
export const MAX_VOICE_MS = 60_000;
// Low enough that a minute stays far under the Worker's size cap.
export const VOICE_BITS_PER_SECOND = 32_000;

// True when the browser can record audio. Without it the mic stays hidden.
export function voiceSupported(
  env: {
    MediaRecorder?: unknown;
    navigator?: { mediaDevices?: { getUserMedia?: unknown } };
  } | null = typeof window === "undefined" ? null : window,
): boolean {
  if (!env) return false;
  return (
    typeof env.MediaRecorder === "function" &&
    typeof env.navigator?.mediaDevices?.getUserMedia === "function"
  );
}
