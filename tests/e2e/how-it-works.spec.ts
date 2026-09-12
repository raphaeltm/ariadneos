import { expect, test } from "@playwright/test";

const HOW_TITLE = "There’s a process inside the conversation.";
const HOW_URL = /\/how-it-works$/;
const APP_URL = /\/app$/;
const HOME_URL = /\/$/;
const EXPECTED_MAP = /^Expected: request/;

test("public explanation supports navigation, keyboard comparison, and refresh without app requests", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(request.url());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "How it works" })
    .click();
  await expect(page).toHaveURL(HOW_URL);
  await expect(page).toHaveTitle("How it works — AriadneOS");
  await expect(page.getByRole("heading", { name: HOW_TITLE })).toBeVisible();
  await page.reload();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" })
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const observed = page.getByRole("button", { name: "Observed path" });
  const compare = page.getByRole("button", { name: "Compare with expected" });
  await observed.focus();
  await page.keyboard.press("Tab");
  await expect(compare).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(compare).toHaveAttribute("aria-pressed", "true");
  await expect(observed).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("img", { name: EXPECTED_MAP })).toBeVisible();
  await expect(
    page.getByText("A gap is a reason to look closer.", { exact: false })
  ).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Space");
  await expect(observed).toHaveAttribute("aria-pressed", "true");
  await page.goto("/how-it-works/");
  await page.reload();
  await expect(page.getByRole("heading", { name: HOW_TITLE })).toBeVisible();
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page).toHaveURL(HOME_URL);
  await page
    .getByRole("link", { exact: true, name: "See how it works ↗" })
    .click();
  await page.getByRole("link", { exact: true, name: "Open AriadneOS" }).click();
  await expect(page).toHaveURL(APP_URL);
  await expect(
    page.getByRole("button", { name: "Sign in with Slack" })
  ).toBeVisible();
});

for (const width of [320, 390, 768, 1440]) {
  test(`explanation fits a ${width}px viewport in both diagram views`, async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width });
    await page.goto("/how-it-works");
    await expect(page.getByRole("heading", { name: HOW_TITLE })).toBeVisible();
    await page
      .getByRole("link", { exact: true, name: "Follow the thread" })
      .click();
    await expect(page.locator("#how-listen-title")).toBeInViewport();
    await page.getByRole("button", { name: "Compare with expected" }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Compare with expected" })
    ).toBeVisible();
  });
}
