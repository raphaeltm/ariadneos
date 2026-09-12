import type {
  ChannelId,
  ISODateTime,
  Message,
  MessageId,
  PersonId,
  ProcessSessionId,
  ProjectId,
  SlackTs,
  WorkspaceId,
} from "../shared/contracts.ts";

interface SlackMetadata {
  event_payload?: Record<string, unknown>;
  event_type?: string;
}

interface RawSlackMessageEventRow {
  event_id: string;
  event_ts: string | null;
  payload: string;
  received_at: number;
  subtype: string | null;
  text: string | null;
  user_id: string | null;
}

export interface SlackObservationConfig {
  projectId?: ProjectId;
  slackWorkspace?: string;
}

export interface SlackObservationInput {
  channel: ChannelId;
  eventId: string;
  eventTs: SlackTs | null;
  messageTs: SlackTs;
  receivedAt: number;
  subtype: string | null;
  workspace: WorkspaceId;
}

export interface SlackObservationSource {
  event_id: string;
  event_ts: SlackTs | null;
  raw_table: "slack_message_events";
  received_at: ISODateTime;
  signature_verified: true;
  subtype: string | null;
}

export interface NormalizedSlackObservation {
  checkpointId: string;
  message: Message;
  operationKey: string;
  projectId: ProjectId;
  source: SlackObservationSource;
}

const DEFAULT_PROJECT_ID = "proj_helios" satisfies ProjectId;

export async function normalizeSlackObservation(
  db: D1Database,
  input: SlackObservationInput,
  config: SlackObservationConfig = {}
): Promise<NormalizedSlackObservation> {
  const rows = await db
    .prepare(
      `SELECT event_id, event_ts, subtype, user_id, text, payload, received_at
       FROM slack_message_events
       WHERE team_id = ? AND channel_id = ? AND message_ts = ?
       ORDER BY COALESCE(event_ts, ''), received_at, event_id`
    )
    .bind(input.workspace, input.channel, input.messageTs)
    .all<RawSlackMessageEventRow>();

  const projected = projectMessage(rows.results, input, config.slackWorkspace);
  const projectId = config.projectId ?? DEFAULT_PROJECT_ID;
  const checkpointId = `slack:${input.workspace}:${input.eventId}`;
  const operationKey = `slack-message:${input.workspace}:${input.eventId}`;
  const source: SlackObservationSource = {
    event_id: input.eventId,
    event_ts: input.eventTs,
    raw_table: "slack_message_events",
    received_at: toIso(input.receivedAt),
    signature_verified: true,
    subtype: input.subtype,
  };

  await db.batch([
    db
      .prepare(
        `INSERT INTO pm_message
         (workspace_id, channel, ts, id, session_id, author_person_id, author_label,
          text, permalink, thread_ts, revision, deleted, availability, is_agent, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, channel, ts) DO UPDATE SET
          id = excluded.id,
          session_id = excluded.session_id,
          author_person_id = excluded.author_person_id,
          author_label = excluded.author_label,
          text = excluded.text,
          permalink = excluded.permalink,
          thread_ts = excluded.thread_ts,
          revision = excluded.revision,
          deleted = excluded.deleted,
          availability = excluded.availability,
          is_agent = excluded.is_agent,
          received_at = excluded.received_at`
      )
      .bind(
        projected.workspace_id,
        projected.channel,
        projected.ts,
        projected.id,
        projected.session_id,
        projected.author_person_id,
        projected.author_label,
        projected.text,
        projected.permalink,
        projected.thread_ts,
        projected.revision,
        projected.deleted ? 1 : 0,
        projected.availability,
        projected.is_agent ? 1 : 0,
        projected.received_at
      ),
    db
      .prepare(
        `INSERT INTO pm_processing
         (checkpoint_id, workspace_id, channel, observation_id, status, retries,
          extraction_window_revision, error, updated_at)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, ?)
         ON CONFLICT(checkpoint_id) DO NOTHING`
      )
      .bind(
        checkpointId,
        projected.workspace_id,
        projected.channel,
        input.eventId,
        projected.revision,
        projected.received_at
      ),
    db
      .prepare(
        `INSERT INTO pm_journal
         (workspace_id, channel, project_id, session_id, kind, ts, payload_json, operation_key)
         VALUES (?, ?, ?, ?, 'message', ?, ?, ?)
         ON CONFLICT(operation_key) DO NOTHING`
      )
      .bind(
        projected.workspace_id,
        projected.channel,
        projectId,
        projected.session_id,
        projected.received_at,
        JSON.stringify(projected),
        operationKey
      ),
  ]);

  return {
    checkpointId,
    message: projected,
    operationKey,
    projectId,
    source,
  };
}

function projectMessage(
  rows: readonly RawSlackMessageEventRow[],
  input: SlackObservationInput,
  slackWorkspace?: string
): Message {
  let state: Omit<Message, "id" | "permalink" | "workspace_id" | "channel"> = {
    author_label: "unknown",
    author_person_id: null,
    availability: "available",
    deleted: false,
    is_agent: false,
    received_at: toIso(input.receivedAt),
    revision: 0,
    session_id: sessionIdFor(input.workspace, input.channel, input.messageTs),
    text: "",
    thread_ts: null,
    ts: input.messageTs,
  };

  for (const row of rows) {
    const event = parseRawEvent(row.payload);
    const message = eventMessage(event);
    const metadata = readMetadata(message, event);
    const personId = readPersonId(metadata);
    const sessionId = readSessionId(metadata);
    const threadTs =
      readString(message.thread_ts) ?? readString(event.thread_ts);
    const userId =
      readString(message.user) ??
      readString(event.user) ??
      row.user_id ??
      undefined;
    const botId = readString(message.bot_id) ?? readString(event.bot_id);
    const username = readString(message.username) ?? readString(event.username);
    const nextText = readString(message.text) ?? row.text ?? state.text;
    const nextState = { ...state };

    nextState.author_person_id = personId ?? state.author_person_id;
    nextState.author_label =
      personId ?? username ?? userId ?? botId ?? state.author_label;
    nextState.is_agent = isAgentMessage(metadata, botId, personId);
    nextState.received_at = toIso(row.received_at);
    nextState.session_id =
      sessionId ??
      fallbackSessionIdFor(
        state.session_id,
        input,
        threadTs ?? input.messageTs
      );
    nextState.thread_ts = threadTs ?? state.thread_ts;

    if (row.subtype === "message_deleted") {
      nextState.availability = "deleted";
      nextState.deleted = true;
      nextState.text = state.text || "";
    } else {
      nextState.availability = "available";
      nextState.deleted = false;
      nextState.text = nextText;
    }

    if (hasMessageChanged(state, nextState)) {
      nextState.revision = state.revision + 1;
    } else {
      nextState.revision = Math.max(1, state.revision);
    }
    state = nextState;
  }

  const revision = Math.max(1, state.revision);
  const { channel, messageTs: ts, workspace } = input;
  return {
    ...state,
    channel,
    id: `${workspace}:${channel}:${ts}` as MessageId,
    permalink: permalinkFor(channel, ts, slackWorkspace),
    revision,
    workspace_id: workspace,
  };
}

function hasMessageChanged(
  before: Omit<Message, "id" | "permalink" | "workspace_id" | "channel">,
  after: Omit<Message, "id" | "permalink" | "workspace_id" | "channel">
) {
  return (
    before.author_label !== after.author_label ||
    before.author_person_id !== after.author_person_id ||
    before.availability !== after.availability ||
    before.deleted !== after.deleted ||
    before.is_agent !== after.is_agent ||
    before.session_id !== after.session_id ||
    before.text !== after.text ||
    before.thread_ts !== after.thread_ts
  );
}

function parseRawEvent(payload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function eventMessage(event: Record<string, unknown>) {
  return isObject(event.message) ? event.message : event;
}

function readMetadata(
  message: Record<string, unknown>,
  event: Record<string, unknown>
): SlackMetadata | undefined {
  const metadata = isObject(message.metadata)
    ? message.metadata
    : event.metadata;
  return isObject(metadata) ? (metadata as SlackMetadata) : undefined;
}

function readPersonId(metadata: SlackMetadata | undefined) {
  const personId = readString(metadata?.event_payload?.person_id);
  return personId?.startsWith("per_") ? (personId as PersonId) : null;
}

function readSessionId(metadata: SlackMetadata | undefined) {
  const sessionId = readString(metadata?.event_payload?.session_id);
  return sessionId?.startsWith("ses_") ? (sessionId as ProcessSessionId) : null;
}

function isAgentMessage(
  metadata: SlackMetadata | undefined,
  botId: string | undefined,
  personId: PersonId | null
) {
  if (metadata?.event_type === "ariadne_agent") {
    return true;
  }
  if (metadata?.event_type === "ariadne_sim") {
    return false;
  }
  return !!botId && !personId;
}

function sessionIdFor(
  workspace: WorkspaceId,
  channel: ChannelId,
  rootTs: SlackTs
): ProcessSessionId {
  return `ses_slack_${sanitize(workspace)}_${sanitize(channel)}_${sanitize(
    rootTs
  )}` as ProcessSessionId;
}

function fallbackSessionIdFor(
  current: ProcessSessionId,
  input: SlackObservationInput,
  rootTs: SlackTs
) {
  if (!current.startsWith("ses_slack_")) {
    return current;
  }
  return sessionIdFor(input.workspace, input.channel, rootTs);
}

function sanitize(value: string) {
  return value.replaceAll(/[^A-Za-z0-9_]+/g, "_");
}

function permalinkFor(
  channel: ChannelId,
  ts: SlackTs,
  slackWorkspace: string | undefined
) {
  const path = `/archives/${channel}/p${ts.replace(".", "")}`;
  if (!slackWorkspace) {
    return `https://slack.com${path}`;
  }
  return `https://${slackWorkspace}.slack.com${path}`;
}

function toIso(ms: number): ISODateTime {
  return new Date(ms).toISOString();
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
