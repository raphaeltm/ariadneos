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
  DB: { prepare },
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
  it.each(["/api/model", "/api/context", "/api/simulate", "/api/ask"])(
    "rejects anonymous access to %s before reading data",
    async (path) => {
      const post = path === "/api/simulate" || path === "/api/ask";
      const response = await request(
        path,
        post
          ? { headers: { Origin: "https://ariadneos.com" }, method: "POST" }
          : undefined
      );
      expect(response.status).toBe(401);
      expect(prepare).not.toHaveBeenCalled();
    }
  );
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
