import { readFileSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";
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

class FakeModel implements ModelAdapter {
  calls: ModelJsonCall[] = [];

  generateJson(call: ModelJsonCall) {
    this.calls.push(call);
    return Promise.resolve({
      steps: [
        {
          activity_slug: "triage_incident",
          actor_person_id: "per_nia",
          artifact_id: null,
          confidence: 0.9,
          evidence: ["1726152000.000100"],
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
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/0005_pm_foundation.sql", "utf8"));
  sqlite.exec(
    readFileSync("migrations/0006_channel_coordinator_runtime.sql", "utf8")
  );
  sqlite.exec(readFileSync("migrations/0007_graph_kb_persistence.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0008_agent_tools.sql", "utf8"));
  seedProcessRows(sqlite);
  requestContext = {
    actorId: "agent:test",
    env: {
      AGENT_ENABLED: "true",
      DB: new SqliteD1(sqlite) as unknown as D1Database,
      SLACK_ALLOWED_CHANNEL_ID: "C1",
      SLACK_ALLOWED_TEAM_ID: "T1",
    },
    now: () => "2026-09-12T12:00:10.000Z",
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
      queryProcessGraph({ workspace_id: "T2" }, requestContext)
    ).rejects.toMatchObject({ code: "forbidden_scope", status: 403 });

    const graph = await queryProcessGraph(
      { workflow_id: "wf_p1_incident" },
      requestContext
    );
    expect(graph.nodes.map((node) => node.activity.slug)).toContain(
      "triage_incident"
    );
    expect(graph.planes.designed).toBeGreaterThan(0);
  });

  it("returns evidence messages for a scoped step", async () => {
    const evidence = await getEvidence(
      { step_id: "stp_triage" },
      requestContext
    );
    expect(evidence.messages).toMatchObject([
      {
        author_label: "Nia",
        permalink: "https://slack.example/archives/C1/p1726152000000100",
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
    const cases = await searchWorkspace(
      { query: "ses_helios" },
      requestContext
    );
    expect(cases.cases.map((session) => session.id)).toContain("ses_helios_1");
  });

  it("blocks extraction when the agent is disabled", async () => {
    const disabledContext = {
      ...requestContext,
      env: { ...requestContext.env, AGENT_ENABLED: "false" },
      model: new FakeModel(),
    };
    const result = await triggerExtraction(
      { session_id: "ses_helios_1", workflow_id: "wf_p1_incident" },
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
      { session_id: "ses_helios_1", workflow_id: "wf_p1_incident" },
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
        workflow_id: "wf_p1_incident",
      },
      requestContext
    );
    const retry = await proposeEdit(
      {
        action: "promote",
        payload: { node_id: "act_improvise_hotfix" },
        rationale: "Observed in repeated incident cases.",
        request_id: "proposal-1",
        workflow_id: "wf_p1_incident",
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
        workflow_id: "wf_p1_incident",
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
        { text: "Ariadne answer", workflow_id: "wf_p1_incident" },
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
        workflow_id: "wf_p1_incident",
      },
      requestContext
    );
    expect(first.status).toBe("queued_no_token");
    await expect(
      postToSlack(
        {
          request_id: "slack-2",
          text: "Second Ariadne answer",
          workflow_id: "wf_p1_incident",
        },
        requestContext
      )
    ).rejects.toBeInstanceOf(AgentToolError);
  });
});

function seedProcessRows(db: DatabaseSync) {
  db.prepare(
    `INSERT INTO pm_session
     (id, workspace_id, channel, project_id, workflow_id, status, source, started_ts)
     VALUES ('ses_helios_1', 'T1', 'C1', 'proj_helios', 'wf_p1_incident', 'closed', 'human', '2026-09-12T12:00:00.000Z')`
  ).run();
  db.prepare(
    `INSERT INTO pm_message
     (workspace_id, channel, ts, id, session_id, author_person_id, author_label,
      text, permalink, received_at)
     VALUES ('T1', 'C1', '1726152000.000100', 'T1:C1:1726152000.000100',
      'ses_helios_1', 'per_nia', 'Nia', 'I triaged the incident.',
      'https://slack.example/archives/C1/p1726152000000100',
      '2026-09-12T12:00:01.000Z')`
  ).run();
  db.prepare(
    `INSERT INTO pm_step
     (id, session_id, seq, activity_id, actor_person_id, intent, type, modality,
      lifecycle_state, curation_status, confidence, ts_start)
     VALUES ('stp_triage', 'ses_helios_1', 1, 'act_triage_incident',
      'per_nia', 'triage incident', 'action', 'reported', 'done', 'confirmed',
      0.92, '2026-09-12T12:00:01.000Z')`
  ).run();
  db.prepare(
    `INSERT INTO pm_step_evidence
     (step_id, workspace_id, channel, message_ts, message_revision)
     VALUES ('stp_triage', 'T1', 'C1', '1726152000.000100', 1)`
  ).run();
}
