-- Tenant foundation: real Slack workspace installs, observed channels, resolved
-- people and workspace-authored process definitions.
--
-- Replaces the checked-in synthetic knowledge base (Helios/Atlas personas) and the
-- legacy synthetic event store. Every authored and observed row is scoped by the
-- Slack workspace (team) id that produced it, so one deployment can serve several
-- installs without mixing evidence.

-- Bot-level workspace install obtained through Slack OAuth v2. One row per team.
CREATE TABLE IF NOT EXISTS slack_install (
  workspace_id TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  team_domain TEXT,
  app_id TEXT,
  bot_user_id TEXT NOT NULL,
  bot_token TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',
  installed_by TEXT,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS slack_install_active
  ON slack_install(revoked_at, workspace_id);

-- Channels the workspace has asked Ariadne to observe. A channel is only mined
-- once it is enabled and bound to a project.
CREATE TABLE IF NOT EXISTS slack_channel (
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  project_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  session_idle_seconds INTEGER NOT NULL DEFAULT 3600,
  backfilled_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, channel_id)
);

CREATE INDEX IF NOT EXISTS slack_channel_enabled
  ON slack_channel(workspace_id, enabled, channel_id);

-- People resolved from Slack via users.info. person_id is derived from the Slack
-- user id so extraction output is stable across re-resolution.
CREATE TABLE IF NOT EXISTS tenant_person (
  workspace_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  real_name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  role_id TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  avatar_url TEXT,
  color TEXT NOT NULL DEFAULT '#6366F1',
  tz TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, person_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_person_slack_user
  ON tenant_person(workspace_id, slack_user_id);

-- Roles are workspace-authored; there is no fixed vocabulary.
CREATE TABLE IF NOT EXISTS tenant_role (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS tenant_project (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  spec_md TEXT NOT NULL DEFAULT '',
  constraints_json TEXT NOT NULL DEFAULT '[]',
  workflow_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS tenant_workflow (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  entry_slug TEXT NOT NULL,
  exit_slugs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS tenant_workflow_project
  ON tenant_workflow(workspace_id, project_id, id);

-- Designed activities in workflow order. rank drives the designed happy path.
CREATE TABLE IF NOT EXISTS tenant_activity (
  workspace_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  role_expected TEXT,
  rank INTEGER NOT NULL,
  synonyms_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (workspace_id, workflow_id, slug),
  CHECK (slug GLOB '[a-z][a-z0-9_][a-z0-9_]*')
);

CREATE INDEX IF NOT EXISTS tenant_activity_rank
  ON tenant_activity(workspace_id, workflow_id, rank, slug);

CREATE TABLE IF NOT EXISTS tenant_edge (
  workspace_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  from_slug TEXT NOT NULL,
  to_slug TEXT NOT NULL,
  probability REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (workspace_id, workflow_id, from_slug, to_slug)
);

CREATE TABLE IF NOT EXISTS tenant_policy (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workflow_id TEXT,
  kind TEXT NOT NULL,
  activity_slug TEXT NOT NULL,
  text TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CHECK (kind IN ('approval', 'mandatory', 'ordering', 'threshold'))
);

CREATE INDEX IF NOT EXISTS tenant_policy_project
  ON tenant_policy(workspace_id, project_id, id);

-- Which activities a role is expected to perform, used as an extraction prior and
-- to score role deviations.
CREATE TABLE IF NOT EXISTS tenant_role_repertoire (
  workspace_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  activity_slug TEXT NOT NULL,
  relation TEXT NOT NULL,
  PRIMARY KEY (workspace_id, role_id, activity_slug, relation),
  CHECK (relation IN ('performs', 'never_performs'))
);

-- Channel-level session segmentation state. Tracks the session a new message
-- joins, so ingestion does not have to re-scan message history.
CREATE TABLE IF NOT EXISTS pm_session_cursor (
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  session_id TEXT NOT NULL,
  last_message_ts TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, channel)
);

-- Thread root to session mapping, so a late thread reply joins its parent session
-- instead of opening a new one.
CREATE TABLE IF NOT EXISTS pm_session_thread (
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, channel, thread_ts)
);

-- Message provenance. Existing rows are synthetic simulator output and are removed
-- below, so backfilling the column with 'slack' is safe.
ALTER TABLE pm_message ADD COLUMN source TEXT NOT NULL DEFAULT 'slack';

-- Outbound delivery bookkeeping, so a failed agent post is diagnosable and
-- retried with backoff instead of retried forever or silently dropped.
ALTER TABLE pm_outbox ADD COLUMN last_error TEXT;
ALTER TABLE pm_outbox ADD COLUMN delivered_ts TEXT;

-- Slack workspace identity on the signed-in user. This is what scopes a request
-- to the caller's own workspace instead of a server-wide configured channel.
-- Added here rather than by regenerating 0003_better_auth.sql, which is already
-- applied to the deployed databases.
ALTER TABLE auth_user ADD COLUMN "slackTeamId" TEXT;
ALTER TABLE auth_user ADD COLUMN "slackTeamName" TEXT;
ALTER TABLE auth_user ADD COLUMN "slackUserId" TEXT;

CREATE INDEX IF NOT EXISTS auth_user_slack_team
  ON auth_user("slackTeamId");

-- Remove every synthetic row and the legacy simulation store. The simulator that
-- produced these is deleted in the same change; keeping the rows would leave
-- fabricated Slack permalinks and fictional personas in a production graph.
DELETE FROM pm_step_evidence;
DELETE FROM pm_step;
DELETE FROM pm_message;
DELETE FROM pm_session;
DELETE FROM pm_role_deviation_evidence;
DELETE FROM pm_role_deviation;
DELETE FROM pm_unreconciled_work_evidence;
DELETE FROM pm_unreconciled_work;
DELETE FROM pm_promise_reconciliation;
DELETE FROM pm_journal;
DELETE FROM pm_processing;
DELETE FROM pm_outbox;
DELETE FROM pm_graph_revision;
DELETE FROM pm_graph_view;
DELETE FROM pm_graph_edit_revision;
DELETE FROM pm_agent_message;
DELETE FROM pm_agent_thread;
DELETE FROM agent_edit_proposal;
DELETE FROM agent_event;

-- Legacy synthetic event store for the removed simulation API.
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS edits;
DROP TABLE IF EXISTS graph_canvas_edits;
DROP TABLE IF EXISTS sessions;

-- Authored-knowledge tables superseded by the workspace-scoped tenant_* tables
-- above. These were never workspace-scoped, so they cannot hold a tenant's data
-- safely, and nothing reads them any more.
DROP TABLE IF EXISTS pm_kb_nodes;
DROP TABLE IF EXISTS pm_kb_workflow_activities;
DROP TABLE IF EXISTS pm_kb_workflow_follows;
DROP TABLE IF EXISTS pm_kb_state;
DROP TABLE IF EXISTS pm_person;
DROP TABLE IF EXISTS pm_project;
DROP TABLE IF EXISTS pm_policy;
DROP TABLE IF EXISTS pm_artifact;
DROP TABLE IF EXISTS pm_activity_synonym;
DROP TABLE IF EXISTS pm_activity;
DROP TABLE IF EXISTS pm_workflow_activity;
DROP TABLE IF EXISTS pm_workflow;
DROP TABLE IF EXISTS pm_designed_edge;
DROP TABLE IF EXISTS pm_role_repertoire;
DROP TABLE IF EXISTS pm_role;
DROP TABLE IF EXISTS pm_artifact_lifecycle_transition;
DROP TABLE IF EXISTS pm_artifact_lifecycle;
