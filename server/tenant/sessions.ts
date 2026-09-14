// Session segmentation: groups observed Slack messages into process sessions.
//
// Process mining needs a case identifier. Slack has none, so Ariadne derives one
// from conversation structure:
//
//   - A thread is one case. Every reply joins the session its thread root opened.
//   - Channel-level messages join the currently open session while they keep
//     arriving inside the channel's idle window; a longer silence closes that
//     session and the next message opens a new one.
//
// Segmentation is deliberately deterministic and model-free, so a re-run over the
// same message order produces the same sessions.

import type { ObservedChannel } from "./installs.ts";

export interface SessionAssignment {
  /** Set when this message closed the previous session before opening a new one. */
  closed_session_id: string | null;
  created: boolean;
  session_id: string;
}

interface CursorRow {
  last_activity_at: string;
  last_message_ts: string;
  session_id: string;
}

interface ThreadRow {
  session_id: string;
}

function sanitize(value: string) {
  return value.replaceAll(/[^A-Za-z0-9]+/g, "_");
}

/** Session ids embed the scope and opening timestamp so they are self-describing. */
export function sessionIdFor(
  workspaceId: string,
  channel: string,
  rootTs: string
) {
  return `ses_${sanitize(workspaceId)}_${sanitize(channel)}_${sanitize(rootTs)}`.toLowerCase();
}

function slackTsToIso(ts: string) {
  const seconds = Number.parseFloat(ts);
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
}

async function openSession(
  db: D1Database,
  input: {
    channel: ObservedChannel;
    projectId: string;
    sessionId: string;
    startedTs: string;
    workflowId: string | null;
  }
) {
  await db
    .prepare(
      `INSERT INTO pm_session
       (id, workspace_id, channel, project_id, workflow_id, status, source,
        scenario_id, variant, started_ts, ended_ts, suggested, fitness,
        missing_json, extra_json, violations_json)
       VALUES (?, ?, ?, ?, ?, 'open', 'human', NULL, NULL, ?, NULL, 0, NULL,
               '[]', '[]', '[]')
       ON CONFLICT(id) DO NOTHING`
    )
    .bind(
      input.sessionId,
      input.channel.workspace_id,
      input.channel.channel_id,
      input.projectId,
      input.workflowId,
      input.startedTs
    )
    .run();
}

export async function closeSession(
  db: D1Database,
  sessionId: string,
  endedTs: string
) {
  await db
    .prepare(
      `UPDATE pm_session SET status = 'closed', ended_ts = ?
       WHERE id = ? AND status = 'open'`
    )
    .bind(endedTs, sessionId)
    .run();
}

/**
 * Returns the session an observed message belongs to, creating it when needed.
 *
 * Thread replies are routed by thread root. Channel-level messages extend the
 * open session when they arrive within the idle window and start a new one
 * otherwise. Out-of-order deliveries never reopen a closed session: they attach
 * to the session whose window covers them, falling back to their own new session,
 * so evidence is never silently moved between cases.
 */
export async function assignSession(
  db: D1Database,
  input: {
    channel: ObservedChannel;
    messageTs: string;
    threadTs: string | null;
    workflowId: string | null;
  }
): Promise<SessionAssignment> {
  const { channel } = input;
  const projectId = channel.project_id;
  if (!projectId) {
    throw new Error("Cannot assign a session for a channel without a project.");
  }
  const rootTs = input.threadTs ?? input.messageTs;
  const messageAt = slackTsToIso(input.messageTs);

  if (input.threadTs) {
    const existing = await db
      .prepare(
        `SELECT session_id FROM pm_session_thread
         WHERE workspace_id = ? AND channel = ? AND thread_ts = ?`
      )
      .bind(channel.workspace_id, channel.channel_id, input.threadTs)
      .first<ThreadRow>();
    if (existing) {
      return {
        closed_session_id: null,
        created: false,
        session_id: existing.session_id,
      };
    }
  }

  const cursor = await db
    .prepare(
      `SELECT session_id, last_message_ts, last_activity_at
       FROM pm_session_cursor
       WHERE workspace_id = ? AND channel = ?`
    )
    .bind(channel.workspace_id, channel.channel_id)
    .first<CursorRow>();

  const idleMs = channel.session_idle_seconds * 1000;
  const withinWindow =
    cursor !== null &&
    Date.parse(messageAt) - Date.parse(cursor.last_activity_at) <= idleMs &&
    Date.parse(messageAt) >= Date.parse(cursor.last_activity_at) - idleMs;

  let sessionId: string;
  let created = false;
  let closedSessionId: string | null = null;

  if (withinWindow && cursor) {
    sessionId = cursor.session_id;
  } else {
    sessionId = sessionIdFor(channel.workspace_id, channel.channel_id, rootTs);
    created = true;
    if (cursor && cursor.session_id !== sessionId) {
      closedSessionId = cursor.session_id;
      await closeSession(db, cursor.session_id, cursor.last_activity_at);
    }
    await openSession(db, {
      channel,
      projectId,
      sessionId,
      startedTs: messageAt,
      workflowId: input.workflowId,
    });
  }

  const statements = [
    db
      .prepare(
        `INSERT INTO pm_session_thread
         (workspace_id, channel, thread_ts, session_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(workspace_id, channel, thread_ts) DO NOTHING`
      )
      .bind(channel.workspace_id, channel.channel_id, rootTs, sessionId),
  ];
  // Only advance the cursor for messages at or after its head, so a backfilled
  // older message cannot drag the live segmentation window backwards.
  if (!cursor || Number(input.messageTs) >= Number(cursor.last_message_ts)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO pm_session_cursor
           (workspace_id, channel, session_id, last_message_ts, last_activity_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(workspace_id, channel) DO UPDATE SET
             session_id = excluded.session_id,
             last_message_ts = excluded.last_message_ts,
             last_activity_at = excluded.last_activity_at`
        )
        .bind(
          channel.workspace_id,
          channel.channel_id,
          sessionId,
          input.messageTs,
          messageAt
        )
    );
  }
  await db.batch(statements);

  return { closed_session_id: closedSessionId, created, session_id: sessionId };
}

/**
 * Closes sessions whose idle window has elapsed. Run from the coordinator beat so
 * a quiet channel does not leave a case open forever.
 */
export async function closeIdleSessions(
  db: D1Database,
  channel: ObservedChannel,
  now = Date.now()
) {
  const cutoff = new Date(
    now - channel.session_idle_seconds * 1000
  ).toISOString();
  const rows = await db
    .prepare(
      `SELECT ses.id AS id, MAX(msg.received_at) AS last_seen
       FROM pm_session ses
       JOIN pm_message msg ON msg.session_id = ses.id
       WHERE ses.workspace_id = ? AND ses.channel = ? AND ses.status = 'open'
       GROUP BY ses.id
       HAVING last_seen <= ?`
    )
    .bind(channel.workspace_id, channel.channel_id, cutoff)
    .all<{ id: string; last_seen: string }>();
  if (rows.results.length === 0) {
    return [];
  }
  await db.batch(
    rows.results.map((row) =>
      db
        .prepare(
          "UPDATE pm_session SET status = 'closed', ended_ts = ? WHERE id = ?"
        )
        .bind(row.last_seen, row.id)
    )
  );
  return rows.results.map((row) => row.id);
}
