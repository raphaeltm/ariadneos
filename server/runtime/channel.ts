export const CHANNEL_JOURNAL_LIMIT = 500;
export const CHANNEL_MAX_SUBSCRIBERS = 32;
export const CHANNEL_MAX_BUFFERED_EVENTS = 64;
export const CHANNEL_HEARTBEAT_MS = 15_000;
export const CHANNEL_MAX_STREAM_MS = 5 * 60_000;

export type ChannelStatus =
  | "prepared"
  | "running"
  | "paused"
  | "draining"
  | "closed";
export type DeadlineKind = "extraction" | "beat" | "close" | "recovery";
export type JournalKind =
  | "message"
  | "session_started"
  | "step"
  | "graph_delta"
  | "conformance"
  | "agent_post"
  | "paused"
  | "resumed"
  | "session_closed"
  | "reset";

export interface ChannelScope {
  channel: string;
  workspaceId: string;
}

export interface ChannelRequestScope extends ChannelScope {
  projectId: string;
  workflowId?: string;
}

export interface JournalEnvelope {
  channel: string;
  id: number;
  kind: JournalKind;
  payload: unknown;
  project_id: string;
  session_id?: string;
  ts: number;
  workspace_id: string;
}

export interface JournalWrite {
  kind: JournalKind;
  opKey: string;
  payload: unknown;
  projectId: string;
  sessionId?: string;
  ts?: number;
}

export interface ChannelSnapshot {
  channel: string;
  cursor: number;
  deadlines: Partial<Record<DeadlineKind, number>>;
  project_id: string;
  status: ChannelStatus;
  workflow_id?: string;
  workspace_id: string;
}

export interface ChannelHookContext {
  checkpoint: (name: string, value: string) => void;
  commit: (entry: JournalWrite) => Promise<JournalEnvelope | null>;
  now: number;
  scope: ChannelScope;
}

export interface ChannelHookResult {
  checkpoint?: Record<string, string>;
  rescheduleAt?: number | null;
  status?: ChannelStatus;
}

export type ChannelHook = (
  context: ChannelHookContext
) => Promise<ChannelHookResult | undefined>;

export type ChannelHooks = Partial<Record<DeadlineKind, ChannelHook>>;

interface JournalRow {
  channel: string;
  id: number;
  kind: JournalKind;
  payload_json: string;
  project_id: string;
  session_id: string | null;
  ts: string;
  workspace_id: string;
}

interface JournalBounds {
  max: number;
  min: number;
}

const NON_NEGATIVE_INTEGER = /^\d+$/;

export interface ChannelCoordinatorEnv {
  CHANNEL_COORDINATOR?: DurableObjectNamespace;
  CHANNEL_ID?: string;
  SLACK_ALLOWED_CHANNEL_ID?: string;
  SLACK_ALLOWED_TEAM_ID?: string;
  SLACK_TEAM_ID?: string;
}

function firstConfigured(...values: (string | undefined)[]) {
  return values.find((value) => value !== undefined && value.length > 0);
}

export function configuredChannelScope(
  env: ChannelCoordinatorEnv
): ChannelScope | null {
  const workspaceId = firstConfigured(
    env.SLACK_ALLOWED_TEAM_ID,
    env.SLACK_TEAM_ID
  );
  const channel = firstConfigured(env.SLACK_ALLOWED_CHANNEL_ID, env.CHANNEL_ID);
  return workspaceId && channel ? { channel, workspaceId } : null;
}

export function channelObjectName(scope: ChannelScope) {
  return `${scope.workspaceId}:${scope.channel}`;
}

export function channelCoordinatorStub(
  env: ChannelCoordinatorEnv,
  scope: ChannelScope
) {
  if (!env.CHANNEL_COORDINATOR) {
    return null;
  }
  return env.CHANNEL_COORDINATOR.get(
    env.CHANNEL_COORDINATOR.idFromName(channelObjectName(scope))
  );
}

export async function notifyChannelCoordinator(
  env: ChannelCoordinatorEnv,
  scope: ChannelScope
) {
  const stub = channelCoordinatorStub(env, scope);
  if (!stub) {
    return;
  }
  await stub.fetch(
    `https://channel-coordinator.internal/wake?workspace_id=${encodeURIComponent(scope.workspaceId)}&channel=${encodeURIComponent(scope.channel)}`,
    {
      method: "POST",
    }
  );
}

export function coordinatorUrl(
  path: string,
  scope: ChannelScope,
  params: URLSearchParams
) {
  params.set("workspace_id", scope.workspaceId);
  params.set("channel", scope.channel);
  return `https://channel-coordinator.internal${path}?${params.toString()}`;
}

export async function coordinatorFetch(
  env: ChannelCoordinatorEnv,
  scope: ChannelScope,
  path: string,
  init: RequestInit & { params?: URLSearchParams } = {}
) {
  const stub = channelCoordinatorStub(env, scope);
  if (!stub) {
    return null;
  }
  const { params = new URLSearchParams(), ...requestInit } = init;
  return await stub.fetch(coordinatorUrl(path, scope, params), requestInit);
}

export async function wakeChannelCoordinator(
  env: ChannelCoordinatorEnv,
  scope: ChannelScope
) {
  await coordinatorFetch(env, scope, "/wake", {
    method: "POST",
  });
}

export function parseNonNegativeInteger(value: string | null) {
  if (value === null || !NON_NEGATIVE_INTEGER.test(value)) {
    return null;
  }
  return Number.parseInt(value, 10);
}

export function sseFrame(envelope: JournalEnvelope) {
  return `id: ${envelope.id}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

export function resetFrame(
  scope: ChannelScope,
  projectId: string,
  reason: string,
  id = 0
) {
  return sseFrame({
    channel: scope.channel,
    id,
    kind: "reset",
    payload: { reason },
    project_id: projectId,
    ts: Date.now(),
    workspace_id: scope.workspaceId,
  });
}

function toEnvelope(row: JournalRow): JournalEnvelope {
  return {
    channel: row.channel,
    id: row.id,
    kind: row.kind,
    payload: JSON.parse(row.payload_json) as unknown,
    project_id: row.project_id,
    ...(row.session_id ? { session_id: row.session_id } : {}),
    ts: Date.parse(row.ts),
    workspace_id: row.workspace_id,
  };
}

async function journalBounds(
  db: D1Database,
  scope: ChannelScope
): Promise<JournalBounds> {
  const row = await db
    .prepare(
      `SELECT MIN(id) AS min, MAX(id) AS max
       FROM (
         SELECT id FROM pm_journal
         WHERE workspace_id = ? AND channel = ?
         ORDER BY id DESC
         LIMIT ?
       )`
    )
    .bind(scope.workspaceId, scope.channel, CHANNEL_JOURNAL_LIMIT)
    .first<{ max: number | null; min: number | null }>();
  return { max: row?.max ?? 0, min: row?.min ?? 0 };
}

export async function currentJournalCursor(
  db: D1Database,
  scope: ChannelScope
) {
  const bounds = await journalBounds(db, scope);
  return bounds.max;
}

export async function replayJournal(
  db: D1Database,
  scope: ChannelScope,
  projectId: string,
  after: number
) {
  const bounds = await journalBounds(db, scope);
  if (bounds.min > 0 && after < bounds.min - 1) {
    return {
      events: [
        {
          channel: scope.channel,
          id: bounds.max,
          kind: "reset",
          payload: { reason: "expired_cursor" },
          project_id: projectId,
          ts: Date.now(),
          workspace_id: scope.workspaceId,
        } satisfies JournalEnvelope,
      ],
      expired: true,
    };
  }
  const rows = await db
    .prepare(
      `SELECT id, workspace_id, channel, project_id, session_id, kind, ts, payload_json
       FROM pm_journal
       WHERE workspace_id = ? AND channel = ? AND id > ?
       ORDER BY id
       LIMIT ?`
    )
    .bind(scope.workspaceId, scope.channel, after, CHANNEL_JOURNAL_LIMIT)
    .all<JournalRow>();
  return {
    events: rows.results.map(toEnvelope),
    expired: false,
  };
}

export async function readJournalEnvelope(
  db: D1Database,
  scope: ChannelScope,
  id: number
) {
  const row = await db
    .prepare(
      `SELECT id, workspace_id, channel, project_id, session_id, kind, ts, payload_json
       FROM pm_journal
       WHERE workspace_id = ? AND channel = ? AND id = ?`
    )
    .bind(scope.workspaceId, scope.channel, id)
    .first<JournalRow>();
  return row ? toEnvelope(row) : null;
}

export async function commitJournalEntry(
  db: D1Database,
  scope: ChannelScope,
  entry: JournalWrite
) {
  const now = Date.now();
  const inserted = await db
    .prepare(
      `INSERT INTO pm_journal
       (workspace_id, channel, project_id, session_id, kind, ts, payload_json, operation_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(operation_key) DO NOTHING
       RETURNING id, workspace_id, channel, project_id, session_id, kind, ts, payload_json`
    )
    .bind(
      scope.workspaceId,
      scope.channel,
      entry.projectId,
      entry.sessionId ?? null,
      entry.kind,
      new Date(entry.ts ?? now).toISOString(),
      JSON.stringify(entry.payload),
      `${scope.workspaceId}:${scope.channel}:${entry.opKey}`
    )
    .first<JournalRow>();
  if (inserted) {
    return { envelope: toEnvelope(inserted), inserted: true };
  }
  const existing = await db
    .prepare(
      `SELECT id, workspace_id, channel, project_id, session_id, kind, ts, payload_json
       FROM pm_journal
       WHERE workspace_id = ? AND channel = ? AND operation_key = ?`
    )
    .bind(
      scope.workspaceId,
      scope.channel,
      `${scope.workspaceId}:${scope.channel}:${entry.opKey}`
    )
    .first<JournalRow>();
  return existing
    ? { envelope: toEnvelope(existing), inserted: false }
    : { envelope: null, inserted: false };
}
