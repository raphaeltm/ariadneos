import { describe, expect, it, vi } from "vitest";
import worker from "../server/index.ts";

vi.mock("../server/auth.ts", () => ({
  authConfigured: () => true,
  createAuth: () => ({
    api: { getSession: async () => ({ user: { id: "test-user" } }) },
  }),
}));

// These requests must be rejected before any storage or AI binding is used.
const context = {} as ExecutionContext;
const env = {} as Parameters<typeof worker.fetch>[1];
const origin = "https://demo.example";
const request = (path: string, body: unknown, requestOrigin = origin) =>
  worker.fetch(
    new Request(`${origin}${path}`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Origin: requestOrigin },
      method: "POST",
    }),
    env,
    context
  );

describe("request boundaries", () => {
  it.each([null, {}, { workflow: "unknown" }, { workflow: 42 }])(
    "rejects invalid simulations: %j",
    async (body) => {
      expect((await request("/api/simulate", body)).status).toBe(400);
    }
  );
  it.each([
    null,
    {},
    { question: "", workflow: "vendor" },
    { question: 42, workflow: "vendor" },
    { question: "x".repeat(401), workflow: "vendor" },
    { question: "show me the handoff", workflow_id: 42 },
    { question: "show me the handoff", workflow_id: "wf_unknown" },
  ])("rejects invalid questions: %j", async (body) => {
    expect((await request("/api/ask", body)).status).toBe(400);
  });
  it("rejects cross-origin mutation before storage", async () => {
    expect(
      (
        await request(
          "/api/simulate",
          { workflow: "vendor" },
          "https://untrusted.example"
        )
      ).status
    ).toBe(403);
  });
  it("rejects oversized bodies", async () => {
    expect(
      (await request("/api/ask", { question: "x".repeat(5000) })).status
    ).toBe(413);
  });
  it("rejects malformed agent thread identifiers before storage", async () => {
    expect(
      (
        await request("/api/ask", {
          question: "What changed?",
          thread_id: "../other-thread",
          workflow: "vendor",
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
    const response = await worker.fetch(
      new Request(`${origin}/api/agent/smoke`, {
        body: "{}",
        headers: { "Content-Type": "application/json", Origin: origin },
        method: "POST",
      }),
      { AGENT_ENABLED: "true" } as Parameters<typeof worker.fetch>[1],
      context
    );
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
