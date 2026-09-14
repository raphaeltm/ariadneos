import { describe, expect, it, vi } from "vitest";
import worker from "../server/index.ts";

// A session with a Slack workspace, so these tests reach the handlers' own
// validation rather than stopping at the authentication boundary. tests/auth.test.ts
// covers the boundary itself.
vi.mock("../server/auth.ts", () => ({
  authConfigured: () => true,
  createAuth: () => ({
    api: { getSession: async () => ({ user: { id: "test-user" } }) },
  }),
  sessionIdentity: async () => ({
    slackTeamId: "T0TESTTEAM",
    slackUserId: "U0TESTUSER",
    userId: "test-user",
  }),
}));

// These requests must be rejected before any storage or AI binding is used, so the
// environment deliberately has no DB binding: reaching storage would throw.
const context = {} as ExecutionContext;
const env = {} as Parameters<typeof worker.fetch>[1];
const origin = "https://demo.example";
const request = (
  path: string,
  body: unknown,
  requestOrigin = origin,
  bindings: Parameters<typeof worker.fetch>[1] = env
) =>
  worker.fetch(
    new Request(`${origin}${path}`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Origin: requestOrigin },
      method: "POST",
    }),
    bindings,
    context
  );

describe("request boundaries", () => {
  it.each([
    null,
    {},
    { question: "" },
    { question: 42 },
    { question: "x".repeat(401) },
    { project_id: 42, question: "show me the handoff" },
  ])("rejects invalid questions: %j", async (body) => {
    expect((await request("/api/ask", body)).status).toBe(400);
  });

  it("rejects malformed JSON before storage", async () => {
    const response = await worker.fetch(
      new Request(`${origin}/api/ask`, {
        body: "{not json",
        headers: { "Content-Type": "application/json", Origin: origin },
        method: "POST",
      }),
      env,
      context
    );
    expect(response.status).toBe(400);
  });

  it("rejects malformed agent thread identifiers before storage", async () => {
    expect(
      (
        await request("/api/ask", {
          question: "What changed?",
          thread_id: "../other-thread",
        })
      ).status
    ).toBe(400);
  });

  it("rejects cross-origin mutation before storage", async () => {
    expect(
      (
        await request(
          "/api/ask",
          { question: "hello" },
          "https://untrusted.example"
        )
      ).status
    ).toBe(403);
  });

  it("rejects cross-origin deletion before storage", async () => {
    const response = await worker.fetch(
      new Request(`${origin}/api/setup/policies/pol_example`, {
        headers: { Origin: "https://untrusted.example" },
        method: "DELETE",
      }),
      env,
      context
    );
    expect(response.status).toBe(403);
  });

  it("rejects oversized bodies", async () => {
    expect(
      (await request("/api/ask", { question: "x".repeat(70_000) })).status
    ).toBe(413);
  });

  it("rejects an invalid project on setup authoring before storage", async () => {
    expect((await request("/api/setup/projects", { name: "" })).status).toBe(
      400
    );
    expect(
      (await request("/api/setup/projects", { name: "x".repeat(200) })).status
    ).toBe(400);
  });

  it("rejects a workflow with no activities before storage", async () => {
    expect(
      (
        await request("/api/setup/workflows", {
          activities: [],
          name: "Empty workflow",
          project_id: "proj_example",
        })
      ).status
    ).toBe(400);
  });

  it("rejects a workflow with a malformed activity before storage", async () => {
    expect(
      (
        await request("/api/setup/workflows", {
          activities: [{ label: "" }],
          name: "Bad workflow",
          project_id: "proj_example",
        })
      ).status
    ).toBe(400);
  });

  it("rejects a policy with an unsupported kind before storage", async () => {
    expect(
      (
        await request("/api/setup/policies", {
          activity_slug: "deploy_fix",
          kind: "not_a_kind",
          project_id: "proj_example",
          text: "Some rule",
        })
      ).status
    ).toBe(400);
  });

  it("reports the agent runtime as disabled without storage or secrets", async () => {
    const response = await worker.fetch(
      new Request(`${origin}/api/agent/status`),
      env,
      context
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      config: {
        enabled: false,
        hasOpenRouterKey: false,
      },
      executor: "mastra-embedded",
      fallback: "typed-fetch",
      path: "embedded-worker",
    });
  });

  it("keeps the agent smoke disabled without storage or model calls", async () => {
    const response = await request("/api/agent/smoke", {});
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      executor: "disabled",
      ok: true,
      status: "disabled",
    });
  });

  it("reports a missing OpenRouter key before storage", async () => {
    const response = await request("/api/agent/smoke", {}, origin, {
      AGENT_ENABLED: "true",
    } as Parameters<typeof worker.fetch>[1]);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      executor: "disabled",
      ok: false,
      status: "missing_key",
    });
  });

  it("rejects cross-origin agent smoke requests before storage", async () => {
    expect(
      (await request("/api/agent/smoke", {}, "https://untrusted.example"))
        .status
    ).toBe(403);
  });

  it("returns a not-found error for unknown API paths", async () => {
    const response = await worker.fetch(
      new Request(`${origin}/api/does-not-exist`),
      env,
      context
    );
    expect(response.status).toBe(404);
  });

  it("preserves path and query on canonical redirects", async () => {
    const response = await worker.fetch(
      new Request("http://www.ariadneos.com/api/health?check=1"),
      env,
      context
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://ariadneos.com/api/health?check=1"
    );
  });
});
