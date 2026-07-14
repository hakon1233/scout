import { expect, test, type Page } from "@playwright/test";

const PORT = process.env.SCOUT_E2E_PORT ?? "47821";
const ORIGIN = `http://127.0.0.1:${PORT}`;

// The interest workbench's closeDoc() (src/app/app/interests/page.tsx)
// branches on whether window.history.state carries the `scoutInterestDoc`
// marker: opened via the on-screen card click (which pushState()s), Close
// uses history.back(); opened via a direct ?id= deep-link (no push
// happened), Close falls through to a manual setSelectedKey(null) +
// replaceState instead. interests-deeplink.spec.ts covers deep-link-then-
// render and click-drill-in-then-browser-Back, but nothing exercised
// deep-link-then-on-screen-Close — the only path that reaches the
// replaceState branch through a real click.
async function blockNonLoopback(page: Page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost")
    ) {
      return route.continue();
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return route.continue(); // data:, blob:, about: — harmless
    }
    return route.abort();
  });
}

test("deep-link into a doc, then click on-screen Close (not browser Back)", async ({
  page,
}) => {
  await blockNonLoopback(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(`${ORIGIN}/app/interests/?mock=1&id=ai-policy`);
  await expect(
    page.getByRole("heading", { name: "AI policy & regulation" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/id=ai-policy/);

  await page.getByRole("button", { name: "← Interests" }).click();

  // The replaceState branch cleared the id and restored the card list —
  // the OTHER query params (here `mock=1`) survive since it edits the URL
  // object rather than replacing the whole query string.
  await expect(
    page.getByRole("heading", { name: "Skills setup" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/mock=1/);
  await expect(page).not.toHaveURL(/id=ai-policy/);

  // Because Close used replaceState (not pushState), there is no extra
  // history entry for this page to consume — a real browser Back from here
  // leaves the app entirely rather than "un-closing" the doc.
  await page.goBack();
  await expect(page).not.toHaveURL(/\/app\/interests\//);
});
