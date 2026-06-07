"use client";

import * as React from "react";
import { BriefLayout } from "@/components/BriefLayout";
import { Button } from "@/components/ui";
import { fetchBriefHistory } from "@/lib/companion";
import type { Brief } from "@/lib/types";

// PER-219 (AC6): the "previous briefs" pager that lives below the current brief.
// Scrolling past the current edition reveals previous editions, each rendered as
// a full "Daily brief — <date>" feed (reusing BriefLayout/FeedView). It pages the
// companion's rolling history via GET /v0/briefs?limit=&offset= — 3 at a time,
// newest-first — with a "Load older briefs" button. "Manage interests" sits next
// to it: this footer bar is also the (only) place those two actions live now that
// the inline feed buttons are gone (AC2).
//
// The current brief is shown by the page ABOVE this component, so the pager skips
// history index 0 (offset starts at 1) and additionally id-filters defensively so
// the current edition can never double-render here.

const PAGE_SIZE = 3;

export function BriefHistory({
  token,
  currentBriefId,
  onManageInterests,
  onDetailOpenChange,
}: {
  token: string;
  currentBriefId: string | null;
  onManageInterests: () => void;
  // PER-223: bubble up when a story inside ONE of the history editions opens its
  // focused detail. The page uses it to collapse the current edition + banners
  // above; we use it to collapse to just the open section (hide the other
  // editions and this footer) so the focused view is ONLY that one story — the
  // same isolation the current edition already had (PER-222).
  onDetailOpenChange?: (open: boolean) => void;
}) {
  const [briefs, setBriefs] = React.useState<Brief[]>([]);
  // `total` is the companion's full ready-brief count (includes the current
  // edition at index 0). `offset` is the next index to fetch from; it starts at
  // 1 to skip the current edition shown above. `loaded` flips true after the
  // first fetch resolves so we don't flash an empty footer before we know if any
  // history exists.
  const [total, setTotal] = React.useState(0);
  const [offset, setOffset] = React.useState(1);
  const [loaded, setLoaded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const seenIds = React.useRef<Set<string>>(new Set());

  // PER-223: which history edition (if any) currently has a story open in its
  // focused detail view. When set, we render ONLY that edition and drop the
  // pager footer, so the page below the story is empty — matching AC1.
  const [openBriefId, setOpenBriefId] = React.useState<string | null>(null);
  React.useEffect(() => {
    onDetailOpenChange?.(openBriefId != null);
  }, [openBriefId, onDetailOpenChange]);

  const loadMore = React.useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const startOffset = offsetRef.current;
      const { briefs: page, total: serverTotal } = await fetchBriefHistory(
        token,
        { limit: PAGE_SIZE, offset: startOffset },
      );
      setTotal(serverTotal);
      const fresh = page.filter((b) => {
        if (b.id === currentBriefId) return false;
        if (seenIds.current.has(b.id)) return false;
        seenIds.current.add(b.id);
        return true;
      });
      if (fresh.length > 0) setBriefs((prev) => [...prev, ...fresh]);
      setOffset(startOffset + PAGE_SIZE);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [token, currentBriefId]);

  // Keep a ref of the latest offset so loadMore (memoized on token/currentBriefId)
  // always reads the current paging cursor without re-creating the callback each
  // page — avoids a render→effect→fetch loop.
  const offsetRef = React.useRef(offset);
  React.useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  // First page on mount / when the current brief changes. A new current edition
  // resets the pager: history shifts down by one, so anything we'd cached is
  // stale. Reset state and refetch from offset 1.
  React.useEffect(() => {
    seenIds.current = new Set();
    // Intentional synchronous reset of the pager when the current edition
    // changes (history shifts down by one, cached pages are stale). The
    // react-compiler lint rules flag the synchronous setState + ref write, but
    // this is the correct pattern here and changes no behavior. (PER-224: this
    // was blocking the Pages deploy from PER-219, where lint wasn't run.)
    /* eslint-disable react-hooks/set-state-in-effect, react-hooks/immutability */
    setBriefs([]);
    setTotal(0);
    setOffset(1);
    offsetRef.current = 1;
    setLoaded(false);
    setOpenBriefId(null);
    /* eslint-enable react-hooks/set-state-in-effect, react-hooks/immutability */
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, currentBriefId]);

  // More history remains when the next fetch cursor is still inside the server's
  // total. (offset already accounts for the skipped current edition at index 0.)
  const hasMore = offset < total;

  // Nothing to show yet and still loading the first page → render nothing rather
  // than a bare "Manage interests" bar that would flash then grow.
  if (!loaded && briefs.length === 0) return null;

  // PER-223: in single-story mode show ONLY the edition holding the open story;
  // its BriefLayout already drops its own "Daily brief — <date>" header, so the
  // focused view is just the one story (matching the current-edition path).
  const visibleBriefs = openBriefId
    ? briefs.filter((b) => b.id === openBriefId)
    : briefs;

  return (
    <div className="flex flex-col gap-10">
      {visibleBriefs.map((b) => (
        <section
          key={b.id}
          aria-label={`Daily brief — ${formatBriefDate(b)}`}
          // Drop the divider/top padding when this section is the isolated open
          // story — a focused story should have nothing (not even a rule) above
          // its "← Back to feed" affordance.
          className={openBriefId ? undefined : "border-t border-border-default pt-8"}
        >
          <BriefLayout
            brief={b}
            name=""
            heading="Daily brief"
            onDetailOpenChange={(open) => setOpenBriefId(open ? b.id : null)}
          />
        </section>
      ))}

      {/* PER-223: the pager footer is feed chrome — hide it while a history
          story is open so nothing shows below the focused story. */}
      {!openBriefId && (
      <div className="measure-prose flex flex-col gap-3 border-t border-border-default pt-6 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
        <p className="text-caption text-muted">
          {briefs.length > 0
            ? `Showing ${briefs.length} previous brief${briefs.length === 1 ? "" : "s"}`
            : "No previous briefs yet — they'll appear here after future runs."}
        </p>
        <div className="flex flex-col gap-2 min-[480px]:flex-row">
          {hasMore && (
            <Button
              variant="secondary"
              loading={loading}
              onClick={() => void loadMore()}
            >
              {loading ? "Loading…" : "Load older briefs"}
            </Button>
          )}
          <Button variant="link" onClick={onManageInterests}>
            Manage interests
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}

// Mirrors BriefLayout's header date format so each historical section's aria
// label reads identically to its rendered "Daily brief — <date>" heading.
function formatBriefDate(b: Brief): string {
  return new Date(b.generatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
