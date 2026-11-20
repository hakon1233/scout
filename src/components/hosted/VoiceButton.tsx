"use client";

import * as React from "react";
import { HostedError } from "@/lib/hosted";
import {
  MAX_VOICE_MS,
  VOICE_BITS_PER_SECOND,
  voiceSupported,
} from "@/lib/voice";

const noSubscribe = () => () => {};

// The setup chat's mic: records up to a minute, sends it to be written out,
// and hands the text back for the reader to edit and send. Renders nothing
// where the browser can't record. Hand-built: no registry part records audio.
export function VoiceButton({
  transcribe,
  onText,
  onStatus,
  onError,
  disabled,
}: {
  transcribe: (audio: Blob) => Promise<string>;
  onText: (text: string) => void;
  // Muted status text beside the composer; null clears it.
  onStatus: (status: string | null) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const supported = React.useSyncExternalStore(
    noSubscribe,
    () => voiceSupported(),
    () => false,
  );
  const [state, setState] = React.useState<"idle" | "recording" | "writing">(
    "idle",
  );
  const recorder = React.useRef<MediaRecorder | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const r = recorder.current;
      if (r && r.state !== "inactive") r.stop();
    },
    [],
  );

  if (!supported) return null;

  async function start() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError("Scout can't use the microphone. Allow it, or type instead.");
      return;
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream, {
      audioBitsPerSecond: VOICE_BITS_PER_SECOND,
    });
    recorder.current = r;
    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    r.onstop = () => {
      if (timer.current) clearTimeout(timer.current);
      for (const track of stream.getTracks()) track.stop();
      recorder.current = null;
      void finish(new Blob(chunks, { type: r.mimeType || "audio/webm" }));
    };
    r.start();
    setState("recording");
    onStatus("Listening… up to a minute.");
    timer.current = setTimeout(
      () => r.state !== "inactive" && r.stop(),
      MAX_VOICE_MS,
    );
  }

  async function finish(audio: Blob) {
    setState("writing");
    onStatus("Writing it out…");
    try {
      if (audio.size === 0)
        throw new HostedError("failed", "That recording was empty. Try again.");
      onText(await transcribe(audio));
    } catch (err) {
      onError(
        err instanceof HostedError
          ? err.message
          : "Voice isn't working right now. Type instead.",
      );
    } finally {
      onStatus(null);
      setState("idle");
    }
  }

  const recording = state === "recording";
  return (
    <button
      type="button"
      aria-label={recording ? "Stop recording" : "Record a voice message"}
      aria-pressed={recording}
      disabled={disabled || state === "writing"}
      onClick={() => (recording ? recorder.current?.stop() : void start())}
      className={[
        "inline-flex size-11 items-center justify-center rounded-full transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50",
        recording ? "text-danger" : "text-secondary",
      ].join(" ")}
    >
      {recording ? <StopIcon /> : <MicIcon />}
    </button>
  );
}

function MicIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  );
}
