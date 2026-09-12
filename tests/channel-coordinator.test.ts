import { readFileSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChannelCoordinatorCore } from "../server/channel-coordinator.ts";
import type {
  ChannelScope,
  JournalEnvelope,
} from "../server/runtime/channel.ts";

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

class FakeStorage {
  alarmAt: number | null = null;
  readonly sql: {
    exec: <T>(query: string, ...bindings: unknown[]) => { toArray: () => T[] };
  };

  constructor(sql: {
    exec: <T>(query: string, ...bindings: unknown[]) => { toArray: () => T[] };
  }) {
    this.sql = sql;
  }

  async deleteAlarm() {
    this.alarmAt = null;
    await Promise.resolve();
  }

  async setAlarm(scheduledTime: number | Date) {
    this.alarmAt =
      scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
    await Promise.resolve();
  }
}

class FakeState {
  readonly id = {
    equals: () => false,
    name: "T1:C1",
    toString: () => "fake-id",
  };
  readonly storage: FakeStorage;

  constructor(db: DatabaseSync) {
    this.storage = new FakeStorage({
      exec: <T>(query: string, ...bindings: unknown[]) => {
        const trimmed = query.trim().toLowerCase();
        const rows =
          trimmed.startsWith("select") || trimmed.startsWith("pragma")
            ? (db.prepare(query).all(...(bindings as SQLInputValue[])) as T[])
            : (db.prepare(query).all(...(bindings as SQLInputValue[])) as T[]);
        return { toArray: () => rows };
      },
    });
  }

  async blockConcurrencyWhile<T>(callback: () => Promise<T>) {
    return await callback();
  }
}

let d1: DatabaseSync;
let storage: DatabaseSync;
let env: { DB: D1Database };
const scope: ChannelScope = { channel: "C1", workspaceId: "T1" };

beforeEach(() => {
  d1 = new DatabaseSync(":memory:");
  d1.exec(readFileSync("migrations/0005_pm_foundation.sql", "utf8"));
  d1.exec(
    readFileSync("migrations/0006_channel_coordinator_runtime.sql", "utf8")
  );
  storage = new DatabaseSync(":memory:");
  env = { DB: new SqliteD1(d1) as unknown as D1Database };
});

afterEach(() => {
  d1.close();
  storage.close();
});

async function textFrom(response: Response, count: number) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("missing response body");
  }
  let text = "";
  while ((text.match(/\n\n/g) ?? []).length < count) {
    // biome-ignore lint/performance/noAwaitInLoops: stream chunks arrive sequentially from one reader.
    const result = await reader.read();
    if (result.done) {
      break;
    }
    text += new TextDecoder().decode(result.value);
  }
  await reader.cancel();
  return text;
}

function envelopes(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const line = frame.split("\n").find((item) => item.startsWith("data: "));
      if (!line) {
        throw new Error(`missing data line: ${frame}`);
      }
      return JSON.parse(line.slice(6)) as JournalEnvelope;
    });
}

describe("ChannelCoordinator", () => {
  it("does not duplicate committed journal rows when an alarm is retried", async () => {
    let attempts = 0;
    const state = new FakeState(storage);
    const coordinator = new ChannelCoordinatorCore(
      state as unknown as DurableObjectState,
      env,
      scope,
      {
        beat: async (context) => {
          attempts += 1;
          await context.commit({
            kind: "step",
            opKey: "beat:session-1:1",
            payload: { attempt: attempts },
            projectId: "proj_helios",
            sessionId: "session-1",
            ts: context.now,
          });
          if (attempts === 1) {
            throw new Error("retry alarm");
          }
        },
      }
    );
    await coordinator.fetch(
      new Request("https://channel.test/schedule", {
        body: JSON.stringify({ beat: 1 }),
        method: "POST",
      })
    );
    await expect(coordinator.alarm(1)).rejects.toThrow("retry alarm");
    await coordinator.alarm(1);
    expect(attempts).toBe(2);
    expect(
      d1.prepare("SELECT COUNT(*) AS count FROM pm_journal").get()
    ).toEqual({ count: 1 });
    expect(state.storage.alarmAt).toBeNull();
  });

  it("fans out identical committed IDs and replays reconnect gaps", async () => {
    const coordinator = new ChannelCoordinatorCore(
      new FakeState(storage) as unknown as DurableObjectState,
      env,
      scope
    );
    const first = await coordinator.stream(
      { ...scope, projectId: "proj_helios" },
      0
    );
    const second = await coordinator.stream(
      { ...scope, projectId: "proj_helios" },
      0
    );
    const firstRead = textFrom(first, 2);
    const secondRead = textFrom(second, 2);
    await coordinator.commitAndPublish({
      kind: "message",
      opKey: "message:1",
      payload: { text: "one" },
      projectId: "proj_helios",
    });
    await coordinator.commitAndPublish({
      kind: "step",
      opKey: "step:1",
      payload: { label: "Review" },
      projectId: "proj_helios",
      sessionId: "session-1",
    });
    const firstEvents = envelopes(await firstRead);
    const secondEvents = envelopes(await secondRead);
    expect(firstEvents.map((event) => event.id)).toEqual([1, 2]);
    expect(secondEvents.map((event) => event.id)).toEqual([1, 2]);
    expect(firstEvents).toEqual(secondEvents);

    const reconnected = await coordinator.stream(
      { ...scope, projectId: "proj_helios" },
      1
    );
    const replayed = envelopes(await textFrom(reconnected, 1));
    expect(replayed.map((event) => event.id)).toEqual([2]);
  });

  it("broadcasts an existing journal row to connected streams", async () => {
    d1.prepare(
      `INSERT INTO pm_journal
       (workspace_id, channel, project_id, kind, ts, payload_json, operation_key)
       VALUES (?, ?, 'proj_helios', 'conformance', ?, ?, ?)`
    ).run(
      "T1",
      "C1",
      new Date(1).toISOString(),
      JSON.stringify({ fitness: 0.75, workflow_id: "wf_p1_incident" }),
      "T1:C1:conformance:1"
    );
    const coordinator = new ChannelCoordinatorCore(
      new FakeState(storage) as unknown as DurableObjectState,
      env,
      scope
    );
    const stream = await coordinator.stream(
      { ...scope, projectId: "proj_helios" },
      1
    );
    const streamed = textFrom(stream, 1);
    const response = await coordinator.fetch(
      new Request(
        "https://channel.test/broadcast?project_id=proj_helios&journal_id=1",
        { method: "POST" }
      )
    );
    expect(response.status).toBe(200);
    const [event] = envelopes(await streamed);
    expect(event).toMatchObject({
      id: 1,
      kind: "conformance",
      payload: { fitness: 0.75, workflow_id: "wf_p1_incident" },
    });
  });

  it("emits reset when a cursor is outside the bounded replay window", async () => {
    const coordinator = new ChannelCoordinatorCore(
      new FakeState(storage) as unknown as DurableObjectState,
      env,
      scope
    );
    const insert = d1.prepare(
      `INSERT INTO pm_journal
       (workspace_id, channel, project_id, kind, ts, payload_json, operation_key)
       VALUES (?, ?, 'proj_helios', 'message', ?, ?, ?)`
    );
    for (let index = 0; index < 501; index += 1) {
      insert.run(
        "T1",
        "C1",
        new Date(index).toISOString(),
        JSON.stringify({ index }),
        `T1:C1:m:${index}`
      );
    }
    const response = await coordinator.stream(
      { ...scope, projectId: "proj_helios" },
      0
    );
    const [reset] = envelopes(await textFrom(response, 1));
    expect(reset).toMatchObject({
      id: 501,
      kind: "reset",
      payload: { reason: "expired_cursor" },
    });
  });
});
