import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../server/index.ts";
import {
  createTestDatabase,
  type SqliteD1,
  seedTenant,
  TEST_WORKSPACE,
} from "./helpers/tenant.ts";

vi.mock("../server/auth.ts", () => ({
  authConfigured: () => true,
  createAuth: () => ({
    api: { getSession: async () => ({ user: { id: "test-user" } }) },
  }),
  sessionIdentity: async () => ({
    slackTeamId: TEST_WORKSPACE,
    slackUserId: "U0USER",
    userId: "test-user",
  }),
}));

let d1: SqliteD1;
let sqlite: DatabaseSync;
let env: Parameters<typeof worker.fetch>[1];

const context = {} as ExecutionContext;
const origin = "https://demo.example";

beforeEach(() => {
  ({ d1, sqlite } = createTestDatabase());
  seedTenant(sqlite);
  env = {
    AI: {
      run: vi.fn(() => Promise.reject(new Error("remote model unavailable"))),
    },
    DB: d1,
  } as Parameters<typeof worker.fetch>[1];
});

afterEach(() => {
  sqlite.close();
});

describe("agent memory route integration", () => {
  it("persists user and fallback assistant turns for ask requests", async () => {
    const response = await worker.fetch(
      new Request(`${origin}/api/ask`, {
        body: JSON.stringify({
          question: "What should I know from last time?",
          thread_id: "demo-thread",
        }),
        headers: { "Content-Type": "application/json", Origin: origin },
        method: "POST",
      }),
      env,
      context
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: "summary",
      notice:
        "AI is temporarily unavailable. Showing computed process statistics.",
    });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM pm_agent_thread").get()
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .prepare(
          "SELECT sequence, role, mode, content FROM pm_agent_message ORDER BY sequence"
        )
        .all()
    ).toMatchObject([
      {
        content: "What should I know from last time?",
        mode: "input",
        role: "user",
        sequence: 1,
      },
      {
        mode: "summary",
        role: "assistant",
        sequence: 2,
      },
    ]);
  });
});
