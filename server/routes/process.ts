// Process API.
//
// Every route is scoped to the caller's Slack workspace and to a channel that
// workspace has enabled, and every project/workflow is validated against the
// definitions that workspace authored. There is no server-wide default scope and
// no simulator: the only data these routes can return is real observed Slack work.

import { type Context, Hono } from "hono";
import type {
  CurationStatus,
  GraphView,
  ProjectId,
  SessionConformance,
  Snapshot,
  Step,
  WorkflowConformance,
  WorkflowId,
} from "../../shared/contracts.ts";
import type {
  AggregateGraph,
  DesignedWorkflowInput,
} from "../../shared/mining/graph.ts";
import {
  applyDesignedGraphEdits,
  type DesignedGraphEditAction,
  type DesignedGraphEditPayload,
} from "../../shared/model-edits.ts";
import { persistGraphRevision } from "../graph-persistence.ts";
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
  apiError,
  buildAggregateForGraph,
  buildGraphView,
  buildSessionConformance,
  buildWorkflowConformance,
  type ConformanceRecalculationInput,
  type ConformanceRecalculationResult,
  DEFAULT_MIN_SUPPORT,
  designedWorkflowInput,
  emptyScopedData,
  humanizeSlug,
  MAX_PAGE_LIMIT,
  readEvidenceMessages,
  readMessages,
  readScopedData,
  readSession,
  readStep,
  type ScopedData,
  toKnowledgeBase,
} from "../process-data.ts";
import {
  type ChannelCoordinatorEnv,
  type ChannelScope,
  commitJournalEntry,
  coordinatorFetch,
  currentJournalCursor,
  type JournalWrite,
} from "../runtime/channel.ts";
import { listEnabledChannels } from "../tenant/installs.ts";
import { readTenantKb, type TenantKb } from "../tenant/kb.ts";

type ProcessEnv = ChannelCoordinatorEnv & {
  DB: D1Database;
};

interface Variables {
  processContext: ProcessContext;
  userId: string;
  workspaceId: string;
}

/**
 * A request's resolved tenant scope: the caller's workspace, the observed channel
 * being read, and that workspace's authored definitions.
 */
interface ProcessContext {
  kb: TenantKb;
  projectId: string;
  scope: ChannelScope;
  workflowId: string | null;
}

const ID_PATTERN = /^[a-z][a-z0-9_:-]*$/;
const SLUG_PATTERN = /^[a-z][a-z0-9_]*$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;
const CURATION_STATUSES = new Set<CurationStatus>(["confirmed", "rejected"]);
// Canvas-facing aliases plus the underlying designed-graph actions. "reject" and
// "retire" both remove a node: rejecting discards a discovered activity the miner
// proposed, retiring removes one the workspace had designed. The effect on the
// designed plane is the same.
const GRAPH_EDIT_ACTIONS = new Set([
  "add_edge",
  "add_node",
  "merge",
  "merge_nodes",
  "promote",
  "reject",
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
  const workspaceId = c.get("workspaceId");
  if (!workspaceId) {
    return apiError(
      "workspace_unresolved",
      "Sign in with Slack so Ariadne knows which workspace to read.",
      401
    );
  }
  const context = await resolveProcessContext(
    c.env.DB,
    workspaceId,
    c.req.query()
  );
  if ("response" in context) {
    return context.response;
  }
  c.set("processContext", context);
  return await next();
});

/**
 * Resolves the channel and project a request reads.
 *
 * The channel comes from the workspace's enabled channels, never from a query
 * parameter, so a caller cannot read a channel their workspace has not opted in to
 * observing. The project must be one the workspace authored.
 */
async function resolveProcessContext(
  db: D1Database,
  workspaceId: string,
  query: Record<string, string | undefined>
): Promise<ProcessContext | { response: Response }> {
  const channels = await listEnabledChannels(db);
  const scoped = channels.filter(
    (observed) => observed.workspace_id === workspaceId
  );
  if (scoped.length === 0) {
    return {
      response: apiError(
        "no_observed_channel",
        "No Slack channel is being observed yet. Finish setup to connect one.",
        409
      ),
    };
  }
  const requestedChannel = query.channel_id;
  const channel = requestedChannel
    ? scoped.find((item) => item.channel_id === requestedChannel)
    : scoped[0];
  if (!channel?.project_id) {
    return {
      response: apiError(
        "unknown_channel",
        "That channel is not being observed by this workspace.",
        404
      ),
    };
  }
  const kb = await readTenantKb(db, workspaceId);
  const projectId = query.project_id ?? channel.project_id;
  const project = kb.projects.find((item) => item.id === projectId);
  if (!project) {
    return {
      response: apiError("unknown_project", "Unknown project_id.", 400),
    };
  }
  const workflowId = query.workflow_id ?? project.workflow_id;
  const workflow = kb.workflows.find((item) => item.id === workflowId);
  if (workflow && workflow.project_id !== project.id) {
    return {
      response: apiError(
        "scope_mismatch",
        "workflow_id does not belong to project_id.",
        400
      ),
    };
  }
  return {
    kb,
    projectId: project.id,
    scope: {
      channel: channel.channel_id,
      workspaceId,
    },
    workflowId: workflow?.id ?? null,
  };
}

processRoutes.get("/kb", (c) => {
  const context = getProcessContext(c);
  return c.json({ kb: toKnowledgeBase(context.kb) });
});

processRoutes.get("/model/edits", async (c) => {
  const context = getProcessContext(c);
  const scope = scopeWithin(
    context,
    {
      project_id: c.req.query("project_id"),
      workflow_id: c.req.query("workflow_id") ?? c.req.query("workflow"),
    },
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
  const scope = scopeWithin(
    context,
    {
      project_id: body.project_id,
      workflow_id: body.workflow_id ?? body.workflow,
    },
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
      duplicate,
      context.kb
    );
  }
  const current = await readEffectiveWorkflow(
    c.env.DB,
    context.scope,
    workflowId,
    context.kb
  );
  if (!current) {
    return apiError("unknown_workflow", "Unknown workflow_id.", 400);
  }
  const data = await readScopedData(c.env.DB, context.scope, scope.projectId);
  const aggregate = buildAggregateForGraph({
    data,
    effectiveWorkflow: current.workflow,
    kb: context.kb,
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
    result.edit,
    context.kb
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
  const scope = scopeWithin(
    context,
    {
      project_id: body.project_id,
      workflow_id: body.workflow_id ?? body.workflow,
    },
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
    result.edit,
    context.kb
  );
});

processRoutes.get("/snapshot", async (c) => {
  const context = getProcessContext(c);
  const scope = scopeWithin(context, c.req.query());
  if ("response" in scope) {
    return scope.response;
  }
  const data = await readScopedData(c.env.DB, context.scope, scope.projectId);
  const effective = scope.workflowId
    ? await readEffectiveWorkflow(
        c.env.DB,
        context.scope,
        scope.workflowId,
        context.kb
      )
    : null;
  const graph = buildGraphView({
    data,
    effectiveWorkflow: effective?.workflow,
    kb: context.kb,
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
      context.kb,
      scope.workflowId,
      effective?.workflow,
      effective?.mergedSlugs
    ),
    cursor: await currentJournalCursor(c.env.DB, context.scope),
    graph,
    kb: toKnowledgeBase(context.kb),
    messages: data.messages,
    pipeline_events: [],
    sessions: data.sessions,
    steps: data.steps,
  };
  return c.json(snapshot);
});

processRoutes.get("/graph/designed", async (c) => {
  const context = getProcessContext(c);
  const scope = scopeWithin(context, c.req.query(), { requireWorkflow: true });
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
    workflowId,
    context.kb
  );
  const data = emptyScopedData();
  return c.json(
    buildGraphView({
      data,
      effectiveWorkflow: effective?.workflow,
      kb: context.kb,
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
  const scope = scopeWithin(context, c.req.query());
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
    kb: context.kb,
    kind: "discovered",
    minSupport,
    projectId: scope.projectId,
    workflowId: scope.workflowId,
  });
  return "response" in graph ? graph.response : c.json(graph);
});

processRoutes.get("/graph/overlay", async (c) => {
  const context = getProcessContext(c);
  const scope = scopeWithin(context, c.req.query(), { requireWorkflow: true });
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
    workflowId,
    context.kb
  );
  const graph = buildGraphView({
    data,
    effectiveWorkflow: effective?.workflow,
    kb: context.kb,
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
  const scope = scopeWithin(context, c.req.query());
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
    ? await readEffectiveWorkflow(
        c.env.DB,
        context.scope,
        session.workflow_id,
        context.kb
      )
    : null;
  return c.json({
    conformance: buildSessionConformance(
      data,
      context.kb,
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
    ? await readEffectiveWorkflow(
        c.env.DB,
        context.scope,
        session.workflow_id,
        context.kb
      )
    : null;
  const graph = buildGraphView({
    data,
    effectiveWorkflow: effective?.workflow,
    kb: context.kb,
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
    ? await recalculateScopedConformance(
        c.env,
        c.env.DB,
        context.scope,
        {
          projectId: session.project_id,
          requestId: body.request_id,
          sessionId: updated.session_id,
          source: "curation",
          workflowId: session.workflow_id,
        },
        context.kb
      )
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
  const scope = scopeWithin(context, {
    project_id: body.project_id,
    workflow_id: body.workflow_id,
  });
  if ("response" in scope) {
    return scope.response;
  }
  const data = await readScopedData(c.env.DB, context.scope, scope.projectId);
  const effective = scope.workflowId
    ? await readEffectiveWorkflow(
        c.env.DB,
        context.scope,
        scope.workflowId,
        context.kb
      )
    : null;
  const graph = buildGraphView({
    data,
    effectiveWorkflow: effective?.workflow,
    kb: context.kb,
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
    ? await recalculateScopedConformance(
        c.env,
        c.env.DB,
        context.scope,
        {
          projectId: scope.projectId,
          requestId: body.request_id,
          source: "graph",
          workflowId: scope.workflowId,
        },
        context.kb
      )
    : null;
  return c.json({ conformance, graph });
});

processRoutes.get("/stream", async (c) => {
  const context = getProcessContext(c);
  const scope = scopeWithin(context, c.req.query());
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
  edit: StoredGraphEdit,
  kb: TenantKb
) {
  if (!scope.workflowId) {
    return apiError("unknown_workflow", "Unknown workflow_id.", 400);
  }
  const data = await readScopedData(c.env.DB, channelScope, scope.projectId);
  const effective = await readEffectiveWorkflow(
    c.env.DB,
    channelScope,
    scope.workflowId,
    kb
  );
  if (!effective) {
    return apiError("unknown_workflow", "Unknown workflow_id.", 400);
  }
  const aggregate = buildAggregateForGraph({
    data,
    effectiveWorkflow: effective.workflow,
    kb,
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
    kb,
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
    kb,
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
  workflowId: WorkflowId,
  kb: TenantKb
) {
  const base = designedWorkflowInput(workflowId, kb);
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
    case "reject":
      return "remove_node";
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

function getProcessContext(c: {
  get: (key: "processContext") => ProcessContext;
}) {
  return c.get("processContext");
}

/**
 * Narrows the request's resolved scope with per-request project/workflow
 * overrides, validated against the same workspace-authored definitions the
 * middleware loaded. A request can only move within its own workspace.
 */
export function scopeWithin(
  context: ProcessContext,
  overrides: { project_id?: string; workflow_id?: string },
  options: { requireWorkflow?: boolean } = {}
): { projectId: ProjectId; workflowId?: WorkflowId } | { response: Response } {
  const projectId = overrides.project_id ?? context.projectId;
  const project = context.kb.projects.find((item) => item.id === projectId);
  if (!project) {
    return {
      response: apiError("unknown_project", "Unknown project_id.", 400),
    };
  }
  const workflowId =
    overrides.workflow_id ??
    (projectId === context.projectId ? context.workflowId : null) ??
    project.workflow_id;
  const workflow = context.kb.workflows.find((item) => item.id === workflowId);
  if (options.requireWorkflow && !workflow) {
    return {
      response: apiError(
        "unknown_workflow",
        "This workspace has not authored that workflow.",
        400
      ),
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

async function recalculateScopedConformance(
  env: ProcessEnv,
  db: D1Database,
  scope: ChannelScope,
  input: ConformanceRecalculationInput,
  kb: TenantKb
): Promise<ConformanceRecalculationResult | null> {
  const data = workflowScopedData(
    await readScopedData(db, scope, input.projectId),
    input.workflowId
  );
  const sessions = buildSessionConformance(data, kb, input.workflowId);
  const workflow = buildWorkflowConformance(data, kb, input.workflowId);
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
