import type { DesignedGraphEditAction } from "../shared/model-edits.ts";
import type { ChannelScope } from "./runtime/channel.ts";

export interface StoredGraphEdit {
  action: DesignedGraphEditAction | "reconcile" | "undo";
  actorId: string;
  baseRevision: number;
  createdAt: string;
  id: string;
  payload: Record<string, unknown>;
  projectId: string;
  requestId: string | null;
  revision: number;
  targetEditId: string | null;
  undone: boolean;
  workflowId: string;
}

export interface AppendGraphEditInput {
  action: DesignedGraphEditAction | "reconcile";
  actorId: string;
  baseRevision?: number;
  id?: string;
  now?: string;
  payload: Record<string, unknown>;
  projectId: string;
  requestId?: string;
  scope: ChannelScope;
  workflowId: string;
}

export interface UndoGraphEditInput {
  actorId: string;
  baseRevision?: number;
  now?: string;
  requestId?: string;
  scope: ChannelScope;
  workflowId: string;
}

export type GraphEditWriteResult =
  | { edit: StoredGraphEdit; status: "created" | "duplicate" }
  | { currentRevision: number; status: "conflict" }
  | { currentRevision: number; status: "empty" };

interface GraphEditRow {
  action: StoredGraphEdit["action"];
  actor_id: string;
  base_revision: number;
  created_at: string;
  id: string;
  payload_json: string;
  project_id: string;
  request_id: string | null;
  revision: number;
  target_edit_id: string | null;
  undone: number;
  workflow_id: string;
}

export async function readGraphEditHead(
  db: D1Database,
  scope: ChannelScope,
  workflowId: string
) {
  const row = await db
    .prepare(
      `SELECT MAX(revision) AS revision
       FROM pm_graph_edit_revision
       WHERE workspace_id = ? AND channel = ? AND workflow_id = ?`
    )
    .bind(scope.workspaceId, scope.channel, workflowId)
    .first<{ revision: number | null }>();
  return row?.revision ?? 0;
}

export async function readGraphEditHistory(
  db: D1Database,
  scope: ChannelScope,
  workflowId: string
) {
  const rows = await db
    .prepare(
      `SELECT *
       FROM pm_graph_edit_revision
       WHERE workspace_id = ? AND channel = ? AND workflow_id = ?
       ORDER BY revision`
    )
    .bind(scope.workspaceId, scope.channel, workflowId)
    .all<GraphEditRow>();
  return rows.results.map(toStoredEdit);
}

export function readGraphEditByRequestId(
  db: D1Database,
  scope: ChannelScope,
  workflowId: string,
  requestId: string | undefined
) {
  return readEditByRequestId(db, scope, workflowId, requestId);
}

export async function readActiveDesignedGraphEdits(
  db: D1Database,
  scope: ChannelScope,
  workflowId: string
) {
  const rows = await db
    .prepare(
      `SELECT *
       FROM pm_graph_edit_revision
       WHERE workspace_id = ? AND channel = ? AND workflow_id = ?
         AND undone = 0
         AND action IN ('add_edge', 'add_node', 'merge_nodes', 'remove_edge', 'remove_node', 'rename_node')
       ORDER BY revision`
    )
    .bind(scope.workspaceId, scope.channel, workflowId)
    .all<GraphEditRow>();
  return rows.results.map(toStoredEdit);
}

export async function appendGraphEdit(
  db: D1Database,
  input: AppendGraphEditInput
): Promise<GraphEditWriteResult> {
  const duplicate = await readEditByRequestId(
    db,
    input.scope,
    input.workflowId,
    input.requestId
  );
  if (duplicate) {
    return { edit: duplicate, status: "duplicate" };
  }
  const currentRevision = await readGraphEditHead(
    db,
    input.scope,
    input.workflowId
  );
  if (
    input.baseRevision !== undefined &&
    input.baseRevision !== currentRevision
  ) {
    return { currentRevision, status: "conflict" };
  }
  const revision = currentRevision + 1;
  const id = input.id ?? crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO pm_graph_edit_revision
       (id, workspace_id, channel, project_id, workflow_id, revision, base_revision,
        request_id, action, payload_json, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.scope.workspaceId,
      input.scope.channel,
      input.projectId,
      input.workflowId,
      revision,
      currentRevision,
      input.requestId ?? null,
      input.action,
      JSON.stringify(input.payload),
      input.actorId,
      input.now ?? new Date().toISOString()
    )
    .run();
  const edit = await readEditById(db, id);
  if (!edit) {
    throw new Error("Graph edit insert did not return a stored edit.");
  }
  return { edit, status: "created" };
}

export async function undoLatestGraphEdit(
  db: D1Database,
  input: UndoGraphEditInput
): Promise<GraphEditWriteResult> {
  const duplicate = await readEditByRequestId(
    db,
    input.scope,
    input.workflowId,
    input.requestId
  );
  if (duplicate) {
    return { edit: duplicate, status: "duplicate" };
  }
  const currentRevision = await readGraphEditHead(
    db,
    input.scope,
    input.workflowId
  );
  if (
    input.baseRevision !== undefined &&
    input.baseRevision !== currentRevision
  ) {
    return { currentRevision, status: "conflict" };
  }
  const target = await db
    .prepare(
      `SELECT *
       FROM pm_graph_edit_revision
       WHERE workspace_id = ? AND channel = ? AND workflow_id = ?
         AND undone = 0
         AND action IN ('add_edge', 'add_node', 'merge_nodes', 'remove_edge', 'remove_node', 'rename_node', 'reconcile')
       ORDER BY revision DESC
       LIMIT 1`
    )
    .bind(input.scope.workspaceId, input.scope.channel, input.workflowId)
    .first<GraphEditRow>();
  if (!target) {
    return { currentRevision, status: "empty" };
  }
  const revision = currentRevision + 1;
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare("UPDATE pm_graph_edit_revision SET undone = 1 WHERE id = ?")
      .bind(target.id),
    db
      .prepare(
        `INSERT INTO pm_graph_edit_revision
         (id, workspace_id, channel, project_id, workflow_id, revision, base_revision,
          request_id, action, payload_json, actor_id, created_at, target_edit_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'undo', ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.scope.workspaceId,
        input.scope.channel,
        target.project_id,
        input.workflowId,
        revision,
        currentRevision,
        input.requestId ?? null,
        JSON.stringify({ target_edit_id: target.id }),
        input.actorId,
        input.now ?? new Date().toISOString(),
        target.id
      ),
  ]);
  const edit = await readEditById(db, id);
  if (!edit) {
    throw new Error("Graph edit undo did not return a stored edit.");
  }
  return { edit, status: "created" };
}

async function readEditByRequestId(
  db: D1Database,
  scope: ChannelScope,
  workflowId: string,
  requestId: string | undefined
) {
  if (!requestId) {
    return null;
  }
  const row = await db
    .prepare(
      `SELECT *
       FROM pm_graph_edit_revision
       WHERE workspace_id = ? AND channel = ? AND workflow_id = ? AND request_id = ?`
    )
    .bind(scope.workspaceId, scope.channel, workflowId, requestId)
    .first<GraphEditRow>();
  return row ? toStoredEdit(row) : null;
}

async function readEditById(db: D1Database, id: string) {
  const row = await db
    .prepare("SELECT * FROM pm_graph_edit_revision WHERE id = ?")
    .bind(id)
    .first<GraphEditRow>();
  return row ? toStoredEdit(row) : null;
}

function toStoredEdit(row: GraphEditRow): StoredGraphEdit {
  return {
    action: row.action,
    actorId: row.actor_id,
    baseRevision: row.base_revision,
    createdAt: row.created_at,
    id: row.id,
    payload: parsePayload(row.payload_json),
    projectId: row.project_id,
    requestId: row.request_id,
    revision: row.revision,
    targetEditId: row.target_edit_id,
    undone: row.undone === 1,
    workflowId: row.workflow_id,
  };
}

function parsePayload(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
