import { readFileSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../server/index.ts";

const authState = vi.hoisted(() => ({
  session: { user: { id: "test-user" } } as { user: { id: string } } | null,
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
  authState.session = { user: { id: "test-user" } };
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

describe("process API routes", () => {
  it("rejects unauthenticated process API requests before reading D1", async () => {
    authState.session = null;
    const response = await get(
      "/api/snapshot",
      {} as Parameters<typeof worker.fetch>[1]
    );
    expect(response.status).toBe(401);
  });

  it("rejects foreign workspace scope with a structured error", async () => {
    const response = await get("/api/snapshot?workspace_id=T2");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "forbidden_scope",
        message: "Requested workspace or channel is not authorized.",
      },
    });
  });

  it("returns an authenticated snapshot from D1 with a journal cursor", async () => {
    const response = await get(
      "/api/snapshot?project_id=proj_helios&workflow_id=wf_p1_incident"
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      cursor: number;
      graph: { kind: string; nodes: unknown[] };
      messages: unknown[];
      sessions: unknown[];
      steps: Array<{ evidence: unknown[]; status: string }>;
    };
    expect(payload.cursor).toBe(1);
    expect(payload.graph.kind).toBe("overlay");
    expect(payload.graph.nodes.length).toBeGreaterThan(0);
    expect(payload.messages).toHaveLength(1);
    expect(payload.sessions).toHaveLength(1);
    expect(payload.steps).toMatchObject([
      {
        evidence: [expect.objectContaining({ message_revision: 1 })],
        status: "confirmed",
      },
    ]);
  });

  it("validates message pagination limits", async () => {
    const response = await get("/api/messages?limit=101");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_limit" },
    });
  });

  it("commits curation updates and journal entries in scope", async () => {
    const response = await post("/api/steps/stp_triage/status", {
      request_id: "req-1",
      status: "rejected",
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      step: { status: string };
    };
    expect(payload.step.status).toBe("rejected");
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM pm_journal WHERE kind = 'step'")
        .get()
    ).toEqual({ count: 1 });
  });

  it("persists designed graph edits with revision history and idempotent request ids", async () => {
    const response = await post("/api/model/edit", {
      action: "add_node",
      base_revision: 0,
      payload: {
        label: "Draft status update",
        role_expected: "pm",
        slug: "draft_status_update",
      },
      request_id: "edit-add-node",
      workflow_id: "wf_p1_incident",
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      designed: { nodes: Array<{ id: string }> };
      edit: { revision: number };
      graph_revision: number;
      revision: number;
    };
    expect(payload.revision).toBe(1);
    expect(payload.edit.revision).toBe(1);
    expect(payload.graph_revision).toBe(1);
    expect(payload.designed.nodes.map((node) => node.id)).toContain(
      "act_draft_status_update"
    );

    const retry = await post("/api/model/edit", {
      action: "add_node",
      base_revision: 0,
      payload: {
        label: "Draft status update",
        role_expected: "pm",
        slug: "draft_status_update",
      },
      request_id: "edit-add-node",
      workflow_id: "wf_p1_incident",
    });
    expect(retry.status).toBe(200);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM pm_graph_edit_revision")
        .get()
    ).toEqual({ count: 1 });

    const history = await get("/api/model/edits?workflow_id=wf_p1_incident");
    expect(history.status).toBe(200);
    await expect(history.json()).resolves.toMatchObject({
      edits: [
        {
          action: "add_node",
          revision: 1,
          undone: false,
        },
      ],
      revision: 1,
      workflow_id: "wf_p1_incident",
    });
  });

  it("rejects stale graph edit revisions before writing", async () => {
    expect(
      (
        await post("/api/model/edit", {
          action: "add_node",
          base_revision: 0,
          payload: { slug: "draft_status_update" },
          request_id: "edit-first",
          workflow_id: "wf_p1_incident",
        })
      ).status
    ).toBe(200);

    const stale = await post("/api/model/edit", {
      action: "add_node",
      base_revision: 0,
      payload: { slug: "publish_status_update" },
      request_id: "edit-stale",
      workflow_id: "wf_p1_incident",
    });

    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      current_revision: 1,
      error: { code: "edit_conflict" },
    });
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM pm_graph_edit_revision")
        .get()
    ).toEqual({ count: 1 });
  });

  it("undoes the latest designed graph edit as its own revision", async () => {
    await post("/api/model/edit", {
      action: "add_node",
      base_revision: 0,
      payload: { slug: "draft_status_update" },
      request_id: "edit-add",
      workflow_id: "wf_p1_incident",
    });

    const undo = await post("/api/model/edit/undo", {
      base_revision: 1,
      request_id: "undo-add",
      workflow_id: "wf_p1_incident",
    });

    expect(undo.status).toBe(200);
    const payload = (await undo.json()) as {
      designed: { nodes: Array<{ id: string }> };
      edit: { action: string; revision: number; target_edit_id: string };
      revision: number;
    };
    expect(payload.revision).toBe(2);
    expect(payload.edit).toMatchObject({ action: "undo", revision: 2 });
    expect(payload.edit.target_edit_id).toBeTruthy();
    expect(payload.designed.nodes.map((node) => node.id)).not.toContain(
      "act_draft_status_update"
    );

    const rows = sqlite
      .prepare(
        "SELECT action, revision, undone FROM pm_graph_edit_revision ORDER BY revision"
      )
      .all();
    expect(rows).toEqual([
      { action: "add_node", revision: 1, undone: 1 },
      { action: "undo", revision: 2, undone: 0 },
    ]);
  });

  it("validates edge edits, merge rewrites and governed node removal", async () => {
    const missingAck = await post("/api/model/edit", {
      action: "remove_node",
      payload: { slug: "security_review" },
      request_id: "remove-governed-without-ack",
      workflow_id: "wf_p1_incident",
    });
    expect(missingAck.status).toBe(400);
    await expect(missingAck.json()).resolves.toMatchObject({
      error: { code: "policy_acknowledgement_required" },
      policy_ids: ["pol_sec_review"],
    });

    const edge = await post("/api/model/edit", {
      action: "add_edge",
      base_revision: 0,
      payload: {
        from_slug: "detect_incident",
        probability: 0.25,
        to_slug: "security_review",
      },
      request_id: "add-designed-edge",
      workflow_id: "wf_p1_incident",
    });
    expect(edge.status).toBe(200);
    await expect(edge.json()).resolves.toMatchObject({ revision: 1 });

    const merge = await post("/api/model/edit", {
      action: "merge_nodes",
      base_revision: 1,
      payload: {
        source_slug: "open_incident_ticket",
        target_slug: "assign_owner",
      },
      request_id: "merge-designed-nodes",
      workflow_id: "wf_p1_incident",
    });
    expect(merge.status).toBe(200);
    const merged = (await merge.json()) as {
      designed: {
        edges: Array<{ from: string; to: string }>;
        nodes: Array<{ id: string }>;
      };
      revision: number;
    };
    expect(merged.revision).toBe(2);
    expect(merged.designed.nodes.map((node) => node.id)).not.toContain(
      "act_open_incident_ticket"
    );
    expect(merged.designed.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "act_triage_incident",
          to: "act_assign_owner",
        }),
      ])
    );

    const remove = await post("/api/model/edit", {
      action: "remove_node",
      base_revision: 2,
      payload: {
        acknowledged_policy_ids: ["pol_sec_review"],
        slug: "security_review",
      },
      request_id: "remove-governed-with-ack",
      workflow_id: "wf_p1_incident",
    });
    expect(remove.status).toBe(200);
    const removed = (await remove.json()) as {
      designed: { nodes: Array<{ id: string }> };
      revision: number;
    };
    expect(removed.revision).toBe(3);
    expect(removed.designed.nodes.map((node) => node.id)).not.toContain(
      "act_security_review"
    );
  });

  it("forwards stream cursor and configured scope to the coordinator", async () => {
    const response = await worker.fetch(
      new Request(
        `${origin}/api/stream?project_id=proj_helios&after=1&workspace_id=T1&channel=C1`,
        { headers: { "Last-Event-ID": "7" } }
      ),
      env,
      context
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      lastEventId: "7",
      url: expect.stringContaining("after=7"),
    });
  });
});

function get(path: string, requestEnv = env) {
  return worker.fetch(new Request(`${origin}${path}`), requestEnv, context);
}

function post(path: string, body: unknown) {
  return worker.fetch(
    new Request(`${origin}${path}`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Origin: origin },
      method: "POST",
    }),
    env,
    context
  );
}

function seedProcessRows(db: DatabaseSync) {
  db.prepare(
    `INSERT INTO pm_session
     (id, workspace_id, channel, project_id, workflow_id, status, source, started_ts)
     VALUES ('ses_helios_1', 'T1', 'C1', 'proj_helios', 'wf_p1_incident', 'closed', 'human', '2026-09-12T12:00:00.000Z')`
  ).run();
  db.prepare(
    `INSERT INTO pm_message
     (workspace_id, channel, ts, id, session_id, author_label, text, permalink, received_at)
     VALUES ('T1', 'C1', '1726152000.000100', 'T1:C1:1726152000.000100', 'ses_helios_1', 'Nia', 'I triaged the incident.', 'https://slack.example/archives/C1/p1726152000000100', '2026-09-12T12:00:01.000Z')`
  ).run();
  db.prepare(
    `INSERT INTO pm_step
     (id, session_id, seq, activity_id, actor_person_id, intent, type, modality, lifecycle_state, curation_status, confidence, ts_start)
     VALUES ('stp_triage', 'ses_helios_1', 1, 'act_triage_incident', 'per_nia', 'triage incident', 'action', 'reported', 'done', 'confirmed', 0.92, '2026-09-12T12:00:01.000Z')`
  ).run();
  db.prepare(
    `INSERT INTO pm_step_evidence
     (step_id, workspace_id, channel, message_ts, message_revision)
     VALUES ('stp_triage', 'T1', 'C1', '1726152000.000100', 1)`
  ).run();
  db.prepare(
    `INSERT INTO pm_journal
     (workspace_id, channel, project_id, kind, ts, payload_json, operation_key)
     VALUES ('T1', 'C1', 'proj_helios', 'message', '2026-09-12T12:00:01.000Z', '{}', 'seed:1')`
  ).run();
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
