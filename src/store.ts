import type {
  AgentPost,
  ConnectionScope,
  GraphDelta,
  GraphView,
  JournalEvent,
  JournalId,
  Message,
  MessageId,
  PipelineEvent,
  ProcessSession,
  ProcessSessionId,
  ProjectId,
  SessionConformance,
  Snapshot,
  Step,
  StepId,
  WorkflowConformance,
  WorkflowId,
} from "./api.ts";

export type ConnectionStatus =
  | "closed"
  | "connecting"
  | "hidden"
  | "live"
  | "reconnecting"
  | "resyncing"
  | "stale";

export interface AppSelection {
  case_id?: ProcessSessionId;
  edge_id?: string;
  message_id?: MessageId;
  node_id?: string;
  workflow_id?: WorkflowId;
}

export interface AppState {
  agentPosts: Record<string, AgentPost>;
  appliedEventIds: JournalId[];
  conformance: Record<string, SessionConformance | WorkflowConformance>;
  connection: {
    backoffMs: number;
    error?: string;
    lastEventId: JournalId | null;
    resetReason?: string;
    status: ConnectionStatus;
  };
  graphRevisions: Record<string, number>;
  graphs: Record<string, GraphView>;
  kb: Snapshot["kb"] | null;
  loading: {
    requestId: string | null;
    scopeKey: string | null;
  };
  messages: Record<MessageId, Message>;
  pipelineEvents: Record<string, PipelineEvent>;
  scope: ConnectionScope;
  scopeKey: string;
  selection: AppSelection;
  sessions: Record<ProcessSessionId, ProcessSession>;
  steps: Record<StepId, Step>;
}

export type ApplyEffect =
  | { kind: "none" }
  | { kind: "snapshot_required"; reason: string };

export interface ApplyResult {
  effect: ApplyEffect;
  state: AppState;
}

export function createInitialState(scope: ConnectionScope): AppState {
  return {
    agentPosts: {},
    appliedEventIds: [],
    conformance: {},
    connection: {
      backoffMs: 1000,
      lastEventId: null,
      status: "closed",
    },
    graphRevisions: {},
    graphs: {},
    kb: null,
    loading: {
      requestId: null,
      scopeKey: null,
    },
    messages: {},
    pipelineEvents: {},
    scope,
    scopeKey: scopeKey(scope),
    selection: {
      workflow_id: scope.workflow_id,
    },
    sessions: {},
    steps: {},
  };
}

export function scopeKey(scope: ConnectionScope): string {
  return [
    scope.workspace_id,
    scope.channel,
    scope.project_id,
    scope.workflow_id ?? "",
    scope.session_id ?? "",
    scope.view,
    String(scope.min_support),
  ].join(":");
}

export function beginSnapshotLoad(
  state: AppState,
  scope: ConnectionScope,
  requestId: string
): AppState {
  return {
    ...state,
    connection: {
      ...state.connection,
      error: undefined,
      status: "connecting",
    },
    loading: {
      requestId,
      scopeKey: scopeKey(scope),
    },
    scope,
    scopeKey: scopeKey(scope),
  };
}

export function failSnapshotLoad(
  state: AppState,
  requestId: string,
  error: Error
): AppState {
  if (state.loading.requestId !== requestId) {
    return state;
  }
  return {
    ...state,
    connection: {
      ...state.connection,
      error: error.message,
      status: "closed",
    },
    loading: {
      requestId: null,
      scopeKey: null,
    },
  };
}

export function applySnapshot(
  state: AppState,
  snapshot: Snapshot,
  scope: ConnectionScope,
  requestId?: string
): AppState {
  const nextScopeKey = scopeKey(scope);
  if (
    requestId &&
    (state.loading.requestId !== requestId ||
      state.loading.scopeKey !== nextScopeKey)
  ) {
    return state;
  }
  return {
    ...state,
    agentPosts: indexBy(snapshot.agent_posts, (item) => item.id),
    appliedEventIds: [snapshot.cursor],
    conformance: indexConformance(snapshot),
    connection: {
      backoffMs: 1000,
      lastEventId: snapshot.cursor,
      status: "live",
    },
    graphRevisions: {
      [snapshot.graph.key]: snapshot.graph.revision,
    },
    graphs: {
      [snapshot.graph.key]: snapshot.graph,
    },
    kb: snapshot.kb,
    loading: {
      requestId: null,
      scopeKey: null,
    },
    messages: indexBy(snapshot.messages, (item) => item.id),
    pipelineEvents: indexBy(snapshot.pipeline_events, (item) => item.id),
    scope,
    scopeKey: nextScopeKey,
    selection: {
      workflow_id: scope.workflow_id,
    },
    sessions: indexBy(snapshot.sessions, (item) => item.id),
    steps: indexBy(snapshot.steps, (item) => item.id),
  };
}

export function applyJournalEvent(
  state: AppState,
  event: JournalEvent
): ApplyResult {
  if (!eventMatchesScope(state.scope, event)) {
    return { effect: { kind: "none" }, state };
  }
  if (state.appliedEventIds.includes(event.id)) {
    return { effect: { kind: "none" }, state };
  }
  if (event.kind === "reset") {
    return {
      effect: { kind: "snapshot_required", reason: event.payload.reason },
      state: markForSnapshot(state, event.id, event.payload.reason),
    };
  }
  const result = applyKnownEvent(state, event);
  const status: ConnectionStatus =
    result.effect.kind === "snapshot_required" ? "resyncing" : "live";
  const nextState = {
    ...result.state,
    appliedEventIds: appendApplied(result.state.appliedEventIds, event.id),
    connection: {
      ...result.state.connection,
      lastEventId: event.id,
      status,
    },
  };
  return { effect: result.effect, state: nextState };
}

export function selectConnection(state: AppState): AppState["connection"] {
  return state.connection;
}

export function selectCurrentGraph(state: AppState): GraphView | null {
  const preferred = Object.values(state.graphs).find(
    (graphView) =>
      graphView.project_id === state.scope.project_id &&
      graphView.kind === state.scope.view &&
      graphView.workflow_id === state.scope.workflow_id
  );
  return preferred ?? Object.values(state.graphs)[0] ?? null;
}

export function selectEvidenceForStep(
  state: AppState,
  stepId: StepId
): Message[] {
  return (
    state.steps[stepId]?.evidence
      .map((ref) => state.messages[ref.message_id])
      .filter((item): item is Message => Boolean(item)) ?? []
  );
}

export function selectMessagesForSession(
  state: AppState,
  sessionId: ProcessSessionId
): Message[] {
  return Object.values(state.messages)
    .filter((message) => message.session_id === sessionId)
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export function selectStepsForSession(
  state: AppState,
  sessionId: ProcessSessionId
): Step[] {
  return Object.values(state.steps)
    .filter((step) => step.session_id === sessionId)
    .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
}

export function selectWorkflowCases(
  state: AppState,
  workflowId: WorkflowId
): ProcessSession[] {
  return Object.values(state.sessions)
    .filter((session) => session.workflow_id === workflowId)
    .sort((a, b) => b.started_ts.localeCompare(a.started_ts));
}

export function setConnectionHidden(state: AppState): AppState {
  return {
    ...state,
    connection: {
      ...state.connection,
      status: "hidden",
    },
  };
}

export function setConnectionReconnecting(
  state: AppState,
  backoffMs: number,
  error?: string
): AppState {
  return {
    ...state,
    connection: {
      ...state.connection,
      backoffMs,
      error,
      status: "reconnecting",
    },
  };
}

export function selectCase(
  state: AppState,
  sessionId: ProcessSessionId | undefined
): AppState {
  return {
    ...state,
    scope: {
      ...state.scope,
      session_id: sessionId,
      view: sessionId ? "instance" : "overlay",
    },
    selection: {
      ...state.selection,
      case_id: sessionId,
    },
  };
}

export function selectProject(
  state: AppState,
  projectId: ProjectId,
  workflowId?: WorkflowId
): AppState {
  const scope = {
    ...state.scope,
    project_id: projectId,
    session_id: undefined,
    view: "overlay" as const,
    workflow_id: workflowId,
  };
  return {
    ...state,
    connection: {
      ...state.connection,
      status: "stale",
    },
    scope,
    scopeKey: scopeKey(scope),
    selection: {
      workflow_id: workflowId,
    },
  };
}

export function selectWorkflow(
  state: AppState,
  workflowId: WorkflowId
): AppState {
  return selectProject(state, state.scope.project_id, workflowId);
}

function appendApplied(appliedEventIds: JournalId[], id: JournalId) {
  return [...appliedEventIds, id].sort((a, b) => a - b);
}

function applyGraphDelta(state: AppState, delta: GraphDelta): ApplyResult {
  const graphView = state.graphs[delta.view_key];
  if (!graphView || graphView.revision !== delta.base_revision) {
    return {
      effect: {
        kind: "snapshot_required",
        reason: "revision_mismatch",
      },
      state: {
        ...state,
        connection: {
          ...state.connection,
          resetReason: "revision_mismatch",
          status: "resyncing",
        },
      },
    };
  }
  const removedNodes = new Set(delta.nodes_removed);
  const removedEdges = new Set(delta.edges_removed);
  const edgeUpdates = new Map(
    delta.edges_updated.map((edgeItem) => [edgeItem.id, edgeItem])
  );
  const nodeUpdates = new Map(
    delta.nodes_updated.map((nodeItem) => [nodeItem.id, nodeItem])
  );
  const edges = [
    ...graphView.edges
      .filter(
        (edgeItem) =>
          !(
            removedEdges.has(edgeItem.id) ||
            removedNodes.has(edgeItem.from) ||
            removedNodes.has(edgeItem.to)
          )
      )
      .map((edgeItem) => edgeUpdates.get(edgeItem.id) ?? edgeItem),
    ...delta.edges_added.filter((edgeItem) => !removedEdges.has(edgeItem.id)),
  ];
  const nodes = [
    ...graphView.nodes
      .filter((nodeItem) => !removedNodes.has(nodeItem.id))
      .map((nodeItem) => nodeUpdates.get(nodeItem.id) ?? nodeItem),
    ...delta.nodes_added.filter((nodeItem) => !removedNodes.has(nodeItem.id)),
  ];
  const nextGraph = {
    ...graphView,
    edges: dedupeBy(edges, (edgeItem) => edgeItem.id),
    nodes: dedupeBy(nodes, (nodeItem) => nodeItem.id),
    revision: delta.revision,
  };
  return {
    effect: { kind: "none" },
    state: {
      ...state,
      graphRevisions: {
        ...state.graphRevisions,
        [nextGraph.key]: nextGraph.revision,
      },
      graphs: {
        ...state.graphs,
        [nextGraph.key]: nextGraph,
      },
    },
  };
}

function applyKnownEvent(state: AppState, event: JournalEvent): ApplyResult {
  switch (event.kind) {
    case "agent_post":
      return {
        effect: { kind: "none" },
        state: {
          ...state,
          agentPosts: upsert(state.agentPosts, event.payload.id, event.payload),
        },
      };
    case "conformance":
      return {
        effect: { kind: "none" },
        state: {
          ...state,
          conformance: upsert(
            state.conformance,
            conformanceKey(event.payload),
            event.payload
          ),
        },
      };
    case "graph_delta":
      return applyGraphDelta(state, event.payload);
    case "message":
      return {
        effect: { kind: "none" },
        state: {
          ...state,
          messages: upsert(state.messages, event.payload.id, event.payload),
        },
      };
    case "paused":
    case "resumed":
      return {
        effect: { kind: "none" },
        state: patchSessionStatus(state, event.payload.session_id, "open"),
      };
    case "pipeline":
      return {
        effect: { kind: "none" },
        state: {
          ...state,
          pipelineEvents: upsert(
            state.pipelineEvents,
            event.payload.id,
            event.payload
          ),
        },
      };
    case "session_closed":
      return {
        effect: { kind: "none" },
        state: {
          ...patchSessionStatus(state, event.payload.session_id, "closed"),
          conformance: upsert(
            state.conformance,
            event.payload.conformance.session_id,
            event.payload.conformance
          ),
        },
      };
    case "session_started":
      return {
        effect: { kind: "none" },
        state: {
          ...state,
          sessions: upsert(state.sessions, event.payload.id, event.payload),
        },
      };
    case "step":
      return {
        effect: { kind: "none" },
        state: {
          ...state,
          steps: upsert(state.steps, event.payload.id, event.payload),
        },
      };
    case "reset":
      return {
        effect: { kind: "snapshot_required", reason: event.payload.reason },
        state,
      };
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled event ${(value as { kind?: string }).kind}`);
}

function conformanceKey(
  value: SessionConformance | WorkflowConformance
): string {
  return "session_id" in value
    ? value.session_id
    : `workflow:${value.workflow_id}`;
}

function dedupeBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const indexed = new Map<string, T>();
  for (const item of items) {
    indexed.set(getKey(item), item);
  }
  return [...indexed.values()];
}

function eventMatchesScope(scope: ConnectionScope, event: JournalEvent) {
  return (
    event.workspace_id === scope.workspace_id &&
    event.channel === scope.channel &&
    event.project_id === scope.project_id
  );
}

function indexBy<T, TKey extends string>(
  items: T[],
  getKey: (item: T) => TKey
): Record<TKey, T> {
  return Object.fromEntries(
    items.map((item) => [getKey(item), item])
  ) as Record<TKey, T>;
}

function indexConformance(snapshot: Snapshot) {
  return indexBy(snapshot.conformance, conformanceKey);
}

function markForSnapshot(
  state: AppState,
  eventId: JournalId,
  reason: string
): AppState {
  return {
    ...state,
    appliedEventIds: appendApplied(state.appliedEventIds, eventId),
    connection: {
      ...state.connection,
      lastEventId: eventId,
      resetReason: reason,
      status: "resyncing",
    },
  };
}

function patchSessionStatus(
  state: AppState,
  sessionId: ProcessSessionId,
  status: ProcessSession["status"]
): AppState {
  const session = state.sessions[sessionId];
  if (!session) {
    return state;
  }
  return {
    ...state,
    sessions: upsert(state.sessions, sessionId, {
      ...session,
      status,
    }),
  };
}

function upsert<T, TKey extends string>(
  record: Record<TKey, T>,
  key: TKey,
  value: T
): Record<TKey, T> {
  return {
    ...record,
    [key]: value,
  };
}
