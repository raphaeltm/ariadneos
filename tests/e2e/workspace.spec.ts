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

const HELIOS = /Helios Payments/;
const ATLAS = /Atlas Self-Serve Billing/;
const UPDATED = /Demo simulation persisted as/;
const EVIDENCE = /Evidence messages/;
const INSPECT_SOURCES = /Inspect .* source events?/;

test("opens settings from the shell help action", async ({ page }) => {
  await page.goto("/app");
  const opener = page.getByRole("button", { name: "About this demo" });
  await opener.click();
  await expect(
    page.getByRole("heading", { name: "Workspace configuration" })
  ).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Graph canvas" }).click();
  await expect(page.getByText("Live overlay from /api/snapshot")).toBeVisible();
});

test("refreshes persisted simulation results and exposes evidence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: HELIOS })).toBeVisible();
  const cases = page
    .locator(".stat")
    .filter({ hasText: EVIDENCE })
    .locator(".stat-value");
  await expect(cases).toHaveText("0");
  await page
    .getByRole("button", { exact: true, name: "Run demo mode" })
    .click();
  await expect(page.getByText(UPDATED)).toBeVisible();
  await expect(cases).not.toHaveText("0");
  await page.reload();
  await expect(cases).not.toHaveText("0");
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Root cause analysis" })
    .click();
  await expect(page.getByText("SELECTION INSPECTOR").first()).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Activity" }).click();
  await expect(page.locator(".events-panel .event-row").first()).toBeVisible();
  await page
    .getByRole("button", { exact: true, name: "Atlas Self-Serve Billing" })
    .click();
  await expect(page.getByRole("heading", { name: ATLAS })).toBeVisible();
  expect(errors).toEqual([]);
});

test("auto-plays the guided demo walkthrough and supports beat jumps", async ({
  page,
}) => {
  await page.goto("/app");
  const cases = page
    .locator(".stat")
    .filter({ hasText: EVIDENCE })
    .locator(".stat-value");
  await expect(cases).not.toHaveText("");
  const initialCases = Number(await cases.textContent());
  await page
    .getByRole("button", { exact: true, name: "Start walkthrough" })
    .click();
  await expect(
    page.getByText("Open on the process that people think they run")
  ).toBeVisible();
  await page.keyboard.press("2");
  await expect(
    page.getByText("Let the Slack-shaped workflow unfold")
  ).toBeVisible();
  await expect
    .poll(async () => Number(await cases.textContent()), { timeout: 15_000 })
    .toBeGreaterThan(initialCases);
  await page.keyboard.press("5");
  await expect(
    page.getByText("Claims stay attached to evidence")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: INSPECT_SOURCES }).first()
  ).toBeVisible();
  await page.keyboard.press("6");
  await expect(
    page.getByText("The same workflow now has visible paths")
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The ways this process unfolds" })
  ).toBeVisible();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { exact: true, name: "Resume walkthrough" })
  ).toBeVisible();
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
  await page.getByLabel("Switch project").selectOption("proj_atlas");
  await expect(
    page.getByRole("heading", { name: "Atlas Self-Serve Billing" })
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
    page.getByRole("button", { exact: true, name: "Activity" })
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
    name: "Workflow graph nodes and edges",
  });
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("SELECTION INSPECTOR").first()).toBeVisible();
  await page.getByRole("button", { name: "Clear selection" }).first().click();
  await expect(page.getByText("PROCESS INSPECTOR").first()).toBeVisible();
});

test("signs out and rejects the previous session", async ({
  page,
  context,
}) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: HELIOS })).toBeVisible();
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
  const response = await page.request.get("/api/snapshot", {
    headers: { Cookie: `better-auth.session_token=${session?.value}` },
  });
  expect(response.status()).toBe(401);
});
