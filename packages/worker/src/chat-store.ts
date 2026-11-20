// The hosted chat's store (packages/hosted ChatStore) over PostgREST with the
// service role. The Worker has already verified the reader's JWT, so every
// query names the reader's id itself. Writes go through commit_chat_turn, one
// transaction per turn (supabase/migrations/20261120030000_chat.sql).

import {
  chatTurnFromRow,
  chatTurnToRow,
  type ChatTurnRow,
  type Interest,
} from "@scout/core";
import type { ChatStore } from "@scout/hosted";
import { RpcError, rpcCaller } from "./supabase.ts";

type Fetch = typeof fetch;

// How many earlier turns the model sees.
const TRANSCRIPT_TURNS = 20;
// How many public interests are ranked against a message.
const PUBLIC_POOL = 200;

export function supabaseChatStore(opts: {
  url: string;
  serviceKey: string;
  fetch?: Fetch;
}): ChatStore {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const rpc = rpcCaller(opts.url, doFetch);
  const auth = { apikey: opts.serviceKey, bearer: opts.serviceKey };

  async function select<T>(table: string, query: string): Promise<T[]> {
    const res = await doFetch(`${opts.url}/rest/v1/${table}?${query}`, {
      method: "GET",
      headers: {
        apikey: opts.serviceKey,
        authorization: `Bearer ${opts.serviceKey}`,
      },
    });
    const text = await res.text();
    if (!res.ok)
      throw new RpcError(
        res.status,
        undefined,
        `${table}: ${text.slice(0, 300)}`,
      );
    return JSON.parse(text) as T[];
  }

  return {
    async load(userId) {
      const user = encodeURIComponent(userId);
      const [interests, turns, allowance] = await Promise.all([
        select<{ id: string; topic: string; doc: string }>(
          "interests",
          `select=id,topic,doc&owner_id=eq.${user}&deleted_at=is.null&order=created_at.asc`,
        ),
        select<ChatTurnRow>(
          "chat_turns",
          `select=id,created_at,status,message,reply,changes,pending,error_msg&user_id=eq.${user}&order=created_at.desc&limit=${TRANSCRIPT_TURNS}`,
        ),
        rpc("allowance", { p_user: userId }, auth) as Promise<{
          limits: { max_interests: number; max_doc_chars: number };
        }>,
      ]);
      return {
        interests,
        transcript: turns.reverse().map(chatTurnFromRow),
        limits: {
          maxInterests: allowance.limits.max_interests,
          maxDocChars: allowance.limits.max_doc_chars,
        },
      };
    },

    async findPublicInterests(userId, message, limit) {
      const user = encodeURIComponent(userId);
      const [pool, follows] = await Promise.all([
        select<Interest>(
          "interests",
          `select=id,topic&visibility=eq.public&deleted_at=is.null&owner_id=neq.${user}&limit=${PUBLIC_POOL}`,
        ),
        select<{ interest_id: string }>(
          "follows",
          `select=interest_id&user_id=eq.${user}`,
        ),
      ]);
      const followed = new Set(follows.map((f) => f.interest_id));
      const said = words(message);
      return (
        pool
          .filter((i) => !followed.has(i.id))
          // The whole catalog, best word matches first: the model judges the fit.
          .map((i) => ({ i, score: overlap(said, words(i.topic)) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((x) => ({ id: x.i.id, topic: x.i.topic }))
      );
    },

    async commit(userId, { turn, follows, costUsd }) {
      await rpc(
        "commit_chat_turn",
        {
          p_user: userId,
          p_turn: chatTurnToRow(turn),
          p_follows: follows,
          p_cost_usd: costUsd,
        },
        auth,
      );
    },
  };
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of b) if (a.has(w)) n += 1;
  return n;
}

// Who the bearer JWT belongs to, asked of Supabase Auth (which checks the
// signature and expiry). Null when it isn't a live session.
export async function verifiedUserId(opts: {
  url: string;
  anonKey: string;
  userJwt: string;
  fetch?: Fetch;
}): Promise<string | null> {
  const res = await (opts.fetch ?? globalThis.fetch)(
    `${opts.url}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: opts.anonKey,
        authorization: `Bearer ${opts.userJwt}`,
      },
    },
  );
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: unknown };
  return typeof user.id === "string" ? user.id : null;
}
