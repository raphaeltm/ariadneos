import type {
  ActivityId,
  ChannelId,
  Citation,
  AgentPost as ContractAgentPost,
  ApiError as ContractApiError,
  RagAnswer as ContractRagAnswer,
  Snapshot as ContractSnapshot,
  GraphDelta,
  GraphEdgeId,
  GraphView,
  GraphViewKind,
  JournalId,
  Message,
  MessageId,
  PauseResumePayload,
  ProcessSession,
  ProcessSessionId,
  ProjectId,
  ResetPayload,
  SessionClosedPayload,
  SessionConformance,
  JournalEnvelope as SharedJournalEnvelope,
  Step,
  StepId,
  WorkflowConformance,
  WorkflowId,
  WorkspaceId,
} from "../shared/contracts.ts";
import {
  fixtureMessages,
  fixtureSnapshot,
  fixtureSteps,
  overlayGraph,
  removalDelta,
} from "../shared/fixtures.ts";

const WORKFLOW_ID_PREFIX = /^wf_/;

export type {
  ActivityId,
  ChannelId,
  Citation,
  GraphDelta,
  GraphEdge,
  GraphEdgeId,
  GraphNode,
  GraphPlane,
  GraphView,
  GraphViewKind,
  ISODateTime,
  JournalId,
  Message,
  MessageId,
  PauseResumePayload,
  PersonId,
  PolicyId,
  ProcessSession,
  ProcessSessionId,
  ProjectId,
  ResetPayload,
  SessionClosedPayload,
  SessionConformance,
  SlackTs,
  Step,
  StepId,
  WorkflowConformance,
  WorkflowId,
  WorkspaceId,
} from "../shared/contracts.ts";

export type PipelineEventKind =
  | "agent"
  | "canon"
  | "extract"
  | "graph"
  | "ground"
  | "message";

export interface AgentPost extends ContractAgentPost {
  citations: Citation[];
  id: string;
  nodes: Array<ActivityId | StepId>;
  pauses: boolean;
  policy_id?: string;
  resolution?: "approve" | "hold" | "reject";
  workflow_id?: WorkflowId;
}

export interface AskRequest {
  project_id: ProjectId;
  question: string;
  workflow_id?: WorkflowId;
}

export interface ConnectionScope {
  channel: ChannelId;
  min_support: number;
  project_id: ProjectId;
  session_id?: ProcessSessionId;
  view: GraphViewKind;
  workflow_id?: WorkflowId;
  workspace_id: WorkspaceId;
}

export interface PipelineEvent {
  created_at: string;
  id: string;
  kind: PipelineEventKind;
  message_id?: MessageId;
  produced_id?: ActivityId | GraphEdgeId | StepId;
  session_id?: ProcessSessionId;
  text: string;
}

export interface RagAnswer extends ContractRagAnswer {
  evidence?: string[];
  mode?: "ai" | "summary";
  nodes?: Array<ActivityId | StepId>;
  notice?: string;
}

export interface Snapshot extends ContractSnapshot {
  agent_posts: AgentPost[];
  pipeline_events: PipelineEvent[];
}

export interface JournalEnvelope<TKind extends string, TPayload>
  extends Omit<SharedJournalEnvelope<TPayload>, "kind"> {
  kind: TKind;
}

export type JournalEvent =
  | JournalEnvelope<"agent_post", AgentPost>
  | JournalEnvelope<"conformance", SessionConformance | WorkflowConformance>
  | JournalEnvelope<"graph_delta", GraphDelta>
  | JournalEnvelope<"message", Message>
  | JournalEnvelope<"paused", PauseResumePayload>
  | JournalEnvelope<"pipeline", PipelineEvent>
  | JournalEnvelope<"reset", ResetPayload>
  | JournalEnvelope<"resumed", PauseResumePayload>
  | JournalEnvelope<"session_closed", SessionClosedPayload>
  | JournalEnvelope<"session_started", ProcessSession>
  | JournalEnvelope<"step", Step>;

export interface SnapshotRequest {
  scope: ConnectionScope;
  signal?: AbortSignal;
}

export interface StepStatusRequest {
  request_id: string;
  scope: ConnectionScope;
  status: "confirmed" | "rejected";
  step_id: StepId;
}

export type ModelEditAction =
  | "add_edge"
  | "add_node"
  | "merge"
  | "merge_nodes"
  | "promote"
  | "remove_edge"
  | "remove_node"
  | "rename"
  | "rename_node"
  | "require"
  | "retire";

export interface ModelEditRevision {
  action: string;
  actor: string;
  base_revision: number;
  created_at: string;
  id: string;
  payload: Record<string, unknown>;
  request_id: string | null;
  revision: number;
  target_edit_id: string | null;
  undone: boolean;
  workflow: WorkflowId;
}

export interface ModelEditRequest {
  action: ModelEditAction;
  base_revision?: number;
  payload: Record<string, boolean | number | string | string[]>;
  request_id: string;
  scope: ConnectionScope;
}

export interface ModelEditResponse {
  designed: {
    edges: Array<{ from: ActivityId; probability: number; to: ActivityId }>;
    nodes: Array<{
      id: ActivityId;
      label: string;
      role_expected: string | null;
      slug: string;
    }>;
    workflow_id: WorkflowId;
  };
  edit: ModelEditRevision;
  graph: GraphView;
  graph_revision: number;
  revision: number;
}

export interface SimulationRequest {
  request_id: string;
  scenario_id: string;
  scope: ConnectionScope;
  variant: string;
}

export interface SimulationResponse {
  session_id: ProcessSessionId;
}

export interface ApiAdapter {
  applyModelEdit: (request: ModelEditRequest) => Promise<ModelEditResponse>;
  ask: (request: AskRequest, signal?: AbortSignal) => Promise<RagAnswer>;
  buildStreamUrl: (scope: ConnectionScope, after?: JournalId) => string;
  fetchSnapshot: (request: SnapshotRequest) => Promise<Snapshot>;
  pauseSimulation: (
    sessionId: ProcessSessionId,
    scope: ConnectionScope,
    reason: string
  ) => Promise<void>;
  resumeSimulation: (
    sessionId: ProcessSessionId,
    scope: ConnectionScope
  ) => Promise<void>;
  runSimulation: (request: SimulationRequest) => Promise<SimulationResponse>;
  updateStepStatus: (request: StepStatusRequest) => Promise<void>;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, detail: string, status: number) {
    super(detail);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface ClientFixtures {
  atlasSnapshot: Snapshot;
  baseSnapshot: Snapshot;
  duplicateReplay: JournalEvent[];
  finalSnapshot: Snapshot;
  replay: JournalEvent[];
  revisionMismatch: JournalEvent;
  scope: ConnectionScope;
}

export function createProductionApiAdapter(
  fetcher: typeof fetch = fetch,
  baseUrl = ""
): ApiAdapter {
  const buildUrl = (
    path: string,
    params: Record<string, string | undefined>
  ) => {
    const base = baseUrl || "https://ariadneos.local";
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
    return baseUrl ? url.toString() : `${url.pathname}${url.search}`;
  };
  const request = async <T>(
    path: string,
    init: RequestInit | undefined,
    signal?: AbortSignal
  ): Promise<T> => {
    const response = await fetcher(path, { ...init, signal });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const apiError = isApiError(payload) ? payload.error : undefined;
      throw new ApiError(
        apiError?.code ?? "request_failed",
        apiError?.message ?? "Unable to reach AriadneOS.",
        response.status
      );
    }
    return payload as T;
  };
  const post = async <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  return {
    applyModelEdit: ({ action, payload, request_id, scope }) =>
      post<ModelEditResponse>("/api/model/edit", {
        action,
        payload,
        project_id: scope.project_id,
        request_id,
        workflow_id: scope.workflow_id,
      }),
    ask: (body, signal) =>
      request<RagAnswer>(
        "/api/ask",
        {
          body: JSON.stringify({
            ...body,
            workflow: body.workflow_id
              ? legacyWorkflowId(body.workflow_id)
              : undefined,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
        signal
      ),
    buildStreamUrl: (scope, after) =>
      buildUrl("/api/stream", {
        after: after === undefined ? undefined : String(after),
        min_support: String(scope.min_support),
        project_id: scope.project_id,
        session_id: scope.session_id,
        view: scope.view,
        workflow_id: scope.workflow_id,
      }),
    fetchSnapshot: async ({ scope, signal }) =>
      normalizeSnapshot(
        await request<ContractSnapshot & Partial<ClientSnapshotExtras>>(
          buildUrl("/api/snapshot", {
            min_support: String(scope.min_support),
            project_id: scope.project_id,
            session_id: scope.session_id,
            view: scope.view,
            workflow_id: scope.workflow_id,
          }),
          undefined,
          signal
        )
      ),
    pauseSimulation: async (sessionId, scope, reason) => {
      await post<void>("/api/sim/pause", {
        project_id: scope.project_id,
        reason,
        session_id: sessionId,
      });
    },
    resumeSimulation: async (sessionId, scope) => {
      await post<void>("/api/sim/resume", {
        project_id: scope.project_id,
        session_id: sessionId,
      });
    },
    runSimulation: ({ request_id, scenario_id, scope, variant }) =>
      post<SimulationResponse>("/api/sim/run", {
        project_id: scope.project_id,
        request_id,
        scenario_id,
        variant,
        workflow_id: scope.workflow_id,
      }),
    updateStepStatus: ({ request_id, scope, status, step_id }) =>
      post<void>(`/api/steps/${encodeURIComponent(step_id)}/status`, {
        project_id: scope.project_id,
        request_id,
        status,
      }),
  };
}

function legacyWorkflowId(workflowId: WorkflowId): string {
  return workflowId.replace(WORKFLOW_ID_PREFIX, "");
}

export function createFixtureApiAdapter(
  fixtures = createClientFixtures()
): ApiAdapter {
  return {
    applyModelEdit: ({ action, payload, request_id, scope }) => {
      const { graph } = fixtures.finalSnapshot;
      const node = graph.nodes.find(
        (item) =>
          item.activity.slug === payload.slug ||
          item.activity.id === payload.activity_id
      );
      return Promise.resolve({
        conformance: graph.conformance,
        designed: {
          edges: [],
          nodes: [],
          workflow_id: scope.workflow_id ?? "wf_p1_incident",
        },
        edit: {
          action,
          actor: "fixture",
          base_revision: graph.revision - 1,
          created_at: "2026-09-12T00:00:00.000Z",
          id: `edt_${request_id.replaceAll("-", "_")}`,
          payload,
          request_id,
          revision: graph.revision,
          target_edit_id: null,
          undone: false,
          workflow: scope.workflow_id ?? "wf_p1_incident",
        },
        graph: node ? graph : fixtures.baseSnapshot.graph,
        graph_revision: graph.revision,
        revision: graph.revision,
      });
    },
    ask: async (request) => ({
      answer: `Fixture answer for ${request.project_id}.`,
      citations: [{ id: "pol_sec_review", kind: "kb" }],
      nodes: ["act_security_review"],
      subgraph: fixtures.finalSnapshot.graph,
    }),
    buildStreamUrl: (scope, after) => {
      const url = new URL("https://fixtures.invalid/api/stream");
      url.searchParams.set("project_id", scope.project_id);
      url.searchParams.set("view", scope.view);
      if (scope.workflow_id) {
        url.searchParams.set("workflow_id", scope.workflow_id);
      }
      if (after !== undefined) {
        url.searchParams.set("after", String(after));
      }
      return `${url.pathname}${url.search}`;
    },
    fetchSnapshot: async ({ scope }) =>
      scope.project_id === "proj_atlas"
        ? fixtures.atlasSnapshot
        : fixtures.finalSnapshot,
    pauseSimulation: async () => undefined,
    resumeSimulation: async () => undefined,
    runSimulation: async () => ({ session_id: "ses_helios_skip_review" }),
    updateStepStatus: async () => undefined,
  };
}

export function createClientFixtures(): ClientFixtures {
  const scope: ConnectionScope = {
    channel: "C_SYNTH_PROCESS",
    min_support: 1,
    project_id: "proj_helios",
    view: "overlay",
    workflow_id: "wf_p1_incident",
    workspace_id: "T_SYNTH_FIXTURE",
  };
  const ghostRemovalDelta: GraphDelta = {
    ...removalDelta,
    nodes_updated: removalDelta.nodes_updated.map((item) =>
      item.id === "act_security_review"
        ? {
            ...item,
            activity: {
              ...item.activity,
              occurrences: 0,
              plane: "designed",
              support: 0,
            },
          }
        : item
    ),
  };
  const baseSnapshot = normalizeSnapshot({
    ...fixtureSnapshot,
    cursor: 100,
    graph: overlayGraph,
    messages: fixtureMessages.filter(
      (item) => item.id !== "T_SYNTH_FIXTURE:C_SYNTH_PROCESS:100100.000400"
    ),
    steps: fixtureSteps.filter(
      (item) => item.id !== "stp_helios_skip_negated_security"
    ),
  });
  const finalSnapshot = normalizeSnapshot({
    ...fixtureSnapshot,
    cursor: 103,
    graph: applyDeltaToGraph(overlayGraph, ghostRemovalDelta),
  });
  const atlasSessionIds = new Set(
    fixtureSnapshot.sessions
      .filter((item) => item.project_id === "proj_atlas")
      .map((item) => item.id)
  );
  const messageEventPayload = fixtureMessages.find(
    (item) => item.id === "T_SYNTH_FIXTURE:C_SYNTH_PROCESS:100100.000400"
  );
  const stepEventPayload = fixtureSteps.find(
    (item) => item.id === "stp_helios_skip_negated_security"
  );
  if (!(messageEventPayload && stepEventPayload)) {
    throw new Error("Fixture replay payloads are missing.");
  }
  const replay: JournalEvent[] = [
    envelope(101, "message", messageEventPayload),
    envelope(102, "step", stepEventPayload),
    envelope(103, "graph_delta", ghostRemovalDelta),
  ];
  return {
    atlasSnapshot: normalizeSnapshot({
      ...fixtureSnapshot,
      graph: {
        ...fixtureSnapshot.graph,
        project_id: "proj_atlas",
        workflow_id: "wf_feature_intake",
      },
      messages: fixtureSnapshot.messages.filter((item) =>
        atlasSessionIds.has(item.session_id)
      ),
      sessions: fixtureSnapshot.sessions.filter((item) =>
        atlasSessionIds.has(item.id)
      ),
      steps: fixtureSnapshot.steps.filter((item) =>
        atlasSessionIds.has(item.session_id)
      ),
    }),
    baseSnapshot,
    duplicateReplay: [
      ...replay,
      replay[1] as JournalEvent,
      replay[2] as JournalEvent,
    ],
    finalSnapshot,
    replay,
    revisionMismatch: envelope(104, "graph_delta", {
      ...ghostRemovalDelta,
      base_revision: 4,
      revision: 9,
    }),
    scope,
  };
}

interface ClientSnapshotExtras {
  agent_posts: AgentPost[];
  pipeline_events: PipelineEvent[];
}

function applyDeltaToGraph(graph: GraphView, delta: GraphDelta): GraphView {
  const removedEdges = new Set(delta.edges_removed);
  const removedNodes = new Set(delta.nodes_removed);
  const nodeUpdates = new Map(
    delta.nodes_updated.map((item) => [item.id, item])
  );
  const edgeUpdates = new Map(
    delta.edges_updated.map((item) => [item.id, item])
  );
  return {
    ...graph,
    edges: [
      ...graph.edges
        .filter(
          (item) =>
            !(
              removedEdges.has(item.id) ||
              removedNodes.has(item.from) ||
              removedNodes.has(item.to)
            )
        )
        .map((item) => edgeUpdates.get(item.id) ?? item),
      ...delta.edges_added,
    ],
    nodes: [
      ...graph.nodes
        .filter((item) => !removedNodes.has(item.id))
        .map((item) => nodeUpdates.get(item.id) ?? item),
      ...delta.nodes_added,
    ],
    revision: delta.revision,
  };
}

function envelope<TKind extends JournalEvent["kind"], TPayload>(
  id: JournalId,
  kind: TKind,
  payload: TPayload
): JournalEnvelope<TKind, TPayload> {
  return {
    channel: "C_SYNTH_PROCESS",
    id,
    kind,
    payload,
    project_id: "proj_helios",
    session_id: "ses_helios_skip_review",
    ts: "2026-09-12T10:03:00.000Z",
    workspace_id: "T_SYNTH_FIXTURE",
  };
}

function isApiError(value: unknown): value is ContractApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: { message?: unknown } }).error?.message ===
      "string"
  );
}

function normalizeSnapshot(
  snapshot: ContractSnapshot & Partial<ClientSnapshotExtras>
): Snapshot {
  return {
    ...snapshot,
    agent_posts: snapshot.agent_posts ?? [],
    pipeline_events: snapshot.pipeline_events ?? [],
  };
}
