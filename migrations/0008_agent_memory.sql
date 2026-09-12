-- D1-backed Ariadne conversation memory.
-- Additive only: preserves demo, auth, Slack, PM, coordinator, graph and KB data.

CREATE TABLE IF NOT EXISTS pm_agent_thread (
  thread_key TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workflow TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_mode TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pm_agent_thread_scope
  ON pm_agent_thread(workspace_id, channel, user_id, workflow, updated_at);

CREATE TABLE IF NOT EXISTS pm_agent_message (
  id TEXT NOT NULL UNIQUE,
  thread_key TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  mode TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  content_chars INTEGER NOT NULL,
  estimated_tokens INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (thread_key, sequence),
  CHECK (role IN ('system', 'user', 'assistant')),
  CHECK (mode IN ('input', 'ai', 'summary', 'error', 'context'))
);

CREATE INDEX IF NOT EXISTS pm_agent_message_thread_recent
  ON pm_agent_message(thread_key, sequence DESC);
