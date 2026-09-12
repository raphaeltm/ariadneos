import { type Context, Hono } from "hono";
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
  Snapshot,
  Step,
  StepId,
  WorkflowConformance,
  WorkflowId,
} from "../../shared/contracts.ts";
import {
  type ConformanceInput,
  scoreConformance,
} from "../../shared/mining/conformance.ts";
import {
  type AggregateGraph,
  type BuildGraphInput,
  buildAggregateGraph,
  type DesignedWorkflowInput,
  type MiningSessionInput,
  type MiningStepInput,
} from "../../shared/mining/graph.ts";
import {
  applyDesignedGraphEdits,
  type DesignedGraphEditAction,
  type DesignedGraphEditPayload,
  rewriteStepForDesignedEdits,
} from "../../shared/model-edits.ts";
import { persistGraphRevision } from "../graph-persistence.ts";
import {
  type AuthoredKb,
  activityId,
  buildDesignedGraph,
  loadKb,
  type PolicyDefinition,
  type ProjectDefinition,
} from "../kb.ts";
import {
  appendGraphEdit,
  readActiveDesignedGraphEdits,
  readGraphEditByRequestId,
  readGraphEditHead,
  readGraphEditHistory,
  type StoredGraphEdit,
  undoLatestGraphEdit,
} from "../model-edits.ts";
import {
  type ChannelCoordinatorEnv,
  type ChannelScope,
  commitJournalEntry,
  configuredChannelScope,
  coordinatorFetch,
  currentJournalCursor,
  type JournalWrite,
} from "../runtime/channel.ts";

type ProcessEnv = ChannelCoordinatorEnv & {
  DB: D1Database;
};

interface Variables {
  processContext: ProcessContext;
  userId: string;
}

interface ProcessContext {
  scope: ChannelScope;
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

const DEFAULT_PROJECT_ID = "proj_helios";
const DEFAULT_MIN_SUPPORT = 1;
const MAX_PAGE_LIMIT = 100;
const ID_PATTERN = /^[a-z][a-z0-9_:-]*$/;
const SLUG_PATTERN = /^[a-z][a-z0-9_]*$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;
const ACTIVITY_ID_PREFIX_PATTERN = /^act_/;
const CURATION_STATUSES = new Set<CurationStatus>(["confirmed", "rejected"]);
const GRAPH_EDIT_ACTIONS = new Set([
  "add_edge",
  "add_node",
  "merge",
  "merge_nodes",
  "promote",
  "remove_edge",
  "remove_node",
  "rename",
  "rename_node",
  "require",
  "retire",
]);

export const processRoutes = new Hono<{
  Bindings: ProcessEnv;
  Variables: Variables;
}>();

processRoutes.use("*", async (c, next) => {
  const context = routeContext(c.env, c.req.query());
  if ("response" in context) {
    return context.response;
  }
  c.set("processContext", context);
  return await next();
});

processRoutes.get("/kb", (c) => {
  const kb = loadKb();
  return c.json({
    kb: toKnowledgeBase(kb),
    scenarios: kb.workspaces.flatMap((workspace) => workspace.scenarios),
    workspaces: kb.workspaces,
  });
});

processRoutes.get("/model/edits", async (c) => {
  const context = getProcessContext(c);
  const scope = resolveScope(
    {
      project_id: c.req.query("project_id"),
      workflow_id: c.req.query("workflow_id") ?? c.req.query("workflow"),
    },
    loadKb(),
    { requireWorkflow: true }
  );
  if ("response" in scope) {
    return scope.response;
  }
  if (!scope.workflowId) {
    return apiError("unknown_workflow", "Unknown workflow_id.", 400);
  }
  const { workflowId } = scope;
  const edits = await readGraphEditHistory(c.env.DB, context.scope, workflowId);
  return c.json({
    edits: edits.map(toEditResponse),
    revision: await readGraphEditHead(c.env.DB, context.scope, workflowId),
    workflow_id: workflowId,
  });
});

processRoutes.post("/model/edit", async (c) => {
  const context = getProcessContext(c);
  const body = await readJson<{
    action?: string;
    base_revision?: number;
    payload?: unknown;
    project_id?: string;
    request_id?: string;
    workflow?: string;
    workflow_id?: string;
  }>(c.req.raw);
  if ("response" in body) {
    return body.response;
  }
  const metadata = validateEditRequestMetadata(body);
  if (metadata) {
    return metadata;
  }
  const scope = resolveScope(
    {
      project_id: body.project_id,
      workflow_id: body.workflow_id ?? body.workflow,
    },
    loadKb(),
    { requireWorkflow: true }
  );
  if ("response" in scope) {
    return scope.response;
  }
  if (!scope.workflowId) {
    return apiError("unknown_workflow", "Unknown workflow_id.", 400);
  }
  const { workflowId } = scope;
  const duplicate = await readGraphEditByRequestId(
    c.env.DB,
    context.scope,
    workflowId,
    body.request_id
  );
  if (duplicate) {
    return modelEditResponse(
      c,
      context.scope,
      { ...scope, workflowId },
      duplicate
    );
  }
  const current = await readEffectiveWorkflow(
    c.env.DB,
    context.scope,
    workflowId
  );
  if (!current) {
    return apiError("unknown_workflow", "Unknown workflow_id.", 400);
  }
  const data = await readScopedData(c.env.DB, context.scope, scope.projectId);
  const aggregate = buildAggregateForGraph({
    data,
    effectiveWorkflow: current.workflow,
    mergedSlugs: current.mergedSlugs,
    projectId: scope.projectId,
    workflowId,
  });
  const edit = validateGraphEdit({
    action: body.action,
    aggregate,
    payload: body.payload,
    workflow: current.workflow,
  });
  if ("response" in edit) {
    return edit.response;
  }
  const result = await appendGraphEdit(c.env.DB, {
    action: edit.action,
    actorId: c.get("userId"),
    baseRevision: body.base_revision,
    payload: edit.payload,
    projectId: scope.projectId,
    requestId: body.request_id,
    scope: context.scope,
    workflowId,
  });
  if (result.status === "conflict") {
    return editConflict(result.currentRevision);
  }
  if (result.status !== "created" && result.status !== "duplicate") {
    return apiError("edit_not_applied", "Graph edit was not applied.", 409);
  }
  return modelEditResponse(
    c,
    context.scope,
    { ...scope, workflowId },
    result.edit
  );
});

processRoutes.post("/model/edit/undo", async (c) => {
  const context = getProcessContext(c);
  const body = await readJson<{
    base_revision?: number;
    project_id?: string;
    request_id?: string;
    workflow?: string;
    workflow_id?: string;
  }>(c.req.raw);
  if ("response" in body) {
    return body.response;
  }
  const metadata = validateEditRequestMetadata(body);
  if (metadata) {
    return metadata;
  }
  const scope = resolveScope(
    {
      project_id: body.project_id,
      workflow_id: body.workflow_id ?? body.workflow,
    },
    loadKb(),
    { requireWorkflow: true }
  );
  if ("response" in scope) {
    return scope.response;
  }
  if (!scope.workflowId) {
    return apiError("unknown_workflow", "Unknown workflow_id.", 400);
  }
  const { workflowId } = scope;
  const result = await undoLatestGraphEdit(c.env.DB, {
    actorId: c.get("userId"),
    baseRevision: body.base_revision,
    requestId: body.request_id,
    scope: context.scope,
    workflowId,
  });
  if (result.status === "conflict") {
    return editConflict(result.currentRevision);
  }
  if (result.status === "empty") {
    return apiError("nothing_to_undo", "No active graph edit exists.", 409);
  }
  return modelEditResponse(
    c,
    context.scope,
    { ...scope, workflowId },
    result.edit
  );
});

processRoutes.get("/snapshot", async (c) => {
  const context = getProcessContext(c);
  const scope = resolveScope(c.req.query(), loadKb());
  if ("response" in scope) {
    return scope.response;
  }
  const data = await readScopedData(c.env.DB, context.scope, scope.projectId);
  const effective = scope.workflowId
    ? await readEffectiveWorkflow(c.env.DB, context.scope, scope.workflowId)
    : null;
  const graph = buildGraphView({
    data,
    effectiveWorkflow: effective?.workflow,
    kind: requestedView(c.req.query("view")),
    mergedSlugs: effective?.mergedSlugs,
    minSupport: readLimit(c.req.query("min_support"), {
      defaultValue: DEFAULT_MIN_SUPPORT,
      maximum: 50,
      name: "min_support",
    }),
    projectId: scope.projectId,
    sessionId: c.req.query("session_id") ?? undefined,
    workflowId: scope.workflowId,
  });
  if ("response" in graph) {
    return graph.response;
  }
  const snapshot: Snapshot & {
    agent_posts: unknown[];
    pipeline_events: unknown[];
  } = {
    agent_posts: [],
    conformance: buildSessionConformance(
      data,
      scope.workflowId,
      effective?.workflow,
      effective?.mergedSlugs
    ),
    cursor: await currentJournalCursor(c.env.DB, context.scope),
    graph,
    kb: toKnowledgeBase(loadKb()),
    messages: data.messages,
    pipeline_events: [],
    sessions: data.sessions,
    steps: data.steps,
  };
  return c.json(snapshot);
});

processRoutes.get("/graph/designed", async (c) => {
  const context = getProcessContext(c);
  const scope = resolveScope(c.req.query(), loadKb(), {
    requireWorkflow: true,
  });
  if ("response" in scope) {
    return scope.response;
  }
  if (!scope.workflowId) {
    return apiError("unknown_workflow", "Unknown workflow_id.", 400);
  }
  const { workflowId } = scope;
  const effective = await readEffectiveWorkflow(
    c.env.DB,
    context.scope,
    workflowId
  );
  const data = emptyScopedData();
  return c.json(
    buildGraphView({
      data,
      effectiveWorkflow: effective?.workflow,
      kind: "designed",
      mergedSlugs: effective?.mergedSlugs,
      minSupport: DEFAULT_MIN_SUPPORT,
      projectId: scope.projectId,
      workflowId,
    })
  );
});

processRoutes.get("/graph/discovered", async (c) => {
  const context = getProcessContext(c);
  const scope = resolveScope(c.req.query(), loadKb());
  if ("response" in scope) {
    return scope.response;
  }
  const minSupport = readLimit(c.req.query("min_support"), {
    defaultValue: DEFAULT_MIN_SUPPORT,
    maximum: 50,
    name: "min_support",
  });
  if (typeof minSupport !== "number") {
    return minSupport.response;
  }
  const data = await readScopedData(c.env.DB, context.scope, scope.projectId);
  const graph = buildGraphView({
    data,
    kind: "discovered",
    minSupport,
    projectId: scope.projectId,
    workflowId: scope.workflowId,
  });
  return "response" in graph ? graph.response : c.json(graph);
});

processRoutes.get("/graph/overlay", async (c) => {
  const context = getProcessContext(c);
  const scope = resolveScope(c.req.query(), loadKb(), {
    requireWorkflow: true,
  });
  if ("response" in scope) {
    return scope.response;
  }
  if (!scope.workflowId) {
    return apiError("unknown_workflow", "Unknown workflow_id.", 400);
  }
  const { workflowId } = scope;
  const minSupport = readLimit(c.req.query("min_support"), {
    defaultValue: DEFAULT_MIN_SUPPORT,
    maximum: 50,
    name: "min_support",
  });
  if (typeof minSupport !== "number") {
    return minSupport.response;
  }
  const data = await readScopedData(c.env.DB, context.scope, scope.projectId);
  const effective = await readEffectiveWorkflow(
    c.env.DB,
    context.scope,
    workflowId
  );
  const graph = buildGraphView({
    data,
    effectiveWorkflow: effective?.workflow,
    kind: "overlay",
    mergedSlugs: effective?.mergedSlugs,
    minSupport,
    projectId: scope.projectId,
    workflowId,
  });
  return "response" in graph ? graph.response : c.json(graph);
});

processRoutes.get("/sessions", async (c) => {
  const context = getProcessContext(c);
  const scope = resolveScope(c.req.query(), loadKb());
  if ("response" in scope) {
    return scope.response;
  }
  const data = await readScopedData(c.env.DB, context.scope, scope.projectId);
  return c.json({ sessions: data.sessions });
});

processRoutes.get("/sessions/:id", async (c) => {
  const context = getProcessContext(c);
  const sessionId = c.req.param("id");
  if (!isSafeId(sessionId)) {
    return apiError("invalid_session_id", "Session id is invalid.", 400);
  }
  const session = await readSession(c.env.DB, context.scope, sessionId);
  if (!session) {
    return apiError("not_found", "Session was not found.", 404);
  }
  const data = await readScopedData(
    c.env.DB,
    context.scope,
    session.project_id,
    {
      sessionId,
    }
  );
  const effective = session.workflow_id
    ? await readEffectiveWorkflow(c.env.DB, context.scope, session.workflow_id)
    : null;
  return c.json({
    conformance: buildSessionConformance(
      data,
      session.workflow_id ?? undefined,
      effective?.workflow,
      effective?.mergedSlugs
    ),
    session,
    steps: data.steps,
  });
});

processRoutes.get("/sessions/:id/graph", async (c) => {
  const context = getProcessContext(c);
  const sessionId = c.req.param("id");
  if (!isSafeId(sessionId)) {
    return apiError("invalid_session_id", "Session id is invalid.", 400);
  }
  const session = await readSession(c.env.DB, context.scope, sessionId);
  if (!session) {
    return apiError("not_found", "Session was not found.", 404);
  }
  const data = await readScopedData(
    c.env.DB,
    context.scope,
    session.project_id,
    {
      sessionId,
    }
  );
  const effective = session.workflow_id
    ? await readEffectiveWorkflow(c.env.DB, context.scope, session.workflow_id)
    : null;
  const graph = buildGraphView({
    data,
    effectiveWorkflow: effective?.workflow,
    kind: "instance",
    mergedSlugs: effective?.mergedSlugs,
    minSupport: DEFAULT_MIN_SUPPORT,
    projectId: session.project_id,
    sessionId,
    workflowId: session.workflow_id ?? undefined,
  });
  return "response" in graph ? graph.response : c.json(graph);
});

processRoutes.get("/messages", async (c) => {
  const context = getProcessContext(c);
  const limit = readLimit(c.req.query("limit"), {
    defaultValue: 50,
    maximum: MAX_PAGE_LIMIT,
    name: "limit",
  });
  if (typeof limit !== "number") {
    return limit.response;
  }
  const sessionId = c.req.query("session_id");
  if (sessionId && !isSafeId(sessionId)) {
    return apiError("invalid_session_id", "Session id is invalid.", 400);
  }
  const cursor = c.req.query("cursor");
  const messages = await readMessages(c.env.DB, context.scope, {
    cursor,
    limit,
    sessionId,
  });
  return c.json({
    cursor: messages.at(-1)?.ts ?? null,
    messages,
  });
});

processRoutes.get("/steps/:id/evidence", async (c) => {
  const context = getProcessContext(c);
  const stepId = c.req.param("id");
  if (!isSafeId(stepId)) {
    return apiError("invalid_step_id", "Step id is invalid.", 400);
  }
  const step = await readStep(c.env.DB, context.scope, stepId);
  if (!step) {
    return apiError("not_found", "Step was not found.", 404);
  }
  const messages = await readEvidenceMessages(c.env.DB, context.scope, stepId);
  return c.json({ messages, step_id: stepId });
});

processRoutes.post("/steps/:id/status", async (c) => {
  const context = getProcessContext(c);
  const stepId = c.req.param("id");
  if (!isSafeId(stepId)) {
    return apiError("invalid_step_id", "Step id is invalid.", 400);
  }
  const body = await readJson<{ request_id?: string; status?: CurationStatus }>(
    c.req.raw
  );
  if ("response" in body) {
    return body.response;
  }
  if (!(body.status && CURATION_STATUSES.has(body.status))) {
    return apiError(
      "invalid_status",
      "Step status must be confirmed or rejected.",
      400
    );
  }
  const step = await readStep(c.env.DB, context.scope, stepId);
  if (!step) {
    return apiError("not_found", "Step was not found.", 404);
  }
  await c.env.DB.prepare("UPDATE pm_step SET curation_status = ? WHERE id = ?")
    .bind(body.status, stepId)
    .run();
  const updated = (await readStep(c.env.DB, context.scope, stepId)) ?? step;
  await commitCurationJournal(
    c.env,
    c.env.DB,
    context.scope,
    updated,
    body.request_id
  );
  const session = await readSession(
    c.env.DB,
    context.scope,
    updated.session_id
  );
  const conformance = session?.workflow_id
    ? await recalculateScopedConformance(c.env, c.env.DB, context.scope, {
        projectId: session.project_id,
        requestId: body.request_id,
        sessionId: updated.session_id,
        source: "curation",
        workflowId: session.workflow_id,
      })
    : null;
  return c.json({ conformance, step: updated });
});

processRoutes.post("/graph/rebuild", async (c) => {
  const context = getProcessContext(c);
  const body = await readJson<{
    project_id?: string;
    request_id?: string;
    workflow_id?: string;
  }>(c.req.raw);
  if ("response" in body) {
    return body.response;
  }
  const scope = resolveScope(
    {
      project_id: body.project_id,
      workflow_id: body.workflow_id,
    },
    loadKb()
  );
  if ("response" in scope) {
    return scope.response;
  }
  const data = await readScopedData(c.env.DB, context.scope, scope.projectId);
  const effective = scope.workflowId
    ? await readEffectiveWorkflow(c.env.DB, context.scope, scope.workflowId)
    : null;
  const graph = buildGraphView({
    data,
    effectiveWorkflow: effective?.workflow,
    kind: scope.workflowId ? "overlay" : "discovered",
    mergedSlugs: effective?.mergedSlugs,
    minSupport: DEFAULT_MIN_SUPPORT,
    projectId: scope.projectId,
    workflowId: scope.workflowId,
  });
  if ("response" in graph) {
    return graph.response;
  }
  await commitGraphJournal(
    c.env,
    c.env.DB,
    context.scope,
    graph,
    body.request_id
  );
  const conformance = scope.workflowId
    ? await recalculateScopedConformance(c.env, c.env.DB, context.scope, {
        projectId: scope.projectId,
        requestId: body.request_id,
        source: "graph",
        workflowId: scope.workflowId,
      })
    : null;
  return c.json({ conformance, graph });
});

processRoutes.get("/stream", async (c) => {
  const context = getProcessContext(c);
  const scope = resolveScope(c.req.query(), loadKb());
  if ("response" in scope) {
    return scope.response;
  }
  const after = readLimit(
    c.req.header("Last-Event-ID") ?? c.req.query("after"),
    {
      defaultValue: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      name: "after",
    }
  );
  if (typeof after !== "number") {
    return after.response;
  }
  const params = new URLSearchParams();
  params.set("project_id", scope.projectId);
  if (scope.workflowId) {
    params.set("workflow_id", scope.workflowId);
  }
  params.set("after", String(after));
  const response = await coordinatorFetch(c.env, context.scope, "/stream", {
    headers: c.req.header("Last-Event-ID")
      ? { "Last-Event-ID": c.req.header("Last-Event-ID") ?? "" }
      : {},
    params,
  });
  if (!response) {
    return apiError(
      "coordinator_unavailable",
      "Channel coordinator is not bound.",
      503
    );
  }
  return response;
});

processRoutes.post("/sim/run", async () =>
  apiError(
    "simulation_runtime_unavailable",
    "Durable simulation persistence is not available on this branch yet.",
    503
  )
);

processRoutes.post("/sim/pause", async (c) => controlSimulation(c, "/pause"));
processRoutes.post("/sim/resume", async (c) => controlSimulation(c, "/resume"));

function apiError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } } satisfies ApiError, {
    status,
  });
}

function editConflict(currentRevision: number) {
  return Response.json(
    {
      current_revision: currentRevision,
      error: {
        code: "edit_conflict",
        message: "The graph edit is based on a stale revision.",
      },
    },
    { status: 409 }
  );
}

function validateEditRequestMetadata(body: {
  base_revision?: number;
  request_id?: string;
}) {
  if (
    body.base_revision !== undefined &&
    (!Number.isInteger(body.base_revision) || body.base_revision < 0)
  ) {
    return apiError(
      "invalid_base_revision",
      "base_revision must be a non-negative integer.",
      400
    );
  }
  if (
    body.request_id !== undefined &&
    (typeof body.request_id !== "string" ||
      body.request_id.trim().length === 0 ||
      body.request_id.length > 120)
  ) {
    return apiError(
      "invalid_request_id",
      "request_id must be a non-empty string up to 120 characters.",
      400
    );
  }
  return null;
}

async function modelEditResponse(
  c: Context<{ Bindings: ProcessEnv; Variables: Variables }>,
  channelScope: ChannelScope,
  scope: { projectId: ProjectId; workflowId?: WorkflowId },
  edit: StoredGraphEdit
) {
  if (!scope.workflowId) {
    return apiError("unknown_workflow", "Unknown workflow_id.", 400);
  }
  const data = await readScopedData(c.env.DB, channelScope, scope.projectId);
  const effective = await readEffectiveWorkflow(
    c.env.DB,
    channelScope,
    scope.workflowId
  );
  if (!effective) {
    return apiError("unknown_workflow", "Unknown workflow_id.", 400);
  }
  const aggregate = buildAggregateForGraph({
    data,
    effectiveWorkflow: effective.workflow,
    kind: "overlay",
    mergedSlugs: effective.mergedSlugs,
    projectId: scope.projectId,
    workflowId: scope.workflowId,
  });
  const persisted = await persistGraphRevision(c.env.DB, {
    graph: aggregate,
    operationKey: `graph-edit:${edit.id}`,
    scope: {
      channel: channelScope.channel,
      kind: "overlay",
      minSupport: DEFAULT_MIN_SUPPORT,
      projectId: scope.projectId,
      workflowId: scope.workflowId,
      workspaceId: channelScope.workspaceId,
    },
  });
  const graph = buildGraphView({
    data,
    effectiveWorkflow: effective.workflow,
    kind: "overlay",
    mergedSlugs: effective.mergedSlugs,
    minSupport: DEFAULT_MIN_SUPPORT,
    projectId: scope.projectId,
    workflowId: scope.workflowId,
  });
  if ("response" in graph) {
    return graph.response;
  }
  await commitGraphJournal(
    c.env,
    c.env.DB,
    channelScope,
    graph,
    `graph-edit:${edit.id}`
  );
  const designed = buildGraphView({
    data: emptyScopedData(),
    effectiveWorkflow: effective.workflow,
    kind: "designed",
    mergedSlugs: effective.mergedSlugs,
    minSupport: DEFAULT_MIN_SUPPORT,
    projectId: scope.projectId,
    workflowId: scope.workflowId,
  });
  if ("response" in designed) {
    return designed.response;
  }
  return c.json({
    conformance: graph.conformance,
    designed: { ...designed, revision: persisted.revision },
    edit: toEditResponse(edit),
    graph: { ...graph, revision: persisted.revision },
    graph_revision: persisted.revision,
    revision: edit.revision,
  });
}

async function readEffectiveWorkflow(
  db: D1Database,
  scope: ChannelScope,
  workflowId: WorkflowId
) {
  const base = designedWorkflowInput(workflowId, loadKb());
  if (!base) {
    return null;
  }
  const edits = await readActiveDesignedGraphEdits(db, scope, workflowId);
  return applyDesignedGraphEdits(
    base,
    edits.map((edit) => ({
      action: edit.action as DesignedGraphEditAction,
      id: edit.id,
      payload: edit.payload as DesignedGraphEditPayload,
      revision: edit.revision,
      undone: edit.undone,
    }))
  );
}

function validateGraphEdit(input: {
  action?: string;
  aggregate: AggregateGraph;
  payload: unknown;
  workflow: DesignedWorkflowInput;
}):
  | { action: DesignedGraphEditAction; payload: Record<string, unknown> }
  | { response: Response } {
  const action = normalizeEditAction(input.action);
  if (!action) {
    return {
      response: apiError(
        "invalid_action",
        "Graph edit action is not supported.",
        400
      ),
    };
  }
  const payload = payloadObject(input.payload);
  if (!payload) {
    return {
      response: apiError(
        "invalid_payload",
        "Graph edit payload must be an object.",
        400
      ),
    };
  }
  const activities = new Map(
    input.workflow.activities.map((activity) => [activity.slug, activity])
  );
  const edges = new Set(
    (input.workflow.edges ?? []).map(
      (edge) =>
        `${edge.sourceActivitySlug ?? slugFromActivityId(edge.sourceActivityId)}\0${
          edge.targetActivitySlug ?? slugFromActivityId(edge.targetActivityId)
        }`
    )
  );

  switch (action) {
    case "add_node":
      return validateAddNodeEdit(input, payload, activities);
    case "merge_nodes":
      return validateMergeNodeEdit(payload, activities);
    case "remove_node":
      return validateRemoveNodeEdit(input, payload, activities);
    case "rename_node":
      return validateRenameNodeEdit(payload, activities);
    case "add_edge":
    case "remove_edge":
      return validateEdgeEdit(action, payload, activities, edges);
    default:
      return {
        response: apiError(
          "invalid_action",
          "Graph edit action is not supported.",
          400
        ),
      };
  }
}

function validateAddNodeEdit(
  input: { action?: string; aggregate: AggregateGraph },
  payload: Record<string, unknown>,
  activities: Map<string, DesignedWorkflowInput["activities"][number]>
) {
  const slug = stringPayload(payload, "slug");
  if (!validSlug(slug)) {
    return {
      response: apiError("invalid_slug", "Node slug is invalid.", 400),
    };
  }
  if (activities.has(slug)) {
    return {
      response: apiError("node_exists", "Designed node already exists.", 409),
    };
  }
  if (input.action === "promote") {
    const discovered = input.aggregate.nodes.find((node) => node.slug === slug);
    if (discovered?.plane !== "discovered") {
      return {
        response: apiError(
          "illegal_promote",
          "Only discovered-only nodes can be promoted.",
          400
        ),
      };
    }
    return {
      action: "add_node" as const,
      payload: {
        label: stringPayload(payload, "label") || discovered.label,
        role_expected: stringPayload(payload, "role_expected"),
        slug,
      },
    };
  }
  return {
    action: "add_node" as const,
    payload: {
      label: stringPayload(payload, "label") || humanizeSlug(slug),
      rank: numberPayload(payload, "rank"),
      role_expected: stringPayload(payload, "role_expected"),
      slug,
    },
  };
}

function validateRemoveNodeEdit(
  input: { action?: string; aggregate: AggregateGraph },
  payload: Record<string, unknown>,
  activities: Map<string, DesignedWorkflowInput["activities"][number]>
) {
  const slug = stringPayload(payload, "slug");
  const activity = activities.get(slug);
  if (!activity) {
    return {
      response: apiError("unknown_node", "Designed node was not found.", 404),
    };
  }
  if (input.action === "retire") {
    const node = input.aggregate.nodes.find((item) => item.slug === slug);
    if (node?.plane !== "designed") {
      return {
        response: apiError(
          "illegal_retire",
          "Only designed-only nodes can be retired.",
          400
        ),
      };
    }
  }
  const acknowledged = stringArrayPayload(payload, "acknowledged_policy_ids");
  const missingPolicies = (activity.policyIds ?? []).filter(
    (policyId) => !acknowledged.includes(policyId)
  );
  if (missingPolicies.length > 0) {
    return {
      response: Response.json(
        {
          error: {
            code: "policy_acknowledgement_required",
            message:
              "Retiring this node removes governed policy coverage; acknowledge the policy ids.",
          },
          policy_ids: missingPolicies,
        },
        { status: 400 }
      ),
    };
  }
  return {
    action: "remove_node" as const,
    payload: { acknowledged_policy_ids: acknowledged, slug },
  };
}

function validateRenameNodeEdit(
  payload: Record<string, unknown>,
  activities: Map<string, DesignedWorkflowInput["activities"][number]>
) {
  const slug = stringPayload(payload, "slug");
  const label = stringPayload(payload, "label");
  if (!activities.has(slug)) {
    return {
      response: apiError("unknown_node", "Designed node was not found.", 404),
    };
  }
  if (!(label && label.length <= 120)) {
    return {
      response: apiError(
        "invalid_label",
        "Node label must be 1 to 120 characters.",
        400
      ),
    };
  }
  return { action: "rename_node" as const, payload: { label, slug } };
}

function validateMergeNodeEdit(
  payload: Record<string, unknown>,
  activities: Map<string, DesignedWorkflowInput["activities"][number]>
) {
  const source = stringPayload(payload, "source_slug");
  const target = stringPayload(payload, "target_slug");
  if (
    !(activities.has(source) && activities.has(target)) ||
    source === target
  ) {
    return {
      response: apiError(
        "invalid_merge",
        "Merge requires two distinct designed nodes.",
        400
      ),
    };
  }
  return {
    action: "merge_nodes" as const,
    payload: {
      label: stringPayload(payload, "label"),
      source_slug: source,
      target_slug: target,
    },
  };
}

function validateEdgeEdit(
  action: "add_edge" | "remove_edge",
  payload: Record<string, unknown>,
  activities: Map<string, DesignedWorkflowInput["activities"][number]>,
  edges: Set<string>
) {
  const from = stringPayload(payload, "from_slug");
  const to = stringPayload(payload, "to_slug");
  if (!(activities.has(from) && activities.has(to)) || from === to) {
    return {
      response: apiError(
        "invalid_edge",
        "Edge edits require two distinct designed nodes.",
        400
      ),
    };
  }
  const edgeKey = `${from}\0${to}`;
  if (action === "add_edge") {
    if (edges.has(edgeKey)) {
      return {
        response: apiError("edge_exists", "Designed edge already exists.", 409),
      };
    }
    return {
      action,
      payload: {
        from_slug: from,
        probability: numberPayload(payload, "probability") ?? 1,
        to_slug: to,
      },
    };
  }
  if (!edges.has(edgeKey)) {
    return {
      response: apiError("unknown_edge", "Designed edge was not found.", 404),
    };
  }
  return { action, payload: { from_slug: from, to_slug: to } };
}

function normalizeEditAction(
  action: string | undefined
): DesignedGraphEditAction | null {
  if (!(action && GRAPH_EDIT_ACTIONS.has(action))) {
    return null;
  }
  switch (action) {
    case "merge":
      return "merge_nodes";
    case "promote":
      return "add_node";
    case "rename":
      return "rename_node";
    case "require":
      return "add_edge";
    case "retire":
      return "remove_node";
    default:
      return action as DesignedGraphEditAction;
  }
}

function payloadObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringPayload(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function numberPayload(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringArrayPayload(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function validSlug(slug: string) {
  return SLUG_PATTERN.test(slug) && slug.length <= 80;
}

function slugFromActivityId(id: string | undefined) {
  return id?.startsWith("act_") ? id.slice(4) : (id ?? "");
}

function toEditResponse(edit: StoredGraphEdit) {
  return {
    action: edit.action,
    actor: edit.actorId,
    base_revision: edit.baseRevision,
    created_at: edit.createdAt,
    id: edit.id,
    payload: edit.payload,
    request_id: edit.requestId,
    revision: edit.revision,
    target_edit_id: edit.targetEditId,
    undone: edit.undone,
    workflow: edit.workflowId,
  };
}

function routeContext(
  env: ProcessEnv,
  query: Record<string, string | undefined>
): ProcessContext | { response: Response } {
  const scope = configuredChannelScope(env);
  if (!scope) {
    return {
      response: apiError(
        "channel_unconfigured",
        "Channel coordination is not configured.",
        503
      ),
    };
  }
  const { channel, workspace_id: workspaceId } = query;
  if (
    (workspaceId && workspaceId !== scope.workspaceId) ||
    (channel && channel !== scope.channel)
  ) {
    return {
      response: apiError(
        "forbidden_scope",
        "Requested workspace or channel is not authorized.",
        403
      ),
    };
  }
  return { scope };
}

function getProcessContext(c: {
  get: (key: "processContext") => ProcessContext;
}) {
  return c.get("processContext");
}

export function resolveScope(
  query: Record<string, string | undefined>,
  kb: AuthoredKb,
  options: { requireWorkflow?: boolean } = {}
): { projectId: ProjectId; workflowId?: WorkflowId } | { response: Response } {
  const projectId = query.project_id ?? DEFAULT_PROJECT_ID;
  const project = kb.projects.find((item) => item.id === projectId);
  if (!project) {
    return {
      response: apiError("unknown_project", "Unknown project_id.", 400),
    };
  }
  const workflowId = query.workflow_id ?? project.workflow_id;
  const workflow = kb.workflows.find((item) => item.id === workflowId);
  if (options.requireWorkflow && !workflow) {
    return {
      response: apiError("unknown_workflow", "Unknown workflow_id.", 400),
    };
  }
  if (workflow?.project_id && workflow.project_id !== project.id) {
    return {
      response: apiError(
        "scope_mismatch",
        "workflow_id does not belong to project_id.",
        400
      ),
    };
  }
  return {
    projectId: project.id as ProjectId,
    ...(workflow ? { workflowId: workflow.id as WorkflowId } : {}),
  };
}

function readLimit(
  value: string | undefined,
  options: { defaultValue: number; maximum: number; name: string }
): number | { response: Response } {
  if (value === undefined || value === "") {
    return options.defaultValue;
  }
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(value)) {
    return {
      response: apiError(
        "invalid_limit",
        `${options.name} must be a non-negative integer.`,
        400
      ),
    };
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed > options.maximum) {
    return {
      response: apiError(
        "invalid_limit",
        `${options.name} must be at most ${options.maximum}.`,
        400
      ),
    };
  }
  return parsed;
}

function requestedView(value: string | undefined) {
  return value === "designed" ||
    value === "discovered" ||
    value === "instance" ||
    value === "overlay"
    ? value
    : "overlay";
}

async function readJson<T>(
  request: Request
): Promise<T | { response: Response }> {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {
        response: apiError(
          "invalid_json",
          "Request body must be an object.",
          400
        ),
      };
    }
    return body as T;
  } catch {
    return {
      response: apiError(
        "invalid_json",
        "Request body must be valid JSON.",
        400
      ),
    };
  }
}

function isSafeId(value: string) {
  return ID_PATTERN.test(value);
}

export interface ScopedData {
  messages: Message[];
  sessions: ProcessSession[];
  steps: Step[];
}

function emptyScopedData(): ScopedData {
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

async function readSession(
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

async function readSteps(
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

function buildAggregateForGraph(input: {
  data: ScopedData;
  effectiveWorkflow?: DesignedWorkflowInput;
  kind?: GraphView["kind"];
  mergedSlugs?: Record<string, string>;
  projectId: ProjectId;
  sessionId?: string;
  workflowId?: WorkflowId;
}): AggregateGraph {
  const kb = loadKb();
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
  kb: AuthoredKb
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

function buildSessionConformance(
  data: ScopedData,
  workflowId: WorkflowId | undefined,
  effectiveWorkflow?: DesignedWorkflowInput,
  mergedSlugs?: Record<string, string>
): SessionConformance[] {
  if (!workflowId) {
    return [];
  }
  const workflow =
    effectiveWorkflow ?? designedWorkflowInput(workflowId, loadKb());
  if (!workflow) {
    return [];
  }
  return runConformance(data, workflowId, workflow, mergedSlugs).sessions.map(
    (session) => ({
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
    })
  );
}

function buildWorkflowConformance(
  data: ScopedData,
  workflowId: WorkflowId | undefined,
  effectiveWorkflow?: DesignedWorkflowInput,
  mergedSlugs?: Record<string, string>
): WorkflowConformance | null {
  if (!workflowId) {
    return null;
  }
  const result = runConformance(
    data,
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
  workflowId: WorkflowId,
  effectiveWorkflow?: DesignedWorkflowInput,
  mergedSlugs: Record<string, string> = {}
) {
  const kb = loadKb();
  const workflow = kb.workflows.find((item) => item.id === workflowId);
  const designed = effectiveWorkflow ?? designedWorkflowInput(workflowId, kb);
  if (!(designed || workflow)) {
    return scoreConformance(emptyConformanceInput(workflowId));
  }
  return scoreConformance({
    artifacts: kb.artifacts.map((artifact) => ({
      id: artifact.id,
      projectId: artifact.project_id,
      unit: artifact.value?.unit ?? null,
      value: artifact.value?.amount ?? null,
    })),
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

interface ConformanceRecalculationInput {
  projectId: ProjectId;
  requestId?: string;
  sessionId?: ProcessSession["id"];
  source: "curation" | "graph";
  workflowId: WorkflowId;
}

interface ConformanceRecalculationResult {
  session: SessionConformance | null;
  sessions: SessionConformance[];
  workflow: WorkflowConformance;
}

async function recalculateScopedConformance(
  env: ProcessEnv,
  db: D1Database,
  scope: ChannelScope,
  input: ConformanceRecalculationInput
): Promise<ConformanceRecalculationResult | null> {
  const data = workflowScopedData(
    await readScopedData(db, scope, input.projectId),
    input.workflowId
  );
  const sessions = buildSessionConformance(data, input.workflowId);
  const workflow = buildWorkflowConformance(data, input.workflowId);
  if (!workflow) {
    return null;
  }
  const affectedSession = input.sessionId
    ? (sessions.find((session) => session.session_id === input.sessionId) ??
      null)
    : null;
  if (affectedSession) {
    await persistSessionConformanceSummary(db, affectedSession);
  }
  await publishConformanceEvents(env, db, scope, input, {
    session: affectedSession,
    workflow,
  });
  return {
    session: affectedSession,
    sessions,
    workflow,
  };
}

function workflowScopedData(
  data: ScopedData,
  workflowId: WorkflowId
): ScopedData {
  const sessionIds = new Set(
    data.sessions
      .filter((session) => session.workflow_id === workflowId)
      .map((session) => session.id)
  );
  return {
    messages: data.messages.filter((message) =>
      sessionIds.has(message.session_id)
    ),
    sessions: data.sessions.filter((session) => sessionIds.has(session.id)),
    steps: data.steps.filter((step) => sessionIds.has(step.session_id)),
  };
}

async function persistSessionConformanceSummary(
  db: D1Database,
  conformance: SessionConformance
) {
  await db
    .prepare(
      `UPDATE pm_session
       SET fitness = ?, missing_json = ?, extra_json = ?, violations_json = ?
       WHERE id = ?`
    )
    .bind(
      conformance.fitness,
      JSON.stringify(conformance.missing.map((item) => item.slug)),
      JSON.stringify(conformance.extra.map((item) => item.slug)),
      JSON.stringify(
        conformance.violations.map((violation) => violation.policy_id)
      ),
      conformance.session_id
    )
    .run();
}

async function publishConformanceEvents(
  env: ProcessEnv,
  db: D1Database,
  scope: ChannelScope,
  input: ConformanceRecalculationInput,
  conformance: {
    session: SessionConformance | null;
    workflow: WorkflowConformance;
  }
) {
  const requestKey = input.requestId ?? crypto.randomUUID();
  const entries: JournalWrite[] = [
    ...(conformance.session
      ? [
          {
            kind: "conformance",
            opKey: `${input.source}:conformance:${requestKey}:session:${conformance.session.session_id}`,
            payload: conformance.session,
            projectId: input.projectId,
            sessionId: conformance.session.session_id,
          } satisfies JournalWrite,
        ]
      : []),
    {
      kind: "conformance",
      opKey: `${input.source}:conformance:${requestKey}:workflow:${input.workflowId}`,
      payload: conformance.workflow,
      projectId: input.projectId,
    },
  ];
  for (const entry of entries) {
    // biome-ignore lint/performance/noAwaitInLoops: journal order matters for SSE clients.
    await publishProcessJournal(env, db, scope, entry);
  }
}

async function commitCurationJournal(
  env: ProcessEnv,
  db: D1Database,
  scope: ChannelScope,
  step: Step,
  requestId: string | undefined
) {
  const session = await readSession(db, scope, step.session_id);
  if (!session) {
    return;
  }
  await publishProcessJournal(env, db, scope, {
    kind: "step",
    opKey: `curation:${requestId ?? crypto.randomUUID()}`,
    payload: step,
    projectId: session.project_id,
    sessionId: session.id,
  });
}

async function commitGraphJournal(
  env: ProcessEnv,
  db: D1Database,
  scope: ChannelScope,
  graph: GraphView,
  requestId: string | undefined
) {
  await publishProcessJournal(env, db, scope, {
    kind: "graph_delta",
    opKey: `rebuild:${requestId ?? crypto.randomUUID()}`,
    payload: {
      base_revision: graph.revision,
      conformance: graph.conformance,
      edges_added: graph.edges,
      edges_removed: [],
      edges_updated: [],
      nodes_added: graph.nodes,
      nodes_removed: [],
      nodes_updated: [],
      replace: true,
      revision: graph.revision,
      view_key: graph.key,
    },
    projectId: graph.project_id,
  });
}

async function publishProcessJournal(
  env: ProcessEnv,
  db: D1Database,
  scope: ChannelScope,
  entry: JournalWrite
) {
  const committed = await commitJournalEntry(db, scope, entry);
  if (!(committed.inserted && committed.envelope)) {
    return committed.envelope;
  }
  const params = new URLSearchParams();
  params.set("project_id", entry.projectId);
  params.set("journal_id", String(committed.envelope.id));
  if (entry.sessionId) {
    params.set("session_id", entry.sessionId);
  }
  await coordinatorFetch(env, scope, "/broadcast", {
    method: "POST",
    params,
  });
  return committed.envelope;
}

async function controlSimulation(
  c: Context<{ Bindings: ProcessEnv; Variables: Variables }>,
  path: "/pause" | "/resume"
) {
  const context = getProcessContext(c);
  const body = await readJson<{ project_id?: string; session_id?: string }>(
    c.req.raw
  );
  if ("response" in body) {
    return body.response;
  }
  if (!(body.session_id && isSafeId(body.session_id))) {
    return apiError("invalid_session_id", "session_id is required.", 400);
  }
  const params = new URLSearchParams();
  params.set("project_id", body.project_id ?? DEFAULT_PROJECT_ID);
  params.set("session_id", body.session_id);
  const response = await coordinatorFetch(c.env, context.scope, path, {
    method: "POST",
    params,
  });
  if (!response) {
    return apiError(
      "coordinator_unavailable",
      "Channel coordinator is not bound.",
      503
    );
  }
  return response;
}

function toKnowledgeBase(kb: AuthoredKb): KnowledgeBase {
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
    artifact_lifecycles: kb.artifactLifecycles.map((lifecycle) => ({
      artifact_type: lifecycle.type,
      states:
        lifecycle.states as KnowledgeBase["artifact_lifecycles"][number]["states"],
      transitions: [],
    })),
    artifacts: kb.artifacts.map((artifact) => ({
      current_state:
        artifact.lifecycle_state as KnowledgeBase["artifacts"][number]["current_state"],
      id: artifact.id as KnowledgeBase["artifacts"][number]["id"],
      name: artifact.name,
      project_id: artifact.project_id as ProjectId,
      type: artifact.type,
      ...(artifact.uri ? { uri: artifact.uri } : {}),
      ...(artifact.value
        ? { unit: artifact.value.unit, value: artifact.value.amount }
        : {}),
    })),
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
    roles: [...new Set(kb.people.map((person) => person.role))].map((role) => ({
      id: role as RoleId,
      name: humanizeSlug(role),
    })),
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

function uniqueActivities(kb: AuthoredKb): Activity[] {
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

function humanizeSlug(slug: string) {
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
