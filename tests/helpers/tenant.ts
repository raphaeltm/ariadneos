// Shared test harness: a real SQLite-backed D1 shim, the real migration set, and
// a workspace configured the way a real install configures one.
//
// Tests run against the checked-in migrations rather than a hand-written schema,
// so a migration that forgets a column fails the suite instead of passing it.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  buildGraphView,
  buildSessionConformance,
  type ScopedData,
} from "../../server/process-data.ts";
import type {
  PolicyDefinition,
  TenantKb,
  WorkflowDefinition,
} from "../../server/tenant/kb.ts";
import type {
  GraphView,
  Message,
  ProcessSession,
  ProjectId,
  Snapshot,
  Step,
  WorkflowId,
} from "../../shared/contracts.ts";
import type { JournalEvent } from "../../src/api.ts";

export interface BoundStatement {
  all: <T>() => Promise<{ results: T[] }>;
  first: <T>() => Promise<T | null>;
  run: () => Promise<{ meta?: { changes?: number } }>;
}

export interface SqliteD1Options {
  /** Set to make every write throw, to exercise failure paths. */
  failWrites?: () => boolean;
}

export class SqliteD1 {
  private readonly db: DatabaseSync;
  private readonly options: SqliteD1Options;

  constructor(db: DatabaseSync, options: SqliteD1Options = {}) {
    this.db = db;
    this.options = options;
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
      run: () => {
        if (this.options.failWrites?.()) {
          throw new Error("Database unavailable");
        }
        const result = this.db.prepare(sql).run(...(values as SQLInputValue[]));
        return Promise.resolve({
          meta: { changes: Number(result.changes ?? 0) },
        });
      },
    });
    return {
      all: create([]).all,
      bind: (...values: unknown[]) => create(values),
      first: create([]).first,
      run: create([]).run,
    };
  }

  async batch(statements: BoundStatement[]) {
    if (this.options.failWrites?.()) {
      throw new Error("Database unavailable");
    }
    return await Promise.all(statements.map((statement) => statement.run()));
  }
}

const MIGRATIONS_DIR = "migrations";

/**
 * Applies every checked-in migration in order. Better Auth's generated DDL uses
 * `date` columns, which node:sqlite accepts, so the auth tables come from the same
 * source of truth the deployed database uses.
 */
export function applyMigrations(db: DatabaseSync) {
  for (const name of readdirSync(MIGRATIONS_DIR).sort()) {
    if (!name.endsWith(".sql")) {
      continue;
    }
    db.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
  }
}

export function createTestDatabase(options: SqliteD1Options = {}) {
  const sqlite = new DatabaseSync(":memory:");
  applyMigrations(sqlite);
  return { d1: new SqliteD1(sqlite, options), sqlite };
}

export const TEST_WORKSPACE = "T0TESTTEAM";
export const TEST_CHANNEL = "C0TESTCHAN";
export const TEST_PROJECT = "proj_checkout";
export const TEST_WORKFLOW = "wf_incident_response";
export const TEST_BOT_TOKEN = "xoxb-test-token";

export interface TenantActivity {
  label: string;
  role: string;
  slug: string;
}

export const TEST_ACTIVITIES: TenantActivity[] = [
  { label: "Detect incident", role: "support", slug: "detect_incident" },
  { label: "Triage incident", role: "support", slug: "triage_incident" },
  { label: "Security review", role: "security", slug: "security_review" },
  { label: "Deploy fix", role: "engineering", slug: "deploy_fix" },
  { label: "Notify customer", role: "support", slug: "notify_customer" },
];

/**
 * Configures the workspace the way a completed setup leaves it: an install, an
 * enabled channel bound to a project, and an authored workflow with a linear
 * designed happy path.
 */
export function seedTenant(
  sqlite: DatabaseSync,
  options: {
    activities?: TenantActivity[];
    channel?: string;
    enabled?: boolean;
    idleSeconds?: number;
    projectId?: string;
    workflowId?: string;
    workspaceId?: string;
  } = {}
) {
  const workspaceId = options.workspaceId ?? TEST_WORKSPACE;
  const channel = options.channel ?? TEST_CHANNEL;
  const projectId = options.projectId ?? TEST_PROJECT;
  const workflowId = options.workflowId ?? TEST_WORKFLOW;
  const activities = options.activities ?? TEST_ACTIVITIES;
  const now = "2026-09-14T00:00:00.000Z";

  sqlite
    .prepare(
      `INSERT INTO slack_install
       (workspace_id, team_name, team_domain, app_id, bot_user_id, bot_token,
        scopes, installed_by, installed_at, updated_at, revoked_at)
       VALUES (?, 'Test Workspace', 'testworkspace', 'A0APP', 'U0BOT', ?,
               'channels:history,channels:read,chat:write,users:read',
               'auth-user', ?, ?, NULL)`
    )
    .run(workspaceId, TEST_BOT_TOKEN, now, now);
  sqlite
    .prepare(
      `INSERT INTO slack_channel
       (workspace_id, channel_id, channel_name, project_id, enabled,
        session_idle_seconds, backfilled_at, last_error, created_at, updated_at)
       VALUES (?, ?, 'ops-war-room', ?, ?, ?, NULL, NULL, ?, ?)`
    )
    .run(
      workspaceId,
      channel,
      options.enabled === false ? null : projectId,
      options.enabled === false ? 0 : 1,
      options.idleSeconds ?? 3600,
      now,
      now
    );
  sqlite
    .prepare(
      `INSERT INTO tenant_project
       (workspace_id, id, name, summary, spec_md, constraints_json, workflow_id,
        created_at, updated_at)
       VALUES (?, ?, 'Checkout', 'Checkout reliability', '', '[]', ?, ?, ?)`
    )
    .run(workspaceId, projectId, workflowId, now, now);
  sqlite
    .prepare(
      `INSERT INTO tenant_workflow
       (workspace_id, id, project_id, name, entry_slug, exit_slugs_json,
        created_at, updated_at)
       VALUES (?, ?, ?, 'Incident response', ?, ?, ?, ?)`
    )
    .run(
      workspaceId,
      workflowId,
      projectId,
      activities[0]?.slug ?? "",
      JSON.stringify(activities.slice(-1).map((activity) => activity.slug)),
      now,
      now
    );
  for (const [rank, activity] of activities.entries()) {
    sqlite
      .prepare(
        `INSERT INTO tenant_activity
         (workspace_id, workflow_id, slug, label, description, role_expected,
          rank, synonyms_json)
         VALUES (?, ?, ?, ?, '', ?, ?, '[]')`
      )
      .run(
        workspaceId,
        workflowId,
        activity.slug,
        activity.label,
        activity.role,
        rank
      );
  }
  for (const role of new Set(activities.map((activity) => activity.role))) {
    sqlite
      .prepare(
        "INSERT INTO tenant_role (workspace_id, id, name) VALUES (?, ?, ?)"
      )
      .run(workspaceId, role, role);
  }
  for (const activity of activities) {
    sqlite
      .prepare(
        `INSERT INTO tenant_role_repertoire
         (workspace_id, role_id, activity_slug, relation)
         VALUES (?, ?, ?, 'performs')`
      )
      .run(workspaceId, activity.role, activity.slug);
  }
  return { channel, projectId, workflowId, workspaceId };
}

export function seedPerson(
  sqlite: DatabaseSync,
  options: {
    name?: string;
    role?: string;
    slackUserId: string;
    workspaceId?: string;
  }
) {
  const workspaceId = options.workspaceId ?? TEST_WORKSPACE;
  const personId = `per_${options.slackUserId.toLowerCase()}`;
  sqlite
    .prepare(
      `INSERT INTO tenant_person
       (workspace_id, person_id, slack_user_id, display_name, real_name, title,
        role_id, is_bot, deleted, avatar_url, color, tz, updated_at)
       VALUES (?, ?, ?, ?, ?, '', ?, 0, 0, NULL, '#6366F1', NULL, ?)`
    )
    .run(
      workspaceId,
      personId,
      options.slackUserId,
      options.name ?? options.slackUserId,
      options.name ?? options.slackUserId,
      options.role ?? null,
      "2026-09-14T00:00:00.000Z"
    );
  return personId;
}

/** Seeds a signed-in user whose session resolves to the test workspace. */
export function seedAuthUser(
  sqlite: DatabaseSync,
  options: { id?: string; workspaceId?: string } = {}
) {
  const id = options.id ?? "auth-user";
  sqlite
    .prepare(
      `INSERT INTO auth_user
       (id, name, email, emailVerified, image, createdAt, updatedAt,
        slackTeamId, slackTeamName, slackUserId)
       VALUES (?, 'Test User', ?, 1, NULL, ?, ?, ?, 'Test Workspace', 'U0USER')`
    )
    .run(
      id,
      `${id}@example.invalid`,
      "2026-09-14T00:00:00.000Z",
      "2026-09-14T00:00:00.000Z",
      options.workspaceId ?? TEST_WORKSPACE
    );
  return id;
}

/**
 * Builds an overlay GraphView by running real steps through the production
 * mining and conformance code, so canvas and inspector tests assert on what the
 * miner actually produces rather than on a hand-written graph.
 */
export interface ObservedStepInput {
  activitySlug: string;
  /** Slack user id of the actor; resolved to the derived person id. */
  actor: string;
  seq: number;
  sessionId: string;
  status?: "confirmed" | "proposed" | "rejected";
  ts: string;
  type?: "action" | "approval" | "decision" | "handoff" | "rework" | "wait";
}

export interface ObservedGraphOptions {
  activities?: TenantActivity[];
  minSupport?: number;
  policies?: PolicyDefinition[];
  roleOverrides?: Record<string, string>;
  steps: ObservedStepInput[];
}

function tenantKbFor(
  activities: readonly TenantActivity[],
  policies: readonly PolicyDefinition[],
  people: TenantKb["people"]
): TenantKb {
  const workflow: WorkflowDefinition = {
    activities: activities.map((activity) => ({
      label: activity.label,
      role: activity.role,
      slug: activity.slug,
      synonyms: [],
    })),
    entry_activity: activities[0]?.slug ?? "",
    exit_activities: activities.slice(-1).map((activity) => activity.slug),
    id: TEST_WORKFLOW,
    // Linear designed happy path over the authored activity order.
    matrix: activities.map((_, from) =>
      activities.map((__, to) => (to === from + 1 ? 1 : 0))
    ),
    name: "Incident response",
    policy_ids: policies.map((policy) => policy.id),
    project_id: TEST_PROJECT,
  };
  const roles = [...new Set(activities.map((activity) => activity.role))];
  return {
    people,
    policies: [...policies],
    projects: [
      {
        constraints: [],
        id: TEST_PROJECT,
        name: "Checkout",
        spec_md: "",
        summary: "",
        workflow_id: TEST_WORKFLOW,
      },
    ],
    roleCapabilities: roles.map((role) => ({
      never_performs: [],
      performs: activities
        .filter((activity) => activity.role === role)
        .map((activity) => `act_${activity.slug}`),
      role,
    })),
    roles: roles.map((role) => ({ id: role, name: role })),
    workflows: [workflow],
    workspaceId: TEST_WORKSPACE,
  };
}

/** Builds the contract-shaped messages, sessions and steps for observed input. */
export function observedScopedData(
  steps: readonly ObservedStepInput[]
): ScopedData {
  const sessionIds = [...new Set(steps.map((step) => step.sessionId))];
  const sessions: ProcessSession[] = sessionIds.map((id) => ({
    channel: TEST_CHANNEL as ProcessSession["channel"],
    ended_ts: null,
    extra: [],
    fitness: null,
    id: id as ProcessSession["id"],
    missing: [],
    project_id: TEST_PROJECT as ProjectId,
    source: "human",
    started_ts: "2026-09-14T00:00:00.000Z" as ProcessSession["started_ts"],
    status: "closed",
    suggested: false,
    violations: [],
    workflow_id: TEST_WORKFLOW as WorkflowId,
    workspace_id: TEST_WORKSPACE as ProcessSession["workspace_id"],
  }));
  const messages: Message[] = steps.map((step) => ({
    author_label: step.actor,
    author_person_id:
      `per_${step.actor.toLowerCase()}` as Message["author_person_id"],
    availability: "available",
    channel: TEST_CHANNEL as Message["channel"],
    deleted: false,
    id: `${TEST_WORKSPACE}:${TEST_CHANNEL}:${step.ts}` as Message["id"],
    is_agent: false,
    permalink: `https://testworkspace.slack.com/archives/${TEST_CHANNEL}/p${step.ts.replace(".", "")}`,
    received_at: new Date(
      Number.parseFloat(step.ts) * 1000
    ).toISOString() as Message["received_at"],
    revision: 1,
    session_id: step.sessionId as Message["session_id"],
    text: `${step.activitySlug} observed`,
    thread_ts: null,
    ts: step.ts as Message["ts"],
    workspace_id: TEST_WORKSPACE as Message["workspace_id"],
  }));
  const contractSteps: Step[] = steps.map((step) => ({
    activity_id: `act_${step.activitySlug}` as Step["activity_id"],
    actor_person_id:
      `per_${step.actor.toLowerCase()}` as Step["actor_person_id"],
    artifact_id: null,
    confidence: 0.9,
    evidence: [
      {
        channel: TEST_CHANNEL as Step["evidence"][number]["channel"],
        message_id:
          `${TEST_WORKSPACE}:${TEST_CHANNEL}:${step.ts}` as Step["evidence"][number]["message_id"],
        message_revision: 1,
        ts: step.ts as Step["evidence"][number]["ts"],
        workspace_id:
          TEST_WORKSPACE as Step["evidence"][number]["workspace_id"],
      },
    ],
    handoff_to_person_id: null,
    id: `stp_${step.sessionId}_${step.activitySlug}` as Step["id"],
    intent: step.activitySlug,
    lifecycle_state: "done",
    modality: "reported",
    negated: false,
    seq: step.seq,
    session_id: step.sessionId as Step["session_id"],
    status: step.status ?? "confirmed",
    ts_end: null,
    ts_start: new Date(
      Number.parseFloat(step.ts) * 1000
    ).toISOString() as Step["ts_start"],
    type: step.type ?? "action",
  }));
  return { messages, sessions, steps: contractSteps };
}

export function buildObservedGraph(options: ObservedGraphOptions): GraphView {
  const activities = options.activities ?? TEST_ACTIVITIES;
  const policies = options.policies ?? [];
  const actorIds = [...new Set(options.steps.map((step) => step.actor))];
  const people: TenantKb["people"] = actorIds.map((actor) => ({
    biases: [],
    color: "#6366F1",
    comms_style: "",
    emoji: "",
    goals: [],
    id: `per_${actor.toLowerCase()}`,
    name: actor,
    projects: [TEST_PROJECT],
    role:
      options.roleOverrides?.[actor] ??
      activities.find((activity) =>
        options.steps.some(
          (step) => step.actor === actor && step.activitySlug === activity.slug
        )
      )?.role ??
      "support",
    seniority: "",
  }));
  const graph = buildGraphView({
    data: observedScopedData(options.steps),
    kb: tenantKbFor(activities, policies, people),
    kind: "overlay",
    minSupport: options.minSupport ?? 1,
    projectId: TEST_PROJECT as ProjectId,
    workflowId: TEST_WORKFLOW as WorkflowId,
  });
  if ("response" in graph) {
    throw new Error("Failed to build the observed test graph.");
  }
  return graph;
}

export interface ObservedClientFixtures {
  baseSnapshot: Snapshot & { agent_posts: never[]; pipeline_events: never[] };
  duplicateReplay: ClientJournalEvent[];
  finalSnapshot: Snapshot & { agent_posts: never[]; pipeline_events: never[] };
  replay: ClientJournalEvent[];
  revisionMismatch: ClientJournalEvent;
  scope: {
    channel: string;
    min_support: number;
    project_id: ProjectId;
    view: "overlay";
    workflow_id: WorkflowId;
    workspace_id: string;
  };
}

type ClientJournalEvent = JournalEvent;

const INCIDENT_CASE: ObservedStepInput[] = [
  {
    activitySlug: "detect_incident",
    actor: "U0OPS",
    seq: 1,
    sessionId: "ses_alpha",
    ts: "1700000001.000100",
  },
  {
    activitySlug: "triage_incident",
    actor: "U0OPS",
    seq: 2,
    sessionId: "ses_alpha",
    ts: "1700000002.000100",
  },
  {
    activitySlug: "deploy_fix",
    actor: "U0ENG",
    seq: 3,
    sessionId: "ses_alpha",
    ts: "1700000003.000100",
  },
  {
    activitySlug: "notify_customer",
    actor: "U0OPS",
    seq: 4,
    sessionId: "ses_alpha",
    ts: "1700000004.000100",
  },
];

/** The step the replay adds on top of the base snapshot. */
const LATE_STEP: ObservedStepInput = {
  activitySlug: "escalate_to_ceo",
  actor: "U0OPS",
  seq: 5,
  sessionId: "ses_alpha",
  ts: "1700000005.000100",
  type: "decision",
};

function snapshotFor(steps: ObservedStepInput[], cursor: number) {
  const graph = buildObservedGraph({ steps });
  const built = observedScopedData(steps);
  // Snapshot conformance is per session; the workflow rollup lives on the graph.
  const conformance = buildSessionConformance(
    built,
    tenantKbFor(TEST_ACTIVITIES, [], []),
    TEST_WORKFLOW as WorkflowId
  );
  return {
    agent_posts: [] as never[],
    conformance,
    cursor: cursor as Snapshot["cursor"],
    graph,
    kb: EMPTY_KNOWLEDGE_BASE,
    messages: built.messages,
    pipeline_events: [] as never[],
    sessions: built.sessions,
    steps: built.steps,
  };
}

/**
 * Snapshot and journal-replay fixtures for the client store, built from the real
 * mining output. The store's convergence and de-duplication guarantees are what
 * these exercise; the process content is incidental but real in shape.
 */
export function observedClientFixtures(): ObservedClientFixtures {
  const baseSnapshot = snapshotFor(INCIDENT_CASE, 100);
  const finalSteps = [...INCIDENT_CASE, LATE_STEP];
  const finalSnapshot = snapshotFor(finalSteps, 103);
  const lateData = observedScopedData([LATE_STEP]);
  const scope = {
    channel: TEST_CHANNEL,
    min_support: 1,
    project_id: TEST_PROJECT as ProjectId,
    view: "overlay" as const,
    workflow_id: TEST_WORKFLOW as WorkflowId,
    workspace_id: TEST_WORKSPACE,
  };
  const envelope = (
    id: number,
    kind: JournalEvent["kind"],
    payload: unknown
  ): ClientJournalEvent =>
    ({
      channel: TEST_CHANNEL,
      id,
      kind,
      payload,
      project_id: TEST_PROJECT,
      session_id: "ses_alpha",
      ts: "2026-09-14T00:00:00.000Z",
      workspace_id: TEST_WORKSPACE,
    }) as unknown as ClientJournalEvent;
  const [lateMessage] = lateData.messages;
  const [lateStep] = lateData.steps;
  if (!(lateMessage && lateStep)) {
    throw new Error("Expected the late observation fixture to exist.");
  }
  // A replace delta carries the whole rebuilt graph, which is what the extraction
  // pipeline publishes after it writes new steps.
  const delta = {
    base_revision: baseSnapshot.graph.revision,
    conformance: finalSnapshot.graph.conformance,
    edges_added: finalSnapshot.graph.edges,
    edges_removed: [],
    edges_updated: [],
    nodes_added: finalSnapshot.graph.nodes,
    nodes_removed: [],
    nodes_updated: [],
    replace: true,
    revision: finalSnapshot.graph.revision,
    view_key: finalSnapshot.graph.key,
  };
  const replay = [
    envelope(101, "message", lateMessage),
    envelope(102, "step", lateStep),
    envelope(103, "graph_delta", delta),
  ];
  return {
    baseSnapshot,
    duplicateReplay: [
      ...replay,
      replay[1] as ClientJournalEvent,
      replay[2] as ClientJournalEvent,
    ],
    finalSnapshot,
    replay,
    revisionMismatch: envelope(104, "graph_delta", {
      ...delta,
      base_revision: finalSnapshot.graph.revision + 5,
      replace: false,
      revision: finalSnapshot.graph.revision + 6,
    }),
    scope,
  };
}

export const EMPTY_KNOWLEDGE_BASE = {
  activities: [],
  artifact_lifecycles: [],
  artifacts: [],
  authored_activity_synonyms: [],
  people: [],
  policies: [],
  projects: [],
  role_repertoires: [],
  roles: [],
  workflow_activities: [],
  workflows: [],
} satisfies Snapshot["kb"];
