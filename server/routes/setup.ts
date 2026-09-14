// Workspace setup API.
//
// Everything a workspace needs to go from "signed in" to "mining a real Slack
// channel": install the bot, list and enable channels, author the process, and
// assign roles to the people Slack resolved.

import { Hono } from "hono";
import { backfillChannel } from "../pipeline/backfill.ts";
import { apiError } from "../process-data.ts";
import {
  type ChannelCoordinatorEnv,
  wakeChannelCoordinator,
} from "../runtime/channel.ts";
import {
  exchangeOauthCode,
  SlackApiError,
  SlackClient,
} from "../slack/client.ts";
import {
  deletePolicy,
  parsePolicyInput,
  parseProjectInput,
  parseWorkflowInput,
  savePolicy,
  saveProject,
  saveWorkflow,
  syncRolesFromWorkflow,
} from "../tenant/authoring.ts";
import {
  clientForWorkspace,
  configureChannel,
  listChannels,
  readChannel,
  readInstall,
  revokeInstall,
  saveInstall,
  upsertChannel,
} from "../tenant/installs.ts";
import { readTenantKb } from "../tenant/kb.ts";
import { assignPersonRole, listPeople } from "../tenant/people.ts";

export interface SetupEnv extends ChannelCoordinatorEnv {
  BETTER_AUTH_URL: string;
  DB: D1Database;
  OPENROUTER_API_KEY?: string;
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  SLACK_SIGNING_SECRET?: string;
}

interface Variables {
  userId: string;
  workspaceId: string;
}

/**
 * Bot scopes Ariadne needs: read channel messages and membership to observe work,
 * read users to name the people doing it, and write messages to answer in thread.
 */
export const REQUIRED_BOT_SCOPES = [
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "chat:write",
  "users:read",
  "team:read",
] as const;

const BACKFILL_WINDOW_DAYS = 14;
const OAUTH_STATE_TTL_MS = 10 * 60_000;

export const setupRoutes = new Hono<{
  Bindings: SetupEnv;
  Variables: Variables;
}>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(request: Request) {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}

function redirectUri(env: SetupEnv) {
  return new URL("/api/setup/slack/callback", env.BETTER_AUTH_URL).toString();
}

/**
 * OAuth state binds the install callback to the signed-in user who started it and
 * expires quickly, so a leaked authorize URL cannot attach a workspace to someone
 * else's account.
 */
async function issueState(env: SetupEnv, userId: string) {
  const state = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO auth_verification (id, identifier, value, expiresAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      `slack-install:${state}`,
      userId,
      new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
      new Date().toISOString(),
      new Date().toISOString()
    )
    .run();
  return state;
}

async function consumeState(env: SetupEnv, state: string) {
  const identifier = `slack-install:${state}`;
  const row = await env.DB.prepare(
    "SELECT id, value, expiresAt FROM auth_verification WHERE identifier = ?"
  )
    .bind(identifier)
    .first<{ expiresAt: string; id: string; value: string }>();
  if (!row) {
    return null;
  }
  await env.DB.prepare("DELETE FROM auth_verification WHERE id = ?")
    .bind(row.id)
    .run();
  return Date.parse(row.expiresAt) > Date.now() ? row.value : null;
}

setupRoutes.get("/slack/install", async (c) => {
  if (!(c.env.SLACK_CLIENT_ID && c.env.SLACK_CLIENT_SECRET)) {
    return apiError(
      "slack_app_unconfigured",
      "Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to install the Slack app.",
      503
    );
  }
  const state = await issueState(c.env, c.get("userId"));
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", c.env.SLACK_CLIENT_ID);
  url.searchParams.set("scope", REQUIRED_BOT_SCOPES.join(","));
  url.searchParams.set("redirect_uri", redirectUri(c.env));
  url.searchParams.set("state", state);
  return c.json({ authorize_url: url.toString() });
});

setupRoutes.get("/slack/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!(code && state)) {
    return c.redirect("/app?install=missing_code", 302);
  }
  if (!(c.env.SLACK_CLIENT_ID && c.env.SLACK_CLIENT_SECRET)) {
    return c.redirect("/app?install=unconfigured", 302);
  }
  const installedBy = await consumeState(c.env, state);
  if (!installedBy) {
    return c.redirect("/app?install=expired", 302);
  }
  try {
    const access = await exchangeOauthCode({
      clientId: c.env.SLACK_CLIENT_ID,
      clientSecret: c.env.SLACK_CLIENT_SECRET,
      code,
      redirectUri: redirectUri(c.env),
    });
    await saveInstall(c.env.DB, {
      app_id: access.app_id,
      bot_token: access.bot_token,
      bot_user_id: access.bot_user_id,
      installed_by: installedBy,
      scopes: access.scopes,
      team_domain: access.team_domain,
      team_name: access.team_name,
      workspace_id: access.team_id,
    });
    // Populate the channel list immediately so setup can continue without a
    // second round trip to Slack.
    await syncChannels(c.env.DB, access.team_id, access.bot_token);
    return c.redirect("/app?install=ok", 302);
  } catch (error) {
    console.error(
      "Slack install failed",
      error instanceof Error ? error.message : "unknown"
    );
    return c.redirect("/app?install=failed", 302);
  }
});

async function syncChannels(db: D1Database, teamId: string, token: string) {
  const client = new SlackClient(token);
  const channels = await client.conversationsList({ limit: 500 });
  for (const channel of channels) {
    if (!channel.is_member) {
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: D1 has no multi-row upsert helper here and the list is bounded.
    await upsertChannel(db, {
      channel_id: channel.id,
      channel_name: channel.name,
      workspace_id: teamId,
    });
  }
  return channels.filter((channel) => channel.is_member).length;
}

setupRoutes.get("/status", async (c) => {
  const workspaceId = c.get("workspaceId");
  const [install, channels, kb, people] = await Promise.all([
    readInstall(c.env.DB, workspaceId),
    listChannels(c.env.DB, workspaceId),
    readTenantKb(c.env.DB, workspaceId),
    listPeople(c.env.DB, workspaceId),
  ]);
  const observed = channels.filter(
    (channel) => channel.enabled && channel.project_id
  );
  return c.json({
    channels: channels.map((channel) => ({
      backfilled_at: channel.backfilled_at,
      enabled: channel.enabled,
      id: channel.channel_id,
      last_error: channel.last_error,
      name: channel.channel_name,
      project_id: channel.project_id,
      session_idle_seconds: channel.session_idle_seconds,
    })),
    extraction: {
      configured: Boolean(c.env.OPENROUTER_API_KEY),
    },
    install: install
      ? {
          bot_user_id: install.bot_user_id,
          installed_at: install.installed_at,
          missing_scopes: REQUIRED_BOT_SCOPES.filter(
            (scope) => !install.scopes.includes(scope)
          ),
          scopes: install.scopes,
          team_domain: install.team_domain,
          team_name: install.team_name,
          workspace_id: install.workspace_id,
        }
      : null,
    people: people.map((person) => ({
      id: person.person_id,
      is_bot: person.is_bot,
      name: person.real_name || person.display_name,
      role_id: person.role_id,
      slack_user_id: person.slack_user_id,
      title: person.title,
    })),
    projects: kb.projects.map((project) => ({
      id: project.id,
      name: project.name,
      summary: project.summary,
      workflow_id: project.workflow_id,
    })),
    ready: Boolean(
      install &&
        observed.length > 0 &&
        kb.workflows.some((workflow) => workflow.activities.length > 0) &&
        c.env.OPENROUTER_API_KEY
    ),
    roles: kb.roles,
    signing_secret_configured: Boolean(c.env.SLACK_SIGNING_SECRET),
    workflows: kb.workflows.map((workflow) => ({
      activities: workflow.activities,
      entry_activity: workflow.entry_activity,
      exit_activities: workflow.exit_activities,
      id: workflow.id,
      name: workflow.name,
      project_id: workflow.project_id,
    })),
  });
});

setupRoutes.post("/slack/channels/sync", async (c) => {
  const workspaceId = c.get("workspaceId");
  const install = await readInstall(c.env.DB, workspaceId);
  if (!install) {
    return apiError("not_installed", "Install the Slack app first.", 409);
  }
  try {
    const count = await syncChannels(c.env.DB, workspaceId, install.bot_token);
    return c.json({ channels: count });
  } catch (error) {
    return slackFailure(error);
  }
});

setupRoutes.post("/channels/:id", async (c) => {
  const workspaceId = c.get("workspaceId");
  const channelId = c.req.param("id");
  const body = await readJson(c.req.raw);
  if (!isObject(body)) {
    return apiError("invalid_body", "A JSON object is required.", 400);
  }
  const existing = await readChannel(c.env.DB, workspaceId, channelId);
  if (!existing) {
    return apiError(
      "unknown_channel",
      "That channel is not visible to the Slack app. Invite the bot, then sync channels.",
      404
    );
  }
  const enabled = body.enabled === true;
  const projectId =
    typeof body.project_id === "string" && body.project_id
      ? body.project_id
      : null;
  if (enabled && !projectId) {
    return apiError(
      "project_required",
      "Choose the project this channel's work belongs to before enabling it.",
      400
    );
  }
  if (projectId) {
    const kb = await readTenantKb(c.env.DB, workspaceId);
    if (!kb.projects.some((project) => project.id === projectId)) {
      return apiError("unknown_project", "Unknown project_id.", 400);
    }
  }
  const idle =
    typeof body.session_idle_seconds === "number"
      ? body.session_idle_seconds
      : existing.session_idle_seconds;
  await configureChannel(c.env.DB, {
    channel_id: channelId,
    enabled,
    project_id: projectId,
    session_idle_seconds: idle,
    workspace_id: workspaceId,
  });
  const updated = await readChannel(c.env.DB, workspaceId, channelId);
  if (updated?.enabled && c.env.CHANNEL_COORDINATOR) {
    // Start the coordinator so extraction and delivery deadlines begin running.
    c.executionCtx.waitUntil(
      wakeChannelCoordinator(c.env, {
        channel: channelId,
        workspaceId,
      })
    );
  }
  return c.json({ channel: updated });
});

setupRoutes.post("/channels/:id/backfill", async (c) => {
  const workspaceId = c.get("workspaceId");
  const channelId = c.req.param("id");
  const [channel, install] = await Promise.all([
    readChannel(c.env.DB, workspaceId, channelId),
    readInstall(c.env.DB, workspaceId),
  ]);
  if (!(channel?.enabled && channel.project_id)) {
    return apiError(
      "channel_not_observed",
      "Enable the channel and bind it to a project first.",
      409
    );
  }
  if (!install) {
    return apiError("not_installed", "Install the Slack app first.", 409);
  }
  const client = await clientForWorkspace(c.env.DB, workspaceId);
  if (!client) {
    return apiError("not_installed", "Install the Slack app first.", 409);
  }
  const workflowId = await workflowForProject(
    c.env.DB,
    workspaceId,
    channel.project_id
  );
  const oldest = (
    Math.floor(Date.now() / 1000) -
    BACKFILL_WINDOW_DAYS * 86_400
  ).toString();
  try {
    const outcome = await backfillChannel(c.env.DB, channel, client, {
      oldest,
      teamDomain: install.team_domain,
      workflowId,
    });
    if (c.env.CHANNEL_COORDINATOR) {
      c.executionCtx.waitUntil(
        wakeChannelCoordinator(c.env, { channel: channelId, workspaceId })
      );
    }
    return c.json(outcome);
  } catch (error) {
    return slackFailure(error);
  }
});

setupRoutes.post("/projects", async (c) => {
  const parsed = parseProjectInput(await readJson(c.req.raw));
  if ("errors" in parsed) {
    return validationFailure(parsed.errors);
  }
  await saveProject(c.env.DB, c.get("workspaceId"), parsed.value);
  return c.json({ project: parsed.value });
});

setupRoutes.post("/workflows", async (c) => {
  const workspaceId = c.get("workspaceId");
  const parsed = parseWorkflowInput(await readJson(c.req.raw));
  if ("errors" in parsed) {
    return validationFailure(parsed.errors);
  }
  const kb = await readTenantKb(c.env.DB, workspaceId);
  if (!kb.projects.some((project) => project.id === parsed.value.project_id)) {
    return apiError("unknown_project", "Unknown project_id.", 400);
  }
  await saveWorkflow(c.env.DB, workspaceId, parsed.value);
  await syncRolesFromWorkflow(c.env.DB, workspaceId, parsed.value);
  return c.json({ workflow: parsed.value });
});

setupRoutes.post("/policies", async (c) => {
  const workspaceId = c.get("workspaceId");
  const parsed = parsePolicyInput(await readJson(c.req.raw));
  if ("errors" in parsed) {
    return validationFailure(parsed.errors);
  }
  const kb = await readTenantKb(c.env.DB, workspaceId);
  if (!kb.projects.some((project) => project.id === parsed.value.project_id)) {
    return apiError("unknown_project", "Unknown project_id.", 400);
  }
  const known = kb.workflows.some((workflow) =>
    workflow.activities.some(
      (activity) => activity.slug === parsed.value.activity_slug
    )
  );
  if (!known) {
    return apiError(
      "unknown_activity",
      "The policy must reference an activity in one of this workspace's workflows.",
      400
    );
  }
  await savePolicy(c.env.DB, workspaceId, parsed.value);
  return c.json({ policy: parsed.value });
});

setupRoutes.delete("/policies/:id", async (c) => {
  const removed = await deletePolicy(
    c.env.DB,
    c.get("workspaceId"),
    c.req.param("id")
  );
  if (!removed) {
    return apiError("unknown_policy", "Unknown policy id.", 404);
  }
  return c.json({ ok: true });
});

setupRoutes.post("/people/:id/role", async (c) => {
  const body = await readJson(c.req.raw);
  if (!isObject(body)) {
    return apiError("invalid_body", "A JSON object is required.", 400);
  }
  const roleId =
    typeof body.role_id === "string" && body.role_id ? body.role_id : null;
  const workspaceId = c.get("workspaceId");
  if (roleId) {
    const kb = await readTenantKb(c.env.DB, workspaceId);
    if (!kb.roles.some((role) => role.id === roleId)) {
      return apiError(
        "unknown_role",
        "Roles come from workflow activities. Add the role to an activity first.",
        400
      );
    }
  }
  const updated = await assignPersonRole(
    c.env.DB,
    workspaceId,
    c.req.param("id"),
    roleId
  );
  if (!updated) {
    return apiError("unknown_person", "Unknown person id.", 404);
  }
  return c.json({ ok: true });
});

setupRoutes.delete("/slack/install", async (c) => {
  await revokeInstall(c.env.DB, c.get("workspaceId"));
  return c.json({ ok: true });
});

function validationFailure(
  errors: ReadonlyArray<{ field: string; message: string }>
) {
  return Response.json(
    {
      error: {
        code: "invalid_input",
        details: errors,
        message: errors[0]?.message ?? "The request was invalid.",
      },
    },
    { status: 400 }
  );
}

function slackFailure(error: unknown) {
  if (error instanceof SlackApiError) {
    return apiError(
      `slack_${error.slackError}`,
      `Slack rejected the request: ${error.slackError}.`,
      error.slackError === "missing_scope" ? 403 : 502
    );
  }
  return apiError(
    "slack_unavailable",
    "Slack could not be reached. Try again.",
    502
  );
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
