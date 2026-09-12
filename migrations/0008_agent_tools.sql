-- Agent tool persistence for issue #39.
-- Additive only: graph edits remain proposed until a human-only edit route applies them.

CREATE TABLE IF NOT EXISTS agent_edit_proposal (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  rationale TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  CHECK (status IN ('proposed', 'rejected', 'applied'))
);

CREATE INDEX IF NOT EXISTS agent_edit_proposal_scope
  ON agent_edit_proposal(workspace_id, channel, project_id, workflow_id, created_at);

CREATE TABLE IF NOT EXISTS agent_event (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workflow_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  nodes_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  pauses INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'recorded',
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_event_scope
  ON agent_event(workspace_id, channel, project_id, workflow_id, created_at);
