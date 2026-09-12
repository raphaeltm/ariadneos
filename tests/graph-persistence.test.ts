import { readFileSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  graphViewKey,
  type PersistedGraphScope,
  persistGraphRevision,
  readGraphDeltas,
  readGraphHead,
  readGraphRevision,
} from "../server/graph-persistence.ts";
import {
  buildAggregateGraph,
  type MiningStepInput,
} from "../shared/mining/graph.ts";

interface BoundStatement {
  all: <T>() => Promise<{ results: T[] }>;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
}

class SqliteD1 {
  private readonly db: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.db = database;
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

const scope: PersistedGraphScope = {
  channel: "C1",
  kind: "overlay",
  projectId: "proj_helios",
  workspaceId: "T1",
};

let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/0005_pm_foundation.sql", "utf8"));
  sqlite.exec(
    readFileSync("migrations/0006_channel_coordinator_runtime.sql", "utf8")
  );
  sqlite.exec(readFileSync("migrations/0007_graph_kb_persistence.sql", "utf8"));
  db = new SqliteD1(sqlite) as unknown as D1Database;
});

afterEach(() => {
  sqlite.close();
});

describe("D1 graph persistence", () => {
  it("commits a graph snapshot, delta and idempotent operation key", async () => {
    const graph = graphFor(["detect_incident"]);
    const first = await persistGraphRevision(db, {
      graph,
      now: "2026-09-12T00:00:00.000Z",
      operationKey: "rebuild:1",
      scope,
    });
    const retry = await persistGraphRevision(db, {
      graph,
      now: "2026-09-12T00:00:01.000Z",
      operationKey: "rebuild:1",
      scope,
    });
    const sameHead = await persistGraphRevision(db, {
      graph,
      now: "2026-09-12T00:00:02.000Z",
      operationKey: "rebuild:same-content",
      scope,
    });
    const head = await readGraphHead(db, scope);

    expect(first).toMatchObject({
      graphHash: graph.revision,
      inserted: true,
      revision: 1,
    });
    expect(first.delta.added.nodes.map((node) => node.slug)).toEqual([
      "detect_incident",
    ]);
    expect(retry).toMatchObject({ inserted: false, revision: 1 });
    expect(sameHead).toMatchObject({ inserted: false, revision: 1 });
    expect(head).toMatchObject({
      graphHash: graph.revision,
      revision: 1,
      viewKey: first.viewKey,
    });
  });

  it("merges stale rebuilds by diffing against the current stored head", async () => {
    const firstGraph = graphFor(["detect_incident"]);
    const secondGraph = graphFor(["detect_incident", "triage_incident"]);
    const staleWriterGraph = graphFor(["detect_incident", "security_review"]);

    await persistGraphRevision(db, {
      graph: firstGraph,
      operationKey: "rebuild:first",
      scope,
    });
    const second = await persistGraphRevision(db, {
      graph: secondGraph,
      operationKey: "rebuild:second",
      scope,
    });
    const merged = await persistGraphRevision(db, {
      graph: staleWriterGraph,
      operationKey: "rebuild:stale-writer",
      scope,
    });
    const head = await readGraphHead(db, scope);
    const deltas = await readGraphDeltas(db, merged.viewKey, 1);

    expect(second.revision).toBe(2);
    expect(merged).toMatchObject({
      inserted: true,
      revision: 3,
    });
    expect(merged.delta.baseRevision).toBe(2);
    expect(merged.delta.removed.nodes.map((node) => node.id)).toEqual([
      "act_triage_incident",
    ]);
    expect(merged.delta.added.nodes.map((node) => node.slug)).toEqual([
      "security_review",
    ]);
    expect(head?.graph.revision).toBe(staleWriterGraph.revision);
    expect(deltas.map((item) => item.delta.revision)).toEqual([2, 3]);
  });

  it("reads historical snapshots by integer revision", async () => {
    const firstGraph = graphFor(["detect_incident"]);
    const secondGraph = graphFor(["detect_incident", "triage_incident"]);
    const viewKey = graphViewKey(scope);

    await persistGraphRevision(db, {
      graph: firstGraph,
      operationKey: "rebuild:first",
      scope,
    });
    await persistGraphRevision(db, {
      graph: secondGraph,
      operationKey: "rebuild:second",
      scope,
    });
    const first = await readGraphRevision(db, viewKey, 1);
    const second = await readGraphRevision(db, viewKey, 2);

    expect(first?.graph.revision).toBe(firstGraph.revision);
    expect(second?.graph.nodes.map((node) => node.slug)).toEqual([
      "detect_incident",
      "triage_incident",
    ]);
  });
});

function graphFor(slugs: string[]) {
  return buildAggregateGraph({
    scope: { projectId: "proj_helios" },
    sessions: [{ id: "ses_1", projectId: "proj_helios" }],
    steps: slugs.map((slug, index) => step(`stp_${index}`, index + 1, slug)),
  });
}

function step(id: string, seq: number, activitySlug: string): MiningStepInput {
  return {
    activitySlug,
    actorPersonId: "per_priya",
    actorRole: "support",
    curation: "confirmed",
    evidence: [`${seq}.000100`],
    id,
    lifecycle: "done",
    projectId: "proj_helios",
    seq,
    sessionId: "ses_1",
    tsStart: `2026-09-12T00:${String(seq).padStart(2, "0")}:00.000Z`,
    type: "action",
  };
}
