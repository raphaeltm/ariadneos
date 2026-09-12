import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  const cookies: string[] = JSON.parse(
    process.env.ARIADNE_BROWSER_COOKIES ?? "[]"
  );
  const cookie = cookies[testInfo.title.includes("signs out") ? 2 : 0];
  if (!(cookie && baseURL)) {
    throw new Error(
      "Run browser tests through npm run test:e2e to provision real local sessions."
    );
  }
  const separator = cookie.indexOf("=");
  await context.addCookies([
    {
      httpOnly: true,
      name: cookie.slice(0, separator),
      sameSite: "Lax",
      url: baseURL,
      value: cookie.slice(separator + 1),
    },
  ]);
});

const CASE_COUNT = /Process cases/;
const VENDOR = /Vendor onboarding/;
const REFUND = /Customer refunds/;
const UPDATED = /new events across 6 cases/;
const EVIDENCE = /Inspect .* source events/;

test("opens the dialog, contains focus, and restores it on Escape", async ({
  page,
}) => {
  await page.goto("/app");
  const opener = page.getByRole("button", { name: "About this demo" });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close about dialog" })
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Explore the process" })
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Close about dialog" })
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("refreshes persisted simulation results and exposes evidence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: VENDOR })).toBeVisible();
  const cases = page
    .locator(".stat")
    .filter({ hasText: CASE_COUNT })
    .locator(".stat-value");
  await expect(cases).toHaveText("24");
  await page
    .getByRole("button", { exact: true, name: "Simulate activity" })
    .click();
  await expect(page.getByText(UPDATED)).toBeVisible();
  await expect(cases).toHaveText("30");
  await page.reload();
  await expect(cases).toHaveText("30");
  await page.locator(".react-flow__edge").first().click();
  await page.getByRole("button", { name: EVIDENCE }).click();
  await expect(page.locator(".events-panel .event-row").first()).toBeVisible();
  await page
    .getByRole("button", { exact: true, name: "Customer refunds" })
    .click();
  await expect(page.getByRole("heading", { name: REFUND })).toBeVisible();
  await expect(cases).toHaveText("24");
  expect(errors).toEqual([]);
});

test("exposes shell navigation, project switching, and mobile layout", async ({
  page,
}) => {
  await page.goto("/app");
  await expect(
    page.getByRole("navigation", { name: "App navigation" })
  ).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace configuration" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Deployment configuration" })
  ).toBeVisible();
  await expect(page.getByText("staging.ariadneos.com")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh runtime" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Deploy workflow" })
  ).toBeVisible();
  await page.getByLabel("Switch project").selectOption("refund");
  await expect(
    page.getByRole("heading", { name: "Customer refunds" })
  ).toBeVisible();

  await page.setViewportSize({ height: 800, width: 390 });
  await page.goto("/app");
  await expect(
    page.getByRole("button", { exact: true, name: "Graph canvas" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "Inspector" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "Settings" })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});

test("supports keyboard selection and clearing on the process canvas", async ({
  page,
}) => {
  await page.goto("/app");
  const canvas = page.getByRole("application", {
    name: "Process map nodes and edges",
  });
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("SELECTION INSPECTOR")).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.getByText("PROCESS INSPECTOR")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Z");
  await expect(page.getByText("SELECTION INSPECTOR")).toBeVisible();
});

test("signs out and rejects the previous session", async ({
  page,
  context,
}) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: VENDOR })).toBeVisible();
  const before = await context.cookies();
  const session = before.find(
    (cookie) => cookie.name === "better-auth.session_token"
  );
  expect(session).toBeDefined();
  await page.getByRole("button", { exact: true, name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in with Slack" })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in with Slack" })
  ).toBeVisible();
  const response = await page.request.get("/api/model", {
    headers: { Cookie: `better-auth.session_token=${session?.value}` },
  });
  expect(response.status()).toBe(401);
});
