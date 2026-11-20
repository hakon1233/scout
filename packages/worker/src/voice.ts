// POST /voice: a recorded clip (the body, Content-Type audio/*) of up to a
// minute, turned into text for the setup chat's input; 200 {text}. The reader
// edits the text and sends it as a normal chat message.
//
// Free only. Workers AI's whisper-large-v3-turbo costs $0.0005 per audio
// minute, 46.63 neurons per audio minute
// (https://developers.cloudflare.com/workers-ai/platform/pricing/, read
// 2026-11-20). The Workers Free plan includes 10,000 neurons a day; past them
// a call fails and is never billed, and this account must stay on Workers Free
// for that to hold. begin_voice_clip (supabase/migrations/*_voice.sql) allows 5
// clips per reader per rolling 24 hours and stops everyone at 9,000 neurons a
// UTC day. At any limit the reader is told to type instead: there is no paid
// fallback.

import { VOICE_USED_UP } from "@scout/core";
import { verifiedUserId } from "./chat-store.ts";
import { rpcCaller } from "./supabase.ts";

export { VOICE_USED_UP };
export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
// A minute at the web app's 32 kbps is about 240 KB; browsers that ignore the
// bitrate stay under this too.
export const MAX_VOICE_BYTES = 1536 * 1024;
const NEURONS_PER_MINUTE = 46.63;

// The Workers AI binding ([ai] in wrangler.toml), as much of it as /voice uses.
export type VoiceAi = {
  run(
    model: string,
    input: { audio: string },
  ): Promise<{
    text?: unknown;
    transcription_info?: { duration?: unknown };
  }>;
};

export type VoiceDeps = {
  supabaseUrl: string;
  anonKey: string;
  allowedOrigin: string;
  serviceKey?: string;
  // Without it (or the service key) /voice answers 404.
  ai?: VoiceAi;
  fetch?: typeof fetch;
};

export async function handleVoiceRequest(
  request: Request,
  deps: VoiceDeps,
): Promise<Response> {
  const origin = request.headers.get("origin");
  const allowed = deps.allowedOrigin.split(",").map((o) => o.trim());
  const cors: Record<string, string> =
    origin && allowed.includes(origin)
      ? {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "POST",
          "access-control-allow-headers": "authorization, content-type",
          vary: "origin",
        }
      : {};
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...cors },
    });

  if (!deps.serviceKey || !deps.ai) return json(404, { error: "not found" });
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST")
    return json(405, { error: "method not allowed" });

  const jwt = /^Bearer (\S+)$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (!jwt) return json(401, { error: "sign in first" });
  let userId: string | null;
  try {
    userId = await verifiedUserId({
      url: deps.supabaseUrl,
      anonKey: deps.anonKey,
      userJwt: jwt,
      fetch: deps.fetch,
    });
  } catch {
    return json(502, {
      error: "Scout couldn't check your sign-in. Try again.",
    });
  }
  if (!userId) return json(401, { error: "sign in first" });

  if (!(request.headers.get("content-type") ?? "").startsWith("audio/"))
    return json(415, { error: "Send the recording as audio." });
  const audio = await readBytes(request, MAX_VOICE_BYTES);
  if (audio === null)
    return json(413, {
      error: "That recording is too long. Keep it under a minute.",
    });
  if (audio.byteLength === 0)
    return json(400, { error: "That recording was empty. Try again." });

  const rpc = rpcCaller(deps.supabaseUrl, deps.fetch);
  const auth = { apikey: deps.serviceKey, bearer: deps.serviceKey };
  let clipId: string;
  try {
    const begun = (await rpc("begin_voice_clip", { p_user: userId }, auth)) as {
      id?: string;
      blocked?: string;
    };
    if (!begun.id) return json(429, { error: VOICE_USED_UP });
    clipId = begun.id;
  } catch {
    return json(502, { error: "Voice isn't working right now. Type instead." });
  }

  let result: Awaited<ReturnType<VoiceAi["run"]>>;
  try {
    result = await deps.ai.run(WHISPER_MODEL, { audio: toBase64(audio) });
  } catch {
    // Over the free allocation Workers AI fails rather than bills; either way
    // the reader types this one.
    return json(503, { error: "Voice isn't working right now. Type instead." });
  }

  const seconds = Number(result.transcription_info?.duration);
  if (Number.isFinite(seconds) && seconds >= 0) {
    await rpc(
      "finish_voice_clip",
      {
        p_id: clipId,
        p_neurons: Math.ceil((seconds * NEURONS_PER_MINUTE) / 60),
      },
      auth,
    ).catch(() => undefined); // the reservation (a full minute) stands
  }
  const text = typeof result.text === "string" ? result.text.trim() : "";
  if (!text)
    return json(422, { error: "Scout couldn't hear any words. Try again." });
  return json(200, { text });
}

// The body's bytes, or null when it is over `max`. Stops reading there.
async function readBytes(
  request: Request,
  max: number,
): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return all;
}

// Whisper's documented input is the audio as base64.
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
