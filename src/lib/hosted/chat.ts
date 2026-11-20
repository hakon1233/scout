// The setup chat: the reader's recent turns, a new message and its
// confirm (both the Worker's), and a voice clip as text.

import {
  type ChatTurn,
  type ChatTurnRow,
  chatTurnFromRow,
  VOICE_USED_UP,
} from "@scout/core";
import type { HostedClient } from "./client";
import { type HostedData, HostedError } from "./types";

const TRANSCRIPT_TURNS = 30;

export function chatData(
  c: HostedClient,
): Pick<HostedData, "transcript" | "chat" | "confirm" | "transcribe"> {
  const { deps, doFetch, session, rest, worker } = c;
  return {
    async transcript() {
      const s = await session();
      const rows = await rest<ChatTurnRow[]>(
        `chat_turns?select=id,created_at,status,message,reply,changes,pending,error_msg&user_id=eq.${encodeURIComponent(s.userId)}&status=neq.pending&order=created_at.desc&limit=${TRANSCRIPT_TURNS}`,
      );
      return rows.reverse().map(chatTurnFromRow);
    },

    async chat(message) {
      return (await worker("/chat", { message })) as ChatTurn;
    },

    async confirm(action) {
      return (await worker("/chat/confirm", action)) as ChatTurn;
    },

    async transcribe(audio) {
      if (!deps.workerUrl)
        throw new HostedError(
          "failed",
          "This build has no Scout server set up.",
        );
      const s = await session();
      let res: Response;
      try {
        res = await doFetch(`${deps.workerUrl}/voice`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${s.accessToken}`,
            "content-type": audio.type || "audio/webm",
          },
          body: audio,
        });
      } catch {
        throw new HostedError(
          "failed",
          "Scout's server can't be reached right now. Type instead.",
        );
      }
      const body = (await res.json().catch(() => null)) as {
        text?: string;
        error?: string;
      } | null;
      if (res.ok && typeof body?.text === "string") return body.text;
      if (res.status === 401)
        throw new HostedError(
          "signed-out",
          "Your session ended. Sign in again.",
        );
      if (res.status === 429) throw new HostedError("limit", VOICE_USED_UP);
      throw new HostedError(
        "failed",
        body?.error ?? "Voice isn't working right now. Type instead.",
      );
    },
  };
}
