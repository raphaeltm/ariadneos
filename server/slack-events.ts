import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

export type SlackEventsEnv = { DB: D1Database; SLACK_SIGNING_SECRET?: string };
const encoder = new TextEncoder();

async function verified(headers: Headers, body: string, secret: string) {
  const timestamp = headers.get("x-slack-request-timestamp") ?? "";
  const signature = headers.get("x-slack-signature") ?? "";
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !/^v0=[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.slice(3).match(/../g)!, (hex) =>
    Number.parseInt(hex, 16),
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    encoder.encode(`v0:${timestamp}:${body}`),
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// Mounted before browser Origin/session middleware: Slack authenticates with HMAC.
export const slackEvents = new Hono<{ Bindings: SlackEventsEnv }>();
slackEvents.use(
  "*",
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: "Event too large." }, 413),
  }),
);
slackEvents.post("/", async (c) => {
  c.header("Cache-Control", "no-store");
  if (!c.env.SLACK_SIGNING_SECRET)
    return c.json({ error: "Slack event delivery is not configured." }, 503);
  const body = await c.req.text();
  if (!(await verified(c.req.raw.headers, body, c.env.SLACK_SIGNING_SECRET)))
    return c.json({ error: "Invalid Slack signature." }, 401);
  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON." }, 400);
  }
  if (!object(envelope)) return c.json({ error: "Invalid event." }, 400);
  if (envelope.type === "url_verification") {
    if (!nonempty(envelope.challenge))
      return c.json({ error: "Missing challenge." }, 400);
    return c.json({ challenge: envelope.challenge });
  }
  if (envelope.type !== "event_callback") return c.json({ ok: true });
  if (
    !object(envelope.event) ||
    !nonempty(envelope.team_id) ||
    !nonempty(envelope.event_id)
  )
    return c.json({ error: "Missing event identity." }, 400);
  const event = envelope.event;
  if (event.type !== "message") return c.json({ ok: true });
  if (!nonempty(event.channel))
    return c.json({ error: "Missing channel." }, 400);
  const message = object(event.message) ? event.message : event;
  const timestamp =
    event.subtype === "message_deleted" ? event.deleted_ts : message.ts;
  if (!nonempty(timestamp) || !/^\d+\.\d+$/.test(timestamp))
    return c.json({ error: "Missing message timestamp." }, 400);
  // Append observed changes rather than overwriting messages: edits, deletions and
  // out-of-order deliveries retain their source evidence. Slack retries deduplicate.
  await c.env.DB.prepare(
    `INSERT INTO slack_message_events
    (team_id, event_id, channel_id, message_ts, event_ts, subtype, user_id, text, payload, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(team_id, event_id) DO NOTHING`,
  )
    .bind(
      envelope.team_id,
      envelope.event_id,
      event.channel,
      timestamp,
      typeof event.event_ts === "string" ? event.event_ts : null,
      typeof event.subtype === "string" ? event.subtype : null,
      typeof message.user === "string" ? message.user : null,
      typeof message.text === "string" ? message.text : null,
      JSON.stringify(event),
      Date.now(),
    )
    .run();
  // Acknowledge only after durable storage; errors produce non-2xx so Slack retries.
  return c.json({ ok: true });
});
