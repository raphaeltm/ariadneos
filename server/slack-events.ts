import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  type ChannelCoordinatorEnv,
  wakeChannelCoordinator,
} from "./runtime/channel.ts";
import { SlackClient } from "./slack/client.ts";
import { normalizeSlackObservation } from "./slack-observations.ts";
import {
  readChannel,
  readInstall,
  revokeInstall,
  upsertChannel,
} from "./tenant/installs.ts";

export interface SlackEventsEnv extends ChannelCoordinatorEnv {
  DB: D1Database;
  SLACK_SIGNING_SECRET?: string;
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

async function persistRawEvent(
  env: SlackEventsEnv,
  envelope: Record<string, unknown>,
  event: Record<string, unknown>,
  record: SlackMessageEventRecord,
  receivedAt: number
) {
  await env.DB.prepare(
    `INSERT INTO slack_message_events
    (team_id, event_id, channel_id, message_ts, event_ts, subtype, user_id, text, payload, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(team_id, event_id) DO NOTHING`
  )
    .bind(
      envelope.team_id as string,
      envelope.event_id as string,
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
}

async function handleMessageEvent(
  env: SlackEventsEnv,
  envelope: Record<string, unknown>,
  event: Record<string, unknown>
) {
  const record = messageEventRecord(event);
  if (!record) {
    return { error: "Missing message identity.", status: 400 as const };
  }
  const teamId = envelope.team_id as string;
  const eventId = envelope.event_id as string;
  const receivedAt = Date.now();
  // Store the raw event first so a later configuration change can replay it, and
  // so Slack retries deduplicate on (team_id, event_id).
  await persistRawEvent(env, envelope, event, record, receivedAt);

  const install = await readInstall(env.DB, teamId);
  if (!install) {
    // Unknown workspace: the raw event is kept for diagnosis but no process data
    // is derived, so an event from a revoked or foreign install cannot enter a
    // tenant's graph.
    return { ok: true as const };
  }
  const channel = await readChannel(env.DB, teamId, record.channel);
  if (!channel) {
    // The bot was added to a channel nobody has configured. Record it so it can
    // be enabled from the setup UI, but do not mine it.
    await upsertChannel(env.DB, {
      channel_id: record.channel,
      channel_name: record.channel,
      workspace_id: teamId,
    });
    return { ok: true as const };
  }
  if (!(channel.enabled && channel.project_id)) {
    return { ok: true as const };
  }
  const workflowId = await workflowForProject(
    env.DB,
    teamId,
    channel.project_id
  );
  const normalized = await normalizeSlackObservation(
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
      channel,
      client: new SlackClient(install.bot_token),
      teamDomain: install.team_domain,
      workflowId,
    }
  );
  return {
    normalized,
    ok: true as const,
    scope: { channel: record.channel, teamId },
  };
}

async function workflowForProject(
  db: D1Database,
  workspaceId: string,
  projectId: string
) {
  const row = await db
    .prepare(
      "SELECT workflow_id FROM tenant_project WHERE workspace_id = ? AND id = ?"
    )
    .bind(workspaceId, projectId)
    .first<{ workflow_id: string | null }>();
  return row?.workflow_id ?? null;
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
/**
 * Handles the lifecycle events that change what Ariadne observes. Returns true
 * when the event was fully handled here.
 */
async function handleLifecycleEvent(
  env: SlackEventsEnv,
  teamId: string,
  event: Record<string, unknown>
) {
  // A workspace that uninstalls the app must stop being observed immediately.
  if (event.type === "app_uninstalled" || event.type === "tokens_revoked") {
    await revokeInstall(env.DB, teamId);
    return true;
  }
  // Keep the selectable channel list current as channels are renamed.
  if (event.type === "channel_rename" && object(event.channel)) {
    const renamed = event.channel;
    if (nonempty(renamed.id)) {
      await upsertChannel(env.DB, {
        channel_id: renamed.id,
        channel_name: nonempty(renamed.name) ? renamed.name : renamed.id,
        workspace_id: teamId,
      });
    }
    return true;
  }
  return false;
}

function parseEnvelope(body: string) {
  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch {
    return { error: "Invalid JSON.", status: 400 as const };
  }
  if (!object(envelope)) {
    return { error: "Invalid event.", status: 400 as const };
  }
  return { envelope };
}

slackEvents.post("/", async (c) => {
  c.header("Cache-Control", "no-store");
  if (!c.env.SLACK_SIGNING_SECRET) {
    return c.json({ error: "Slack event delivery is not configured." }, 503);
  }
  const body = await c.req.text();
  if (!(await verified(c.req.raw.headers, body, c.env.SLACK_SIGNING_SECRET))) {
    return c.json({ error: "Invalid Slack signature." }, 401);
  }
  const parsed = parseEnvelope(body);
  if ("error" in parsed) {
    return c.json({ error: parsed.error }, parsed.status);
  }
  const { envelope } = parsed;
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
  if (await handleLifecycleEvent(c.env, envelope.team_id, event)) {
    return c.json({ ok: true });
  }
  if (event.type !== "message") {
    return c.json({ ok: true });
  }

  const outcome = await handleMessageEvent(c.env, envelope, event);
  if ("error" in outcome) {
    return c.json({ error: outcome.error }, outcome.status);
  }
  if (outcome.normalized && outcome.scope && c.env.CHANNEL_COORDINATOR) {
    c.executionCtx.waitUntil(
      wakeChannelCoordinator(c.env, {
        channel: outcome.scope.channel,
        workspaceId: outcome.scope.teamId,
      })
    );
  }
  // Acknowledge only after durable storage; errors produce non-2xx so Slack retries.
  return c.json({ ok: true });
});
