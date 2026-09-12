-- Process-mining foundation schema for Roman spec issue #14.
-- Additive only: preserves existing demo, auth and raw Slack observation tables.

CREATE TABLE IF NOT EXISTS pm_role (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pm_person (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_id TEXT NOT NULL,
  seniority TEXT NOT NULL,
  emoji TEXT NOT NULL,
  color TEXT NOT NULL,
  goals_json TEXT NOT NULL DEFAULT '[]',
  biases_json TEXT NOT NULL DEFAULT '[]',
  comms_style TEXT NOT NULL,
  project_ids_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS pm_project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  spec_md TEXT NOT NULL,
  constraints_json TEXT NOT NULL DEFAULT '[]',
  workflow_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pm_artifact (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  uri TEXT,
  project_id TEXT NOT NULL,
  current_state TEXT,
  value REAL,
  unit TEXT
);

CREATE TABLE IF NOT EXISTS pm_policy (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  kind TEXT NOT NULL,
  activity_slug TEXT NOT NULL,
  project_id TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS pm_activity (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  project_id TEXT,
  role_expected TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (slug GLOB '[a-z][a-z0-9_][a-z0-9_]*')
);

CREATE TABLE IF NOT EXISTS pm_activity_synonym (
  activity_id TEXT NOT NULL,
  synonym TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'authored',
  PRIMARY KEY (activity_id, synonym)
);

CREATE TABLE IF NOT EXISTS pm_workflow (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_id TEXT NOT NULL,
  plane TEXT NOT NULL,
  entry_activity TEXT NOT NULL,
  exit_activities_json TEXT NOT NULL DEFAULT '[]',
  activity_slugs_json TEXT NOT NULL DEFAULT '[]',
  matrix_json TEXT NOT NULL DEFAULT '[]',
  policy_ids_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS pm_workflow_activity (
  workflow_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  expected_role TEXT NOT NULL,
  rank INTEGER NOT NULL,
  PRIMARY KEY (workflow_id, activity_id)
);

CREATE INDEX IF NOT EXISTS pm_workflow_activity_rank
  ON pm_workflow_activity(workflow_id, rank);

CREATE TABLE IF NOT EXISTS pm_designed_edge (
  workflow_id TEXT NOT NULL,
  from_activity_id TEXT NOT NULL,
  to_activity_id TEXT NOT NULL,
  probability REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (workflow_id, from_activity_id, to_activity_id)
);

CREATE TABLE IF NOT EXISTS pm_role_repertoire (
  role_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  PRIMARY KEY (role_id, activity_id, relation),
  CHECK (relation IN ('performs', 'never_performs'))
);

CREATE TABLE IF NOT EXISTS pm_artifact_lifecycle (
  artifact_type TEXT PRIMARY KEY,
  states_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS pm_artifact_lifecycle_transition (
  artifact_type TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  PRIMARY KEY (artifact_type, from_state, to_state, activity_id)
);

CREATE TABLE IF NOT EXISTS pm_session (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workflow_id TEXT,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  scenario_id TEXT,
  variant TEXT,
  started_ts TEXT NOT NULL,
  ended_ts TEXT,
  suggested INTEGER NOT NULL DEFAULT 0,
  fitness REAL,
  missing_json TEXT NOT NULL DEFAULT '[]',
  extra_json TEXT NOT NULL DEFAULT '[]',
  violations_json TEXT NOT NULL DEFAULT '[]',
  CHECK (status IN ('open', 'closed')),
  CHECK (source IN ('simulation', 'human'))
);

CREATE INDEX IF NOT EXISTS pm_session_scope
  ON pm_session(workspace_id, channel, project_id, started_ts);

CREATE TABLE IF NOT EXISTS pm_message (
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  ts TEXT NOT NULL,
  id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  author_person_id TEXT,
  author_label TEXT NOT NULL,
  text TEXT NOT NULL,
  permalink TEXT NOT NULL,
  thread_ts TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0,
  availability TEXT NOT NULL DEFAULT 'available',
  is_agent INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, channel, ts)
);

CREATE INDEX IF NOT EXISTS pm_message_session
  ON pm_message(session_id, ts);

CREATE TABLE IF NOT EXISTS pm_step (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  activity_id TEXT,
  actor_person_id TEXT,
  artifact_id TEXT,
  intent TEXT NOT NULL,
  type TEXT NOT NULL,
  handoff_to_person_id TEXT,
  modality TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  curation_status TEXT NOT NULL,
  negated INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL,
  ts_start TEXT NOT NULL,
  ts_end TEXT,
  effort_days REAL,
  UNIQUE (session_id, seq),
  CHECK (type IN ('action', 'decision', 'handoff', 'wait', 'rework', 'approval')),
  CHECK (modality IN ('reported', 'committed', 'requested', 'negated')),
  CHECK (lifecycle_state IN ('requested', 'committed', 'in_progress', 'done', 'failed', 'skipped', 'abandoned')),
  CHECK (curation_status IN ('proposed', 'confirmed', 'rejected')),
  CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS pm_step_session_sequence
  ON pm_step(session_id, seq);

CREATE INDEX IF NOT EXISTS pm_step_activity_state
  ON pm_step(activity_id, lifecycle_state, curation_status, negated);

CREATE TABLE IF NOT EXISTS pm_step_evidence (
  step_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  message_revision INTEGER NOT NULL,
  span_start INTEGER,
  span_end INTEGER,
  PRIMARY KEY (step_id, workspace_id, channel, message_ts)
);

CREATE INDEX IF NOT EXISTS pm_step_evidence_message
  ON pm_step_evidence(workspace_id, channel, message_ts, message_revision);

CREATE TABLE IF NOT EXISTS pm_promise_reconciliation (
  source_step_id TEXT NOT NULL,
  report_step_id TEXT NOT NULL,
  resolution TEXT NOT NULL,
  reconciled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_step_id, report_step_id),
  CHECK (resolution IN ('advanced', 'duplicate_dropped', 'unmatched'))
);

CREATE TABLE IF NOT EXISTS pm_role_deviation (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  expected_role TEXT NOT NULL,
  observed_role TEXT NOT NULL,
  sessions_json TEXT NOT NULL DEFAULT '[]',
  session_count INTEGER NOT NULL DEFAULT 0,
  of_sessions INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pm_role_deviation_evidence (
  role_deviation_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  message_revision INTEGER NOT NULL,
  PRIMARY KEY (role_deviation_id, workspace_id, channel, message_ts)
);

CREATE TABLE IF NOT EXISTS pm_unreconciled_work (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL,
  actor_person_id TEXT,
  lifecycle_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (lifecycle_state IN ('requested', 'committed', 'in_progress', 'failed', 'abandoned')),
  CHECK (reason IN ('still_open', 'case_closed', 'abandoned'))
);

CREATE TABLE IF NOT EXISTS pm_unreconciled_work_evidence (
  unreconciled_work_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  message_revision INTEGER NOT NULL,
  PRIMARY KEY (unreconciled_work_id, workspace_id, channel, message_ts)
);

CREATE TABLE IF NOT EXISTS pm_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_id TEXT,
  kind TEXT NOT NULL,
  ts TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS pm_journal_scope
  ON pm_journal(workspace_id, channel, project_id, id);

CREATE TABLE IF NOT EXISTS pm_outbox (
  operation_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  slack_ts TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_due_ts TEXT,
  CHECK (status IN ('pending', 'sent', 'uncertain', 'failed'))
);

CREATE INDEX IF NOT EXISTS pm_outbox_pending
  ON pm_outbox(status, next_due_ts);

CREATE TABLE IF NOT EXISTS pm_processing (
  checkpoint_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  retries INTEGER NOT NULL DEFAULT 0,
  extraction_window_revision INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('pending', 'done', 'error'))
);

CREATE INDEX IF NOT EXISTS pm_processing_status
  ON pm_processing(workspace_id, channel, status, updated_at);
