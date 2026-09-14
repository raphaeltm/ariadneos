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
import type { SlackClient } from "./slack/client.ts";
import type { ObservedChannel } from "./tenant/installs.ts";
import { resolvePerson } from "./tenant/people.ts";
import { assignSession } from "./tenant/sessions.ts";

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
  sessionCreated: boolean;
  source: SlackObservationSource;
}

/**
 * Projects the append-only raw event rows for one Slack message into its current
 * state, then records it as an observation of a real process session.
 *
 * Returns null when the channel is not configured for observation: the raw event
 * stays in slack_message_events, but nothing enters the process tables, so a bot
 * that is present in extra channels does not mine them.
 */
export async function normalizeSlackObservation(
  db: D1Database,
  input: SlackObservationInput,
  context: {
    channel: ObservedChannel;
    client?: SlackClient | null;
    teamDomain?: string | null;
    workflowId?: string | null;
  }
): Promise<NormalizedSlackObservation | null> {
  if (!(context.channel.enabled && context.channel.project_id)) {
    return null;
  }
  const rows = await db
    .prepare(
      `SELECT event_id, event_ts, subtype, user_id, text, payload, received_at
       FROM slack_message_events
       WHERE team_id = ? AND channel_id = ? AND message_ts = ?
       ORDER BY COALESCE(event_ts, ''), received_at, event_id`
    )
    .bind(input.workspace, input.channel, input.messageTs)
    .all<RawSlackMessageEventRow>();

  const projected = projectMessage(rows.results, input);
  const person = projected.slack_user_id
    ? await resolvePerson(
        db,
        {
          slackUserId: projected.slack_user_id,
          workspaceId: input.workspace,
        },
        context.client ?? null
      )
    : null;
  const assignment = await assignSession(db, {
    channel: context.channel,
    messageTs: input.messageTs,
    threadTs: projected.thread_ts,
    workflowId: context.workflowId ?? null,
  });

  const projectId = context.channel.project_id as ProjectId;
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
  const message: Message = {
    author_label: person
      ? person.real_name || person.display_name
      : projected.author_label,
    author_person_id: (person?.person_id as PersonId | undefined) ?? null,
    availability: projected.availability,
    channel: input.channel,
    deleted: projected.deleted,
    id: `${input.workspace}:${input.channel}:${input.messageTs}` as MessageId,
    is_agent: projected.is_agent || (person?.is_bot ?? false),
    permalink: permalinkFor(
      input.channel,
      input.messageTs,
      context.teamDomain ?? null
    ),
    received_at: projected.received_at,
    revision: projected.revision,
    session_id: assignment.session_id as ProcessSessionId,
    text: projected.text,
    thread_ts: projected.thread_ts,
    ts: input.messageTs,
    workspace_id: input.workspace,
  };

  await db.batch([
    db
      .prepare(
        `INSERT INTO pm_message
         (workspace_id, channel, ts, id, session_id, author_person_id, author_label,
          text, permalink, thread_ts, revision, deleted, availability, is_agent,
          received_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'slack')
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
          received_at = excluded.received_at,
          source = 'slack'`
      )
      .bind(
        message.workspace_id,
        message.channel,
        message.ts,
        message.id,
        message.session_id,
        message.author_person_id,
        message.author_label,
        message.text,
        message.permalink,
        message.thread_ts,
        message.revision,
        message.deleted ? 1 : 0,
        message.availability,
        message.is_agent ? 1 : 0,
        message.received_at
      ),
    // A revised message must be re-extracted, so the checkpoint is re-queued when
    // the window revision advances rather than left at its earlier status.
    db
      .prepare(
        `INSERT INTO pm_processing
         (checkpoint_id, workspace_id, channel, observation_id, status, retries,
          extraction_window_revision, error, updated_at)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, ?)
         ON CONFLICT(checkpoint_id) DO UPDATE SET
           status = 'pending',
           retries = 0,
           extraction_window_revision = excluded.extraction_window_revision,
           error = NULL,
           updated_at = excluded.updated_at`
      )
      .bind(
        checkpointId,
        message.workspace_id,
        message.channel,
        input.eventId,
        message.revision,
        message.received_at
      ),
    db
      .prepare(
        `INSERT INTO pm_journal
         (workspace_id, channel, project_id, session_id, kind, ts, payload_json, operation_key)
         VALUES (?, ?, ?, ?, 'message', ?, ?, ?)
         ON CONFLICT(operation_key) DO NOTHING`
      )
      .bind(
        message.workspace_id,
        message.channel,
        projectId,
        message.session_id,
        message.received_at,
        JSON.stringify(message),
        operationKey
      ),
  ]);

  return {
    checkpointId,
    message,
    operationKey,
    projectId,
    sessionCreated: assignment.created,
    source,
  };
}

interface ProjectedMessage {
  author_label: string;
  availability: Message["availability"];
  deleted: boolean;
  is_agent: boolean;
  received_at: ISODateTime;
  revision: number;
  slack_user_id: string | null;
  text: string;
  thread_ts: string | null;
}

function projectMessage(
  rows: readonly RawSlackMessageEventRow[],
  input: SlackObservationInput
): ProjectedMessage {
  let state: ProjectedMessage = {
    author_label: "unknown",
    availability: "available",
    deleted: false,
    is_agent: false,
    received_at: toIso(input.receivedAt),
    revision: 0,
    slack_user_id: null,
    text: "",
    thread_ts: null,
  };

  for (const row of rows) {
    const event = parseRawEvent(row.payload);
    const message = eventMessage(event);
    const metadata = readMetadata(message, event);
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

    nextState.slack_user_id = userId ?? state.slack_user_id;
    nextState.author_label = username ?? userId ?? botId ?? state.author_label;
    nextState.is_agent = isAgentMessage(metadata, botId, userId);
    nextState.received_at = toIso(row.received_at);
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

    nextState.revision = hasMessageChanged(state, nextState)
      ? state.revision + 1
      : Math.max(1, state.revision);
    state = nextState;
  }

  return { ...state, revision: Math.max(1, state.revision) };
}

function hasMessageChanged(before: ProjectedMessage, after: ProjectedMessage) {
  return (
    before.author_label !== after.author_label ||
    before.availability !== after.availability ||
    before.deleted !== after.deleted ||
    before.is_agent !== after.is_agent ||
    before.slack_user_id !== after.slack_user_id ||
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

/**
 * Ariadne's own Slack posts must not become process evidence, otherwise the agent
 * mines its own summaries. Its posts carry an ariadne_agent metadata marker; any
 * other bot post is treated as agent traffic too, since bot output is a report
 * about work rather than the work itself.
 */
function isAgentMessage(
  metadata: SlackMetadata | undefined,
  botId: string | undefined,
  userId: string | undefined
) {
  if (metadata?.event_type === "ariadne_agent") {
    return true;
  }
  return !!botId && !userId;
}

/**
 * Slack permalinks are deterministic from channel and timestamp, so they are
 * constructed rather than fetched. Without the workspace domain the canonical
 * slack.com host still resolves for a signed-in member of that workspace.
 */
function permalinkFor(
  channel: ChannelId,
  ts: SlackTs,
  teamDomain: string | null
) {
  const path = `/archives/${channel}/p${ts.replace(".", "")}`;
  return teamDomain
    ? `https://${teamDomain}.slack.com${path}`
    : `https://slack.com${path}`;
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
