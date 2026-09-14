import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../server/index.ts";
import {
  createTestDatabase,
  type SqliteD1,
  seedTenant,
  TEST_CHANNEL,
  TEST_PROJECT,
  TEST_WORKFLOW,
  TEST_WORKSPACE,
  type TenantActivity,
} from "./helpers/tenant.ts";

const authState = vi.hoisted(() => ({
  session: { user: { id: "test-user" } } as { user: { id: string } } | null,
}));

vi.mock("../server/auth.ts", () => ({
  authConfigured: () => true,
  createAuth: () => ({
    api: { getSession: async () => authState.session },
  }),
  sessionIdentity: () => {
    if (!authState.session) {
      return null;
    }
    return {
      slackTeamId: TEST_WORKSPACE,
      slackUserId: "U0USER",
      userId: authState.session.user.id,
    };
  },
}));

// A richer activity set than the shared helper default, so edge, merge and
// governed-removal edits each have distinct designed nodes to act on, mirroring
// a real incident-response workflow.
const CUSTOM_ACTIVITIES: TenantActivity[] = [
  { label: "Detect incident", role: "support", slug: "detect_incident" },
  { label: "Triage incident", role: "support", slug: "triage_incident" },
  {
    label: "Open incident ticket",
    role: "support",
    slug: "open_incident_ticket",
  },
  { label: "Assign owner", role: "support", slug: "assign_owner" },
  { label: "Reproduce issue", role: "engineering", slug: "reproduce_issue" },
  {
    label: "Root cause analysis",
    role: "engineering",
    slug: "root_cause_analysis",
  },
  { label: "Security review", role: "security", slug: "security_review" },
  { label: "Deploy fix", role: "engineering", slug: "deploy_fix" },
  {
    label: "Verify resolution",
    role: "engineering",
    slug: "verify_resolution",
  },
  { label: "Notify customer", role: "support", slug: "notify_customer" },
  { label: "Write postmortem", role: "support", slug: "write_postmortem" },
];

const SESSION_ID = "ses_case_1";
const STEP_ID = "stp_triage";
const TRIAGE_TS = "1726152000.000100";

let d1: SqliteD1;
let sqlite: DatabaseSync;
let env: Parameters<typeof worker.fetch>[1];

const context = {} as ExecutionContext;
const origin = "https://demo.example";

beforeEach(() => {
  authState.session = { user: { id: "test-user" } };
  ({ d1, sqlite } = createTestDatabase());
  seedTenant(sqlite, { activities: CUSTOM_ACTIVITIES });
  seedGovernancePolicy(sqlite);
  seedProcessRows(sqlite);
  env = {
    CHANNEL_COORDINATOR: fakeDurableObjectNamespace(),
    DB: d1,
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

  it("rejects a foreign project_id with a structured error", async () => {
    const response = await get("/api/snapshot?project_id=proj_other_tenant");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unknown_project",
        message: "Unknown project_id.",
      },
    });
  });

  it("returns an authenticated snapshot from D1 with a journal cursor", async () => {
    const response = await get(
      `/api/snapshot?project_id=${TEST_PROJECT}&workflow_id=${TEST_WORKFLOW}`
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
    const response = await post(`/api/steps/${STEP_ID}/status`, {
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
      session_id: SESSION_ID,
    });
    expect(payload.conformance.workflow).toMatchObject({
      fitness: 0,
      workflow_id: TEST_WORKFLOW,
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
          `SELECT fitness, missing_json FROM pm_session WHERE id = '${SESSION_ID}'`
        )
        .get()
    ).toEqual({
      fitness: 0,
      missing_json: JSON.stringify(
        CUSTOM_ACTIVITIES.map((activity) => activity.slug)
      ),
    });
  });

  it("reflects newly observed sessions in the snapshot and graph after a rebuild", async () => {
    insertObservedCase(sqlite);

    const rebuild = await post("/api/graph/rebuild", {
      project_id: TEST_PROJECT,
      request_id: "rebuild-1",
      workflow_id: TEST_WORKFLOW,
    });
    expect(rebuild.status).toBe(200);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM pm_journal WHERE kind = 'graph_delta'"
        )
        .get()
    ).toEqual({ count: 1 });

    const snapshot = await get(
      `/api/snapshot?project_id=${TEST_PROJECT}&workflow_id=${TEST_WORKFLOW}`
    );
    expect(snapshot.status).toBe(200);
    const snapshotPayload = (await snapshot.json()) as {
      graph: { nodes: unknown[] };
      messages: unknown[];
      sessions: unknown[];
      steps: unknown[];
    };
    expect(snapshotPayload.sessions.length).toBeGreaterThan(1);
    expect(snapshotPayload.messages.length).toBeGreaterThan(1);
    expect(snapshotPayload.steps.length).toBeGreaterThan(1);
    expect(snapshotPayload.graph.nodes.length).toBeGreaterThan(0);
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
      workflow_id: TEST_WORKFLOW,
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
      workflow_id: TEST_WORKFLOW,
    });
    expect(retry.status).toBe(200);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM pm_graph_edit_revision")
        .get()
    ).toEqual({ count: 1 });

    const history = await get(`/api/model/edits?workflow_id=${TEST_WORKFLOW}`);
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
      workflow_id: TEST_WORKFLOW,
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
          workflow_id: TEST_WORKFLOW,
        })
      ).status
    ).toBe(200);

    const stale = await post("/api/model/edit", {
      action: "add_node",
      base_revision: 0,
      payload: { slug: "publish_status_update" },
      request_id: "edit-stale",
      workflow_id: TEST_WORKFLOW,
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
      workflow_id: TEST_WORKFLOW,
    });

    const undo = await post("/api/model/edit/undo", {
      base_revision: 1,
      request_id: "undo-add",
      workflow_id: TEST_WORKFLOW,
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
      workflow_id: TEST_WORKFLOW,
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
      workflow_id: TEST_WORKFLOW,
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
      workflow_id: TEST_WORKFLOW,
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
      workflow_id: TEST_WORKFLOW,
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
      new Request(`${origin}/api/stream?project_id=${TEST_PROJECT}&after=1`, {
        headers: { "Last-Event-ID": "7" },
      }),
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

function seedGovernancePolicy(db: DatabaseSync) {
  db.prepare(
    `INSERT INTO tenant_policy
     (workspace_id, id, project_id, workflow_id, kind, activity_slug, text,
      params_json, created_at)
     VALUES (?, 'pol_sec_review', ?, ?, 'mandatory', 'security_review',
      'A security reviewer must sign off before deploy.', '{}', '2026-09-14T00:00:00.000Z')`
  ).run(TEST_WORKSPACE, TEST_PROJECT, TEST_WORKFLOW);
}

function seedProcessRows(db: DatabaseSync) {
  db.prepare(
    `INSERT INTO pm_session
     (id, workspace_id, channel, project_id, workflow_id, status, source, started_ts)
     VALUES (?, ?, ?, ?, ?, 'closed', 'human', '2026-09-14T12:00:00.000Z')`
  ).run(SESSION_ID, TEST_WORKSPACE, TEST_CHANNEL, TEST_PROJECT, TEST_WORKFLOW);
  db.prepare(
    `INSERT INTO pm_message
     (workspace_id, channel, ts, id, session_id, author_label, text, permalink, received_at)
     VALUES (?, ?, ?, ?, ?, 'Nia', 'I triaged the incident.', ?, '2026-09-14T12:00:01.000Z')`
  ).run(
    TEST_WORKSPACE,
    TEST_CHANNEL,
    TRIAGE_TS,
    `${TEST_WORKSPACE}:${TEST_CHANNEL}:${TRIAGE_TS}`,
    SESSION_ID,
    `https://testworkspace.slack.com/archives/${TEST_CHANNEL}/p1726152000000100`
  );
  db.prepare(
    `INSERT INTO pm_step
     (id, session_id, seq, activity_id, actor_person_id, intent, type, modality, lifecycle_state, curation_status, confidence, ts_start)
     VALUES (?, ?, 1, 'act_triage_incident', 'per_nia', 'triage incident', 'action', 'reported', 'done', 'confirmed', 0.92, '2026-09-14T12:00:01.000Z')`
  ).run(STEP_ID, SESSION_ID);
  db.prepare(
    `INSERT INTO pm_step_evidence
     (step_id, workspace_id, channel, message_ts, message_revision)
     VALUES (?, ?, ?, ?, 1)`
  ).run(STEP_ID, TEST_WORKSPACE, TEST_CHANNEL, TRIAGE_TS);
  db.prepare(
    `INSERT INTO pm_journal
     (workspace_id, channel, project_id, kind, ts, payload_json, operation_key)
     VALUES (?, ?, ?, 'message', '2026-09-14T12:00:01.000Z', '{}', 'seed:1')`
  ).run(TEST_WORKSPACE, TEST_CHANNEL, TEST_PROJECT);
}

/**
 * Inserts a second, independent observed case directly, standing in for the
 * removed `/api/sim/run` simulator. The invariant under test is that data
 * observed straight from Slack messages becomes visible through the normal
 * read path once a session row exists.
 */
function insertObservedCase(db: DatabaseSync) {
  const sessionId = "ses_case_2";
  const detectTs = "1726160000.000100";
  const triageTs = "1726160001.000100";
  db.prepare(
    `INSERT INTO pm_session
     (id, workspace_id, channel, project_id, workflow_id, status, source, started_ts)
     VALUES (?, ?, ?, ?, ?, 'closed', 'human', '2026-09-14T14:00:00.000Z')`
  ).run(sessionId, TEST_WORKSPACE, TEST_CHANNEL, TEST_PROJECT, TEST_WORKFLOW);
  for (const [ts, text] of [
    [detectTs, "Another checkout incident just started."],
    [triageTs, "Triaged: same root cause as before."],
  ] as const) {
    db.prepare(
      `INSERT INTO pm_message
       (workspace_id, channel, ts, id, session_id, author_label, text, permalink, received_at)
       VALUES (?, ?, ?, ?, ?, 'Nia', ?, ?, '2026-09-14T14:00:01.000Z')`
    ).run(
      TEST_WORKSPACE,
      TEST_CHANNEL,
      ts,
      `${TEST_WORKSPACE}:${TEST_CHANNEL}:${ts}`,
      sessionId,
      text,
      `https://testworkspace.slack.com/archives/${TEST_CHANNEL}/p${ts.replace(".", "")}`
    );
  }
  db.prepare(
    `INSERT INTO pm_step
     (id, session_id, seq, activity_id, actor_person_id, intent, type, modality, lifecycle_state, curation_status, confidence, ts_start)
     VALUES ('stp_case2_detect', ?, 1, 'act_detect_incident', 'per_nia', 'detect incident', 'action', 'reported', 'done', 'confirmed', 0.9, '2026-09-14T14:00:01.000Z')`
  ).run(sessionId);
  db.prepare(
    `INSERT INTO pm_step_evidence
     (step_id, workspace_id, channel, message_ts, message_revision)
     VALUES ('stp_case2_detect', ?, ?, ?, 1)`
  ).run(TEST_WORKSPACE, TEST_CHANNEL, detectTs);
  db.prepare(
    `INSERT INTO pm_step
     (id, session_id, seq, activity_id, actor_person_id, intent, type, modality, lifecycle_state, curation_status, confidence, ts_start)
     VALUES ('stp_case2_triage', ?, 2, 'act_triage_incident', 'per_nia', 'triage incident', 'action', 'reported', 'done', 'confirmed', 0.9, '2026-09-14T14:00:02.000Z')`
  ).run(sessionId);
  db.prepare(
    `INSERT INTO pm_step_evidence
     (step_id, workspace_id, channel, message_ts, message_revision)
     VALUES ('stp_case2_triage', ?, ?, ?, 1)`
  ).run(TEST_WORKSPACE, TEST_CHANNEL, triageTs);
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
