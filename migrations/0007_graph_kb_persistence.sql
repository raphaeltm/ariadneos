-- D1 persistence for authored KB state and scoped graph revisions.
-- Additive only: preserves existing demo, auth, Slack, PM and coordinator data.

CREATE TABLE IF NOT EXISTS pm_kb_nodes (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  authored_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);

CREATE INDEX IF NOT EXISTS pm_kb_nodes_source
  ON pm_kb_nodes(source, kind, id);

CREATE TABLE IF NOT EXISTS pm_kb_workflow_activities (
  workflow_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  rank INTEGER NOT NULL,
  payload TEXT NOT NULL,
  authored_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  observed_support INTEGER NOT NULL DEFAULT 0,
  observed_occurrences INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workflow_id, activity_id)
);

CREATE INDEX IF NOT EXISTS pm_kb_workflow_activities_source_rank
  ON pm_kb_workflow_activities(workflow_id, source, rank, activity_id);

CREATE TABLE IF NOT EXISTS pm_kb_workflow_follows (
  workflow_id TEXT NOT NULL,
  from_activity_id TEXT NOT NULL,
  to_activity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  payload TEXT NOT NULL,
  authored_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  observed_support INTEGER NOT NULL DEFAULT 0,
  observed_occurrences INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workflow_id, from_activity_id, to_activity_id)
);

CREATE INDEX IF NOT EXISTS pm_kb_workflow_follows_source
  ON pm_kb_workflow_follows(workflow_id, source, from_activity_id, to_activity_id);

CREATE TABLE IF NOT EXISTS pm_kb_state (
  source TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pm_graph_view (
  view_key TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  project_id TEXT,
  workflow_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL,
  min_support INTEGER NOT NULL DEFAULT 1,
  head_revision INTEGER NOT NULL DEFAULT 0,
  graph_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pm_graph_view_scope
  ON pm_graph_view(workspace_id, channel, project_id, workflow_id, kind);

CREATE TABLE IF NOT EXISTS pm_graph_revision (
  view_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  base_revision INTEGER NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  graph_hash TEXT NOT NULL,
  delta_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (view_key, revision)
);

CREATE INDEX IF NOT EXISTS pm_graph_revision_view_created
  ON pm_graph_revision(view_key, created_at);
