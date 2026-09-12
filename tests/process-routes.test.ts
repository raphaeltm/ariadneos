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
      conformance: {
        session: { fitness: number | null; session_id: string };
        workflow: { fitness: number | null; workflow_id: string };
      };
      step: { status: string };
    };
    expect(payload.step.status).toBe("rejected");
    expect(payload.conformance.session).toMatchObject({
      fitness: 0,
      session_id: "ses_helios_1",
    });
    expect(payload.conformance.workflow).toMatchObject({
      fitness: 0,
      workflow_id: "wf_p1_incident",
    });
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM pm_journal WHERE kind = 'step'")
        .get()
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM pm_journal WHERE kind = 'conformance'"
        )
        .get()
    ).toEqual({ count: 2 });
    expect(
      sqlite
        .prepare(
          "SELECT fitness, missing_json FROM pm_session WHERE id = 'ses_helios_1'"
        )
        .get()
    ).toEqual({
      fitness: 0,
      missing_json: JSON.stringify([
        "detect_incident",
        "triage_incident",
        "open_incident_ticket",
        "assign_owner",
        "reproduce_issue",
        "root_cause_analysis",
        "security_review",
        "deploy_fix",
        "verify_resolution",
        "notify_customer",
        "write_postmortem",
      ]),
    });
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
