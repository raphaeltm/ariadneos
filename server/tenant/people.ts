// Resolves Slack user ids to workspace people.
//
// Extraction needs stable person ids and human-readable names. Slack only gives
// the raw user id on a message event, so unknown ids are resolved through
// users.info once and cached in tenant_person.

import type { SlackClient } from "../slack/client.ts";

export interface TenantPerson {
  avatar_url: string | null;
  color: string;
  deleted: boolean;
  display_name: string;
  is_bot: boolean;
  person_id: string;
  real_name: string;
  role_id: string | null;
  slack_user_id: string;
  title: string;
  tz: string | null;
}

interface PersonRow {
  avatar_url: string | null;
  color: string;
  deleted: number;
  display_name: string;
  is_bot: number;
  person_id: string;
  real_name: string;
  role_id: string | null;
  slack_user_id: string;
  title: string;
  tz: string | null;
}

const SLACK_USER_ID = /^[A-Z0-9._-]{2,64}$/;

/**
 * Derives the person id from the Slack user id so re-resolving a user never
 * produces a second person, and so step ids stay stable across re-extraction.
 */
export function personIdForSlackUser(slackUserId: string) {
  return `per_${slackUserId.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_")}`;
}

function toPerson(row: PersonRow): TenantPerson {
  return {
    avatar_url: row.avatar_url,
    color: row.color,
    deleted: row.deleted === 1,
    display_name: row.display_name,
    is_bot: row.is_bot === 1,
    person_id: row.person_id,
    real_name: row.real_name,
    role_id: row.role_id,
    slack_user_id: row.slack_user_id,
    title: row.title,
    tz: row.tz,
  };
}

const PERSON_COLUMNS = `workspace_id, person_id, slack_user_id, display_name, real_name,
  title, role_id, is_bot, deleted, avatar_url, color, tz, updated_at`;

export async function listPeople(db: D1Database, workspaceId: string) {
  const rows = await db
    .prepare(
      `SELECT person_id, slack_user_id, display_name, real_name, title, role_id,
              is_bot, deleted, avatar_url, color, tz
       FROM tenant_person
       WHERE workspace_id = ?
       ORDER BY real_name, person_id`
    )
    .bind(workspaceId)
    .all<PersonRow>();
  return rows.results.map(toPerson);
}

export async function readPersonBySlackUser(
  db: D1Database,
  workspaceId: string,
  slackUserId: string
) {
  const row = await db
    .prepare(
      `SELECT person_id, slack_user_id, display_name, real_name, title, role_id,
              is_bot, deleted, avatar_url, color, tz
       FROM tenant_person
       WHERE workspace_id = ? AND slack_user_id = ?`
    )
    .bind(workspaceId, slackUserId)
    .first<PersonRow>();
  return row ? toPerson(row) : null;
}

export async function assignPersonRole(
  db: D1Database,
  workspaceId: string,
  personId: string,
  roleId: string | null,
  now = new Date().toISOString()
) {
  const result = await db
    .prepare(
      `UPDATE tenant_person SET role_id = ?, updated_at = ?
       WHERE workspace_id = ? AND person_id = ?`
    )
    .bind(roleId, now, workspaceId, personId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Returns the person for a Slack user id, resolving through users.info on first
 * sight. A failed lookup stores a placeholder so ingestion still has a stable
 * person id and does not re-call Slack for every message from that user.
 */
export async function resolvePerson(
  db: D1Database,
  input: { slackUserId: string; workspaceId: string },
  client: SlackClient | null,
  now = new Date().toISOString()
): Promise<TenantPerson | null> {
  if (!SLACK_USER_ID.test(input.slackUserId)) {
    return null;
  }
  const existing = await readPersonBySlackUser(
    db,
    input.workspaceId,
    input.slackUserId
  );
  if (existing) {
    return existing;
  }
  const personId = personIdForSlackUser(input.slackUserId);
  let resolved: {
    avatarUrl: string | null;
    color: string;
    deleted: boolean;
    displayName: string;
    isBot: boolean;
    realName: string;
    title: string;
    tz: string | null;
  } = {
    avatarUrl: null,
    color: "#6366F1",
    deleted: false,
    displayName: input.slackUserId,
    isBot: false,
    realName: input.slackUserId,
    title: "",
    tz: null,
  };
  if (client) {
    try {
      const user = await client.usersInfo(input.slackUserId);
      resolved = {
        avatarUrl: user.image_url,
        color: user.color ?? "#6366F1",
        deleted: user.deleted,
        displayName: user.display_name,
        isBot: user.is_bot,
        realName: user.real_name,
        title: user.title,
        tz: user.tz,
      };
    } catch (error) {
      console.error(
        "Slack users.info failed",
        error instanceof Error ? error.message : "unknown"
      );
    }
  }
  await db
    .prepare(
      `INSERT INTO tenant_person (${PERSON_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, person_id) DO UPDATE SET
         display_name = excluded.display_name,
         real_name = excluded.real_name,
         title = excluded.title,
         is_bot = excluded.is_bot,
         deleted = excluded.deleted,
         avatar_url = excluded.avatar_url,
         color = excluded.color,
         tz = excluded.tz,
         updated_at = excluded.updated_at`
    )
    .bind(
      input.workspaceId,
      personId,
      input.slackUserId,
      resolved.displayName,
      resolved.realName,
      resolved.title,
      resolved.isBot ? 1 : 0,
      resolved.deleted ? 1 : 0,
      resolved.avatarUrl,
      resolved.color,
      resolved.tz,
      now
    )
    .run();
  return {
    avatar_url: resolved.avatarUrl,
    color: resolved.color,
    deleted: resolved.deleted,
    display_name: resolved.displayName,
    is_bot: resolved.isBot,
    person_id: personId,
    real_name: resolved.realName,
    role_id: null,
    slack_user_id: input.slackUserId,
    title: resolved.title,
    tz: resolved.tz,
  };
}
