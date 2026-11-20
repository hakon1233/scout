import { expect, test } from "@playwright/test";
import { HOSTED_PORT } from "./port";

// "Email me new briefs" on the hosted app's fake backend
// (src/lib/hosted-fake.ts): hidden while email is switched off for Scout (the
// default), and beside each bell, off until tapped, once it is switched on.

const ORIGIN = `http://127.0.0.1:${HOSTED_PORT}`;
const POWER = "Nordic power prices and the NO3 area";
const toggle = `Email me new briefs about ${POWER}`;

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
});

test("email switched off: no email toggles, the bells as before", async ({
  page,
}) => {
  await page.goto(`${ORIGIN}/app/settings/`);
  await expect(
    page.getByRole("button", { name: `Notify me about ${POWER}` }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: toggle })).toHaveCount(0);
});

test("email switched on: each topic gets an email toggle, off until tapped", async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.sessionStorage.setItem("scout.fake.emailOn", "1"),
  );
  await page.goto(`${ORIGIN}/app/settings/`);
  const button = page.getByRole("button", { name: toggle });
  await expect(button).toHaveAttribute("aria-pressed", "false", {
    timeout: 60_000,
  });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: `Notify me about ${POWER}` }),
  ).toHaveAttribute("aria-pressed", "false");
});
