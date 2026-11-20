import { expect, test, type Page } from "@playwright/test";
import { HOSTED_PORT } from "./port";

// The business step on the hosted first-run screen, over the in-memory fake
// backend (src/lib/hosted-fake.ts) started as a new reader with no topics:
// pick a trade and a kommune, add a ready-made topic, and it is created and
// scheduled. "Not now" hides the step for good.

const ORIGIN = `http://127.0.0.1:${HOSTED_PORT}`;

async function blockNonLoopback(page: Page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost") ||
      !/^https?:\/\//.test(url)
    ) {
      return route.continue();
    }
    return route.abort();
  });
}

async function newReader(page: Page) {
  await blockNonLoopback(page);
  await page.addInitScript(() =>
    window.sessionStorage.setItem("scout.fake.fresh", "1"),
  );
  await page.goto(`${ORIGIN}/app/`);
  await expect(page.getByText("Run a business?")).toBeVisible({
    timeout: 60_000,
  });
}

test("pick a trade and a kommune, then add a ready-made topic", async ({
  page,
}) => {
  await newReader(page);
  await page.getByLabel("What do you do?").selectOption({
    label: "Restaurant, café or bar",
  });
  const kommune = page.getByLabel("Kommune", { exact: true });
  // The fake profile lives in Trondheim, so the kommune is filled in.
  await expect(kommune).toHaveValue("Trondheim");

  // A place that is no kommune is refused under the field.
  await kommune.fill("Atlantis");
  const rivals = "New restaurants, cafés and bars and closures in Trondheim";
  await page
    .getByRole("button", {
      name: "Add New restaurants, cafés and bars and closures in your kommune",
    })
    .click();
  await expect(page.getByText("Pick a kommune from the list.")).toBeVisible();

  await kommune.fill("bergen");
  await expect(page.getByText("Pick a kommune from the list.")).toBeHidden();
  await kommune.fill("Trondheim");
  await page.getByRole("button", { name: `Add ${rivals}` }).click();
  await expect(page.getByText("Added")).toBeVisible();
  // The step stays for the trade's other topic until Done.
  await expect(
    page.getByRole("button", {
      name: "Add New rules for restaurants, cafés and bars in Norway",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Run a business?")).toBeHidden();
  // The new topic is on the Topics page (a client-side visit keeps the fake).
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("link", { name: /^Topics/ }).click();
  await expect(page.getByText(rivals).first()).toBeVisible();
});

test("Not now hides the step, also after a reload", async ({ page }) => {
  await newReader(page);
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByText("Run a business?")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "What do you want to follow?" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What do you want to follow?" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Run a business?")).toBeHidden();
});
