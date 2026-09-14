// Shared test harness: a real SQLite-backed D1 shim, the real migration set, and
// a workspace configured the way a real install configures one.
//
// Tests run against the checked-in migrations rather than a hand-written schema,
// so a migration that forgets a column fails the suite instead of passing it.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export interface BoundStatement {
  all: <T>() => Promise<{ results: T[] }>;
  first: <T>() => Promise<T | null>;
  run: () => Promise<{ meta?: { changes?: number } }>;
}

export interface SqliteD1Options {
  /** Set to make every write throw, to exercise failure paths. */
  failWrites?: () => boolean;
}

export class SqliteD1 {
  private readonly db: DatabaseSync;
  private readonly options: SqliteD1Options;

  constructor(db: DatabaseSync, options: SqliteD1Options = {}) {
    this.db = db;
    this.options = options;
  }

  prepare(sql: string) {
    const create = (values: unknown[]): BoundStatement => ({
      all: async <T>() => ({
        results: this.db
          .prepare(sql)
          .all(...(values as SQLInputValue[])) as T[],
      }),
      first: async <T>() =>
        (this.db.prepare(sql).get(...(values as SQLInputValue[])) as
          | T
          | undefined) ?? null,
      run: async () => {
        if (this.options.failWrites?.()) {
          throw new Error("Database unavailable");
        }
        const result = this.db
          .prepare(sql)
          .run(...(values as SQLInputValue[]));
        return { meta: { changes: Number(result.changes ?? 0) } };
      },
    });
    return {
      all: create([]).all,
      bind: (...values: unknown[]) => create(values),
      first: create([]).first,
      run: create([]).run,
    };
  }

  async batch(statements: BoundStatement[]) {
    if (this.options.failWrites?.()) {
      throw new Error("Database unavailable");
    }
    return await Promise.all(statements.map((statement) => statement.run()));
  }
}

const MIGRATIONS_DIR = "migrations";

/**
 * Applies every checked-in migration in order. Better Auth's generated DDL uses
 * `date` columns, which node:sqlite accepts, so the auth tables come from the same
 * source of truth the deployed database uses.
 */
export function applyMigrations(db: DatabaseSync) {
  for (const name of readdirSync(MIGRATIONS_DIR).sort()) {
    if (!name.endsWith(".sql")) {
      continue;
    }
    db.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
  }
}

export function createTestDatabase(options: SqliteD1Options = {}) {
  const sqlite = new DatabaseSync(":memory:");
  applyMigrations(sqlite);
  return { d1: new SqliteD1(sqlite, options), sqlite };
}

export const TEST_WORKSPACE = "T0TESTTEAM";
export const TEST_CHANNEL = "C0TESTCHAN";
export const TEST_PROJECT = "proj_checkout";
export const TEST_WORKFLOW = "wf_incident_response";
export const TEST_BOT_TOKEN = "xoxb-test-token";

export interface TenantActivity {
  label: string;
  role: string;
  slug: string;
}

export const TEST_ACTIVITIES: TenantActivity[] = [
  { label: "Detect incident", role: "support", slug: "detect_incident" },
  { label: "Triage incident", role: "support", slug: "triage_incident" },
  { label: "Security review", role: "security", slug: "security_review" },
  { label: "Deploy fix", role: "engineering", slug: "deploy_fix" },
  { label: "Notify customer", role: "support", slug: "notify_customer" },
];

/**
 * Configures the workspace the way a completed setup leaves it: an install, an
 * enabled channel bound to a project, and an authored workflow with a linear
 * designed happy path.
 */
export function seedTenant(
  sqlite: DatabaseSync,
  options: {
    activities?: TenantActivity[];
    channel?: string;
    enabled?: boolean;
    idleSeconds?: number;
    projectId?: string;
    workflowId?: string;
    workspaceId?: string;
  } = {}
) {
  const workspaceId = options.workspaceId ?? TEST_WORKSPACE;
  const channel = options.channel ?? TEST_CHANNEL;
  const projectId = options.projectId ?? TEST_PROJECT;
  const workflowId = options.workflowId ?? TEST_WORKFLOW;
  const activities = options.activities ?? TEST_ACTIVITIES;
  const now = "2026-09-14T00:00:00.000Z";

  sqlite
    .prepare(
      `INSERT INTO slack_install
       (workspace_id, team_name, team_domain, app_id, bot_user_id, bot_token,
        scopes, installed_by, installed_at, updated_at, revoked_at)
       VALUES (?, 'Test Workspace', 'testworkspace', 'A0APP', 'U0BOT', ?,
               'channels:history,channels:read,chat:write,users:read',
               'auth-user', ?, ?, NULL)`
    )
    .run(workspaceId, TEST_BOT_TOKEN, now, now);
  sqlite
    .prepare(
      `INSERT INTO slack_channel
       (workspace_id, channel_id, channel_name, project_id, enabled,
        session_idle_seconds, backfilled_at, last_error, created_at, updated_at)
       VALUES (?, ?, 'ops-war-room', ?, ?, ?, NULL, NULL, ?, ?)`
    )
    .run(
      workspaceId,
      channel,
      options.enabled === false ? null : projectId,
      options.enabled === false ? 0 : 1,
      options.idleSeconds ?? 3600,
      now,
      now
    );
  sqlite
    .prepare(
      `INSERT INTO tenant_project
       (workspace_id, id, name, summary, spec_md, constraints_json, workflow_id,
        created_at, updated_at)
       VALUES (?, ?, 'Checkout', 'Checkout reliability', '', '[]', ?, ?, ?)`
    )
    .run(workspaceId, projectId, workflowId, now, now);
  sqlite
    .prepare(
      `INSERT INTO tenant_workflow
       (workspace_id, id, project_id, name, entry_slug, exit_slugs_json,
        created_at, updated_at)
       VALUES (?, ?, ?, 'Incident response', ?, ?, ?, ?)`
    )
    .run(
      workspaceId,
      workflowId,
      projectId,
      activities[0]?.slug ?? "",
      JSON.stringify(activities.slice(-1).map((activity) => activity.slug)),
      now,
      now
    );
  for (const [rank, activity] of activities.entries()) {
    sqlite
      .prepare(
        `INSERT INTO tenant_activity
         (workspace_id, workflow_id, slug, label, description, role_expected,
          rank, synonyms_json)
         VALUES (?, ?, ?, ?, '', ?, ?, '[]')`
      )
      .run(
        workspaceId,
        workflowId,
        activity.slug,
        activity.label,
        activity.role,
        rank
      );
  }
  for (const role of new Set(activities.map((activity) => activity.role))) {
    sqlite
      .prepare("INSERT INTO tenant_role (workspace_id, id, name) VALUES (?, ?, ?)")
      .run(workspaceId, role, role);
  }
  for (const activity of activities) {
    sqlite
      .prepare(
        `INSERT INTO tenant_role_repertoire
         (workspace_id, role_id, activity_slug, relation)
         VALUES (?, ?, ?, 'performs')`
      )
      .run(workspaceId, activity.role, activity.slug);
  }
  return { channel, projectId, workflowId, workspaceId };
}

export function seedPerson(
  sqlite: DatabaseSync,
  options: {
    name?: string;
    role?: string;
    slackUserId: string;
    workspaceId?: string;
  }
) {
  const workspaceId = options.workspaceId ?? TEST_WORKSPACE;
  const personId = `per_${options.slackUserId.toLowerCase()}`;
  sqlite
    .prepare(
      `INSERT INTO tenant_person
       (workspace_id, person_id, slack_user_id, display_name, real_name, title,
        role_id, is_bot, deleted, avatar_url, color, tz, updated_at)
       VALUES (?, ?, ?, ?, ?, '', ?, 0, 0, NULL, '#6366F1', NULL, ?)`
    )
    .run(
      workspaceId,
      personId,
      options.slackUserId,
      options.name ?? options.slackUserId,
      options.name ?? options.slackUserId,
      options.role ?? null,
      "2026-09-14T00:00:00.000Z"
    );
  return personId;
}

/** Seeds a signed-in user whose session resolves to the test workspace. */
export function seedAuthUser(
  sqlite: DatabaseSync,
  options: { id?: string; workspaceId?: string } = {}
) {
  const id = options.id ?? "auth-user";
  sqlite
    .prepare(
      `INSERT INTO auth_user
       (id, name, email, emailVerified, image, createdAt, updatedAt,
        slackTeamId, slackTeamName, slackUserId)
       VALUES (?, 'Test User', ?, 1, NULL, ?, ?, ?, 'Test Workspace', 'U0USER')`
    )
    .run(
      id,
      `${id}@example.invalid`,
      "2026-09-14T00:00:00.000Z",
      "2026-09-14T00:00:00.000Z",
      options.workspaceId ?? TEST_WORKSPACE
    );
  return id;
}
