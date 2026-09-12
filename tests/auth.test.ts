import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../server/auth.ts", () => ({
  authConfigured: (bindings: { BETTER_AUTH_SECRET?: string }) =>
    Boolean(bindings.BETTER_AUTH_SECRET),
  createAuth: () => ({
    api: { getSession },
    handler: () => new Response("auth handler"),
  }),
}));

import worker from "../server/index.ts";

const first = vi.fn();
const all = vi.fn().mockResolvedValue({ results: [] });
const bind = vi.fn();
const prepare = vi.fn(() => ({ all, bind, first }));
const env = {
  ASSETS: { fetch: vi.fn() },
  BETTER_AUTH_SECRET: "configured",
  BETTER_AUTH_URL: "https://ariadneos.com",
  CHANNEL_COORDINATOR: {},
  DB: { prepare },
  RELEASE_SHA: "abc123456789",
  SLACK_ALLOWED_CHANNEL_ID: "C1",
  SLACK_ALLOWED_TEAM_ID: "T1",
  SLACK_CLIENT_ID: "client",
  SLACK_CLIENT_SECRET: "secret",
};
const request = (path: string, init?: RequestInit, bindings = env) =>
  worker.fetch(
    new Request(`https://ariadneos.com${path}`, init),
    bindings as never
  );
beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(null);
  first.mockResolvedValue(null);
  bind.mockReturnValue({ all, first });
});
describe("Slack authentication boundary", () => {
  it("leaves health public", async () => {
    expect((await request("/api/health")).status).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
  });
  it.each([
    "/api/model",
    "/api/context",
    "/api/settings",
    "/api/simulate",
    "/api/ask",
  ])("rejects anonymous access to %s before reading data", async (path) => {
    const post = path === "/api/simulate" || path === "/api/ask";
    const response = await request(
      path,
      post
        ? { headers: { Origin: "https://ariadneos.com" }, method: "POST" }
        : undefined
    );
    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });
  it("reports runtime settings without secret values", async () => {
    getSession.mockResolvedValue({ user: { id: "verified-user" } });
    const response = await request("/api/settings");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      auth: { provider: "Slack", status: "configured" },
      channelCoordinator: "ready",
      deployment: {
        activeTarget: "local",
        targets: [
          {
            database: "ariadneos-staging",
            domain: "staging.ariadneos.com",
            environment: "staging",
            worker: "ariadneos-staging",
          },
          {
            database: "ariadneos-demo",
            domain: "ariadneos.com",
            environment: "production",
            worker: "ariadneos-demo",
          },
        ],
      },
      releaseSha: "abc123456789",
      slack: { channel: "C1", status: "scoped", workspaceId: "T1" },
    });
  });
  it("fails closed when credentials are missing", async () => {
    expect(
      (
        await request("/api/model", undefined, {
          ...env,
          BETTER_AUTH_SECRET: "",
        })
      ).status
    ).toBe(503);
  });
  it("allows auth callbacks without an existing session", async () => {
    expect(
      await (
        await request("/api/auth/callback/slack?error=access_denied")
      ).text()
    ).toBe("auth handler");
    expect(getSession).not.toHaveBeenCalled();
  });
  it("rejects cross-origin mutations", async () => {
    expect(
      (
        await request("/api/simulate", {
          headers: { Origin: "https://evil.example" },
          method: "POST",
        })
      ).status
    ).toBe(403);
  });
  it("uses verified account identity instead of legacy anonymous cookies", async () => {
    getSession.mockResolvedValue({ user: { id: "verified-user" } });
    expect(
      (
        await request("/api/model", {
          headers: { Cookie: "ariadne_session=attacker-selected-id" },
        })
      ).status
    ).toBe(200);
    expect(bind).toHaveBeenCalledWith("vendor", "verified-user");
    expect(bind).toHaveBeenCalledWith("verified-user");
  });
});
