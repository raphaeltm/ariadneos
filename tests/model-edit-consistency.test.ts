import { readFileSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../server/index.ts";
import {
  type ConnectionScope,
  createProductionApiAdapter,
  type JournalEvent,
} from "../src/api.ts";
import {
  applyJournalEvent,
  applySnapshot,
  createInitialState,
  selectCurrentGraph,
} from "../src/store.ts";

const authState = vi.hoisted(() => ({
  session: { user: { id: "user-a" } } as { user: { id: string } } | null,
}));

vi.mock("../server/auth.ts", () => ({
  authConfigured: () => true,
  createAuth: () => ({
    api: { getSession: async () => authState.session },
  }),
}));

interface BoundStatement {
  all: <T>() => Promise<{ results: T[] }>;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
}

interface JournalRow {
  channel: string;
  id: number;
  kind: JournalEvent["kind"];
  payload_json: string;
  project_id: string;
  session_id: string | null;
  ts: string;
  workspace_id: string;
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
const scope: ConnectionScope = {
  channel: "C1",
  min_support: 1,
  project_id: "proj_helios",
  view: "overlay",
  workflow_id: "wf_p1_incident",
  workspace_id: "T1",
};

beforeEach(() => {
  authState.session = { user: { id: "user-a" } };
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/0005_pm_foundation.sql", "utf8"));
  sqlite.exec(
    readFileSync("migrations/0006_channel_coordinator_runtime.sql", "utf8")
  );
  sqlite.exec(readFileSync("migrations/0007_graph_kb_persistence.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0008_graph_edit_revisions.sql", "utf8"));
  seedProcessRows(sqlite);
  env = {
    CHANNEL_COORDINATOR: fakeDurableObjectNamespace(),
    DB: new SqliteD1(sqlite) as unknown as D1Database,
    SLACK_ALLOWED_CHANNEL_ID: "C1",
    SLACK_ALLOWED_TEAM_ID: "T1",
  } as Parameters<typeof worker.fetch>[1];
});

afterEach(() => {
  sqlite.close();
});

describe("graph model edit consistency", () => {
  it("round-trips promote edits through API, D1 and reload with identical graph state", async () => {
    const adapter = createWorkerAdapter();
    const before = await adapter.fetchSnapshot({ scope });
    expect(nodePlane(before.graph, "improvise_hotfix")).toBe("discovered");

    const applied = await adapter.applyModelEdit({
      action: "promote",
      base_revision: 0,
      payload: { slug: "improvise_hotfix" },
      request_id: "req-promote-hotfix",
      scope,
    });
    const reloaded = await adapter.fetchSnapshot({ scope });
    const duplicate = await adapter.applyModelEdit({
      action: "promote",
      base_revision: 0,
      payload: { slug: "improvise_hotfix" },
      request_id: "req-promote-hotfix",
      scope,
    });

    expect(comparableGraph(applied.graph, { ignoreRevision: true })).toEqual(
      comparableGraph(reloaded.graph, { ignoreRevision: true })
    );
    expect(applied.graph_revision).toBe(applied.graph.revision);
    expect(nodePlane(reloaded.graph, "improvise_hotfix")).toBe("both");
    expect(reloaded.graph.conformance?.extra).not.toContainEqual(
      expect.objectContaining({ slug: "improvise_hotfix" })
    );
    expect(duplicate.edit.id).toBe(applied.edit.id);
    expect(duplicate.edit.action).toBe("add_node");
    expect(editCount()).toBe(1);
  });

  it("replays multi-client edit journal deltas to the same state as a fresh reload", async () => {
    const adapter = createWorkerAdapter();
    const initial = await adapter.fetchSnapshot({ scope });
    const clientState = applySnapshot(
      createInitialState(scope),
      initial,
      scope
    );

    await adapter.applyModelEdit({
      action: "promote",
      base_revision: 0,
      payload: { slug: "improvise_hotfix" },
      request_id: "client-a-promote",
      scope,
    });
    await adapter.applyModelEdit({
      action: "require",
      base_revision: 1,
      payload: {
        from_slug: "improvise_hotfix",
        to_slug: "security_review",
      },
      request_id: "client-b-require",
      scope,
    });

    const replayed = journalEvents().reduce(
      (state, event) => applyJournalEvent(state, event).state,
      clientState
    );
    const fresh = await adapter.fetchSnapshot({ scope });

    expect(comparableGraph(selectCurrentGraph(replayed))).toEqual(
      comparableGraph(fresh.graph)
    );
    expect(
      fresh.graph.edges.some(
        (edge) =>
          edge.from === "act_improvise_hotfix" &&
          edge.to === "act_security_review" &&
          edge.plane === "designed"
      )
    ).toBe(true);
  });

  it("keeps promoted model edits consistent with curation and conformance reloads", async () => {
    const adapter = createWorkerAdapter();
    await adapter.applyModelEdit({
      action: "promote",
      base_revision: 0,
      payload: { slug: "improvise_hotfix" },
      request_id: "promote-before-curation",
      scope,
    });
    await adapter.updateStepStatus({
      request_id: "reject-hotfix-step",
      scope,
      status: "rejected",
      step_id: "stp_hotfix",
    });

    const reloaded = await adapter.fetchSnapshot({ scope });

    expect(nodePlane(reloaded.graph, "improvise_hotfix")).toBe("designed");
    expect(reloaded.graph.conformance?.extra).not.toContainEqual(
      expect.objectContaining({ slug: "improvise_hotfix" })
    );
    expect(reloaded.graph.conformance?.missing).toContainEqual(
      expect.objectContaining({ slug: "improvise_hotfix" })
    );
  });
});

function createWorkerAdapter() {
  return createProductionApiAdapter(async (input, init) => {
    let path: string;
    if (typeof input === "string") {
      path = input;
    } else if (input instanceof URL) {
      path = `${input.pathname}${input.search}`;
    } else {
      path = input.url;
    }
    const headers = new Headers(init?.headers);
    headers.set("Origin", origin);
    return await worker.fetch(
      new Request(`${origin}${path}`, { ...init, headers }),
      env,
      context
    );
  });
}

function comparableGraph(
  graph: Awaited<ReturnType<typeof selectCurrentGraph>>,
  options: { ignoreRevision?: boolean } = {}
) {
  if (!graph) {
    return null;
  }
  const comparable = {
    conformance: {
      extra: graph.conformance?.extra.map((item) => item.slug).sort(),
      fitness: graph.conformance?.fitness,
      missing: graph.conformance?.missing.map((item) => item.slug).sort(),
    },
    edges: graph.edges
      .map((edge) => ({
        from: edge.from,
        id: edge.id,
        plane: edge.plane,
        to: edge.to,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    nodes: graph.nodes
      .map((node) => ({
        id: node.id,
        plane: node.activity.plane,
        slug: node.activity.slug,
        support: node.activity.support,
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    revision: graph.revision,
  };
  return options.ignoreRevision
    ? { ...comparable, revision: undefined }
    : comparable;
}

function nodePlane(
  graph: NonNullable<Awaited<ReturnType<typeof selectCurrentGraph>>>,
  slug: string
) {
  return graph.nodes.find((node) => node.activity.slug === slug)?.activity
    .plane;
}

function editCount() {
  return (
    sqlite
      .prepare("SELECT COUNT(*) AS count FROM pm_graph_edit_revision")
      .get() as {
      count: number;
    }
  ).count;
}

function journalEvents(): JournalEvent[] {
  return (
    sqlite
      .prepare(
        "SELECT * FROM pm_journal WHERE kind = 'graph_delta' ORDER BY id"
      )
      .all() as unknown as JournalRow[]
  ).map((row) => ({
    channel: row.channel,
    id: row.id,
    kind: row.kind,
    payload: JSON.parse(row.payload_json) as JournalEvent["payload"],
    project_id: row.project_id,
    ...(row.session_id ? { session_id: row.session_id } : {}),
    ts: row.ts,
    workspace_id: row.workspace_id,
  })) as JournalEvent[];
}

function seedProcessRows(db: DatabaseSync) {
  db.prepare(
    `INSERT INTO pm_session
     (id, workspace_id, channel, project_id, workflow_id, status, source, started_ts, ended_ts)
     VALUES ('ses_helios_1', 'T1', 'C1', 'proj_helios', 'wf_p1_incident',
             'closed', 'human', '2026-09-12T12:00:00.000Z', '2026-09-12T12:09:00.000Z')`
  ).run();
  seedMessage(
    db,
    "1726152000.000100",
    "I detected the incident and called a P1."
  );
  seedMessage(db, "1726152001.000100", "I triaged severity.");
  seedMessage(db, "1726152002.000100", "I improvised the mitigation hotfix.");
  seedStep(db, "stp_detect", 1, "act_detect_incident", "detect incident");
  seedStep(db, "stp_triage", 2, "act_triage_incident", "triage incident");
  seedStep(db, "stp_hotfix", 3, "act_improvise_hotfix", "improvise hotfix");
}

function seedMessage(db: DatabaseSync, ts: string, text: string) {
  db.prepare(
    `INSERT INTO pm_message
     (workspace_id, channel, ts, id, session_id, author_label, text, permalink, received_at)
     VALUES ('T1', 'C1', ?, ?, 'ses_helios_1', 'Nia', ?, ?, '2026-09-12T12:00:01.000Z')`
  ).run(
    ts,
    `T1:C1:${ts}`,
    text,
    `https://slack.example/archives/C1/p${ts.replace(".", "")}`
  );
}

function seedStep(
  db: DatabaseSync,
  id: string,
  seq: number,
  activityId: string,
  intent: string
) {
  db.prepare(
    `INSERT INTO pm_step
     (id, session_id, seq, activity_id, actor_person_id, intent, type,
      modality, lifecycle_state, curation_status, confidence, ts_start)
     VALUES (?, 'ses_helios_1', ?, ?, 'per_nia', ?, 'action', 'reported',
             'done', 'confirmed', 0.92, ?)`
  ).run(id, seq, activityId, intent, `2026-09-12T12:0${seq}:00.000Z`);
  db.prepare(
    `INSERT INTO pm_step_evidence
     (step_id, workspace_id, channel, message_ts, message_revision)
     VALUES (?, 'T1', 'C1', ?, 1)`
  ).run(id, `172615200${seq - 1}.000100`);
}

function fakeDurableObjectNamespace() {
  return {
    get: () => ({
      fetch: (request: Request | string, init?: RequestInit) => {
        const actual =
          typeof request === "string" ? new Request(request, init) : request;
        return Response.json({
          lastEventId: actual.headers.get("Last-Event-ID"),
          url: actual.url,
        });
      },
    }),
    idFromName: (name: string) => ({ name }),
  } as unknown as DurableObjectNamespace;
}
