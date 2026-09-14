// Workspace install and observed-channel records.

import { SlackClient, type SlackClientOptions } from "../slack/client.ts";

export interface SlackInstall {
  app_id: string;
  bot_token: string;
  bot_user_id: string;
  installed_at: string;
  installed_by: string | null;
  scopes: string[];
  team_domain: string | null;
  team_name: string;
  workspace_id: string;
}

export interface ObservedChannel {
  backfilled_at: string | null;
  channel_id: string;
  channel_name: string;
  enabled: boolean;
  last_error: string | null;
  project_id: string | null;
  session_idle_seconds: number;
  workspace_id: string;
}

interface InstallRow {
  app_id: string | null;
  bot_token: string;
  bot_user_id: string;
  installed_at: string;
  installed_by: string | null;
  scopes: string;
  team_domain: string | null;
  team_name: string;
  workspace_id: string;
}

interface ChannelRow {
  backfilled_at: string | null;
  channel_id: string;
  channel_name: string;
  enabled: number;
  last_error: string | null;
  project_id: string | null;
  session_idle_seconds: number;
  workspace_id: string;
}

const MIN_IDLE_SECONDS = 60;
const MAX_IDLE_SECONDS = 86_400;

function toInstall(row: InstallRow): SlackInstall {
  return {
    app_id: row.app_id ?? "",
    bot_token: row.bot_token,
    bot_user_id: row.bot_user_id,
    installed_at: row.installed_at,
    installed_by: row.installed_by,
    scopes: row.scopes ? row.scopes.split(",").filter(Boolean) : [],
    team_domain: row.team_domain,
    team_name: row.team_name,
    workspace_id: row.workspace_id,
  };
}

function toChannel(row: ChannelRow): ObservedChannel {
  return {
    backfilled_at: row.backfilled_at,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    enabled: row.enabled === 1,
    last_error: row.last_error,
    project_id: row.project_id,
    session_idle_seconds: row.session_idle_seconds,
    workspace_id: row.workspace_id,
  };
}

export async function saveInstall(
  db: D1Database,
  install: {
    app_id: string;
    bot_token: string;
    bot_user_id: string;
    installed_by?: string | null;
    scopes: string;
    team_domain: string | null;
    team_name: string;
    workspace_id: string;
  },
  now = new Date().toISOString()
) {
  await db
    .prepare(
      `INSERT INTO slack_install
       (workspace_id, team_name, team_domain, app_id, bot_user_id, bot_token,
        scopes, installed_by, installed_at, updated_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(workspace_id) DO UPDATE SET
         team_name = excluded.team_name,
         team_domain = excluded.team_domain,
         app_id = excluded.app_id,
         bot_user_id = excluded.bot_user_id,
         bot_token = excluded.bot_token,
         scopes = excluded.scopes,
         installed_by = COALESCE(excluded.installed_by, slack_install.installed_by),
         updated_at = excluded.updated_at,
         revoked_at = NULL`
    )
    .bind(
      install.workspace_id,
      install.team_name,
      install.team_domain,
      install.app_id,
      install.bot_user_id,
      install.bot_token,
      install.scopes,
      install.installed_by ?? null,
      now,
      now
    )
    .run();
}

export async function readInstall(db: D1Database, workspaceId: string) {
  const row = await db
    .prepare(
      `SELECT workspace_id, team_name, team_domain, app_id, bot_user_id,
              bot_token, scopes, installed_by, installed_at
       FROM slack_install
       WHERE workspace_id = ? AND revoked_at IS NULL`
    )
    .bind(workspaceId)
    .first<InstallRow>();
  return row ? toInstall(row) : null;
}

export async function listInstalls(db: D1Database) {
  const rows = await db
    .prepare(
      `SELECT workspace_id, team_name, team_domain, app_id, bot_user_id,
              bot_token, scopes, installed_by, installed_at
       FROM slack_install
       WHERE revoked_at IS NULL
       ORDER BY workspace_id`
    )
    .all<InstallRow>();
  return rows.results.map(toInstall);
}

export async function revokeInstall(
  db: D1Database,
  workspaceId: string,
  now = new Date().toISOString()
) {
  await db
    .prepare(
      "UPDATE slack_install SET revoked_at = ?, updated_at = ? WHERE workspace_id = ?"
    )
    .bind(now, now, workspaceId)
    .run();
}

/**
 * Builds a Slack client for a workspace. Returns null rather than throwing so
 * callers on a background path can skip a workspace whose install was removed.
 */
export async function clientForWorkspace(
  db: D1Database,
  workspaceId: string,
  options: SlackClientOptions = {}
) {
  const install = await readInstall(db, workspaceId);
  if (!install) {
    return null;
  }
  return new SlackClient(install.bot_token, options);
}

export async function upsertChannel(
  db: D1Database,
  channel: {
    channel_id: string;
    channel_name: string;
    workspace_id: string;
  },
  now = new Date().toISOString()
) {
  await db
    .prepare(
      `INSERT INTO slack_channel
       (workspace_id, channel_id, channel_name, project_id, enabled,
        session_idle_seconds, backfilled_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 0, 3600, NULL, NULL, ?, ?)
       ON CONFLICT(workspace_id, channel_id) DO UPDATE SET
         channel_name = excluded.channel_name,
         updated_at = excluded.updated_at`
    )
    .bind(
      channel.workspace_id,
      channel.channel_id,
      channel.channel_name,
      now,
      now
    )
    .run();
}

export async function configureChannel(
  db: D1Database,
  input: {
    channel_id: string;
    enabled: boolean;
    project_id: string | null;
    session_idle_seconds?: number;
    workspace_id: string;
  },
  now = new Date().toISOString()
) {
  const idle = Math.min(
    Math.max(input.session_idle_seconds ?? 3600, MIN_IDLE_SECONDS),
    MAX_IDLE_SECONDS
  );
  await db
    .prepare(
      `UPDATE slack_channel
       SET project_id = ?, enabled = ?, session_idle_seconds = ?, updated_at = ?
       WHERE workspace_id = ? AND channel_id = ?`
    )
    .bind(
      input.project_id,
      input.enabled ? 1 : 0,
      idle,
      now,
      input.workspace_id,
      input.channel_id
    )
    .run();
}

export async function readChannel(
  db: D1Database,
  workspaceId: string,
  channelId: string
) {
  const row = await db
    .prepare(
      `SELECT workspace_id, channel_id, channel_name, project_id, enabled,
              session_idle_seconds, backfilled_at, last_error
       FROM slack_channel
       WHERE workspace_id = ? AND channel_id = ?`
    )
    .bind(workspaceId, channelId)
    .first<ChannelRow>();
  return row ? toChannel(row) : null;
}

export async function listChannels(db: D1Database, workspaceId: string) {
  const rows = await db
    .prepare(
      `SELECT workspace_id, channel_id, channel_name, project_id, enabled,
              session_idle_seconds, backfilled_at, last_error
       FROM slack_channel
       WHERE workspace_id = ?
       ORDER BY enabled DESC, channel_name`
    )
    .bind(workspaceId)
    .all<ChannelRow>();
  return rows.results.map(toChannel);
}

export async function listEnabledChannels(db: D1Database) {
  const rows = await db
    .prepare(
      `SELECT ch.workspace_id, ch.channel_id, ch.channel_name, ch.project_id,
              ch.enabled, ch.session_idle_seconds, ch.backfilled_at, ch.last_error
       FROM slack_channel ch
       JOIN slack_install ins ON ins.workspace_id = ch.workspace_id
       WHERE ch.enabled = 1 AND ch.project_id IS NOT NULL
         AND ins.revoked_at IS NULL
       ORDER BY ch.workspace_id, ch.channel_id`
    )
    .all<ChannelRow>();
  return rows.results.map(toChannel);
}

export async function markChannelBackfilled(
  db: D1Database,
  workspaceId: string,
  channelId: string,
  now = new Date().toISOString()
) {
  await db
    .prepare(
      `UPDATE slack_channel SET backfilled_at = ?, updated_at = ?
       WHERE workspace_id = ? AND channel_id = ?`
    )
    .bind(now, now, workspaceId, channelId)
    .run();
}

export async function recordChannelError(
  db: D1Database,
  workspaceId: string,
  channelId: string,
  message: string | null,
  now = new Date().toISOString()
) {
  await db
    .prepare(
      `UPDATE slack_channel SET last_error = ?, updated_at = ?
       WHERE workspace_id = ? AND channel_id = ?`
    )
    .bind(message?.slice(0, 500) ?? null, now, workspaceId, channelId)
    .run();
}
