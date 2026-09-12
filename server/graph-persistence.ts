import {
  type AggregateEdge,
  type AggregateGraph,
  type AggregateNode,
  diffAggregateGraphs,
  type GraphDiff,
} from "../shared/mining/graph.ts";

export type PersistedGraphKind =
  | "designed"
  | "discovered"
  | "instance"
  | "overlay";

export interface PersistedGraphScope {
  channel: string;
  kind: PersistedGraphKind;
  minSupport?: number;
  projectId?: string;
  sessionId?: string;
  workflowId?: string;
  workspaceId: string;
}

export interface StoredGraphHead {
  graph: AggregateGraph;
  graphHash: string;
  revision: number;
  scope: PersistedGraphScope;
  updatedAt: string;
  viewKey: string;
}

export interface StoredGraphDelta
  extends GraphDiff<AggregateNode, AggregateEdge> {
  baseRevision: number;
  graphHash: string;
  revision: number;
  viewKey: string;
}

export interface PersistGraphRevisionInput {
  graph: AggregateGraph;
  now?: string;
  operationKey: string;
  scope: PersistedGraphScope;
}

export interface PersistGraphRevisionResult {
  delta: StoredGraphDelta;
  graph: AggregateGraph;
  graphHash: string;
  inserted: boolean;
  revision: number;
  viewKey: string;
}

interface GraphViewRow {
  channel: string;
  graph_hash: string;
  head_revision: number;
  kind: PersistedGraphKind;
  min_support: number;
  project_id: string | null;
  session_id: string | null;
  snapshot_json: string;
  updated_at: string;
  view_key: string;
  workflow_id: string | null;
  workspace_id: string;
}

interface GraphRevisionRow {
  base_revision: number;
  delta_json: string;
  graph_hash: string;
  revision: number;
  snapshot_json: string;
  view_key: string;
}

export function graphViewKey(scope: PersistedGraphScope) {
  const minSupport = Math.max(1, Math.trunc(scope.minSupport ?? 1));
  return [
    scope.workspaceId,
    scope.channel,
    scope.kind,
    scope.projectId ?? "*",
    scope.workflowId ?? "*",
    scope.sessionId ?? "*",
    `min${minSupport}`,
  ].join(":");
}

export async function readGraphHead(
  db: D1Database,
  scopeOrViewKey: PersistedGraphScope | string
): Promise<StoredGraphHead | null> {
  const viewKey =
    typeof scopeOrViewKey === "string"
      ? scopeOrViewKey
      : graphViewKey(scopeOrViewKey);
  const row = await db
    .prepare(
      `SELECT view_key, workspace_id, channel, project_id, workflow_id,
              session_id, kind, min_support, head_revision, graph_hash,
              snapshot_json, updated_at
       FROM pm_graph_view
       WHERE view_key = ?`
    )
    .bind(viewKey)
    .first<GraphViewRow>();
  return row ? graphHeadFromRow(row) : null;
}

export async function readGraphRevision(
  db: D1Database,
  viewKey: string,
  revision: number
) {
  const row = await db
    .prepare(
      `SELECT view_key, revision, base_revision, graph_hash, delta_json,
              snapshot_json
       FROM pm_graph_revision
       WHERE view_key = ? AND revision = ?`
    )
    .bind(viewKey, revision)
    .first<GraphRevisionRow>();
  return row ? graphRevisionFromRow(row) : null;
}

export async function readGraphDeltas(
  db: D1Database,
  viewKey: string,
  afterRevision: number
) {
  const rows = await db
    .prepare(
      `SELECT view_key, revision, base_revision, graph_hash, delta_json,
              snapshot_json
       FROM pm_graph_revision
       WHERE view_key = ? AND revision > ?
       ORDER BY revision`
    )
    .bind(viewKey, Math.max(0, Math.trunc(afterRevision)))
    .all<GraphRevisionRow>();
  return rows.results.map(graphRevisionFromRow);
}

export async function persistGraphRevision(
  db: D1Database,
  input: PersistGraphRevisionInput
): Promise<PersistGraphRevisionResult> {
  const viewKey = graphViewKey(input.scope);
  const operationKey = `${viewKey}:${input.operationKey}`;
  const existingOperation = await readRevisionByOperation(db, operationKey);
  if (existingOperation) {
    return {
      delta: existingOperation.delta,
      graph: existingOperation.graph,
      graphHash: existingOperation.delta.graphHash,
      inserted: false,
      revision: existingOperation.delta.revision,
      viewKey,
    };
  }

  const head = await readGraphHead(db, viewKey);
  if (head?.graphHash === input.graph.revision) {
    return {
      delta: emptyDelta(viewKey, head.revision, input.graph),
      graph: head.graph,
      graphHash: head.graphHash,
      inserted: false,
      revision: head.revision,
      viewKey,
    };
  }

  const baseRevision = head?.revision ?? 0;
  const revision = baseRevision + 1;
  const now = input.now ?? new Date().toISOString();
  const diff = diffAggregateGraphs(head?.graph ?? null, input.graph);
  const delta: StoredGraphDelta = {
    ...diff,
    baseRevision,
    graphHash: input.graph.revision,
    revision,
    viewKey,
  };
  const snapshotJson = JSON.stringify(input.graph);
  const deltaJson = JSON.stringify(delta);
  const inserted = await db
    .prepare(
      `INSERT INTO pm_graph_revision
       (view_key, revision, base_revision, operation_key, graph_hash,
        delta_json, snapshot_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(operation_key) DO NOTHING
       RETURNING view_key, revision, base_revision, graph_hash, delta_json,
                 snapshot_json`
    )
    .bind(
      viewKey,
      revision,
      baseRevision,
      operationKey,
      input.graph.revision,
      deltaJson,
      snapshotJson,
      now
    )
    .first<GraphRevisionRow>();

  if (!inserted) {
    const existing = await readRevisionByOperation(db, operationKey);
    if (existing) {
      return {
        delta: existing.delta,
        graph: existing.graph,
        graphHash: existing.delta.graphHash,
        inserted: false,
        revision: existing.delta.revision,
        viewKey,
      };
    }
    throw new Error("Graph revision insert did not return a stored revision.");
  }

  await db
    .prepare(
      `INSERT INTO pm_graph_view
       (view_key, workspace_id, channel, project_id, workflow_id, session_id,
        kind, min_support, head_revision, graph_hash, snapshot_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(view_key) DO UPDATE SET
         head_revision = excluded.head_revision,
         graph_hash = excluded.graph_hash,
         snapshot_json = excluded.snapshot_json,
         updated_at = excluded.updated_at
       WHERE pm_graph_view.head_revision <= excluded.head_revision`
    )
    .bind(
      viewKey,
      input.scope.workspaceId,
      input.scope.channel,
      input.scope.projectId ?? null,
      input.scope.workflowId ?? null,
      input.scope.sessionId ?? null,
      input.scope.kind,
      Math.max(1, Math.trunc(input.scope.minSupport ?? 1)),
      revision,
      input.graph.revision,
      snapshotJson,
      now
    )
    .run();

  return {
    delta,
    graph: input.graph,
    graphHash: input.graph.revision,
    inserted: true,
    revision,
    viewKey,
  };
}

async function readRevisionByOperation(db: D1Database, operationKey: string) {
  const row = await db
    .prepare(
      `SELECT view_key, revision, base_revision, graph_hash, delta_json,
              snapshot_json
       FROM pm_graph_revision
       WHERE operation_key = ?`
    )
    .bind(operationKey)
    .first<GraphRevisionRow>();
  return row ? graphRevisionFromRow(row) : null;
}

function emptyDelta(
  viewKey: string,
  revision: number,
  graph: AggregateGraph
): StoredGraphDelta {
  return {
    added: { edges: [], nodes: [] },
    baseRevision: revision,
    fromRevision: graph.revision,
    graphHash: graph.revision,
    removed: { edges: [], nodes: [] },
    revision,
    toRevision: graph.revision,
    updated: { edges: [], nodes: [] },
    viewKey,
  };
}

function graphHeadFromRow(row: GraphViewRow): StoredGraphHead {
  return {
    graph: JSON.parse(row.snapshot_json) as AggregateGraph,
    graphHash: row.graph_hash,
    revision: row.head_revision,
    scope: {
      channel: row.channel,
      kind: row.kind,
      minSupport: row.min_support,
      ...(row.project_id ? { projectId: row.project_id } : {}),
      ...(row.session_id ? { sessionId: row.session_id } : {}),
      ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
      workspaceId: row.workspace_id,
    },
    updatedAt: row.updated_at,
    viewKey: row.view_key,
  };
}

function graphRevisionFromRow(row: GraphRevisionRow) {
  return {
    delta: JSON.parse(row.delta_json) as StoredGraphDelta,
    graph: JSON.parse(row.snapshot_json) as AggregateGraph,
    viewKey: row.view_key,
  };
}
