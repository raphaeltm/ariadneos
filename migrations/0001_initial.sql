CREATE TABLE sessions (id TEXT PRIMARY KEY, runs INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE events (id TEXT NOT NULL, session_id TEXT NOT NULL, workflow TEXT NOT NULL, case_id TEXT NOT NULL, occurred_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (session_id,id));
CREATE INDEX events_session_workflow ON events(session_id,workflow,occurred_at);
CREATE TABLE usage (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
