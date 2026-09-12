import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type {
  Citation,
  GraphEdge,
  GraphView,
  Message,
  ProjectId,
  Step,
  WorkflowId,
} from "../../../shared/contracts.ts";
import { type AuthoredKb, activityId, loadKb } from "../../kb.ts";
import { extract } from "../../mining/extract.ts";
import type {
  ExtractedStep,
  ActivityId as ExtractionActivityId,
  ArtifactId as ExtractionArtifactId,
  ExtractionContext,
  PersonId as ExtractionPersonId,
  RoleId as ExtractionRoleId,
  NormalizedObservation,
} from "../../mining/types.ts";
import {
  createOpenRouterModelAdapter,
  type ModelAdapter,
  type ModelEnv,
} from "../../models.ts";
import {
  buildGraphView,
  readEvidenceMessages,
  readMessages,
  readScopedData,
  resolveScope,
  type ScopedData,
} from "../../routes/process.ts";
import {
  type ChannelCoordinatorEnv,
  configuredChannelScope,
  coordinatorFetch,
} from "../../runtime/channel.ts";

export interface AgentToolEnv extends ChannelCoordinatorEnv, ModelEnv {
  AGENT_ENABLED?: string;
  DB: D1Database;
  SLACK_BOT_TOKEN?: string;
}

export interface AgentToolRequestContext {
  actorId?: string;
  env: AgentToolEnv;
  model?: ModelAdapter;
  now?: () => string;
}

interface ToolContext {
  abortSignal?: AbortSignal;
  requestContext?: unknown;
}

const DEFAULT_PROJECT_ID = "proj_helios";
const ACTIVITY_ID_PREFIX_PATTERN = /^act_/;
const JSON_OBJECT_SCHEMA = z.record(z.string(), z.unknown());
const GRAPH_VIEW_SCHEMA = z
  .enum(["designed", "discovered", "instance", "overlay"])
  .default("overlay");
const PROPOSAL_ACTION_SCHEMA = z.enum([
  "confirm",
  "merge",
  "promote",
  "reject",
  "rename",
  "require",
  "retire",
]);

const scopedInput = {
  channel: z.string().min(1).optional(),
  project_id: z.string().min(1).optional(),
  workflow_id: z.string().min(1).optional(),
  workspace_id: z.string().min(1).optional(),
};

export const queryProcessGraphInputSchema = z.object({
  ...scopedInput,
  min_support: z.number().int().min(0).max(50).optional(),
  session_id: z.string().min(1).optional(),
  view: GRAPH_VIEW_SCHEMA.optional(),
});

export const getEvidenceInputSchema = z
  .object({
    ...scopedInput,
    edge_id: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(20).default(5).optional(),
    node_id: z.string().min(1).optional(),
    session_id: z.string().min(1).optional(),
    step_id: z.string().min(1).optional(),
  })
  .refine((input) => input.edge_id || input.node_id || input.step_id, {
    message: "Provide edge_id, node_id, or step_id.",
  });

export const searchWorkspaceInputSchema = z.object({
  ...scopedInput,
  limit: z.number().int().min(1).max(20).default(8).optional(),
  query: z.string().min(1).max(160),
});

export const lookupKnowledgeBaseInputSchema = z.object({
  ...scopedInput,
  kinds: z
    .array(
      z.enum([
        "activity",
        "artifact",
        "person",
        "policy",
        "project",
        "role",
        "workflow",
      ])
    )
    .max(7)
    .optional(),
  limit: z.number().int().min(1).max(30).default(10).optional(),
  query: z.string().min(1).max(160),
});

export const triggerExtractionInputSchema = z.object({
  ...scopedInput,
  limit: z.number().int().min(1).max(20).default(8).optional(),
  session_id: z.string().min(1),
});

export const proposeEditInputSchema = z.object({
  ...scopedInput,
  action: PROPOSAL_ACTION_SCHEMA,
  payload: JSON_OBJECT_SCHEMA,
  rationale: z.string().min(1).max(1200),
  request_id: z.string().min(1).max(160).optional(),
});

export const recordAgentEventInputSchema = z.object({
  ...scopedInput,
  citations: z.array(JSON_OBJECT_SCHEMA).max(20).default([]).optional(),
  kind: z.enum(["answer", "drift", "playbook", "slack_post"]),
  nodes: z.array(z.string().min(1)).max(30).default([]).optional(),
  pauses: z.boolean().default(false).optional(),
  payload: JSON_OBJECT_SCHEMA.default({}).optional(),
  request_id: z.string().min(1).max(160).optional(),
  session_id: z.string().min(1).optional(),
  text: z.string().min(1).max(4000),
});

export const postToSlackInputSchema = z.object({
  ...scopedInput,
  kind: z.enum(["answer", "drift", "playbook"]).default("answer").optional(),
  request_id: z.string().min(1).max(160).optional(),
  text: z.string().min(1).max(3000),
  thread_ts: z.string().min(1).optional(),
});

export const pauseRunInputSchema = z.object({
  ...scopedInput,
  reason: z.string().min(1).max(1000),
  session_id: z.string().min(1),
});

export const resumeRunInputSchema = z.object({
  ...scopedInput,
  session_id: z.string().min(1),
});

export type QueryProcessGraphInput = z.infer<
  typeof queryProcessGraphInputSchema
>;
export type GetEvidenceInput = z.infer<typeof getEvidenceInputSchema>;
export type LookupKnowledgeBaseInput = z.infer<
  typeof lookupKnowledgeBaseInputSchema
>;
export type TriggerExtractionInput = z.infer<
  typeof triggerExtractionInputSchema
>;
export type ProposeEditInput = z.infer<typeof proposeEditInputSchema>;
export type RecordAgentEventInput = z.infer<typeof recordAgentEventInputSchema>;
export type PostToSlackInput = z.infer<typeof postToSlackInputSchema>;
export type PauseRunInput = z.infer<typeof pauseRunInputSchema>;
export type ResumeRunInput = z.infer<typeof resumeRunInputSchema>;

export class AgentToolError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.code = code;
    this.name = "AgentToolError";
    this.status = status;
  }
}

export async function queryProcessGraph(
  rawInput: QueryProcessGraphInput,
  requestContext: AgentToolRequestContext
) {
  const input = queryProcessGraphInputSchema.parse(rawInput);
  const { projectId, scope, workflowId } = resolveToolScope(
    requestContext.env,
    input
  );
  const data = await readScopedData(requestContext.env.DB, scope, projectId, {
    ...(input.session_id ? { sessionId: input.session_id } : {}),
  });
  const graph = await graphOrThrow(
    buildGraphView({
      data,
      kind: input.view ?? "overlay",
      minSupport: input.min_support ?? 1,
      projectId,
      ...(input.session_id ? { sessionId: input.session_id } : {}),
      ...(workflowId ? { workflowId } : {}),
    })
  );
  return {
    conformance: graph.conformance,
    edges: graph.edges,
    generated_at: graph.generated_at,
    min_support: graph.min_support,
    nodes: graph.nodes,
    planes: planesInGraph(graph),
    project_id: graph.project_id,
    revision: graph.revision,
    workflow_id: graph.workflow_id ?? null,
  };
}

export async function getEvidence(
  rawInput: GetEvidenceInput,
  requestContext: AgentToolRequestContext
) {
  const input = getEvidenceInputSchema.parse(rawInput);
  const { projectId, scope, workflowId } = resolveToolScope(
    requestContext.env,
    input
  );

  if (input.step_id) {
    const evidenceMessages = await readEvidenceMessages(
      requestContext.env.DB,
      scope,
      input.step_id
    );
    return {
      messages: evidenceMessages.slice(0, input.limit ?? 5),
    };
  }

  const data = await readScopedData(requestContext.env.DB, scope, projectId, {
    ...(input.session_id ? { sessionId: input.session_id } : {}),
  });
  const messagesByTs = new Map(
    data.messages.map((message) => [message.ts, message])
  );
  const evidenceTs =
    input.node_id === undefined
      ? evidenceForEdge(
          data.steps,
          await edgeForId(data, projectId, workflowId, input)
        )
      : evidenceForNode(data.steps, input.node_id);
  const messages = uniqueStrings(evidenceTs)
    .map((ts) => messagesByTs.get(ts))
    .filter((message): message is Message => Boolean(message))
    .slice(0, input.limit ?? 5);
  return { messages };
}

export async function searchWorkspace(
  rawInput: z.infer<typeof searchWorkspaceInputSchema>,
  requestContext: AgentToolRequestContext
) {
  const input = searchWorkspaceInputSchema.parse(rawInput);
  const { projectId, scope } = resolveToolScope(requestContext.env, input);
  const limit = input.limit ?? 8;
  const query = normalizedQuery(input.query);
  const kb = loadKb();
  const data = await readScopedData(requestContext.env.DB, scope, projectId);
  const people = kb.people
    .filter((person) =>
      searchable([person.id, person.name, person.role], query)
    )
    .slice(0, limit);
  const artifacts = kb.artifacts
    .filter((artifact) =>
      searchable([artifact.id, artifact.name, artifact.type], query)
    )
    .slice(0, limit);
  const activities = kb.workflows
    .flatMap((workflow) =>
      workflow.activities.map((activity) => ({
        ...activity,
        workflow_id: workflow.id,
      }))
    )
    .filter((activity) =>
      searchable(
        [activity.slug, activity.label, activity.role, ...activity.synonyms],
        query
      )
    )
    .slice(0, limit);
  const cases = data.sessions
    .filter((session) =>
      searchable(
        [
          session.id,
          session.workflow_id ?? "",
          session.variant ?? "",
          ...session.extra,
          ...session.missing,
        ],
        query
      )
    )
    .slice(0, limit);
  return { activities, artifacts, cases, people };
}

interface KbMatch {
  id: string;
  kind: string;
  label: string;
  record: unknown;
}

type KbLookupKind = NonNullable<LookupKnowledgeBaseInput["kinds"]>[number];

export function lookupKnowledgeBase(
  rawInput: LookupKnowledgeBaseInput,
  requestContext: AgentToolRequestContext
) {
  const input = lookupKnowledgeBaseInputSchema.parse(rawInput);
  resolveToolScope(requestContext.env, input);
  const query = normalizedQuery(input.query);
  const limit = input.limit ?? 10;
  const kinds = new Set(input.kinds ?? []);
  const kb = loadKb();
  const include = (kind: KbLookupKind) => kinds.size === 0 || kinds.has(kind);
  const matches: KbMatch[] = [];

  addKbMatches(matches, "person", include, kb.people, query, (person) => ({
    fields: [person.id, person.name, person.role],
    id: person.id,
    label: person.name,
    record: person,
  }));
  addKbMatches(
    matches,
    "artifact",
    include,
    kb.artifacts,
    query,
    (artifact) => ({
      fields: [artifact.id, artifact.name, artifact.type],
      id: artifact.id,
      label: artifact.name,
      record: artifact,
    })
  );
  addKbMatches(matches, "policy", include, kb.policies, query, (policy) => ({
    fields: [policy.id, policy.text, policy.kind],
    id: policy.id,
    label: policy.text,
    record: policy,
  }));
  addKbMatches(matches, "project", include, kb.projects, query, (project) => ({
    fields: [project.id, project.name, project.summary],
    id: project.id,
    label: project.name,
    record: project,
  }));
  addKbMatches(
    matches,
    "workflow",
    include,
    kb.workflows,
    query,
    (workflow) => ({
      fields: [workflow.id, workflow.name],
      id: workflow.id,
      label: workflow.name,
      record: workflow,
    })
  );
  addKbMatches(
    matches,
    "activity",
    include,
    kb.workflows.flatMap((workflow) =>
      workflow.activities.map((activity) => ({ ...activity, workflow }))
    ),
    query,
    (entry) => ({
      fields: [
        entry.slug,
        entry.label,
        entry.role,
        ...entry.synonyms,
        entry.workflow.id,
      ],
      id: activityId(entry.slug),
      label: entry.label,
      record: { ...entry, workflow_id: entry.workflow.id },
    })
  );

  return { matches: matches.slice(0, limit) };
}

export async function triggerExtraction(
  rawInput: TriggerExtractionInput,
  requestContext: AgentToolRequestContext
) {
  const input = triggerExtractionInputSchema.parse(rawInput);
  if (!isAgentEnabled(requestContext.env)) {
    return {
      degraded: false,
      modelCalls: 0,
      status: "disabled",
      steps: [],
      warnings: ["agent.disabled"],
    };
  }
  const { projectId, scope, workflowId } = resolveToolScope(
    requestContext.env,
    input,
    { requireWorkflow: true }
  );
  const [messages, data] = await Promise.all([
    readMessages(requestContext.env.DB, scope, {
      limit: input.limit ?? 8,
      sessionId: input.session_id,
    }),
    readScopedData(requestContext.env.DB, scope, projectId, {
      sessionId: input.session_id,
    }),
  ]);
  const window = messages
    .filter((message) => !message.is_agent)
    .map(toNormalizedObservation);
  const model =
    requestContext.model ?? createOpenRouterModelAdapter(requestContext.env);
  const result = await extract(
    window,
    data.steps.map(toExtractedStep),
    extractionContextFor(workflowId, loadKb()),
    withAbortSignal(model, undefined)
  );
  return { ...result, status: result.degraded ? "degraded" : "ok" };
}

export async function proposeEdit(
  rawInput: ProposeEditInput,
  requestContext: AgentToolRequestContext
) {
  const input = proposeEditInputSchema.parse(rawInput);
  const { projectId, scope, workflowId } = resolveToolScope(
    requestContext.env,
    input,
    { requireWorkflow: true }
  );
  const existing = input.request_id
    ? await readProposalByRequestId(requestContext.env.DB, input.request_id)
    : null;
  if (existing) {
    return existing;
  }
  const now = requestContext.now?.() ?? new Date().toISOString();
  const id = `aep_${crypto.randomUUID()}`;
  const proposal = {
    action: input.action,
    actor: requestContext.actorId ?? "agent",
    channel: scope.channel,
    created_at: now,
    id,
    payload: input.payload,
    project_id: projectId,
    rationale: input.rationale,
    request_id: input.request_id ?? null,
    status: "proposed" as const,
    workflow_id: workflowId,
    workspace_id: scope.workspaceId,
  };
  await requestContext.env.DB.prepare(
    `INSERT INTO agent_edit_proposal
     (id, workspace_id, channel, project_id, workflow_id, action, payload_json,
      rationale, actor, status, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`
  )
    .bind(
      proposal.id,
      proposal.workspace_id,
      proposal.channel,
      proposal.project_id,
      proposal.workflow_id,
      proposal.action,
      JSON.stringify(proposal.payload),
      proposal.rationale,
      proposal.actor,
      proposal.request_id,
      proposal.created_at
    )
    .run();
  return proposal;
}

export async function recordAgentEvent(
  rawInput: RecordAgentEventInput,
  requestContext: AgentToolRequestContext
) {
  const input = recordAgentEventInputSchema.parse(rawInput);
  const existing = input.request_id
    ? await readAgentEventByRequestId(requestContext.env.DB, input.request_id)
    : null;
  if (existing) {
    return existing;
  }
  const { projectId, scope, workflowId } = resolveToolScope(
    requestContext.env,
    input
  );
  const now = requestContext.now?.() ?? new Date().toISOString();
  const id = `age_${crypto.randomUUID()}`;
  const event = {
    channel: scope.channel,
    citations: (input.citations ?? []) as unknown as Citation[],
    created_at: now,
    id,
    kind: input.kind,
    nodes: input.nodes ?? [],
    pauses: input.pauses ?? false,
    payload: input.payload ?? {},
    project_id: projectId,
    request_id: input.request_id ?? null,
    session_id: input.session_id ?? null,
    status: "recorded",
    text: input.text,
    workflow_id: workflowId ?? null,
    workspace_id: scope.workspaceId,
  };
  await requestContext.env.DB.prepare(
    `INSERT INTO agent_event
     (id, workspace_id, channel, project_id, workflow_id, session_id, kind, text,
      citations_json, nodes_json, payload_json, pauses, status, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recorded', ?, ?)`
  )
    .bind(
      event.id,
      event.workspace_id,
      event.channel,
      event.project_id,
      event.workflow_id,
      event.session_id,
      event.kind,
      event.text,
      JSON.stringify(event.citations),
      JSON.stringify(event.nodes),
      JSON.stringify(event.payload),
      event.pauses ? 1 : 0,
      event.request_id,
      event.created_at
    )
    .run();
  await writeAgentJournal(requestContext.env.DB, event);
  return event;
}

export async function postToSlack(
  rawInput: PostToSlackInput,
  requestContext: AgentToolRequestContext
) {
  const input = postToSlackInputSchema.parse(rawInput);
  if (!isAgentEnabled(requestContext.env)) {
    return { status: "disabled" as const };
  }
  const { projectId, scope, workflowId } = resolveToolScope(
    requestContext.env,
    input
  );
  const now = requestContext.now?.() ?? new Date().toISOString();
  const recent = await requestContext.env.DB.prepare(
    `SELECT id FROM agent_event
     WHERE workspace_id = ? AND channel = ? AND kind = 'slack_post'
       AND created_at > ?
     ORDER BY created_at DESC LIMIT 1`
  )
    .bind(
      scope.workspaceId,
      scope.channel,
      new Date(Date.parse(now) - 8000).toISOString()
    )
    .first<{ id: string }>();
  if (recent) {
    throw new AgentToolError(
      "Agent Slack posts are rate-limited to one post every 8 seconds.",
      "slack_rate_limited",
      429
    );
  }
  const event = await recordAgentEvent(
    {
      channel: input.channel,
      kind: "slack_post",
      payload: {
        kind: input.kind ?? "answer",
        thread_ts: input.thread_ts ?? null,
      },
      project_id: projectId,
      request_id: input.request_id,
      text: input.text,
      workflow_id: workflowId,
      workspace_id: input.workspace_id,
    },
    { ...requestContext, now: () => now }
  );
  await requestContext.env.DB.prepare(
    `INSERT OR IGNORE INTO pm_outbox
     (operation_id, workspace_id, channel, kind, payload_json, status, next_due_ts)
     VALUES (?, ?, ?, 'agent_post', ?, 'pending', ?)`
  )
    .bind(
      event.id,
      scope.workspaceId,
      scope.channel,
      JSON.stringify({
        text: input.text,
        thread_ts: input.thread_ts ?? null,
      }),
      now
    )
    .run();
  return {
    operation_id: event.id,
    status: requestContext.env.SLACK_BOT_TOKEN ? "queued" : "queued_no_token",
  };
}

export async function pauseRun(
  rawInput: PauseRunInput,
  requestContext: AgentToolRequestContext
) {
  const input = pauseRunInputSchema.parse(rawInput);
  const { scope } = resolveToolScope(requestContext.env, input);
  const response = await coordinatorFetch(requestContext.env, scope, "/pause", {
    body: JSON.stringify({
      reason: input.reason,
      session_id: input.session_id,
    }),
    method: "POST",
  });
  if (!response) {
    throw new AgentToolError(
      "Channel coordinator is not bound.",
      "coordinator_unavailable",
      503
    );
  }
  if (!response.ok) {
    throw new AgentToolError(
      "Unable to pause run.",
      "pause_failed",
      response.status
    );
  }
  return { paused: true, session_id: input.session_id };
}

export async function resumeRun(
  rawInput: ResumeRunInput,
  requestContext: AgentToolRequestContext
) {
  const input = resumeRunInputSchema.parse(rawInput);
  const { scope } = resolveToolScope(requestContext.env, input);
  const response = await coordinatorFetch(
    requestContext.env,
    scope,
    "/resume",
    {
      body: JSON.stringify({ session_id: input.session_id }),
      method: "POST",
    }
  );
  if (!response) {
    throw new AgentToolError(
      "Channel coordinator is not bound.",
      "coordinator_unavailable",
      503
    );
  }
  if (!response.ok) {
    throw new AgentToolError(
      "Unable to resume run.",
      "resume_failed",
      response.status
    );
  }
  return { resumed: true, session_id: input.session_id };
}

export function createAriadneTools() {
  return {
    getEvidence: createTool({
      description:
        "Return source Slack messages that evidence a step, node, or graph edge.",
      execute: (input, context) =>
        getEvidence(input, toolRequestContext(context)),
      id: "getEvidence",
      inputSchema: getEvidenceInputSchema,
    }),
    lookupKnowledgeBase: createTool({
      description:
        "Look up authored workspace knowledge such as people, artifacts, policies, projects, workflows, and activities.",
      execute: async (input, context) =>
        lookupKnowledgeBase(input, toolRequestContext(context)),
      id: "lookupKnowledgeBase",
      inputSchema: lookupKnowledgeBaseInputSchema,
    }),
    pauseRun: createTool({
      description:
        "Pause the active channel run through the existing coordinator control path.",
      execute: (input, context) => pauseRun(input, toolRequestContext(context)),
      id: "pauseRun",
      inputSchema: pauseRunInputSchema,
    }),
    postToSlack: createTool({
      description:
        "Queue an agent Slack post intent with rate limiting and the existing outbox boundary.",
      execute: (input, context) =>
        postToSlack(input, toolRequestContext(context)),
      id: "postToSlack",
      inputSchema: postToSlackInputSchema,
    }),
    proposeEdit: createTool({
      description:
        "Create a proposed graph-model edit with rationale for human review; never applies edits directly.",
      execute: (input, context) =>
        proposeEdit(input, toolRequestContext(context)),
      id: "proposeEdit",
      inputSchema: proposeEditInputSchema,
    }),
    queryProcessGraph: createTool({
      description:
        "Query the scoped process graph, planes, edges, nodes, and conformance summary.",
      execute: (input, context) =>
        queryProcessGraph(input, toolRequestContext(context)),
      id: "queryProcessGraph",
      inputSchema: queryProcessGraphInputSchema,
    }),
    recordAgentEvent: createTool({
      description:
        "Record an Ariadne agent event and replay it through the existing journal.",
      execute: (input, context) =>
        recordAgentEvent(input, toolRequestContext(context)),
      id: "recordAgentEvent",
      inputSchema: recordAgentEventInputSchema,
    }),
    resumeRun: createTool({
      description:
        "Resume a paused channel run through the existing coordinator control path.",
      execute: (input, context) =>
        resumeRun(input, toolRequestContext(context)),
      id: "resumeRun",
      inputSchema: resumeRunInputSchema,
    }),
    searchWorkspace: createTool({
      description:
        "Search scoped workspace records across people, artifacts, activities, and cases.",
      execute: (input, context) =>
        searchWorkspace(input, toolRequestContext(context)),
      id: "searchWorkspace",
      inputSchema: searchWorkspaceInputSchema,
    }),
    triggerExtraction: createTool({
      description:
        "Run the existing evidence-backed extraction boundary for a scoped message window.",
      execute: (input, context) =>
        triggerExtraction(input, toolRequestContext(context)),
      id: "triggerExtraction",
      inputSchema: triggerExtractionInputSchema,
    }),
  };
}

export const ariadneTools = createAriadneTools();

function toolRequestContext(context: ToolContext | undefined) {
  const value = context?.requestContext;
  if (!(isObject(value) && isObject(value.env))) {
    throw new AgentToolError(
      "Ariadne tools require env in Mastra requestContext.",
      "missing_request_context",
      500
    );
  }
  return value as unknown as AgentToolRequestContext;
}

function resolveToolScope(
  env: AgentToolEnv,
  input: {
    channel?: string | undefined;
    project_id?: string | undefined;
    workspace_id?: string | undefined;
    workflow_id?: string | undefined;
  },
  options: { requireWorkflow?: boolean } = {}
) {
  const scope = configuredChannelScope(env);
  if (!scope) {
    throw new AgentToolError(
      "Channel coordination is not configured.",
      "channel_unconfigured",
      503
    );
  }
  if (
    (input.workspace_id && input.workspace_id !== scope.workspaceId) ||
    (input.channel && input.channel !== scope.channel)
  ) {
    throw new AgentToolError(
      "Requested workspace or channel is not authorized.",
      "forbidden_scope",
      403
    );
  }
  const resolved = resolveScope(
    {
      project_id: input.project_id ?? DEFAULT_PROJECT_ID,
      workflow_id: input.workflow_id,
    },
    loadKb(),
    options
  );
  if ("response" in resolved) {
    throw responseError(resolved.response);
  }
  return {
    projectId: resolved.projectId,
    scope,
    workflowId: resolved.workflowId,
  };
}

async function graphOrThrow(
  result: GraphView | { response: Response }
): Promise<GraphView> {
  if (!("response" in result)) {
    return result;
  }
  throw await responseErrorAsync(result.response);
}

function responseError(response: Response) {
  return new AgentToolError(
    `Process API rejected tool input with HTTP ${response.status}.`,
    "process_scope_error",
    response.status
  );
}

async function responseErrorAsync(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  return new AgentToolError(
    body?.error?.message ??
      `Process API rejected tool input with HTTP ${response.status}.`,
    body?.error?.code ?? "process_scope_error",
    response.status
  );
}

function planesInGraph(graph: GraphView) {
  return {
    both: graph.nodes.filter((node) => node.activity.plane === "both").length,
    designed: graph.nodes.filter((node) => node.activity.plane === "designed")
      .length,
    discovered: graph.nodes.filter(
      (node) => node.activity.plane === "discovered"
    ).length,
  };
}

function evidenceForNode(steps: Step[], nodeId: string) {
  return steps
    .filter((step) => step.id === nodeId || step.activity_id === nodeId)
    .flatMap((step) => step.evidence.map((evidence) => evidence.ts));
}

async function edgeForId(
  data: ScopedData,
  projectId: ProjectId,
  workflowId: WorkflowId | undefined,
  input: GetEvidenceInput
) {
  if (!input.edge_id) {
    return null;
  }
  const graph = await graphOrThrow(
    buildGraphView({
      data,
      kind: "overlay",
      minSupport: 1,
      projectId,
      ...(input.session_id ? { sessionId: input.session_id } : {}),
      ...(workflowId ? { workflowId } : {}),
    })
  );
  return graph.edges.find((edge) => edge.id === input.edge_id) ?? null;
}

function evidenceForEdge(steps: Step[], edge: GraphEdge | null) {
  if (!edge) {
    return [];
  }
  const bySession = new Map<string, Step[]>();
  for (const step of steps) {
    bySession.set(step.session_id, [
      ...(bySession.get(step.session_id) ?? []),
      step,
    ]);
  }
  const evidence: string[] = [];
  for (const sessionSteps of bySession.values()) {
    const ordered = [...sessionSteps].sort((a, b) => a.seq - b.seq);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const from = ordered[index];
      const to = ordered[index + 1];
      if (from?.activity_id === edge.from && to?.activity_id === edge.to) {
        evidence.push(...from.evidence.map((item) => item.ts));
        evidence.push(...to.evidence.map((item) => item.ts));
      }
    }
  }
  return evidence;
}

function toNormalizedObservation(message: Message): NormalizedObservation {
  return {
    author_label: message.author_label,
    author_person_id: message.author_person_id,
    channel_id: message.channel,
    deleted: message.deleted,
    id: message.id,
    is_agent: message.is_agent,
    permalink: message.permalink,
    received_at: message.received_at,
    revision: message.revision,
    session_id: message.session_id,
    text: message.text,
    thread_ts: message.thread_ts,
    ts: message.ts,
    workspace_id: message.workspace_id,
  };
}

function toExtractedStep(step: Step): ExtractedStep {
  const evidence = step.evidence.map((item) => ({
    channel_id: item.channel,
    message_revision: item.message_revision,
    received_at: step.ts_start,
    text: "",
    ts: item.ts,
    workspace_id: item.workspace_id,
  }));
  return {
    activity_id: step.activity_id,
    activity_slug:
      step.activity_id?.replace(ACTIVITY_ID_PREFIX_PATTERN, "") ?? step.intent,
    actor_person_id: step.actor_person_id,
    artifact_id: step.artifact_id,
    confidence: step.confidence,
    evidence,
    handoff_to_person_id: step.handoff_to_person_id,
    id: step.id,
    intent: step.intent,
    label: step.intent,
    lifecycle_state: step.lifecycle_state,
    modality: step.modality,
    negated: step.negated,
    role_deviation: false,
    seq: step.seq,
    session_id: step.session_id,
    status: step.status,
    ts_start: step.ts_start,
    type: step.type,
  };
}

function extractionContextFor(
  workflowId: WorkflowId | undefined,
  kb: AuthoredKb
): ExtractionContext {
  const workflow = kb.workflows.find(
    (candidate) => candidate.id === workflowId
  );
  const projectId = workflow?.project_id ?? null;
  return {
    activities:
      workflow?.activities.map((activity) => ({
        id: activityId(activity.slug) as ExtractionActivityId,
        label: activity.label,
        plane: "designed",
        role_expected: activity.role as ExtractionRoleId,
        slug: activity.slug,
      })) ?? [],
    artifacts: kb.artifacts
      .filter((artifact) => !projectId || artifact.project_id === projectId)
      .map((artifact) => ({
        id: artifact.id as ExtractionArtifactId,
        name: artifact.name,
      })),
    people: kb.people.map((person) => ({
      id: person.id as ExtractionPersonId,
      name: person.name,
      role: person.role as ExtractionRoleId,
    })),
    role_repertoires: kb.roleCapabilities.map((entry) => ({
      never_performs: entry.never_performs.map(
        (slug) => activityId(slug) as ExtractionActivityId
      ),
      performs: entry.performs.map(
        (slug) => activityId(slug) as ExtractionActivityId
      ),
      role_id: entry.role as ExtractionRoleId,
    })),
  };
}

function withAbortSignal(model: ModelAdapter, signal: AbortSignal | undefined) {
  if (!signal) {
    return model;
  }
  return {
    generateJson: (call) => model.generateJson({ ...call, signal }),
  } satisfies ModelAdapter;
}

function isAgentEnabled(env: AgentToolEnv) {
  return env.AGENT_ENABLED === "true";
}

async function readProposalByRequestId(db: D1Database, requestId: string) {
  const row = await db
    .prepare("SELECT * FROM agent_edit_proposal WHERE request_id = ?")
    .bind(requestId)
    .first<{
      action: string;
      actor: string;
      channel: string;
      created_at: string;
      id: string;
      payload_json: string;
      project_id: string;
      rationale: string;
      request_id: string | null;
      status: "applied" | "proposed" | "rejected";
      workflow_id: string;
      workspace_id: string;
    }>();
  return row
    ? {
        action: row.action,
        actor: row.actor,
        channel: row.channel,
        created_at: row.created_at,
        id: row.id,
        payload: JSON.parse(row.payload_json) as Record<string, unknown>,
        project_id: row.project_id,
        rationale: row.rationale,
        request_id: row.request_id,
        status: row.status,
        workflow_id: row.workflow_id,
        workspace_id: row.workspace_id,
      }
    : null;
}

async function readAgentEventByRequestId(db: D1Database, requestId: string) {
  const row = await db
    .prepare("SELECT * FROM agent_event WHERE request_id = ?")
    .bind(requestId)
    .first<AgentEventRow>();
  return row ? agentEventFromRow(row) : null;
}

async function writeAgentJournal(
  db: D1Database,
  event: Awaited<ReturnType<typeof readAgentEventByRequestId>> & {
    channel: string;
    created_at: string;
    id: string;
    project_id: string;
    session_id: string | null;
    workspace_id: string;
  }
) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO pm_journal
       (workspace_id, channel, project_id, session_id, kind, ts, payload_json, operation_key)
       VALUES (?, ?, ?, ?, 'agent_post', ?, ?, ?)`
    )
    .bind(
      event.workspace_id,
      event.channel,
      event.project_id,
      event.session_id,
      event.created_at,
      JSON.stringify(event),
      `agent:${event.id}`
    )
    .run();
}

interface AgentEventRow {
  channel: string;
  citations_json: string;
  created_at: string;
  id: string;
  kind: string;
  nodes_json: string;
  pauses: number;
  payload_json: string;
  project_id: string;
  request_id: string | null;
  session_id: string | null;
  status: string;
  text: string;
  workflow_id: string | null;
  workspace_id: string;
}

function agentEventFromRow(row: AgentEventRow) {
  return {
    channel: row.channel,
    citations: JSON.parse(row.citations_json) as Citation[],
    created_at: row.created_at,
    id: row.id,
    kind: row.kind,
    nodes: JSON.parse(row.nodes_json) as string[],
    pauses: Boolean(row.pauses),
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    project_id: row.project_id,
    request_id: row.request_id,
    session_id: row.session_id,
    status: row.status,
    text: row.text,
    workflow_id: row.workflow_id,
    workspace_id: row.workspace_id,
  };
}

function normalizedQuery(query: string) {
  return query.trim().toLocaleLowerCase();
}

function addKbMatches<T>(
  matches: KbMatch[],
  kind: KbLookupKind,
  include: (kind: KbLookupKind) => boolean,
  items: readonly T[],
  query: string,
  describe: (item: T) => {
    fields: readonly string[];
    id: string;
    label: string;
    record: unknown;
  }
) {
  if (!include(kind)) {
    return;
  }
  for (const item of items) {
    const description = describe(item);
    if (searchable(description.fields, query)) {
      matches.push({
        id: description.id,
        kind,
        label: description.label,
        record: description.record,
      });
    }
  }
}

function searchable(values: readonly string[], query: string) {
  return values.some((value) => value.toLocaleLowerCase().includes(query));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
