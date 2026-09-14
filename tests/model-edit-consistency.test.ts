import type { DatabaseSync } from "node:sqlite";
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
  session: { user: { id: "user-a" } } as { user: { id: string } } | null,
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

// Mirrors the designed workflow in process-routes.test.ts: enough activities that
// "improvise_hotfix" (observed but never authored) is unambiguously discovered-only
// until a model edit promotes it.
const CUSTOM_ACTIVITIES: TenantActivity[] = [
  { label: "Detect incident", role: "support", slug: "detect_incident" },
  { label: "Triage incident", role: "support", slug: "triage_incident" },
  { label: "Security review", role: "security", slug: "security_review" },
  { label: "Deploy fix", role: "engineering", slug: "deploy_fix" },
  { label: "Notify customer", role: "support", slug: "notify_customer" },
];

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

let d1: SqliteD1;
let sqlite: DatabaseSync;
let env: Parameters<typeof worker.fetch>[1];

const context = {} as ExecutionContext;
const origin = "https://demo.example";
const scope: ConnectionScope = {
  channel: TEST_CHANNEL,
  min_support: 1,
  project_id: TEST_PROJECT,
  view: "overlay",
  workflow_id: TEST_WORKFLOW,
  workspace_id: TEST_WORKSPACE,
};

beforeEach(() => {
  authState.session = { user: { id: "user-a" } };
  ({ d1, sqlite } = createTestDatabase());
  seedTenant(sqlite, { activities: CUSTOM_ACTIVITIES });
  seedProcessRows(sqlite);
  env = {
    CHANNEL_COORDINATOR: fakeDurableObjectNamespace(),
    DB: d1,
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
     VALUES ('ses_case_1', ?, ?, ?, ?,
             'closed', 'human', '2026-09-14T12:00:00.000Z', '2026-09-14T12:09:00.000Z')`
  ).run(TEST_WORKSPACE, TEST_CHANNEL, TEST_PROJECT, TEST_WORKFLOW);
  seedMessage(
    db,
    "1726152000.000100",
    "I detected the incident and called a P1."
  );
  seedMessage(db, "1726152001.000100", "I triaged severity.");
  seedMessage(db, "1726152002.000100", "I improvised the mitigation hotfix.");
  seedStep(
    db,
    "stp_detect",
    1,
    "act_detect_incident",
    "detect incident",
    "1726152000.000100"
  );
  seedStep(
    db,
    "stp_triage",
    2,
    "act_triage_incident",
    "triage incident",
    "1726152001.000100"
  );
  seedStep(
    db,
    "stp_hotfix",
    3,
    "act_improvise_hotfix",
    "improvise hotfix",
    "1726152002.000100"
  );
}

function seedMessage(db: DatabaseSync, ts: string, text: string) {
  db.prepare(
    `INSERT INTO pm_message
     (workspace_id, channel, ts, id, session_id, author_label, text, permalink, received_at)
     VALUES (?, ?, ?, ?, 'ses_case_1', 'Nia', ?, ?, '2026-09-14T12:00:01.000Z')`
  ).run(
    TEST_WORKSPACE,
    TEST_CHANNEL,
    ts,
    `${TEST_WORKSPACE}:${TEST_CHANNEL}:${ts}`,
    text,
    `https://testworkspace.slack.com/archives/${TEST_CHANNEL}/p${ts.replace(".", "")}`
  );
}

function seedStep(
  db: DatabaseSync,
  id: string,
  seq: number,
  activityId: string,
  intent: string,
  ts: string
) {
  db.prepare(
    `INSERT INTO pm_step
     (id, session_id, seq, activity_id, actor_person_id, intent, type,
      modality, lifecycle_state, curation_status, confidence, ts_start)
     VALUES (?, 'ses_case_1', ?, ?, 'per_nia', ?, 'action', 'reported',
             'done', 'confirmed', 0.92, ?)`
  ).run(id, seq, activityId, intent, ts);
  db.prepare(
    `INSERT INTO pm_step_evidence
     (step_id, workspace_id, channel, message_ts, message_revision)
     VALUES (?, ?, ?, ?, 1)`
  ).run(id, TEST_WORKSPACE, TEST_CHANNEL, ts);
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
