-- Session-scoped graph repair edit log for issue #32.
-- Additive only: observations and authored baseline data remain immutable.

CREATE TABLE IF NOT EXISTS edits (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  workflow TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS edits_session_workflow
  ON edits(session_id, workflow, created_at);
