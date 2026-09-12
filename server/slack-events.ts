import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  type ChannelCoordinatorEnv,
  wakeChannelCoordinator,
} from "./runtime/channel.ts";
import { normalizeSlackObservation } from "./slack-observations.ts";

export interface SlackEventsEnv extends ChannelCoordinatorEnv {
  DB: D1Database;
  SLACK_PROJECT_ID?: "proj_helios" | "proj_atlas";
  SLACK_SIGNING_SECRET?: string;
  SLACK_WORKSPACE?: string;
}
const TIMESTAMP = /^\d+$/;
const SIGNATURE = /^v0=[a-f0-9]{64}$/;
const HEX_PAIR = /../g;
const MESSAGE_TIMESTAMP = /^\d+\.\d+$/;
const encoder = new TextEncoder();
interface SlackMessageEventRecord {
  channel: string;
  eventTs: string | null;
  message: Record<string, unknown>;
  subtype: string | null;
  timestamp: string;
}

async function verified(headers: Headers, body: string, secret: string) {
  const timestamp = headers.get("x-slack-request-timestamp") ?? "";
  const signature = headers.get("x-slack-signature") ?? "";
  if (
    !TIMESTAMP.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !SIGNATURE.test(signature)
  ) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"]
  );
  const bytes = Uint8Array.from(
    signature.slice(3).match(HEX_PAIR) ?? [],
    (hex) => Number.parseInt(hex, 16)
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    encoder.encode(`v0:${timestamp}:${body}`)
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function messageEventRecord(
  event: Record<string, unknown>
): SlackMessageEventRecord | null {
  if (!(event.type === "message" && nonempty(event.channel))) {
    return null;
  }
  const message = object(event.message) ? event.message : event;
  const timestamp =
    event.subtype === "message_deleted" ? event.deleted_ts : message.ts;
  if (!(nonempty(timestamp) && MESSAGE_TIMESTAMP.test(timestamp))) {
    return null;
  }
  return {
    channel: event.channel,
    eventTs: typeof event.event_ts === "string" ? event.event_ts : null,
    message,
    subtype: typeof event.subtype === "string" ? event.subtype : null,
    timestamp,
  };
}

async function persistSlackMessageEvent(
  env: SlackEventsEnv,
  envelope: Record<string, unknown>,
  event: Record<string, unknown>,
  record: SlackMessageEventRecord
) {
  const teamId = envelope.team_id as string;
  const eventId = envelope.event_id as string;
  const receivedAt = Date.now();
  await env.DB.prepare(
    `INSERT INTO slack_message_events
    (team_id, event_id, channel_id, message_ts, event_ts, subtype, user_id, text, payload, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(team_id, event_id) DO NOTHING`
  )
    .bind(
      teamId,
      eventId,
      record.channel,
      record.timestamp,
      record.eventTs,
      record.subtype,
      typeof record.message.user === "string" ? record.message.user : null,
      typeof record.message.text === "string" ? record.message.text : null,
      JSON.stringify(event),
      receivedAt
    )
    .run();
  await normalizeSlackObservation(
    env.DB,
    {
      channel: record.channel,
      eventId,
      eventTs: record.eventTs,
      messageTs: record.timestamp,
      receivedAt,
      subtype: record.subtype,
      workspace: teamId,
    },
    {
      projectId: env.SLACK_PROJECT_ID,
      slackWorkspace: env.SLACK_WORKSPACE,
    }
  );
  return { channelId: record.channel, teamId };
}

// Mounted before browser Origin/session middleware: Slack authenticates with HMAC.
export const slackEvents = new Hono<{ Bindings: SlackEventsEnv }>();
slackEvents.use(
  "*",
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: "Event too large." }, 413),
  })
);
slackEvents.post("/", async (c) => {
  c.header("Cache-Control", "no-store");
  if (!c.env.SLACK_SIGNING_SECRET) {
    return c.json({ error: "Slack event delivery is not configured." }, 503);
  }
  const body = await c.req.text();
  if (!(await verified(c.req.raw.headers, body, c.env.SLACK_SIGNING_SECRET))) {
    return c.json({ error: "Invalid Slack signature." }, 401);
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON." }, 400);
  }
  if (!object(envelope)) {
    return c.json({ error: "Invalid event." }, 400);
  }
  if (envelope.type === "url_verification") {
    if (!nonempty(envelope.challenge)) {
      return c.json({ error: "Missing challenge." }, 400);
    }
    return c.json({ challenge: envelope.challenge });
  }
  if (envelope.type !== "event_callback") {
    return c.json({ ok: true });
  }
  if (
    !(
      object(envelope.event) &&
      nonempty(envelope.team_id) &&
      nonempty(envelope.event_id)
    )
  ) {
    return c.json({ error: "Missing event identity." }, 400);
  }
  const { event } = envelope;
  if (event.type !== "message") {
    return c.json({ ok: true });
  }
  const record = messageEventRecord(event);
  if (!record) {
    return c.json({ error: "Missing message identity." }, 400);
  }
  // Append observed changes rather than overwriting messages: edits, deletions and
  // out-of-order deliveries retain their source evidence. Slack retries deduplicate.
  const persisted = await persistSlackMessageEvent(
    c.env,
    envelope,
    event,
    record
  );
  if (
    c.env.CHANNEL_COORDINATOR &&
    (!c.env.SLACK_ALLOWED_TEAM_ID ||
      c.env.SLACK_ALLOWED_TEAM_ID === persisted.teamId) &&
    (!c.env.SLACK_ALLOWED_CHANNEL_ID ||
      c.env.SLACK_ALLOWED_CHANNEL_ID === persisted.channelId)
  ) {
    c.executionCtx.waitUntil(
      wakeChannelCoordinator(c.env, {
        channel: persisted.channelId,
        workspaceId: persisted.teamId,
      })
    );
  }
  // Acknowledge only after durable storage; errors produce non-2xx so Slack retries.
  return c.json({ ok: true });
});
