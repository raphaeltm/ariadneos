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
  | "reject"
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

export interface ApiAdapter {
  applyModelEdit: (request: ModelEditRequest) => Promise<ModelEditResponse>;
  ask: (request: AskRequest, signal?: AbortSignal) => Promise<RagAnswer>;
  buildStreamUrl: (scope: ConnectionScope, after?: JournalId) => string;
  fetchSnapshot: (request: SnapshotRequest) => Promise<Snapshot>;
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
          body: JSON.stringify(body),
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
    updateStepStatus: ({ request_id, scope, status, step_id }) =>
      post<void>(`/api/steps/${encodeURIComponent(step_id)}/status`, {
        project_id: scope.project_id,
        request_id,
        status,
      }),
  };
}

interface ClientSnapshotExtras {
  agent_posts: AgentPost[];
  pipeline_events: PipelineEvent[];
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
