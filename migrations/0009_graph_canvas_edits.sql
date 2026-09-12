-- Session-scoped edit log for the current graph canvas.
-- Keeps synthetic observations immutable while letting the UI derive labels and
-- designed-edge overlays from authenticated user edits.

CREATE TABLE IF NOT EXISTS graph_canvas_edits (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  workflow TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0,
  CHECK (action IN ('create_edge', 'move_edge', 'rename_edge', 'rename_node'))
);

CREATE INDEX IF NOT EXISTS graph_canvas_edits_session_workflow
  ON graph_canvas_edits(session_id, workflow, created_at);
