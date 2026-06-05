"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bootstrapCompanionToken,
  fetchCompanionInterests,
} from "@/lib/companion";
import {
  fetchChatTranscript,
  runChatTurn,
  type ChatChange,
  type ChatTurn,
} from "@/lib/chat";
import {
  fetchInterestsFull,
  type InterestDocMeta,
  interestKey,
  mockDocMeta,
  SAMPLE_INTERESTS,
} from "@/lib/interest-docs";
import { loadSettings } from "@/lib/storage";
import type { Interest } from "@/lib/types";
import type { ChatMessage } from "./ChatDock";
import type { DocBeat, DocCardModel } from "./InterestDocCard";

function mergeInterests(
  local: Interest[],
  companionTopics: string[],
): Interest[] {
  if (companionTopics.length === 0) return local;
  const byTopic = new Map(local.map((i) => [i.topic.trim().toLowerCase(), i]));
  return companionTopics.map((topic) => {
    const match = byTopic.get(topic.trim().toLowerCase());
    return match ?? { id: "", topic };
  });
}

let msgSeq = 0;
function nextMsgId(): string {
  msgSeq += 1;
  return `m${msgSeq}`;
}

function greetingMessage(): ChatMessage {
  return {
    id: nextMsgId(),
    role: "scout",
    text: "Hi — I'm Scout. Tell me what to track and I'll draft an intent doc for it, refine one you already have, or drop an interest. Pick “Refine” on any card to aim a message at it.",
  };
}

function transcriptMessages(turns: ChatTurn[]): ChatMessage[] {
  return turns.flatMap((turn) => {
    const out: ChatMessage[] = [
      {
        id: nextMsgId(),
        role: "you",
        text: turn.message,
        ts: turn.created_at,
      },
    ];
    if (turn.status === "ready" && turn.reply) {
      out.push({
        id: nextMsgId(),
        role: "scout",
        text: turn.reply,
        ts: turn.created_at,
      });
    } else if (turn.status === "failed" && turn.error_msg) {
      out.push({
        id: nextMsgId(),
        role: "scout",
        text: `I couldn't finish that turn: ${turn.error_msg}`,
        ts: turn.created_at,
      });
    }
    return out;
  });
}

export function useProfileWorkbench() {
  const [hydrated, setHydrated] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [docMeta, setDocMeta] = useState<Record<string, InterestDocMeta>>({});
  const [docBodies, setDocBodies] = useState<Record<string, string>>({});
  const [beats, setBeats] = useState<Record<string, DocBeat>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mockSeed, setMockSeed] = useState<string | null>(null);

  const beatTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const seed = params.has("mock") ? params.get("mock") || "alt" : null;
    const stored = loadSettings();
    const localInterests =
      stored?.interests && stored.interests.length > 0
        ? stored.interests
        : seed !== null
          ? SAMPLE_INTERESTS
          : [];
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(stored?.name?.trim() ?? "");
    setInterests(localInterests);
    setMockSeed(seed);
    setFocusKey(params.get("focus"));
    setMessages([greetingMessage()]);
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (mockSeed !== null) return;
    let cancelled = false;
    (async () => {
      const tok = await bootstrapCompanionToken();
      if (cancelled) return;
      setToken(tok);
      const transcript = tok ? await fetchChatTranscript(tok) : [];
      if (cancelled) return;
      if (transcript.length > 0) {
        setMessages(transcriptMessages(transcript));
      }
      const full = await fetchInterestsFull(tok);
      if (cancelled) return;
      if (full && full.interests.length > 0) {
        setInterests(full.interests);
        setDocMeta(full.meta);
        setDocBodies(
          Object.fromEntries(
            Object.entries(full.meta)
              .filter(([, meta]) => typeof meta.body === "string")
              .map(([key, meta]) => [key, meta.body as string]),
          ),
        );
        return;
      }
      const topics = await fetchCompanionInterests();
      if (cancelled) return;
      if (topics.length > 0)
        setInterests((prev) => mergeInterests(prev, topics));
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, mockSeed]);

  useEffect(() => {
    const timers = beatTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const flashBeat = useCallback((key: string, kind: Exclude<DocBeat, null>) => {
    setBeats((prev) => ({ ...prev, [key]: kind }));
    if (beatTimers.current[key]) clearTimeout(beatTimers.current[key]);
    beatTimers.current[key] = setTimeout(() => {
      setBeats((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      delete beatTimers.current[key];
    }, 6000);
  }, []);

  const applyChanges = useCallback(
    (changes: ChatChange[], at: string) => {
      for (const ch of changes) {
        const key = ch.interestId;
        if (!key) continue;
        if (ch.op === "delete") {
          setInterests((prev) =>
            prev.filter((i) => interestKey(i) !== key && i.id !== key),
          );
          setDocBodies((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          setDocMeta((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          setFocusKey((cur) => (cur === key ? null : cur));
          if (beatTimers.current[key]) {
            clearTimeout(beatTimers.current[key]);
            delete beatTimers.current[key];
          }
          continue;
        }
        const topic = ch.topic?.trim() ?? "";
        setInterests((prev) => {
          const idx = prev.findIndex(
            (i) => interestKey(i) === key || i.id === key,
          );
          if (idx === -1) return [...prev, { id: key, topic }];
          if (topic && prev[idx].topic !== topic) {
            const next = [...prev];
            next[idx] = { ...next[idx], id: prev[idx].id || key, topic };
            return next;
          }
          return prev;
        });
        if (typeof ch.doc === "string") {
          setDocBodies((prev) => ({ ...prev, [key]: ch.doc as string }));
        }
        setDocMeta((prev) => ({
          ...prev,
          [key]: { hasDoc: true, updatedAt: at },
        }));
        flashBeat(key, ch.op === "create" ? "created" : "updated");
      }
    },
    [flashBeat],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || sending) return;

      const focusTopic = focusKey
        ? (interests.find((i) => interestKey(i) === focusKey)?.topic ?? null)
        : null;
      const wire = focusTopic
        ? `Regarding my interest "${focusTopic}": ${text}`
        : text;

      const at = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        { id: nextMsgId(), role: "you", text, ts: at },
      ]);
      setSending(true);
      setError(null);

      (async () => {
        try {
          const turn = await runChatTurn(wire, token);
          const replyAt = new Date().toISOString();
          if (turn.reply) {
            setMessages((prev) => [
              ...prev,
              {
                id: nextMsgId(),
                role: "scout",
                text: turn.reply!,
                ts: replyAt,
              },
            ]);
          }
          if (turn.changes && turn.changes.length > 0) {
            applyChanges(turn.changes, replyAt);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Something went wrong.");
        } finally {
          setSending(false);
        }
      })();
    },
    [sending, focusKey, interests, token, applyChanges],
  );

  const cards: DocCardModel[] = useMemo(() => {
    const meta = mockSeed !== null ? mockDocMeta(interests, mockSeed) : docMeta;
    return interests.map((i) => {
      const key = interestKey(i);
      const m = meta[key] ?? { hasDoc: false };
      const body = docBodies[key];
      return {
        key,
        topic: i.topic,
        hasDoc: m.hasDoc || Boolean(body),
        updatedAt: m.updatedAt,
        body,
        beat: beats[key] ?? null,
        href: `/app/interests/interest?id=${encodeURIComponent(key)}`,
      };
    });
  }, [interests, docMeta, docBodies, beats, mockSeed]);

  const focusTopic = focusKey
    ? (cards.find((c) => c.key === focusKey)?.topic ?? null)
    : null;

  return {
    hydrated,
    name,
    cards,
    docCount: cards.filter((c) => c.hasDoc).length,
    messages,
    sending,
    error,
    focusKey,
    focusTopic,
    setFocusKey,
    send,
  };
}
