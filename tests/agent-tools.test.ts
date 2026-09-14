import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentToolError,
  type AgentToolRequestContext,
  ariadneTools,
  getEvidence,
  lookupKnowledgeBase,
  postToSlack,
  proposeEdit,
  queryProcessGraph,
  recordAgentEvent,
  searchWorkspace,
  triggerExtraction,
} from "../server/agent/tools/index.ts";
import type { ModelAdapter, ModelJsonCall } from "../server/models.ts";
import {
  createTestDatabase,
  seedPerson,
  seedTenant,
  TEST_CHANNEL,
  TEST_PROJECT,
  TEST_WORKFLOW,
  TEST_WORKSPACE,
} from "./helpers/tenant.ts";

const TRIAGE_TS = "1726152000.000100";
const EXTRACT_TS = "1726152005.000100";
const SESSION_ID = "ses_case_1";
const STEP_ID = "stp_triage";
const PERMALINK = `https://testworkspace.slack.com/archives/${TEST_CHANNEL}/p1726152000000100`;

class FakeModel implements ModelAdapter {
  calls: ModelJsonCall[] = [];

  generateJson(call: ModelJsonCall) {
    this.calls.push(call);
    return Promise.resolve({
      steps: [
        {
          activity_slug: "triage_incident",
          actor_person_id: "per_u0nia",
          artifact_id: null,
          confidence: 0.9,
          evidence: [EXTRACT_TS],
          handoff_to_person_id: null,
          intent: "Triage the incident",
          label: "Triage incident",
          modality: "reported",
          type: "action",
        },
      ],
    });
  }
}

let sqlite: DatabaseSync;
let requestContext: AgentToolRequestContext;

beforeEach(() => {
  const created = createTestDatabase();
  sqlite = created.sqlite;
  seedTenant(sqlite);
  const personId = seedPerson(sqlite, {
    name: "Nia",
    role: "support",
    slackUserId: "U0NIA",
  });
  seedProcessRows(sqlite, personId);
  requestContext = {
    actorId: "agent:test",
    env: {
      AGENT_ENABLED: "true",
      DB: created.d1 as unknown as D1Database,
    },
    now: () => "2026-09-14T12:00:10.000Z",
    workspaceId: TEST_WORKSPACE,
  };
});

afterEach(() => {
  sqlite.close();
});

describe("Ariadne Mastra tools", () => {
  it("exports Mastra createTool definitions", () => {
    expect(Object.keys(ariadneTools).sort()).toEqual([
      "getEvidence",
      "lookupKnowledgeBase",
      "pauseRun",
      "postToSlack",
      "proposeEdit",
      "queryProcessGraph",
      "recordAgentEvent",
      "resumeRun",
      "searchWorkspace",
      "triggerExtraction",
    ]);
  });

  it("queries the scoped graph and rejects cross-scope requests", async () => {
    await expect(
      queryProcessGraph({ workspace_id: "T0OTHERTEAM" }, requestContext)
    ).rejects.toMatchObject({ code: "forbidden_scope", status: 403 });

    const graph = await queryProcessGraph(
      { workflow_id: TEST_WORKFLOW },
      requestContext
    );
    expect(graph.nodes.map((node) => node.activity.slug)).toContain(
      "triage_incident"
    );
    expect(graph.planes.designed).toBeGreaterThan(0);
  });

  it("returns evidence messages for a scoped step", async () => {
    const evidence = await getEvidence({ step_id: STEP_ID }, requestContext);
    expect(evidence.messages).toMatchObject([
      {
        author_label: "Nia",
        permalink: PERMALINK,
      },
    ]);
  });

  it("searches authored KB and workspace records", async () => {
    const kb = await lookupKnowledgeBase(
      { kinds: ["policy"], query: "approval" },
      requestContext
    );
    expect(kb.matches.some((match) => match.kind === "policy")).toBe(true);

    const workspace = await searchWorkspace(
      { query: "triage" },
      requestContext
    );
    expect(workspace.activities.map((activity) => activity.slug)).toContain(
      "triage_incident"
    );
    const cases = await searchWorkspace({ query: SESSION_ID }, requestContext);
    expect(cases.cases.map((session) => session.id)).toContain(SESSION_ID);
  });

  it("blocks extraction when the agent is disabled", async () => {
    const disabledContext = {
      ...requestContext,
      env: { ...requestContext.env, AGENT_ENABLED: "false" },
      model: new FakeModel(),
    };
    const result = await triggerExtraction(
      { session_id: SESSION_ID, workflow_id: TEST_WORKFLOW },
      disabledContext
    );
    expect(result).toMatchObject({
      status: "disabled",
      steps: [],
      warnings: ["agent.disabled"],
    });
    expect(disabledContext.model.calls).toEqual([]);
  });

  it("runs extraction through the existing extractor boundary", async () => {
    const model = new FakeModel();
    const result = await triggerExtraction(
      { session_id: SESSION_ID, workflow_id: TEST_WORKFLOW },
      { ...requestContext, model }
    );
    expect(result).toMatchObject({
      degraded: false,
      status: "ok",
    });
    expect(result.steps.map((step) => step.activity_slug)).toEqual([
      "triage_incident",
    ]);
    expect(model.calls).toHaveLength(1);
  });

  it("persists only proposed edit records for human review", async () => {
    const proposal = await proposeEdit(
      {
        action: "promote",
        payload: { node_id: "act_improvise_hotfix" },
        rationale: "Observed in repeated incident cases.",
        request_id: "proposal-1",
        workflow_id: TEST_WORKFLOW,
      },
      requestContext
    );
    const retry = await proposeEdit(
      {
        action: "promote",
        payload: { node_id: "act_improvise_hotfix" },
        rationale: "Observed in repeated incident cases.",
        request_id: "proposal-1",
        workflow_id: TEST_WORKFLOW,
      },
      requestContext
    );

    expect(proposal).toMatchObject({
      actor: "agent:test",
      status: "proposed",
    });
    expect(retry.id).toBe(proposal.id);
    expect(
      sqlite.prepare("SELECT status, actor FROM agent_edit_proposal").get()
    ).toEqual({ actor: "agent:test", status: "proposed" });
  });

  it("records agent events and journals them for replay", async () => {
    const event = await recordAgentEvent(
      {
        kind: "answer",
        nodes: ["act_triage_incident"],
        request_id: "event-1",
        text: "Triage is supported by one observed message.",
        workflow_id: TEST_WORKFLOW,
      },
      requestContext
    );
    expect(event).toMatchObject({ kind: "answer", status: "recorded" });
    expect(
      sqlite
        .prepare("SELECT kind, operation_key FROM pm_journal")
        .all()
        .some(
          (row) =>
            row.kind === "agent_post" &&
            String(row.operation_key).startsWith("agent:")
        )
    ).toBe(true);
  });

  it("blocks disabled Slack posts and rate-limits enabled post intents", async () => {
    await expect(
      postToSlack(
        { text: "Ariadne answer", workflow_id: TEST_WORKFLOW },
        {
          ...requestContext,
          env: { ...requestContext.env, AGENT_ENABLED: "false" },
        }
      )
    ).resolves.toEqual({ status: "disabled" });

    const first = await postToSlack(
      {
        request_id: "slack-1",
        text: "First Ariadne answer",
        workflow_id: TEST_WORKFLOW,
      },
      requestContext
    );
    expect(first.status).toBe("queued_no_token");
    await expect(
      postToSlack(
        {
          request_id: "slack-2",
          text: "Second Ariadne answer",
          workflow_id: TEST_WORKFLOW,
        },
        requestContext
      )
    ).rejects.toBeInstanceOf(AgentToolError);
  });
});

function seedProcessRows(db: DatabaseSync, personId: string) {
  db.prepare(
    `INSERT INTO pm_session
     (id, workspace_id, channel, project_id, workflow_id, status, source, started_ts)
     VALUES (?, ?, ?, ?, ?, 'closed', 'human', '2026-09-14T12:00:00.000Z')`
  ).run(SESSION_ID, TEST_WORKSPACE, TEST_CHANNEL, TEST_PROJECT, TEST_WORKFLOW);
  db.prepare(
    `INSERT INTO pm_message
     (workspace_id, channel, ts, id, session_id, author_person_id, author_label,
      text, permalink, received_at)
     VALUES (?, ?, ?, ?, ?, ?, 'Nia', 'I triaged the incident.', ?, '2026-09-14T12:00:01.000Z')`
  ).run(
    TEST_WORKSPACE,
    TEST_CHANNEL,
    TRIAGE_TS,
    `${TEST_WORKSPACE}:${TEST_CHANNEL}:${TRIAGE_TS}`,
    SESSION_ID,
    personId,
    PERMALINK
  );
  db.prepare(
    `INSERT INTO pm_step
     (id, session_id, seq, activity_id, actor_person_id, intent, type, modality,
      lifecycle_state, curation_status, confidence, ts_start)
     VALUES (?, ?, 1, 'act_triage_incident', ?, 'triage incident', 'action', 'reported',
      'done', 'confirmed', 0.92, '2026-09-14T12:00:01.000Z')`
  ).run(STEP_ID, SESSION_ID, personId);
  db.prepare(
    `INSERT INTO pm_step_evidence
     (step_id, workspace_id, channel, message_ts, message_revision)
     VALUES (?, ?, ?, ?, 1)`
  ).run(STEP_ID, TEST_WORKSPACE, TEST_CHANNEL, TRIAGE_TS);
  db.prepare(
    `INSERT INTO pm_message
     (workspace_id, channel, ts, id, session_id, author_person_id, author_label,
      text, permalink, received_at)
     VALUES (?, ?, ?, ?, ?, ?, 'Nia', 'The fix still needs a deploy.', ?, '2026-09-14T12:00:06.000Z')`
  ).run(
    TEST_WORKSPACE,
    TEST_CHANNEL,
    EXTRACT_TS,
    `${TEST_WORKSPACE}:${TEST_CHANNEL}:${EXTRACT_TS}`,
    SESSION_ID,
    personId,
    `https://testworkspace.slack.com/archives/${TEST_CHANNEL}/p1726152005000100`
  );
  db.prepare(
    `INSERT INTO tenant_policy
     (workspace_id, id, project_id, workflow_id, kind, activity_slug, text,
      params_json, created_at)
     VALUES (?, 'pol_sec_review', ?, ?, 'approval', 'security_review',
      'Security review requires manager approval.', '{}', '2026-09-14T00:00:00.000Z')`
  ).run(TEST_WORKSPACE, TEST_PROJECT, TEST_WORKFLOW);
}
