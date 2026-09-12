-- Scoped designed-graph edit log with revision history.
-- Additive only: authored KB rows remain immutable and edits reduce over them.

CREATE TABLE IF NOT EXISTS pm_graph_edit_revision (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  base_revision INTEGER NOT NULL,
  request_id TEXT,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  target_edit_id TEXT,
  undone INTEGER NOT NULL DEFAULT 0,
  proposal_id TEXT,
  CHECK (revision > 0),
  CHECK (base_revision >= 0),
  CHECK (undone IN (0, 1)),
  CHECK (
    action IN (
      'add_edge',
      'add_node',
      'merge_nodes',
      'remove_edge',
      'remove_node',
      'rename_node',
      'undo',
      'reconcile'
    )
  ),
  UNIQUE (workspace_id, channel, workflow_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS pm_graph_edit_revision_request
  ON pm_graph_edit_revision(workspace_id, channel, workflow_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pm_graph_edit_revision_scope
  ON pm_graph_edit_revision(workspace_id, channel, project_id, workflow_id, revision);

CREATE INDEX IF NOT EXISTS pm_graph_edit_revision_active
  ON pm_graph_edit_revision(workspace_id, channel, workflow_id, undone, revision);
