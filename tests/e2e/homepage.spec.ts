import { expect, test } from "@playwright/test";

const HERO = /Every conversation/;
const APP_URL = /\/app$/;
const HOW_URL = /#how-it-works$/;

test("markets Slack without fetching app data and opens the explorer", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(request.url());
    }
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HERO })).toBeVisible();
  expect(apiRequests).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" })
  ).toBeFocused();
  await page
    .getByRole("link", { exact: true, name: "Explore the demo" })
    .click();
  await expect(page).toHaveURL(APP_URL);
  await expect(
    page.getByText("Observed events", { exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Observed events", { exact: true })
  ).toBeVisible();
  await page.getByRole("link", { exact: true, name: "AriadneOS home" }).click();
  await expect(page.getByRole("heading", { name: HERO })).toBeVisible();
  await page.goto("/app/");
  await expect(
    page.getByText("Observed events", { exact: true })
  ).toBeVisible();
});

test("keeps mobile content within the viewport and section navigation usable", async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 320 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HERO })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page
    .getByRole("link", { exact: true, name: "See how it works ↗" })
    .click();
  await expect(page).toHaveURL(HOW_URL);
  await expect(page.locator("#how-it-works")).toBeInViewport();
});
