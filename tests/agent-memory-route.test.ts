import { readFileSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../server/index.ts";

vi.mock("../server/auth.ts", () => ({
  authConfigured: () => true,
  createAuth: () => ({
    api: { getSession: async () => ({ user: { id: "test-user" } }) },
  }),
}));

interface BoundStatement {
  all: <T>() => Promise<{ results: T[] }>;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
}

class SqliteD1 {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  prepare(sql: string) {
    const create = (values: unknown[]): BoundStatement => ({
      all: async <T>() => ({
        results: this.db
          .prepare(sql)
          .all(...(values as SQLInputValue[])) as T[],
      }),
      first: async <T>() =>
        (this.db.prepare(sql).get(...(values as SQLInputValue[])) as
          | T
          | undefined) ?? null,
      run: async () => this.db.prepare(sql).run(...(values as SQLInputValue[])),
    });
    return {
      all: create([]).all,
      bind: (...values: unknown[]) => create(values),
      first: create([]).first,
      run: create([]).run,
    };
  }

  async batch(statements: BoundStatement[]) {
    return await Promise.all(statements.map((statement) => statement.run()));
  }
}

let sqlite: DatabaseSync;
let env: Parameters<typeof worker.fetch>[1];

const context = {} as ExecutionContext;
const origin = "https://demo.example";

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/0001_initial.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0002_seed.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0008_agent_memory.sql", "utf8"));
  env = {
    AI: {
      run: vi.fn(() => Promise.reject(new Error("remote model unavailable"))),
    },
    DB: new SqliteD1(sqlite) as unknown as D1Database,
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
          workflow: "vendor",
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
