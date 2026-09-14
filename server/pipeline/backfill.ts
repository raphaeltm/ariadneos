// Bounded channel history reconciliation.
//
// Signed webhooks only deliver messages that arrive after the app is installed, so
// enabling a channel would otherwise start from an empty graph. Backfill reads a
// bounded slice of conversations.history, writes it into the same raw event table
// the webhook uses, and lets the normal normalization path segment and queue it.
//
// Backfilled rows are marked with a synthetic event id derived from the message
// timestamp, so a later live event for the same message deduplicates naturally.

import type { SlackClient, SlackHistoryMessage } from "../slack/client.ts";
import { normalizeSlackObservation } from "../slack-observations.ts";
import {
  markChannelBackfilled,
  type ObservedChannel,
  recordChannelError,
} from "../tenant/installs.ts";

export interface BackfillOutcome {
  ingested: number;
  skipped: number;
  threads: number;
}

const MESSAGE_TIMESTAMP = /^\d+\.\d+$/;
const DEFAULT_LIMIT = 200;
const MAX_THREADS = 20;

/** Backfilled events carry a deterministic id so replaying is idempotent. */
export function backfillEventId(channelId: string, ts: string) {
  return `backfill:${channelId}:${ts}`;
}

function isIngestable(message: SlackHistoryMessage) {
  if (!MESSAGE_TIMESTAMP.test(message.ts)) {
    return false;
  }
  // Join/leave/topic notices are channel metadata, not work.
  if (
    message.subtype &&
    message.subtype !== "thread_broadcast" &&
    message.subtype !== "file_share"
  ) {
    return false;
  }
  return Boolean(message.text.trim());
}

function toRawEvent(
  channelId: string,
  message: SlackHistoryMessage,
  teamId: string
) {
  return {
    channel: channelId,
    event_ts: message.ts,
    team_id: teamId,
    text: message.text,
    thread_ts: message.thread_ts,
    ts: message.ts,
    type: "message",
    ...(message.user ? { user: message.user } : {}),
    ...(message.bot_id ? { bot_id: message.bot_id } : {}),
    ...(message.subtype ? { subtype: message.subtype } : {}),
  };
}

/**
 * Reads recent channel history and thread replies, then normalizes each message.
 *
 * `oldest` bounds the read so enabling a long-lived channel does not pull years of
 * history in one request; the caller decides how far back to reconcile.
 */
export async function backfillChannel(
  db: D1Database,
  channel: ObservedChannel,
  client: SlackClient,
  options: {
    limit?: number;
    now?: () => number;
    oldest?: string;
    teamDomain?: string | null;
    workflowId?: string | null;
  } = {}
): Promise<BackfillOutcome> {
  const now = options.now ?? (() => Date.now());
  const outcome: BackfillOutcome = { ingested: 0, skipped: 0, threads: 0 };
  let history: SlackHistoryMessage[];
  try {
    history = await client.conversationsHistory(channel.channel_id, {
      limit: options.limit ?? DEFAULT_LIMIT,
      ...(options.oldest ? { oldest: options.oldest } : {}),
    });
  } catch (error) {
    await recordChannelError(
      db,
      channel.workspace_id,
      channel.channel_id,
      error instanceof Error ? error.message : "history read failed"
    );
    throw error;
  }

  // Thread parents come back in history; their replies need a second call each.
  const threadParents = history
    .filter((message) => message.thread_ts && message.thread_ts === message.ts)
    .slice(0, MAX_THREADS);
  const replies: SlackHistoryMessage[] = [];
  for (const parent of threadParents) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: one Slack call per thread; parallel calls would trip rate limits.
      const threadReplies = await client.conversationsReplies(
        channel.channel_id,
        parent.ts,
        { limit: 200 }
      );
      replies.push(...threadReplies);
      outcome.threads += 1;
    } catch (error) {
      console.error(
        "Slack conversations.replies failed",
        error instanceof Error ? error.message : "unknown"
      );
    }
  }

  const ordered = [...history, ...replies]
    .filter(isIngestable)
    .sort((a, b) => Number(a.ts) - Number(b.ts));

  for (const message of ordered) {
    const eventId = backfillEventId(channel.channel_id, message.ts);
    const receivedAt = Math.round(Number.parseFloat(message.ts) * 1000);
    // biome-ignore lint/performance/noAwaitInLoops: session segmentation depends on observing messages in order.
    await db
      .prepare(
        `INSERT INTO slack_message_events
         (team_id, event_id, channel_id, message_ts, event_ts, subtype, user_id,
          text, payload, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(team_id, event_id) DO NOTHING`
      )
      .bind(
        channel.workspace_id,
        eventId,
        channel.channel_id,
        message.ts,
        message.ts,
        message.subtype,
        message.user,
        message.text,
        JSON.stringify(
          toRawEvent(channel.channel_id, message, channel.workspace_id)
        ),
        receivedAt
      )
      .run();
    const normalized = await normalizeSlackObservation(
      db,
      {
        channel: channel.channel_id,
        eventId,
        eventTs: message.ts,
        messageTs: message.ts,
        receivedAt,
        subtype: message.subtype,
        workspace: channel.workspace_id,
      },
      {
        channel,
        client,
        teamDomain: options.teamDomain ?? null,
        workflowId: options.workflowId ?? null,
      }
    );
    if (normalized) {
      outcome.ingested += 1;
    } else {
      outcome.skipped += 1;
    }
  }

  await markChannelBackfilled(
    db,
    channel.workspace_id,
    channel.channel_id,
    new Date(now()).toISOString()
  );
  await recordChannelError(db, channel.workspace_id, channel.channel_id, null);
  return outcome;
}
