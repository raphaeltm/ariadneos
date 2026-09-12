-- Coordinator runtime indexes for issue #16. The pm_* foundation tables are
-- created by 0005_pm_foundation.sql; this migration keeps the runtime additive.

CREATE INDEX IF NOT EXISTS pm_journal_scope_id
  ON pm_journal(workspace_id, channel, id);

CREATE INDEX IF NOT EXISTS pm_journal_operation_scope
  ON pm_journal(workspace_id, channel, operation_key);

CREATE INDEX IF NOT EXISTS pm_processing_recovery
  ON pm_processing(workspace_id, channel, status, updated_at);

CREATE INDEX IF NOT EXISTS pm_outbox_recovery
  ON pm_outbox(workspace_id, channel, status, next_due_ts);
