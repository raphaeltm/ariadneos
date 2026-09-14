import { expect, test } from "@playwright/test";

// scripts/check_smoke.py provisions the local Worker with a workspace the way a
// completed setup leaves it: an install, an enabled channel bound to a project,
// and an authored workflow. It seeds no observations, because observations may
// only come from Slack. These tests therefore assert the app's real empty state
// and the surfaces that do not depend on observed work.

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  const cookies: string[] = JSON.parse(
    process.env.ARIADNE_BROWSER_COOKIES ?? "[]"
  );
  let cookieIndex = 0;
  if (testInfo.title.includes("edits graph labels")) {
    cookieIndex = 1;
  }
  if (testInfo.title.includes("signs out")) {
    cookieIndex = 2;
  }
  const cookie = cookies[cookieIndex];
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

const DESIGNED_OR_BOTH = /designed|both/;
const CONNECT_SLACK = /Connect Slack/i;
const SMOKE_PROJECT_HEADING = /Local smoke project/;
const EVIDENCE_STAT = /Evidence messages/;
const NO_VARIANTS = /No variants observed yet/;
const NO_EVIDENCE = /No evidence yet/;
const RUN_DEMO = /Run demo/i;
const SIMULATOR = /simulator/i;

test("opens settings from the shell help action", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "About Ariadne" }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace configuration" })
  ).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Graph canvas" }).click();
  await expect(page.getByText("Live overlay from /api/snapshot")).toBeVisible();
});

test("reports the connected workspace and extraction status in settings", async ({
  page,
}) => {
  await page.goto("/app");
  await page.getByRole("button", { exact: true, name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace configuration" })
  ).toBeVisible();
  await expect(page.getByText("Local Test Workspace")).toBeVisible();
  await expect(page.getByText("#local-smoke")).toBeVisible();
  // The smoke Worker runs without an OpenRouter key, so the app must say
  // extraction is not configured rather than appearing healthy.
  await expect(page.getByText("missing key")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh runtime" })
  ).toBeVisible();
});

test("shows the setup surface with its progress steps", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app");
  await page.getByRole("button", { exact: true, name: "Setup" }).click();
  await expect(page.getByText(CONNECT_SLACK).first()).toBeVisible();
  // The provisioned workspace already has an install and a channel, so setup
  // must reflect that rather than asking for them again.
  await expect(page.getByText("Local Test Workspace").first()).toBeVisible();
  await expect(page.getByText("local-smoke").first()).toBeVisible();
  await expect(page.getByText("Local smoke workflow").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("shows an honest empty state before any Slack work is observed", async ({
  page,
}) => {
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: SMOKE_PROJECT_HEADING })
  ).toBeVisible();
  // No observations exist, so the evidence count is zero and the panels say so
  // instead of inviting the user to generate fake data.
  const evidence = page
    .locator(".stat")
    .filter({ hasText: EVIDENCE_STAT })
    .locator(".stat-value");
  await expect(evidence).toHaveText("0");
  await expect(page.getByText(NO_VARIANTS)).toBeVisible();
  await expect(page.getByText(NO_EVIDENCE)).toBeVisible();
  // Nothing anywhere should offer to run a simulation.
  await expect(page.getByRole("button", { name: RUN_DEMO })).toHaveCount(0);
  await expect(page.getByRole("button", { name: SIMULATOR })).toHaveCount(0);
});

test("renders the designed plane authored during setup", async ({ page }) => {
  await page.goto("/app");
  // Designed activities appear as ghosts even with zero observations, which is
  // what makes the overlay readable on day one.
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "Security review" })
  ).toBeVisible();
  const snapshot = await page.request.get("/api/snapshot");
  expect(snapshot.ok()).toBe(true);
  const payload = await snapshot.json();
  expect(payload.graph.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        activity: expect.objectContaining({
          plane: expect.stringMatching(DESIGNED_OR_BOTH),
          slug: "security_review",
          support: 0,
        }),
      }),
    ])
  );
  // Every node must be designed: nothing was observed, so nothing may claim to be.
  for (const node of payload.graph.nodes) {
    expect(node.activity.occurrences).toBe(0);
  }
  expect(payload.messages).toEqual([]);
  expect(payload.steps).toEqual([]);
});

test("edits graph labels inline and persists them", async ({ page }) => {
  await page.goto("/app");
  const node = page
    .locator(".react-flow__node")
    .filter({ hasText: "Security review" })
    .first();
  await node.click();
  await page.getByRole("button", { name: "Rename node" }).click();
  const input = page.locator(
    '.node-rename-form input[aria-label="Node label"]'
  );
  await input.fill("Security checklist");
  await input.press("Enter");
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "Security checklist" })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "Security checklist" })
  ).toBeVisible();
  const snapshot = await page.request.get("/api/snapshot");
  expect(snapshot.ok()).toBe(true);
  expect((await snapshot.json()).graph.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        activity: expect.objectContaining({ label: "Security checklist" }),
      }),
    ])
  );
});

test("exposes shell navigation and mobile layout", async ({ page }) => {
  await page.goto("/app");
  await expect(
    page.getByRole("navigation", { name: "App navigation" })
  ).toBeVisible();
  for (const name of [
    "Graph canvas",
    "Inspector",
    "Activity",
    "Agent chat",
    "Setup",
    "Settings",
  ]) {
    await expect(page.getByRole("button", { exact: true, name })).toBeVisible();
  }

  await page.setViewportSize({ height: 800, width: 390 });
  await page.goto("/app");
  await expect(
    page.getByRole("button", { exact: true, name: "Graph canvas" })
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
  await expect(page.getByText("SELECTION INSPECTOR").first()).toBeVisible();
  await page.getByRole("button", { name: "Clear selection" }).first().click();
  await expect(page.getByText("PROCESS INSPECTOR").first()).toBeVisible();
});

test("opens agent chat, streams an answer, and preserves message history", async ({
  page,
}) => {
  let requestBody: unknown;
  const response =
    "No work has been extracted from this channel yet. Once messages describing work arrive, the graph will show the steps and their evidence.";
  await page.route("**/api/ask", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      body: JSON.stringify({ answer: response, evidence: [], mode: "summary" }),
      contentType: "application/json",
    });
  });

  await page.goto("/app");
  await page.getByRole("button", { exact: true, name: "Agent chat" }).click();
  await expect(
    page.getByRole("heading", { name: "Ask Ariadne" })
  ).toBeVisible();
  await page.getByLabel("Message Ariadne").fill("What has happened so far?");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("What has happened so far?")).toBeVisible();
  await expect(page.locator(".stream-cursor")).toBeVisible();
  await expect(page.getByText(response)).toBeVisible();
  // The request carries the project, and no workflow alias: the legacy
  // vendor/refund/access mapping is gone.
  expect(requestBody).toMatchObject({
    project_id: "proj_local_smoke",
    question: "What has happened so far?",
  });
  expect(requestBody).not.toHaveProperty("workflow");
});

test("signs out and rejects the previous session", async ({
  page,
  context,
}) => {
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: SMOKE_PROJECT_HEADING })
  ).toBeVisible();
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
