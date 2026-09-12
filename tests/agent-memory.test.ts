import { readFileSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AgentMemoryScope,
  agentThreadKey,
  appendAgentMessage,
  defaultAgentThreadId,
  isValidAgentThreadId,
  readAgentContextWindow,
} from "../server/agent-memory.ts";

interface BoundStatement {
  all: <T>() => Promise<{ results: T[] }>;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
}

class SqliteD1 {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  prepare(sql: string) {
    const create = (values: unknown[]): BoundStatement => ({
      all: async <T>() => ({
        results: this.database
          .prepare(sql)
          .all(...(values as SQLInputValue[])) as T[],
      }),
      first: async <T>() =>
        (this.database.prepare(sql).get(...(values as SQLInputValue[])) as
          | T
          | undefined) ?? null,
      run: async () =>
        this.database.prepare(sql).run(...(values as SQLInputValue[])),
    });
    return {
      all: create([]).all,
      bind: (...values: unknown[]) => create(values),
      first: create([]).first,
      run: create([]).run,
    };
  }
}

let sqlite: DatabaseSync;
let db: D1Database;

const scope: AgentMemoryScope = {
  channel: "C1",
  threadId: "T1:test-user:vendor",
  userId: "test-user",
  workflow: "vendor",
  workspaceId: "T1",
};

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/0008_agent_memory.sql", "utf8"));
  db = new SqliteD1(sqlite) as unknown as D1Database;
});

afterEach(() => {
  sqlite.close();
});

describe("agent memory persistence", () => {
  it("keeps recent context bounded to the configured message window", async () => {
    await Array.from({ length: 25 }, (_, index) => index + 1).reduce(
      async (previous, index) => {
        await previous;
        await appendAgentMessage(db, {
          content: `turn ${index}`,
          mode: "input",
          now: `2026-09-12T00:00:${String(index).padStart(2, "0")}.000Z`,
          role: "user",
          scope,
        });
      },
      Promise.resolve()
    );

    const window = await readAgentContextWindow(db, agentThreadKey(scope));

    expect(window).toHaveLength(20);
    expect(window[0]?.sequence).toBe(6);
    expect(window.at(-1)).toMatchObject({
      content: "turn 25",
      sequence: 25,
    });
  });

  it("isolates conversation history by thread key", async () => {
    const otherScope = {
      ...scope,
      threadId: "T1:test-user:refund",
      workflow: "refund",
    };
    await appendAgentMessage(db, {
      content: "vendor question",
      mode: "input",
      role: "user",
      scope,
    });
    await appendAgentMessage(db, {
      content: "refund question",
      mode: "input",
      role: "user",
      scope: otherScope,
    });

    await expect(
      readAgentContextWindow(db, agentThreadKey(scope))
    ).resolves.toMatchObject([{ content: "vendor question" }]);
    await expect(
      readAgentContextWindow(db, agentThreadKey(otherScope))
    ).resolves.toMatchObject([{ content: "refund question" }]);
  });

  it("validates public thread ids and sanitizes default thread segments", () => {
    expect(isValidAgentThreadId("T1:test-user:vendor_1")).toBe(true);
    expect(isValidAgentThreadId("../escape")).toBe(false);
    expect(
      defaultAgentThreadId({
        userId: "user@example.com",
        workflow: "vendor",
        workspaceId: "T1",
      })
    ).toBe("T1:user_example_com:vendor");
  });
});
