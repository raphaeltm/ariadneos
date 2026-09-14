// Scoped process data access, graph construction and conformance scoring.
//
// Shared by the HTTP routes and the background extraction pipeline, so both read
// the same channel-scoped rows and build the same designed/discovered overlay from
// workspace-authored definitions.

import type {
  Activity,
  ActivityId,
  ApiError,
  CurationStatus,
  EvidenceRef,
  GraphEdge,
  GraphNode,
  GraphView,
  KnowledgeBase,
  Message,
  PolicyViolation,
  ProcessSession,
  ProjectId,
  RoleId,
  SessionConformance,
  Step,
  StepId,
  WorkflowConformance,
  WorkflowId,
} from "../shared/contracts.ts";
import {
  type ConformanceInput,
  scoreConformance,
} from "../shared/mining/conformance.ts";
import {
  type AggregateGraph,
  type BuildGraphInput,
  buildAggregateGraph,
  type DesignedWorkflowInput,
  type MiningSessionInput,
  type MiningStepInput,
} from "../shared/mining/graph.ts";
import { rewriteStepForDesignedEdits } from "../shared/model-edits.ts";
import type { ChannelScope } from "./runtime/channel.ts";
import {
  activityId,
  buildDesignedGraph,
  type PolicyDefinition,
  type ProjectDefinition,
  readTenantKb,
  type TenantKb,
} from "./tenant/kb.ts";

export const DEFAULT_MIN_SUPPORT = 1;
export const MAX_PAGE_LIMIT = 100;
const ACTIVITY_ID_PREFIX_PATTERN = /^act_/;

export function apiError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } } satisfies ApiError, {
    status,
  });
}

interface SessionRow {
  channel: string;
  ended_ts: string | null;
  extra_json: string;
  fitness: number | null;
  id: string;
  missing_json: string;
  project_id: string;
  scenario_id: string | null;
  source: "human" | "simulation";
  started_ts: string;
  status: "closed" | "open";
  suggested: number;
  variant: string | null;
  violations_json: string;
  workflow_id: string | null;
  workspace_id: string;
}

interface MessageRow {
  author_label: string;
  author_person_id: string | null;
  availability: "available" | "deleted" | "redacted";
  channel: string;
  deleted: number;
  id: string;
  is_agent: number;
  permalink: string;
  received_at: string;
  revision: number;
  session_id: string;
  text: string;
  thread_ts: string | null;
  ts: string;
  workspace_id: string;
}

interface StepRow {
  activity_id: string | null;
  actor_person_id: string | null;
  artifact_id: string | null;
  confidence: number;
  curation_status: CurationStatus;
  effort_days: number | null;
  handoff_to_person_id: string | null;
  id: string;
  intent: string;
  lifecycle_state: Step["lifecycle_state"];
  modality: Step["modality"];
  negated: number;
  seq: number;
  session_id: string;
  ts_end: string | null;
  ts_start: string;
  type: Step["type"];
}

interface EvidenceRow {
  channel: string;
  message_id: string;
  message_revision: number;
  message_ts: string;
  span_end: number | null;
  span_start: number | null;
  step_id: string;
  workspace_id: string;
}

export interface ScopedData {
  messages: Message[];
  sessions: ProcessSession[];
  steps: Step[];
}

export function emptyScopedData(): ScopedData {
  return { messages: [], sessions: [], steps: [] };
}

export async function readScopedData(
  db: D1Database,
  scope: ChannelScope,
  projectId: string,
  options: { sessionId?: string } = {}
): Promise<ScopedData> {
  const sessions = options.sessionId
    ? await readSessions(db, scope, projectId, options.sessionId)
    : await readSessions(db, scope, projectId);
  const sessionIds = sessions.map((session) => session.id);
  if (sessionIds.length === 0) {
    return emptyScopedData();
  }
  const [messages, steps] = await Promise.all([
    readMessages(db, scope, { sessionIds }),
    readSteps(db, scope, sessionIds),
  ]);
  return { messages, sessions, steps };
}

async function readSessions(
  db: D1Database,
  scope: ChannelScope,
  projectId: string,
  sessionId?: string
) {
  const sql = sessionId
    ? `SELECT * FROM pm_session
       WHERE workspace_id = ? AND channel = ? AND project_id = ? AND id = ?
       ORDER BY started_ts DESC`
    : `SELECT * FROM pm_session
       WHERE workspace_id = ? AND channel = ? AND project_id = ?
       ORDER BY started_ts DESC
       LIMIT 100`;
  const bindings = sessionId
    ? [scope.workspaceId, scope.channel, projectId, sessionId]
    : [scope.workspaceId, scope.channel, projectId];
  const rows = await db
    .prepare(sql)
    .bind(...bindings)
    .all<SessionRow>();
  return rows.results.map(toSession);
}

export async function readSession(
  db: D1Database,
  scope: ChannelScope,
  sessionId: string
) {
  const row = await db
    .prepare(
      `SELECT * FROM pm_session
       WHERE workspace_id = ? AND channel = ? AND id = ?`
    )
    .bind(scope.workspaceId, scope.channel, sessionId)
    .first<SessionRow>();
  return row ? toSession(row) : null;
}

export async function readMessages(
  db: D1Database,
  scope: ChannelScope,
  options: {
    cursor?: string;
    limit?: number;
    sessionId?: string;
    sessionIds?: string[];
  }
) {
  if (options.sessionIds?.length === 0) {
    return [];
  }
  const filters = ["workspace_id = ?", "channel = ?"];
  const bindings: Array<number | string> = [scope.workspaceId, scope.channel];
  if (options.sessionId) {
    filters.push("session_id = ?");
    bindings.push(options.sessionId);
  }
  if (options.sessionIds?.length) {
    filters.push(
      `session_id IN (${options.sessionIds.map(() => "?").join(",")})`
    );
    bindings.push(...options.sessionIds);
  }
  if (options.cursor) {
    filters.push("ts > ?");
    bindings.push(options.cursor);
  }
  bindings.push(options.limit ?? 1000);
  const rows = await db
    .prepare(
      `SELECT * FROM pm_message
       WHERE ${filters.join(" AND ")}
       ORDER BY ts
       LIMIT ?`
    )
    .bind(...bindings)
    .all<MessageRow>();
  return rows.results.map(toMessage);
}

export async function readSteps(
  db: D1Database,
  scope: ChannelScope,
  sessionIds: string[]
) {
  if (sessionIds.length === 0) {
    return [];
  }
  const rows = await db
    .prepare(
      `SELECT stp.*
       FROM pm_step stp
       JOIN pm_session ses ON ses.id = stp.session_id
       WHERE ses.workspace_id = ? AND ses.channel = ?
         AND stp.session_id IN (${sessionIds.map(() => "?").join(",")})
       ORDER BY stp.session_id, stp.seq`
    )
    .bind(scope.workspaceId, scope.channel, ...sessionIds)
    .all<StepRow>();
  const evidence = await readEvidenceForSteps(
    db,
    scope,
    rows.results.map((row) => row.id)
  );
  return rows.results.map((row) => toStep(row, evidence.get(row.id) ?? []));
}

export async function readStep(
  db: D1Database,
  scope: ChannelScope,
  stepId: string
) {
  const row = await db
    .prepare(
      `SELECT stp.*
       FROM pm_step stp
       JOIN pm_session ses ON ses.id = stp.session_id
       WHERE ses.workspace_id = ? AND ses.channel = ? AND stp.id = ?`
    )
    .bind(scope.workspaceId, scope.channel, stepId)
    .first<StepRow>();
  if (!row) {
    return null;
  }
  const evidence = await readEvidenceForSteps(db, scope, [stepId]);
  return toStep(row, evidence.get(stepId) ?? []);
}

async function readEvidenceForSteps(
  db: D1Database,
  scope: ChannelScope,
  stepIds: string[]
) {
  const evidence = new Map<string, EvidenceRef[]>();
  if (stepIds.length === 0) {
    return evidence;
  }
  const rows = await db
    .prepare(
      `SELECT ev.step_id, ev.workspace_id, ev.channel, ev.message_ts, ev.message_revision,
              ev.span_start, ev.span_end, msg.id AS message_id
       FROM pm_step_evidence ev
       JOIN pm_message msg
         ON msg.workspace_id = ev.workspace_id
        AND msg.channel = ev.channel
        AND msg.ts = ev.message_ts
       WHERE ev.workspace_id = ? AND ev.channel = ?
         AND ev.step_id IN (${stepIds.map(() => "?").join(",")})
       ORDER BY ev.step_id, ev.message_ts`
    )
    .bind(scope.workspaceId, scope.channel, ...stepIds)
    .all<EvidenceRow>();
  for (const row of rows.results) {
    evidence.set(row.step_id, [
      ...(evidence.get(row.step_id) ?? []),
      {
        channel: row.channel,
        message_id: row.message_id as EvidenceRef["message_id"],
        message_revision: row.message_revision,
        ...(row.span_start !== null && row.span_end !== null
          ? { span: { end: row.span_end, start: row.span_start } }
          : {}),
        ts: row.message_ts,
        workspace_id: row.workspace_id,
      },
    ]);
  }
  return evidence;
}

export async function readEvidenceMessages(
  db: D1Database,
  scope: ChannelScope,
  stepId: string
) {
  const rows = await db
    .prepare(
      `SELECT msg.*
       FROM pm_step_evidence ev
       JOIN pm_message msg
         ON msg.workspace_id = ev.workspace_id
        AND msg.channel = ev.channel
        AND msg.ts = ev.message_ts
       WHERE ev.workspace_id = ? AND ev.channel = ? AND ev.step_id = ?
         AND msg.deleted = 0
       ORDER BY msg.ts`
    )
    .bind(scope.workspaceId, scope.channel, stepId)
    .all<MessageRow>();
  return rows.results.map(toMessage);
}

function toSession(row: SessionRow): ProcessSession {
  return {
    channel: row.channel,
    ended_ts: row.ended_ts,
    extra: parseJsonArray(row.extra_json),
    fitness: row.fitness,
    id: row.id as ProcessSession["id"],
    missing: parseJsonArray(row.missing_json),
    project_id: row.project_id as ProjectId,
    ...(row.scenario_id ? { scenario_id: row.scenario_id } : {}),
    source: row.source,
    started_ts: row.started_ts,
    status: row.status,
    suggested: Boolean(row.suggested),
    ...(row.variant ? { variant: row.variant } : {}),
    violations: parseJsonArray(
      row.violations_json
    ) as ProcessSession["violations"],
    workflow_id: row.workflow_id as WorkflowId | null,
    workspace_id: row.workspace_id,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    author_label: row.author_label,
    author_person_id: row.author_person_id as Message["author_person_id"],
    availability: row.availability,
    channel: row.channel,
    deleted: Boolean(row.deleted),
    id: row.id as Message["id"],
    is_agent: Boolean(row.is_agent),
    permalink: row.permalink,
    received_at: row.received_at,
    revision: row.revision,
    session_id: row.session_id as Message["session_id"],
    text: row.text,
    thread_ts: row.thread_ts,
    ts: row.ts,
    workspace_id: row.workspace_id,
  };
}

function toStep(row: StepRow, evidence: EvidenceRef[]): Step {
  return {
    activity_id: row.activity_id as Step["activity_id"],
    actor_person_id: row.actor_person_id as Step["actor_person_id"],
    artifact_id: row.artifact_id as Step["artifact_id"],
    confidence: row.confidence,
    ...(row.effort_days === null ? {} : { effort_days: row.effort_days }),
    evidence,
    handoff_to_person_id:
      row.handoff_to_person_id as Step["handoff_to_person_id"],
    id: row.id as StepId,
    intent: row.intent,
    lifecycle_state: row.lifecycle_state,
    modality: row.modality,
    negated: Boolean(row.negated),
    seq: row.seq,
    session_id: row.session_id as Step["session_id"],
    status: row.curation_status,
    ts_end: row.ts_end,
    ts_start: row.ts_start,
    type: row.type,
  };
}

function parseJsonArray(value: string) {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

export function buildGraphView(input: {
  data: ScopedData;
  effectiveWorkflow?: DesignedWorkflowInput;
  kb: TenantKb;
  kind: GraphView["kind"];
  mergedSlugs?: Record<string, string>;
  minSupport: number | { response: Response };
  projectId: ProjectId;
  sessionId?: string;
  workflowId?: WorkflowId;
}): GraphView | { response: Response } {
  if (typeof input.minSupport !== "number") {
    return input.minSupport;
  }
  const { minSupport } = input;
  if (input.kind === "instance" && !input.sessionId) {
    return {
      response: apiError(
        "missing_session_id",
        "session_id is required for an instance graph.",
        400
      ),
    };
  }
  const graph = buildAggregateForGraph(input);
  const nodes = graph.nodes
    .filter(
      (node) =>
        node.designed ||
        input.kind !== "designed" ||
        node.plane === "designed" ||
        node.plane === "both"
    )
    .filter(
      (node) =>
        input.kind === "designed" || node.designed || node.support >= minSupport
    )
    .map((node) => toGraphNode(node, input.projectId));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter((edge) => edge.support >= minSupport || edge.plane === "designed")
    .filter((edge) => nodeIds.has(edge.source as ActivityId))
    .filter((edge) => nodeIds.has(edge.target as ActivityId))
    .map(toGraphEdge);
  const revision = revisionNumber(graph.revision);
  return {
    conformance: buildWorkflowConformance(
      input.data,
      input.kb,
      input.workflowId,
      input.effectiveWorkflow,
      input.mergedSlugs
    ),
    edges,
    generated_at: new Date().toISOString(),
    happy_path: graph.happyPath.map(
      (step) => `ged_${step.activityId}` as GraphEdge["id"]
    ),
    key: [
      input.kind,
      input.projectId,
      input.workflowId ?? "",
      input.sessionId ?? "",
      minSupport,
    ].join(":"),
    kind: input.kind,
    min_support: minSupport,
    nodes,
    project_id: input.projectId,
    revision,
    ...(input.sessionId
      ? { session_id: input.sessionId as ProcessSession["id"] }
      : {}),
    ...(input.workflowId ? { workflow_id: input.workflowId } : {}),
  };
}

export function buildAggregateForGraph(input: {
  data: ScopedData;
  effectiveWorkflow?: DesignedWorkflowInput;
  kb: TenantKb;
  kind?: GraphView["kind"];
  mergedSlugs?: Record<string, string>;
  projectId: ProjectId;
  sessionId?: string;
  workflowId?: WorkflowId;
}): AggregateGraph {
  const { kb } = input;
  const workflows =
    input.kind === "discovered" || !input.workflowId
      ? []
      : [
          input.effectiveWorkflow ??
            designedWorkflowInput(input.workflowId, kb),
        ].filter((item): item is DesignedWorkflowInput => Boolean(item));
  return buildAggregateGraph({
    scope: {
      projectId: input.projectId,
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
    },
    sessions: input.data.sessions.map(toMiningSession),
    steps: input.data.steps
      .map(toMiningStep)
      .map((step) =>
        input.mergedSlugs
          ? rewriteStepForDesignedEdits(step, input.mergedSlugs)
          : step
      ),
    workflows,
  } satisfies BuildGraphInput);
}

function toMiningSession(session: ProcessSession): MiningSessionInput {
  return {
    id: session.id,
    projectId: session.project_id,
    workflowId: session.workflow_id,
  };
}

function toMiningStep(step: Step): MiningStepInput {
  const slug = step.activity_id
    ? step.activity_id.replace(ACTIVITY_ID_PREFIX_PATTERN, "")
    : step.intent;
  return {
    activityId: step.activity_id,
    activityLabel: humanizeSlug(slug),
    activitySlug: slug,
    actorPersonId: step.actor_person_id,
    curation: step.status,
    evidence: step.evidence.map((ref) => ref.ts),
    handoffToPersonId: step.handoff_to_person_id,
    id: step.id,
    lifecycle: step.lifecycle_state,
    modality: step.modality,
    negated: step.negated,
    seq: step.seq,
    sessionId: step.session_id,
    state: step.lifecycle_state,
    type: step.type,
  };
}

function mergedSlugForStep(step: Step, mergedSlugs: Record<string, string>) {
  const slug = step.activity_id
    ? step.activity_id.replace(ACTIVITY_ID_PREFIX_PATTERN, "")
    : step.intent;
  return mergedSlugs[slug] ?? slug;
}

export function designedWorkflowInput(
  workflowId: WorkflowId,
  kb: TenantKb
): DesignedWorkflowInput | null {
  const workflow = kb.workflows.find((item) => item.id === workflowId);
  if (!workflow) {
    return null;
  }
  const designed = buildDesignedGraph(workflow);
  return {
    activities: designed.activities.map((activity) => ({
      id: activity.activityId,
      label: activity.label,
      policyIds: kb.policies
        .filter(
          (policy) =>
            policy.project_id === workflow.project_id &&
            policy.activity_slug === activity.slug
        )
        .map((policy) => policy.id),
      rank: activity.rank,
      roleExpected: activity.roleExpected,
      slug: activity.slug,
    })),
    edges: designed.edges.map((edge) => ({
      probability: edge.weight,
      sourceActivityId: edge.fromActivityId,
      targetActivityId: edge.toActivityId,
    })),
    entryActivitySlug: designed.entryActivity,
    exitActivitySlugs: designed.exitActivities,
    id: workflow.id,
    matrix: designed.matrix,
    name: designed.name,
    projectId: workflow.project_id,
  };
}

function toGraphNode(
  node: ReturnType<typeof buildAggregateGraph>["nodes"][number],
  projectId: ProjectId
): GraphNode {
  const activity: Activity = {
    authored_synonyms: [],
    description: "",
    first_seen_ts: node.firstSeenTs ?? undefined,
    id: node.id as ActivityId,
    label: node.label,
    occurrences: node.occurrences,
    plane: node.plane,
    policy_ids: node.policyIds as Activity["policy_ids"],
    project_id: projectId,
    role_expected: node.roleExpected as RoleId | null,
    roles_observed: node.roles.map((role) => role.role as RoleId),
    slug: node.slug,
    support: node.support,
  };
  return {
    activity,
    id: node.id as ActivityId,
    role_deviations: [],
    unreconciled: [],
  };
}

function toGraphEdge(
  edge: ReturnType<typeof buildAggregateGraph>["edges"][number]
): GraphEdge {
  return {
    cases: edge.cases as GraphEdge["cases"],
    from: edge.source as ActivityId,
    id: `ged_${edge.source}_${edge.target}` as GraphEdge["id"],
    is_back_edge: edge.isBackEdge,
    kind: edge.kind,
    observed_support: edge.support,
    plane: edge.plane,
    probability: edge.probability,
    to: edge.target as ActivityId,
    violates: [],
    weight: edge.occurrences,
  };
}

export function buildSessionConformance(
  data: ScopedData,
  kb: TenantKb,
  workflowId: WorkflowId | undefined,
  effectiveWorkflow?: DesignedWorkflowInput,
  mergedSlugs?: Record<string, string>
): SessionConformance[] {
  if (!workflowId) {
    return [];
  }
  const workflow = effectiveWorkflow ?? designedWorkflowInput(workflowId, kb);
  if (!workflow) {
    return [];
  }
  return runConformance(
    data,
    kb,
    workflowId,
    workflow,
    mergedSlugs
  ).sessions.map((session) => ({
    extra: session.controlFlow.extra.map((slug) => ({
      occurrences: 1,
      slug,
    })),
    fitness: session.controlFlow.fitness,
    missing: session.controlFlow.missing.map((slug) => ({
      of: 1,
      seen_in_sessions: 0,
      slug,
    })),
    order_breaks: session.controlFlow.orderBreaks.map((item) => ({
      expected_between: item.expectedBetween.join(", ") || null,
      from: item.from,
      to: item.to,
    })),
    precision: session.controlFlow.precision,
    role_deviations: [],
    session_id: session.sessionId as ProcessSession["id"],
    unreconciled: [],
    violations: session.violations.map(toPolicyViolation),
    workflow_id: workflowId,
  }));
}

export function buildWorkflowConformance(
  data: ScopedData,
  kb: TenantKb,
  workflowId: WorkflowId | undefined,
  effectiveWorkflow?: DesignedWorkflowInput,
  mergedSlugs?: Record<string, string>
): WorkflowConformance | null {
  if (!workflowId) {
    return null;
  }
  const result = runConformance(
    data,
    kb,
    workflowId,
    effectiveWorkflow,
    mergedSlugs
  );
  return {
    closed_sessions: result.rollup.closedSessions,
    extra: Object.entries(result.rollup.extraCounts).map(
      ([slug, occurrences]) => ({ occurrences, slug })
    ),
    fitness: result.rollup.fitness,
    missing: Object.entries(result.rollup.missingCounts).map(([slug, of]) => ({
      of,
      seen_in_sessions: Math.max(0, result.rollup.closedSessions - of),
      slug,
    })),
    open_sessions: result.rollup.openSessions,
    order_breaks: [],
    precision: result.rollup.precision,
    role_deviations: [],
    unreconciled: [],
    violations: result.sessions.flatMap((session) =>
      session.violations.map(toPolicyViolation)
    ),
    workflow_id: workflowId,
  };
}

function runConformance(
  data: ScopedData,
  kb: TenantKb,
  workflowId: WorkflowId,
  effectiveWorkflow?: DesignedWorkflowInput,
  mergedSlugs: Record<string, string> = {}
) {
  const workflow = kb.workflows.find((item) => item.id === workflowId);
  const designed = effectiveWorkflow ?? designedWorkflowInput(workflowId, kb);
  if (!(designed || workflow)) {
    return scoreConformance(emptyConformanceInput(workflowId));
  }
  return scoreConformance({
    // Slack messages carry no structured artifact values, so threshold policies
    // have nothing to compare against until an artifact connector exists.
    artifacts: [],
    evidence: data.messages.map((message) => ({
      authorized: !message.deleted && message.availability === "available",
      permalink: message.permalink,
      quote: message.text,
      ts: message.ts,
    })),
    people: kb.people.map((person) => ({ id: person.id, role: person.role })),
    policies: kb.policies.map(toConformancePolicy),
    sessions: data.sessions.map((session) => ({
      id: session.id,
      projectId: session.project_id,
      status: session.status,
      workflowId: session.workflow_id,
    })),
    steps: data.steps.map((step) => ({
      activitySlug: mergedSlugForStep(step, mergedSlugs),
      actorPersonId: step.actor_person_id,
      artifactId: step.artifact_id,
      confidence: step.confidence,
      effortDays: step.effort_days ?? null,
      evidence: step.evidence.map((ref) => ref.ts),
      id: step.id,
      seq: step.seq,
      sessionId: step.session_id,
      state: step.lifecycle_state,
      status: step.status,
      type: step.type,
    })),
    workflow: {
      activities: (designed?.activities ?? []).map((activity) => ({
        expectedRole: activity.roleExpected ?? undefined,
        label: activity.label,
        slug: activity.slug,
      })),
      id: workflow?.id ?? workflowId,
      matrix: designed?.matrix ?? [],
      projectId: designed?.projectId ?? workflow?.project_id ?? undefined,
    },
  } satisfies ConformanceInput);
}

function emptyConformanceInput(workflowId: WorkflowId): ConformanceInput {
  return {
    people: [],
    policies: [],
    sessions: [],
    steps: [],
    workflow: {
      activities: [],
      id: workflowId,
      matrix: [],
    },
  };
}

function toConformancePolicy(policy: PolicyDefinition) {
  return {
    activitySlug: policy.activity_slug,
    id: policy.id,
    kind: policy.kind,
    params: policy.params,
    projectId: policy.project_id,
    text: policy.text,
  };
}

function toPolicyViolation(
  violation: ReturnType<
    typeof scoreConformance
  >["sessions"][number]["violations"][number]
): PolicyViolation {
  const [citation] = violation.evidence;
  return {
    evidence: [],
    policy_id: violation.policyId as PolicyViolation["policy_id"],
    quote: citation?.quote ?? violation.reason,
    text: violation.reason,
  };
}

export interface ConformanceRecalculationInput {
  projectId: ProjectId;
  requestId?: string;
  sessionId?: ProcessSession["id"];
  source: "curation" | "graph";
  workflowId: WorkflowId;
}

export interface ConformanceRecalculationResult {
  session: SessionConformance | null;
  sessions: SessionConformance[];
  workflow: WorkflowConformance;
}

function authoredRoles(kb: TenantKb): KnowledgeBase["roles"] {
  const byId = new Map(
    kb.roles.map((role) => [
      role.id,
      { id: role.id as RoleId, name: role.name },
    ])
  );
  for (const person of kb.people) {
    if (person.role && !byId.has(person.role)) {
      byId.set(person.role, {
        id: person.role as RoleId,
        name: humanizeSlug(person.role),
      });
    }
  }
  return [...byId.values()];
}

export function toKnowledgeBase(kb: TenantKb): KnowledgeBase {
  const workflows = kb.workflows
    .filter((workflow) => workflow.project_id)
    .map((workflow) => ({
      activity_slugs: workflow.activities.map((activity) => activity.slug),
      entry_activity: workflow.entry_activity,
      exit_activities: workflow.exit_activities,
      id: workflow.id as WorkflowId,
      matrix: workflow.matrix,
      name: workflow.name,
      plane: "designed" as const,
      policy_ids:
        workflow.policy_ids as KnowledgeBase["workflows"][number]["policy_ids"],
      project_id: workflow.project_id as ProjectId,
    }));
  return {
    activities: uniqueActivities(kb),
    // Artifacts and their lifecycles need a document or tracker connector. Slack
    // observation alone cannot populate them, so they stay empty rather than
    // being inferred from message text.
    artifact_lifecycles: [],
    artifacts: [],
    authored_activity_synonyms: kb.workflows.flatMap((workflow) =>
      workflow.activities.flatMap((activity) =>
        activity.synonyms.map((synonym) => ({
          activity_id: activityId(activity.slug) as ActivityId,
          synonym,
        }))
      )
    ),
    people: kb.people.map((person) => ({
      biases: person.biases,
      color: person.color,
      comms_style: person.comms_style,
      emoji: person.emoji,
      goals: person.goals,
      id: person.id as KnowledgeBase["people"][number]["id"],
      name: person.name,
      project_ids: person.projects as ProjectId[],
      role: person.role as RoleId,
      seniority: person.seniority,
    })),
    policies: kb.policies.map((policy) => ({
      activity_slug: policy.activity_slug,
      id: policy.id as KnowledgeBase["policies"][number]["id"],
      kind: policy.kind,
      params: policy.params as KnowledgeBase["policies"][number]["params"],
      project_id: policy.project_id as ProjectId,
      text: policy.text,
    })),
    projects: kb.projects.map(toProject),
    role_repertoires: kb.roleCapabilities.flatMap((role) => [
      {
        never_performs: role.never_performs.map(
          (slug) => activityId(slug) as ActivityId
        ),
        performs: role.performs.map((slug) => activityId(slug) as ActivityId),
        role_id: role.role as RoleId,
      },
    ]),
    roles: authoredRoles(kb),
    workflow_activities: kb.workflows.flatMap((workflow) =>
      workflow.activities.map((activity, rank) => ({
        activity_id: activityId(activity.slug) as ActivityId,
        rank,
        role_expected: activity.role as RoleId,
        workflow_id: workflow.id as WorkflowId,
      }))
    ),
    workflows,
  };
}

function uniqueActivities(kb: TenantKb): Activity[] {
  const activities = new Map<string, Activity>();
  for (const workflow of kb.workflows) {
    for (const activity of workflow.activities) {
      const id = activityId(activity.slug) as ActivityId;
      const existing = activities.get(id);
      activities.set(id, {
        authored_synonyms: [
          ...(existing?.authored_synonyms ?? []),
          ...activity.synonyms,
        ],
        description: "",
        id,
        label: activity.label,
        occurrences: 0,
        plane: "designed",
        policy_ids: workflow.policy_ids.filter((policyId) =>
          policyAppliesToActivity(kb.policies, policyId, activity.slug)
        ) as Activity["policy_ids"],
        project_id: workflow.project_id as ProjectId | null,
        role_expected: activity.role as RoleId,
        roles_observed: [],
        slug: activity.slug,
        support: 0,
      });
    }
  }
  return [...activities.values()];
}

function policyAppliesToActivity(
  policies: PolicyDefinition[],
  policyId: string,
  activitySlug: string
) {
  return policies.some(
    (policy) => policy.id === policyId && policy.activity_slug === activitySlug
  );
}

function toProject(
  project: ProjectDefinition
): KnowledgeBase["projects"][number] {
  return {
    constraints: project.constraints,
    id: project.id as ProjectId,
    name: project.name,
    spec_md: project.spec_md,
    summary: project.summary,
    workflow_id: project.workflow_id as WorkflowId,
  };
}

export function humanizeSlug(slug: string) {
  return slug
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function revisionNumber(revision: string) {
  let hash = 0;
  for (const char of revision) {
    hash = (hash * 31 + char.charCodeAt(0)) % 2_147_483_647;
  }
  return hash;
}

export interface ScopedGraphBuild {
  conformance: WorkflowConformance | null;
  data: ScopedData;
  graph: GraphView;
  kb: TenantKb;
}

/**
 * Reads a channel's observed data and builds the overlay graph for one project.
 *
 * Returns null when the workspace has not authored a workflow for the project:
 * there is a discovered plane but nothing to compare it against, and callers on
 * the background path should wait rather than publish a half-formed view.
 */
export async function buildScopedGraphView(
  db: D1Database,
  scope: ChannelScope,
  input: {
    kb?: TenantKb;
    minSupport?: number;
    projectId: string;
    sessionId?: string;
    workflowId?: string;
  }
): Promise<ScopedGraphBuild | null> {
  const kb = input.kb ?? (await readTenantKb(db, scope.workspaceId));
  const project = kb.projects.find((item) => item.id === input.projectId);
  if (!project) {
    return null;
  }
  const workflowId = input.workflowId ?? project.workflow_id;
  const workflow = kb.workflows.find((item) => item.id === workflowId);
  const data = await readScopedData(db, scope, input.projectId, {
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
  const graph = buildGraphView({
    data,
    kb,
    kind: workflow ? "overlay" : "discovered",
    minSupport: input.minSupport ?? DEFAULT_MIN_SUPPORT,
    projectId: input.projectId as ProjectId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(workflow ? { workflowId: workflow.id as WorkflowId } : {}),
  });
  if ("response" in graph) {
    return null;
  }
  return {
    conformance: graph.conformance ?? null,
    data,
    graph,
    kb,
  };
}
