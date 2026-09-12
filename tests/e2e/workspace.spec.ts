import { expect, type Page, test } from "@playwright/test";

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

const CASE_COUNT = /Process cases/;
const VENDOR = /Vendor onboarding/;
const REFUND = /Customer refunds/;
const UPDATED = /new events across 6 cases/;
const EVIDENCE = /Inspect .* source events/;

async function fitGraph(page: Page) {
  await page.getByRole("button", { name: "Fit View" }).click();
}

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
  await fitGraph(page);
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Request received" })
    .first()
    .click();
  await page.getByRole("button", { name: EVIDENCE }).click();
  await expect(page.locator(".events-panel .event-row").first()).toBeVisible();
  await page
    .getByRole("button", { exact: true, name: "Customer refunds" })
    .click();
  await expect(page.getByRole("heading", { name: REFUND })).toBeVisible();
  await expect(cases).toHaveText("24");
  expect(errors).toEqual([]);
});

test("auto-plays the guided demo walkthrough and supports beat jumps", async ({
  page,
}) => {
  await page.goto("/app");
  const cases = page
    .locator(".stat")
    .filter({ hasText: CASE_COUNT })
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
  await expect(page.getByText(UPDATED)).toBeVisible();
  await expect(cases).toHaveText(String(initialCases + 6));
  await page.keyboard.press("5");
  await expect(
    page.getByText("Claims stay attached to evidence")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: EVIDENCE })).toBeVisible();
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

test("edits graph labels inline and creates designed edges by drag", async ({
  page,
}) => {
  await page.goto("/app");
  await fitGraph(page);
  const firstNode = page
    .locator(".react-flow__node")
    .filter({
      hasText: "Request received",
    })
    .first();
  await firstNode.click();
  await page.getByRole("button", { name: "Rename node" }).click();
  await page
    .locator('.node-rename-form input[aria-label="Node label"]')
    .fill("Intake captured");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Node label updated.")).toBeVisible();
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "Intake captured" })
  ).toBeVisible();
  await page.reload();
  await fitGraph(page);
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "Intake captured" })
  ).toBeVisible();

  const source = page
    .locator(".react-flow__node")
    .filter({ hasText: "Contract signed" })
    .first()
    .locator(".node-source-handle");
  const target = page
    .locator(".react-flow__node")
    .filter({ hasText: "Approved" })
    .first()
    .locator(".node-target-handle");
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).toBeTruthy();
  expect(targetBox).toBeTruthy();
  if (!(sourceBox && targetBox)) {
    return;
  }
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 8 }
  );
  await page.mouse.up();
  await expect(
    page.getByText("Designed edge added to this process map.")
  ).toBeVisible();
  await page.reload();
  const modelResponse = await page.request.get("/api/model");
  expect(modelResponse.ok()).toBe(true);
  const snapshot = await modelResponse.json();
  expect(snapshot.model.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        plane: "designed",
        source: "Contract signed",
        target: "Approved",
      }),
    ])
  );
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
    page.getByRole("button", { exact: true, name: "Agent chat" })
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

test("opens agent chat, streams an answer, and preserves message history", async ({
  page,
}) => {
  let requestBody: unknown;
  const response =
    "The observed handoff from intake to approval is the best place to inspect. It appears across multiple completed cases, and the supporting event log carries the source observations for review.";
  await page.route("**/api/ask", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      body: JSON.stringify({
        answer: response,
        evidence: ["VEN-104", "VEN-119"],
        mode: "summary",
      }),
      contentType: "application/json",
    });
  });

  await page.goto("/app");
  await page.getByRole("button", { exact: true, name: "Agent chat" }).click();
  await expect(
    page.getByRole("heading", { name: "Ask Ariadne" })
  ).toBeVisible();
  await page.getByLabel("Message Ariadne").fill("Which handoff slows down?");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Which handoff slows down?")).toBeVisible();
  await expect(page.locator(".stream-cursor")).toBeVisible();
  await expect(page.getByText(response)).toBeVisible();
  expect(requestBody).toMatchObject({
    project_id: "proj_helios",
    question: "Which handoff slows down?",
    workflow: "vendor",
    workflow_id: "wf_vendor",
  });

  await page.getByRole("button", { name: "Inspect evidence" }).click();
  await expect(page.locator(".events-panel .event-row").first()).toBeVisible();
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
