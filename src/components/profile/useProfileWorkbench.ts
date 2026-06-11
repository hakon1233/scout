"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bootstrapCompanionToken,
  fetchCompanionInterests,
} from "@/lib/companion";
import {
  confirmDeleteInterest,
  confirmRewriteInterest,
  fetchChatTranscript,
  runChatTurn,
  stopChatTurn,
  type ChatChange,
  type ChatTurn,
  type PendingDelete,
  type PendingRewrite,
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

function markdownDemoMessages(): ChatMessage[] {
  return [
    {
      id: nextMsgId(),
      role: "you",
      text: "Track **user emphasis** and keep `<script>xss()</script>` as inert text.",
      ts: "2026-06-05T12:00:00.000Z",
    },
    {
      id: nextMsgId(),
      role: "scout",
      text: [
        "## Scout markdown reply",
        "",
        "**assistant emphasis** and a [source link](https://example.com/brief).",
        "",
        "> quoted context",
        "",
        "```ts",
        'const topic = "markdown";',
        "```",
      ].join("\n"),
      ts: "2026-06-05T12:01:00.000Z",
    },
  ];
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
    if (
      turn.status === "ready" &&
      (turn.reply || turn.pending_delete || turn.pending_rewrite)
    ) {
      out.push({
        id: nextMsgId(),
        role: "scout",
        text: turn.reply ?? "",
        ts: turn.created_at,
        changes:
          turn.changes && turn.changes.length > 0 ? turn.changes : undefined,
        pendingDelete: turn.pending_delete,
        pendingRewrite: turn.pending_rewrite,
      });
    } else if (turn.status === "failed" && turn.error_msg) {
      out.push({
        id: nextMsgId(),
        role: "scout",
        text: `I couldn't finish that turn: ${turn.error_msg}`,
        ts: turn.created_at,
        failed: true,
      });
    }
    return out;
  });
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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

  // Simulated token streaming (PER-228 chunk 3). The companion is kick→poll, not
  // SSE, so a reply arrives whole; we reveal it with a client-side typewriter so
  // turns feel alive. `streamId` is the scout message being revealed; `streamLen`
  // is how many chars are shown so far. Reduced-motion users skip the reveal.
  const [streamId, setStreamId] = useState<string | null>(null);
  const [streamLen, setStreamLen] = useState(0);

  const beatTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const streamTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const abortedRef = useRef(false);
  // PER-232: the in-flight turn's server id (set once the kick lands) and
  // whether the user pressed Stop before we even had it — so the server-side
  // abort can fire as soon as the id arrives instead of being silently lost.
  const turnIdRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);
  const docBodiesRef = useRef<Record<string, string>>({});

  // Mirror docBodies into a ref so `send` can read the pre-change body for the
  // diff/undo without re-binding on every keystroke-driven body update.
  useEffect(() => {
    docBodiesRef.current = docBodies;
  }, [docBodies]);

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
    setMessages(
      seed === "markdown" ? markdownDemoMessages() : [greetingMessage()],
    );
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
      if (streamTimer.current) clearInterval(streamTimer.current);
      abortRef.current?.abort();
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

  // Play the "removed" flash on a card, then actually drop the interest, doc,
  // and meta from the rail (PER-230 #3). The card stays mounted with the
  // scout-doc-flash for ~2.4s so QA automation can observe the highlight before
  // the card disappears — "card disappears with the flash" per the CEO. Reduced-
  // motion users skip the dwell and remove immediately.
  const flashRemove = useCallback((key: string) => {
    setBeats((prev) => ({ ...prev, [key]: "removed" }));
    const drop = () => {
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
      setBeats((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setFocusKey((cur) => (cur === key ? null : cur));
      delete beatTimers.current[key];
    };
    if (beatTimers.current[key]) clearTimeout(beatTimers.current[key]);
    if (prefersReducedMotion()) {
      drop();
      return;
    }
    beatTimers.current[key] = setTimeout(drop, 2400);
  }, []);

  // Confirm a gated delete (PER-230 #1): the deterministic [Delete] press. Hits
  // the no-model confirm-delete route, which actually removes the interest + doc
  // and returns a ready turn. On success we flash-and-drop the card and mark the
  // confirm message resolved so it locks to "Removed".
  const confirmDelete = useCallback(
    (pd: PendingDelete, msgId: string) => {
      if (sending) return;
      setSending(true);
      setError(null);
      (async () => {
        try {
          await confirmDeleteInterest(pd.interestId, token);
          flashRemove(pd.interestId);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId ? { ...m, deleteResolved: "deleted" } : m,
            ),
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : "Couldn't remove that.");
        } finally {
          setSending(false);
        }
      })();
    },
    [sending, token, flashRemove],
  );

  // Cancel a gated delete: nothing touches the store — just lock the card to
  // "Kept" so the dead-control proof is visible.
  const cancelDelete = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, deleteResolved: "cancelled" } : m,
      ),
    );
  }, []);

  // Confirm a gated rewrite (PER-235): the deterministic [Apply] press. Hits the
  // no-model confirm-rewrite route, which writes the server-stored proposed doc
  // and returns a ready turn whose `changes` carry the applied update. Routing
  // that change set through applyChanges gives the docs-rail card the exact same
  // confirmed-write flash as any other update, then the proposal card locks to
  // "Applied".
  const confirmRewrite = useCallback(
    (pr: PendingRewrite, msgId: string) => {
      if (sending) return;
      setSending(true);
      setError(null);
      (async () => {
        try {
          const turn = await confirmRewriteInterest(pr.interestId, token);
          if (turn.changes && turn.changes.length > 0) {
            applyChanges(turn.changes, new Date().toISOString());
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId ? { ...m, rewriteResolved: "applied" } : m,
            ),
          );
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Couldn't apply that rewrite.",
          );
        } finally {
          setSending(false);
        }
      })();
    },
    [sending, token, applyChanges],
  );

  // Discard a gated rewrite: FE-local, nothing touches the store — the doc on
  // disk was never changed (the "Kept" pattern from cancelDelete). The card
  // locks to "Discarded".
  const discardRewrite = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, rewriteResolved: "discarded" } : m,
      ),
    );
  }, []);

  // Reveal a freshly-arrived scout reply with the typewriter. Reduced-motion
  // users get the whole text at once (no streamId set).
  const startStream = useCallback((id: string, text: string) => {
    if (streamTimer.current) clearInterval(streamTimer.current);
    if (prefersReducedMotion() || text.length === 0) {
      setStreamId(null);
      return;
    }
    setStreamId(id);
    setStreamLen(0);
    const step = Math.max(1, Math.ceil(text.length / 80));
    streamTimer.current = setInterval(() => {
      setStreamLen((prev) => {
        const next = prev + step;
        if (next >= text.length) {
          if (streamTimer.current) clearInterval(streamTimer.current);
          streamTimer.current = null;
          setStreamId(null);
          return text.length;
        }
        return next;
      });
    }, 24);
  }, []);

  // Run one turn against the companion. `wire` is the scope-prefixed message sent
  // to the agent; the matching `you` bubble is appended by the caller (send) or
  // intentionally omitted (retry, which re-runs an existing bubble).
  const dispatch = useCallback(
    (wire: string) => {
      setSending(true);
      setError(null);
      abortedRef.current = false;
      turnIdRef.current = null;
      stopRequestedRef.current = false;
      const controller = new AbortController();
      abortRef.current = controller;

      (async () => {
        try {
          const turn = await runChatTurn(wire, token, {
            signal: controller.signal,
            // PER-232: capture the server turn id the moment the kick lands.
            // If Stop already fired (sub-kick-latency click), abort it now.
            onKick: (id) => {
              turnIdRef.current = id;
              if (stopRequestedRef.current) void stopChatTurn(token, id);
            },
          });
          const replyAt = new Date().toISOString();
          const changes =
            turn.changes && turn.changes.length > 0 ? turn.changes : undefined;
          const pendingDelete = turn.pending_delete;
          const pendingRewrite = turn.pending_rewrite;
          // Snapshot the pre-change bodies so the action card can diff and undo
          // — and the rewrite proposal card can diff current vs proposed.
          let prev: Record<string, string | null> | undefined;
          if (changes || pendingRewrite) {
            prev = {};
            for (const ch of changes ?? []) {
              if (ch.interestId)
                prev[ch.interestId] =
                  docBodiesRef.current[ch.interestId] ?? null;
            }
            if (pendingRewrite) {
              prev[pendingRewrite.interestId] =
                docBodiesRef.current[pendingRewrite.interestId] ?? null;
            }
          }
          if (turn.reply || changes || pendingDelete || pendingRewrite) {
            const id = nextMsgId();
            setMessages((prevMsgs) => [
              ...prevMsgs,
              {
                id,
                role: "scout",
                text:
                  turn.reply ??
                  (pendingDelete
                    ? `Want me to remove “${pendingDelete.topic}”?`
                    : pendingRewrite
                      ? `Here's a proposed rewrite of “${pendingRewrite.topic}” — apply below.`
                      : "Done — updated your interests."),
                ts: replyAt,
                changes,
                prev,
                pendingDelete,
                pendingRewrite,
              },
            ]);
            startStream(id, turn.reply ?? "");
          }
          if (changes) applyChanges(changes, replyAt);
        } catch (e) {
          if (abortedRef.current) return; // user stopped — not an error
          setError(e instanceof Error ? e.message : "Something went wrong.");
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
          setSending(false);
        }
      })();
    },
    [token, applyChanges, startStream],
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
      dispatch(wire);
    },
    [sending, focusKey, interests, dispatch],
  );

  // Stop the in-flight turn (PER-228 chunk 3, fixed in PER-232). Aborting the
  // client poll is NOT enough — the companion is kick→poll, so the server-side
  // model edit would still complete and persist (~14s later, the AC3/AC5 fail).
  // We also tell the companion to abort the turn itself: it kills the model
  // child and writes the turn as stopped with NO changes applied. If the reply
  // already arrived and is mid-typewriter, those changes are already durable —
  // the server stop is then a no-op and we just finish the reveal.
  const stop = useCallback(() => {
    abortedRef.current = true;
    stopRequestedRef.current = true;
    abortRef.current?.abort();
    // Best-effort server abort: with the turn id when the kick already landed,
    // otherwise stop whatever is in flight (single-flight slot); onKick retries
    // with the concrete id if it arrives after this click.
    void stopChatTurn(token, turnIdRef.current ?? undefined);
    if (streamTimer.current) {
      clearInterval(streamTimer.current);
      streamTimer.current = null;
    }
    setStreamId(null);
    setSending(false);
  }, [token]);

  // Retry a scout turn: re-run the preceding `you` message without adding a new
  // bubble. We drop the old scout reply (and anything after it) first so the log
  // stays one-reply-per-turn.
  const retry = useCallback(
    (scoutId: string) => {
      if (sending) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === scoutId);
        if (idx <= 0) return prev;
        let youIdx = idx - 1;
        while (youIdx >= 0 && prev[youIdx].role !== "you") youIdx--;
        if (youIdx < 0) return prev;
        const youText = prev[youIdx].text;
        const focusTopic = focusKey
          ? (interests.find((i) => interestKey(i) === focusKey)?.topic ?? null)
          : null;
        const wire = focusTopic
          ? `Regarding my interest "${focusTopic}": ${youText}`
          : youText;
        // Defer the dispatch out of the updater.
        queueMicrotask(() => dispatch(wire));
        return prev.slice(0, idx);
      });
    },
    [sending, focusKey, interests, dispatch],
  );

  // Undo a durable change by asking Scout to reverse it (no propose/pending mode
  // exists — this is the honest reversal channel). Shows as a normal turn.
  const undo = useCallback(
    (change: ChatChange, prev: string | null) => {
      const topic = change.topic ?? "that interest";
      let instruction: string;
      if (change.op === "create") {
        instruction = `Delete the interest "${topic}" you just created.`;
      } else if (change.op === "delete") {
        instruction = prev
          ? `Re-create the interest "${topic}" with exactly this doc, verbatim:\n\n${prev}`
          : `Re-add the interest "${topic}" you just removed.`;
      } else {
        instruction = prev
          ? `Revert the doc for "${topic}" to exactly this earlier version, verbatim:\n\n${prev}`
          : `Undo your last change to "${topic}".`;
      }
      send(instruction);
    },
    [send],
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
        // Deep-links into the workbench itself (PER-236 fix 2) so a new-tab
        // open lands on the scope view WITH the chat column, not the
        // chat-less standalone page (which stays alive for old links).
        href: `/app/interests/?id=${encodeURIComponent(key)}`,
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
    streamId,
    streamLen,
    setFocusKey,
    send,
    stop,
    retry,
    undo,
    confirmDelete,
    cancelDelete,
    confirmRewrite,
    discardRewrite,
  };
}
