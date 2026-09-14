import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());

// Better Auth needs a real D1 to construct, so the session boundary is stubbed.
// sessionIdentity keeps its real contract: it returns null unless the session
// carries a Slack workspace, which is what scopes every request.
vi.mock("../server/auth.ts", () => ({
  authConfigured: (bindings: { BETTER_AUTH_SECRET?: string }) =>
    Boolean(bindings.BETTER_AUTH_SECRET),
  createAuth: () => ({
    api: { getSession },
    handler: () => new Response("auth handler"),
  }),
  sessionIdentity: async () => {
    const session = (await getSession()) as {
      user?: { id?: string; slackTeamId?: unknown; slackUserId?: unknown };
    } | null;
    const teamId = session?.user?.slackTeamId;
    if (!(session?.user?.id && typeof teamId === "string" && teamId)) {
      return null;
    }
    return {
      slackTeamId: teamId,
      slackUserId:
        typeof session.user.slackUserId === "string"
          ? session.user.slackUserId
          : "",
      userId: session.user.id,
    };
  },
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
  DB: { batch: vi.fn().mockResolvedValue([]), prepare },
  RELEASE_SHA: "abc123456789",
  SLACK_CLIENT_ID: "client",
  SLACK_CLIENT_SECRET: "secret",
};
const request = (path: string, init?: RequestInit, bindings = env) =>
  worker.fetch(
    new Request(`https://ariadneos.com${path}`, init),
    bindings as never
  );

// Authenticated routes are the ones a browser reaches. Anonymous access to any of
// them must be refused before the handler touches the database.
const AUTHENTICATED_ROUTES: Array<{ method: "GET" | "POST"; path: string }> = [
  { method: "GET", path: "/api/settings" },
  { method: "GET", path: "/api/snapshot" },
  { method: "GET", path: "/api/kb" },
  { method: "GET", path: "/api/graph/overlay" },
  { method: "GET", path: "/api/sessions" },
  { method: "GET", path: "/api/messages" },
  { method: "GET", path: "/api/setup/status" },
  { method: "POST", path: "/api/ask" },
  { method: "POST", path: "/api/model/edit" },
  { method: "POST", path: "/api/graph/rebuild" },
  { method: "POST", path: "/api/setup/projects" },
  { method: "POST", path: "/api/setup/workflows" },
];

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(null);
  first.mockResolvedValue(null);
  all.mockResolvedValue({ results: [] });
  bind.mockReturnValue({ all, first, run: vi.fn() });
});

describe("Slack authentication boundary", () => {
  it("leaves health public", async () => {
    expect((await request("/api/health")).status).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
  });

  it.each(["/api/agent/status", "/api/agent/smoke"])(
    "keeps %s reachable without a session for deployment readiness",
    async (path) => {
      // The deploy workflow calls these on the deployed revision to prove the
      // configured model is reachable. Putting either behind the session
      // middleware breaks the staging gate, which is how it broke once already.
      const response = await request(
        path,
        path.endsWith("smoke")
          ? {
              body: "{}",
              headers: {
                "Content-Type": "application/json",
                Origin: "https://ariadneos.com",
              },
              method: "POST",
            }
          : undefined
      );
      expect(response.status).not.toBe(401);
      expect(getSession).not.toHaveBeenCalled();
    }
  );

  it.each(AUTHENTICATED_ROUTES)(
    "rejects anonymous access to $method $path before reading data",
    async ({ method, path }) => {
      const response = await request(
        path,
        method === "POST"
          ? {
              body: "{}",
              headers: {
                "Content-Type": "application/json",
                Origin: "https://ariadneos.com",
              },
              method: "POST",
            }
          : undefined
      );
      expect(response.status).toBe(401);
      expect(prepare).not.toHaveBeenCalled();
    }
  );

  it("rejects a session whose workspace is unknown", async () => {
    // A session created before workspace capture has no Slack team, so it cannot
    // be scoped to any tenant's data and must not fall back to a shared scope.
    getSession.mockResolvedValue({ user: { id: "verified-user" } });
    const response = await request("/api/snapshot");
    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("reports runtime settings without secret values", async () => {
    getSession.mockResolvedValue({
      user: { id: "verified-user", slackTeamId: "T0TEAM" },
    });
    const response = await request("/api/settings");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      auth: { provider: "Slack", status: "configured" },
      environment: "local",
      releaseSha: "abc123456789",
      slack: { status: "not_installed" },
    });
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(JSON.stringify(payload)).not.toContain("configured-secret");
  });

  it("fails closed when credentials are missing", async () => {
    expect(
      (
        await request("/api/snapshot", undefined, {
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
        await request("/api/ask", {
          headers: { Origin: "https://evil.example" },
          method: "POST",
        })
      ).status
    ).toBe(403);
  });

  it("rejects cross-origin deletions", async () => {
    expect(
      (
        await request("/api/setup/policies/pol_example", {
          headers: { Origin: "https://evil.example" },
          method: "DELETE",
        })
      ).status
    ).toBe(403);
  });

  it("scopes the request to the workspace in the session, not a request parameter", async () => {
    getSession.mockResolvedValue({
      user: { id: "verified-user", slackTeamId: "T0OWNTEAM" },
    });
    await request("/api/snapshot?workspace_id=T0OTHERTEAM");
    // Every scoped read filters on the session's workspace. A caller-supplied
    // workspace_id can never widen it.
    const boundWorkspaces = bind.mock.calls.flat();
    expect(boundWorkspaces).not.toContain("T0OTHERTEAM");
  });

  it("serves the app shell for unknown paths without a session", async () => {
    env.ASSETS.fetch.mockResolvedValue(new Response("app"));
    expect((await request("/app")).status).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
  });
});
