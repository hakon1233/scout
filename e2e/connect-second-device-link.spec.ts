import { expect, test } from "@playwright/test";

// AIR-744: Connect page's paired-state ("State A") "Set Scout up on another
// machine" <details> disclosure — src/app/app/connect/page.tsx — has two
// compounding defects that make the feature it advertises unusable:
//
//   1. Its install command is built from `tarballUrl`, which is
//      `window.location.origin` + the tarball path — i.e. THIS page's own
//      serving origin. In the default (and only currently supported) paired
//      deployment that origin is a loopback address, `http://127.0.0.1:<port>`.
//      Copying `npm i -g http://127.0.0.1:<port>/agent/...tgz` into a terminal
//      on a genuinely DIFFERENT physical machine does not fetch machine one's
//      tarball — 127.0.0.1 on the second machine resolves to itself, where
//      nothing is listening on that port. The command is not merely
//      inconvenient, it cannot ever install the intended package as written.
//   2. Independent of (1): `setupComplete` (paired) fires
//      `router.replace("/app/")` in a `useEffect` with no delay, so State A —
//      including this disclosure — is swapped away within tens of
//      milliseconds of mount. A real human has no realistic window to expand
//      the <details>, read the command, or copy it before being redirected.
//      (Confirmed by direct measurement: an in-page poll interval starting at
//      1ms still only rarely wins the race against the redirect.)
//
// Together: a paired user who wants to add a second machine has no reachable,
// correct path to do so from this page. (The only OTHER place the identical
// command renders is Step 01 of the UNPAIRED walkthrough, State B, already
// covered by connect-pairing.spec.ts — but that command is built from
// whatever origin is serving THAT walkthrough, which has the exact same
// loopback problem if it's ever the paired machine's own address, and is
// simply a different page/audience regardless.)
//
// This test captures the disclosure's actual rendered content via an
// addInitScript poll that starts before the app's own React ever mounts, so
// it deterministically wins the race against the redirect (unlike asserting
// on Playwright-side locators, which lose that race almost every time — see
// connect-pairing.spec.ts's AIR-674 test for the same lesson learned about
// this page's transient success state).
//
// Fully offline/deterministic: default same-origin paired e2e environment,
// no companion mocking needed, no network, no Apify.

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TARBALL_PATH = "/agent/scout-agent-0.3.0.tgz";

test("paired Connect page's second-machine install command embeds this machine's own unreachable loopback origin, and is gone within milliseconds", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __airQaCaptured: string | null }).__airQaCaptured =
      null;
    const check = () => {
      const details = document.querySelector("details");
      if (details && details.textContent?.includes("another machine")) {
        (
          window as unknown as { __airQaCaptured: string | null }
        ).__airQaCaptured = details.textContent;
        return true;
      }
      return false;
    };
    const iv = setInterval(() => {
      if (check()) clearInterval(iv);
    }, 1);
  });

  await page.goto(`${ORIGIN}/app/connect/`);

  // Give the redirect (and our racing capture) time to settle either way.
  await expect(page).toHaveURL(`${ORIGIN}/app/`, { timeout: 15_000 });

  const captured = await page.evaluate(
    () =>
      (window as unknown as { __airQaCaptured: string | null })
        .__airQaCaptured,
  );

  // The disclosure DID render (this isn't dead markup) — it just embeds a
  // command that can't work from a second machine, and vanishes almost
  // immediately regardless.
  expect(captured).not.toBeNull();
  expect(captured).toContain("Set Scout up on another machine");
  // The exact defect: the command is pinned to THIS page's own loopback
  // origin, not something a second physical machine could ever reach.
  expect(captured).toContain(`npm i -g ${ORIGIN}${TARBALL_PATH}`);

  // And by the time a real user could plausibly react, they're already gone
  // from this page entirely — reasserting the stable end-state, not the
  // transient one, as the load-bearing proof (same convention as this
  // suite's other transient-state tests).
  await expect(page).toHaveURL(`${ORIGIN}/app/`);
});
