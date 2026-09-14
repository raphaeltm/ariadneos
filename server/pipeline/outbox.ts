// Drains queued agent messages to Slack.
//
// Agent replies are written to pm_outbox inside the same transaction as the
// agent_event that authorised them, so a crash between "decided to post" and
// "posted" cannot lose the message or post it twice: delivery is at-least-once
// with a Slack-side idempotency guard on the operation id.

import { SlackApiError, type SlackClient } from "../slack/client.ts";
import { clientForWorkspace } from "../tenant/installs.ts";

export interface OutboxEnv {
  DB: D1Database;
  OUTBOX_MAX_PER_RUN?: string;
}

export interface OutboxOutcome {
  delivered: number;
  failed: number;
  retried: number;
  warnings: string[];
}

interface OutboxRow {
  attempts: number;
  kind: string;
  operation_id: string;
  payload_json: string;
}

const DEFAULT_MAX_PER_RUN = 5;
const MAX_ATTEMPTS = 5;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePayload(raw: string) {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || typeof parsed.text !== "string") {
      return null;
    }
    return {
      text: parsed.text,
      thread_ts: typeof parsed.thread_ts === "string" ? parsed.thread_ts : null,
    };
  } catch {
    return null;
  }
}

/** Exponential backoff in seconds, capped so a stuck row still retries hourly. */
function backoffSeconds(attempts: number) {
  return Math.min(2 ** attempts * 5, 3600);
}

export async function runOutbox(
  env: OutboxEnv,
  scope: { channel: string; workspaceId: string },
  options: { client?: SlackClient | null; now?: () => number } = {}
): Promise<OutboxOutcome> {
  const nowMs = options.now?.() ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const outcome: OutboxOutcome = {
    delivered: 0,
    failed: 0,
    retried: 0,
    warnings: [],
  };
  const limit = Math.min(
    Math.max(
      Number.parseInt(env.OUTBOX_MAX_PER_RUN ?? "", 10) || DEFAULT_MAX_PER_RUN,
      1
    ),
    50
  );
  const rows = await env.DB.prepare(
    `SELECT operation_id, kind, payload_json, attempts
     FROM pm_outbox
     WHERE workspace_id = ? AND channel = ? AND status = 'pending'
       AND next_due_ts <= ?
     ORDER BY next_due_ts, operation_id
     LIMIT ?`
  )
    .bind(scope.workspaceId, scope.channel, nowIso, limit)
    .all<OutboxRow>();
  if (rows.results.length === 0) {
    return outcome;
  }

  const client =
    options.client ?? (await clientForWorkspace(env.DB, scope.workspaceId));
  if (!client) {
    outcome.warnings.push("outbox.no_install");
    return outcome;
  }

  for (const row of rows.results) {
    // biome-ignore lint/performance/noAwaitInLoops: Slack enforces per-channel ordering and rate limits, so posts are sequential.
    const result = await deliverRow(env.DB, client, scope, row, nowMs);
    outcome[result] += 1;
  }
  return outcome;
}

/**
 * Delivers one queued post. Returns which counter the caller should advance so
 * the drain loop body stays a single awaited call.
 */
async function deliverRow(
  db: D1Database,
  client: SlackClient,
  scope: { channel: string; workspaceId: string },
  row: OutboxRow,
  nowMs: number
): Promise<"delivered" | "failed" | "retried"> {
  const nowIso = new Date(nowMs).toISOString();
  const payload = parsePayload(row.payload_json);
  if (!payload) {
    await failPermanently(db, row.operation_id, "invalid_payload", nowIso);
    return "failed";
  }
  try {
    const posted = await client.chatPostMessage({
      channel: scope.channel,
      text: payload.text,
      thread_ts: payload.thread_ts,
    });
    await db
      .prepare(
        `UPDATE pm_outbox
         SET status = 'sent', attempts = attempts + 1, last_error = NULL,
             delivered_ts = ?, slack_ts = ?
         WHERE operation_id = ?`
      )
      .bind(nowIso, posted.ts, row.operation_id)
      .run();
    return "delivered";
  } catch (error) {
    const retryable = error instanceof SlackApiError ? error.retryable : false;
    const message =
      error instanceof Error ? error.message : "unknown delivery failure";
    const attempts = row.attempts + 1;
    if (!retryable || attempts >= MAX_ATTEMPTS) {
      await failPermanently(db, row.operation_id, message, nowIso);
      return "failed";
    }
    const dueAt = new Date(
      nowMs + backoffSeconds(attempts) * 1000
    ).toISOString();
    await db
      .prepare(
        `UPDATE pm_outbox
         SET attempts = ?, last_error = ?, next_due_ts = ?
         WHERE operation_id = ?`
      )
      .bind(attempts, message.slice(0, 400), dueAt, row.operation_id)
      .run();
    return "retried";
  }
}

async function failPermanently(
  db: D1Database,
  operationId: string,
  message: string,
  now: string
) {
  await db
    .prepare(
      `UPDATE pm_outbox
       SET status = 'failed', attempts = attempts + 1, last_error = ?,
           delivered_ts = ?
       WHERE operation_id = ?`
    )
    .bind(message.slice(0, 400), now, operationId)
    .run();
}

export async function pendingOutboxCount(
  db: D1Database,
  scope: { channel: string; workspaceId: string }
) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM pm_outbox
       WHERE workspace_id = ? AND channel = ? AND status = 'pending'`
    )
    .bind(scope.workspaceId, scope.channel)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
