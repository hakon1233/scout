"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bootstrapCompanionToken,
  fetchCompanionInterests,
} from "@/lib/companion";
import {
  useAbortableController,
  useAbortableEffect,
} from "@/hooks/useAbortableEffect";
import {
  confirmDeleteInterest,
  confirmRewriteInterest,
  fetchChatTranscript,
  runChatTurn,
  stopChatTurn,
  type ChatChange,
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
import { prefersReducedMotion } from "@/lib/motion";
import { loadSettings } from "@/lib/storage";
import type { Interest } from "@/lib/types";
import type { ChatMessage } from "./ChatDock";
import type { DocBeat, DocCardModel } from "./InterestDocCard";
import {
  appliedChangeMessage,
  applyDocBodyChange,
  applyDocMetaChange,
  applyInterestChange,
  buildDocCards,
  dropInterest,
  dropKey,
  greetingMessage,
  markdownDemoMessages,
  mergeInterests,
  nextMsgId,
  resolveMessage,
  resolveRetryTarget,
  transcriptMessages,
} from "./useProfileWorkbench.helpers";

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
  const { startAbortable, clearAbortable, abortCurrent } =
    useAbortableController();
  const abortedRef = useRef(false);
  // PER-232: the in-flight turn's server id (set once the kick lands) and
  // whether the user pressed Stop before we even had it — so the server-side
  // abort can fire as soon as the id arrives instead of being silently lost.
  const turnIdRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);
  const docBodiesRef = useRef<Record<string, string>>({});
  const messagesRef = useRef<ChatMessage[]>([]);

  // Mirror docBodies into a ref so `send` can read the pre-change body for the
  // diff/undo without re-binding on every keystroke-driven body update.
  useEffect(() => {
    docBodiesRef.current = docBodies;
  }, [docBodies]);

  // Mirror messages into a ref so `retry` can read the current log to compute
  // its target OUTSIDE a setMessages updater (see resolveRetryTarget) without
  // re-binding the callback on every message append.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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

  useAbortableEffect(
    (scope) => {
      if (!hydrated) return;
      if (mockSeed !== null) return;
      (async () => {
        const tok = await bootstrapCompanionToken();
        if (scope.cancelled) return;
        setToken(tok);
        // transcript + full-interests both depend only on `tok` and are
        // independent of each other — fetch concurrently instead of in series
        // to roughly halve first-paint latency.
        const [transcript, full] = await Promise.all([
          tok ? fetchChatTranscript(tok) : Promise.resolve([]),
          fetchInterestsFull(tok),
        ]);
        if (scope.cancelled) return;
        if (transcript.length > 0) {
          setMessages(transcriptMessages(transcript));
        }
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
        if (scope.cancelled) return;
        if (topics.length > 0)
          setInterests((prev) => mergeInterests(prev, topics));
      })();
    },
    [hydrated, mockSeed],
  );

  useEffect(() => {
    const timers = beatTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
      if (streamTimer.current) clearInterval(streamTimer.current);
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
        // Pure store transitions live in the helpers; the hook keeps the timer
        // and focus side effects that can't be expressed as a reducer.
        setInterests((prev) => applyInterestChange(prev, ch));
        setDocBodies((prev) => applyDocBodyChange(prev, ch));
        setDocMeta((prev) => applyDocMetaChange(prev, ch, at));
        if (ch.op === "delete") {
          setFocusKey((cur) => (cur === key ? null : cur));
          if (beatTimers.current[key]) {
            clearTimeout(beatTimers.current[key]);
            delete beatTimers.current[key];
          }
          continue;
        }
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
      setInterests((prev) => dropInterest(prev, key));
      setDocBodies((prev) => dropKey(prev, key));
      setDocMeta((prev) => dropKey(prev, key));
      setBeats((prev) => dropKey(prev, key));
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
  // and returns a ready turn. On success we flash-and-drop the card, mark the
  // confirm message resolved so it locks to "Removed", and append the applied
  // delete as its own action card so the founder gets a live Undo — same as a
  // create, and matching what a reload already showed (AIR-611).
  const confirmDelete = useCallback(
    (pd: PendingDelete, msgId: string) => {
      if (sending) return;
      setSending(true);
      setError(null);
      // Snapshot the doc as it is right now, before the delete drops it, so the
      // action card diffs it out and undo re-creates it verbatim (AIR-611).
      const prevBody = docBodiesRef.current[pd.interestId] ?? null;
      abortedRef.current = false;
      const controller = startAbortable();
      (async () => {
        try {
          const turn = await confirmDeleteInterest(pd.interestId, token, {
            signal: controller.signal,
          });
          flashRemove(pd.interestId);
          const card = appliedChangeMessage(turn, pd.interestId, prevBody);
          setMessages((prev) => {
            const resolved = resolveMessage(prev, msgId, {
              deleteResolved: "deleted",
            });
            return card ? [...resolved, card] : resolved;
          });
        } catch (e) {
          if (controller.signal.aborted || abortedRef.current) return;
          setError(e instanceof Error ? e.message : "Couldn't remove that.");
        } finally {
          clearAbortable(controller);
          if (!controller.signal.aborted) setSending(false);
        }
      })();
    },
    [sending, token, flashRemove, startAbortable, clearAbortable],
  );

  // Cancel a gated delete: nothing touches the store — just lock the card to
  // "Kept" so the dead-control proof is visible.
  const cancelDelete = useCallback((msgId: string) => {
    setMessages((prev) =>
      resolveMessage(prev, msgId, { deleteResolved: "cancelled" }),
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
      // Snapshot the pre-rewrite doc before applyChanges overwrites it, so the
      // follow-up action card diffs old→new and undo reverts to it verbatim
      // (AIR-611).
      const prevBody = docBodiesRef.current[pr.interestId] ?? null;
      abortedRef.current = false;
      const controller = startAbortable();
      (async () => {
        try {
          const turn = await confirmRewriteInterest(pr.interestId, token, {
            signal: controller.signal,
          });
          if (turn.changes && turn.changes.length > 0) {
            applyChanges(turn.changes, new Date().toISOString());
          }
          // Append the applied rewrite as its own action card so a confirmed
          // rewrite gets the same live Undo a create does (AIR-611) — the proposal
          // card itself just locks to "Applied".
          const card = appliedChangeMessage(turn, pr.interestId, prevBody);
          setMessages((prev) => {
            const resolved = resolveMessage(prev, msgId, {
              rewriteResolved: "applied",
            });
            return card ? [...resolved, card] : resolved;
          });
        } catch (e) {
          if (controller.signal.aborted || abortedRef.current) return;
          setError(
            e instanceof Error ? e.message : "Couldn't apply that rewrite.",
          );
        } finally {
          clearAbortable(controller);
          if (!controller.signal.aborted) setSending(false);
        }
      })();
    },
    [sending, token, applyChanges, startAbortable, clearAbortable],
  );

  // Discard a gated rewrite: FE-local, nothing touches the store — the doc on
  // disk was never changed (the "Kept" pattern from cancelDelete). The card
  // locks to "Discarded".
  const discardRewrite = useCallback((msgId: string) => {
    setMessages((prev) =>
      resolveMessage(prev, msgId, { rewriteResolved: "discarded" }),
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
      const controller = startAbortable();

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
          // User stopped — not an error. Check THIS dispatch's own controller
          // (not just the shared abortedRef, which a newly-started dispatch resets
          // to false): a stop-then-immediately-send would otherwise let the just-
          // aborted request's rejection surface a spurious error (AIR-527).
          if (controller.signal.aborted || abortedRef.current) return;
          setError(e instanceof Error ? e.message : "Something went wrong.");
        } finally {
          clearAbortable(controller);
          // Only THIS dispatch may clear `sending` — and only if it wasn't
          // aborted. A stop-then-immediately-send aborts turn A's controller and
          // starts turn B (which sets sending=true, resets abortedRef). Turn A's
          // poll doesn't observe the abort until its next loop tick (up to
          // ~1.2s + a poll fetch later — pollChatTurn only checks signal.aborted
          // at the top of the loop), so this finally runs AFTER turn B is live.
          // An unconditional setSending(false) here clobbered turn B's in-flight
          // state — Stop reverted to Send mid-turn and a resend 409'd. Guarding on
          // the closure-captured controller.signal.aborted (immune to abortedRef's
          // reset) mirrors the catch guard above; stop() already set sending=false
          // for the aborted turn, so nothing is left stuck (AIR-107).
          if (!controller.signal.aborted) setSending(false);
        }
      })();
    },
    [token, applyChanges, startStream, startAbortable, clearAbortable],
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
    abortCurrent();
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
  }, [token, abortCurrent]);

  // Retry a scout turn: re-run the preceding `you` message without adding a new
  // bubble. We drop the old scout reply (and anything after it) first so the log
  // stays one-reply-per-turn. Compute the target from the ref and dispatch ONCE
  // here — NOT from inside a setMessages updater. React may invoke an updater
  // more than once (StrictMode double-invokes it in dev), so the old
  // `queueMicrotask(() => dispatch(wire))` inside the updater kicked the turn
  // twice; the second kick hit the companion's single-flight slot and 409'd,
  // surfacing a spurious "still working on your last message" error after a
  // single Retry click.
  const retry = useCallback(
    (scoutId: string) => {
      if (sending) return;
      const focusTopic = focusKey
        ? (interests.find((i) => interestKey(i) === focusKey)?.topic ?? null)
        : null;
      const target = resolveRetryTarget(messagesRef.current, scoutId, focusTopic);
      if (!target) return;
      setMessages(target.nextMessages);
      dispatch(target.wire);
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
    return buildDocCards(interests, meta, docBodies, beats);
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
