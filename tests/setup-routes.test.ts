import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../server/index.ts";
import { REQUIRED_BOT_SCOPES } from "../server/routes/setup.ts";
import {
  createTestDatabase,
  type SqliteD1,
  seedPerson,
  seedTenant,
  TEST_CHANNEL,
  TEST_PROJECT,
  TEST_WORKFLOW,
  TEST_WORKSPACE,
} from "./helpers/tenant.ts";

interface SessionIdentity {
  slackTeamId: string;
  slackUserId: string;
  userId: string;
}

const authState = vi.hoisted(() => ({
  identity: {
    slackTeamId: "T0TESTTEAM",
    slackUserId: "U0USER",
    userId: "auth-user",
  } as SessionIdentity | null,
}));

// server/auth.ts needs a real D1 (and a real Better Auth secret) to construct,
// so the session boundary is stubbed. sessionIdentity keeps its real contract:
// whatever identity the test sets is what the route sees, letting each test
// drive the workspace scoping directly instead of through a fake login flow.
vi.mock("../server/auth.ts", () => ({
  authConfigured: () => true,
  createAuth: () => ({
    api: { getSession: () => Promise.resolve(null) },
    handler: () => new Response("auth handler"),
  }),
  sessionIdentity: () => authState.identity,
}));

const OTHER_WORKSPACE = "T0OTHERTEAM";
const OTHER_CHANNEL = "C0OTHERCHAN";
const OTHER_PROJECT = "proj_other_co";
const OTHER_WORKFLOW = "wf_other_flow";

const origin = "https://ariadneos.example";
const context = {} as ExecutionContext;

let sqlite: DatabaseSync;
let d1: SqliteD1;
let env: Parameters<typeof worker.fetch>[1];

function baseEnv(overrides: Record<string, unknown> = {}) {
  return {
    BETTER_AUTH_URL: origin,
    DB: d1 as unknown as D1Database,
    SLACK_CLIENT_ID: "client-1",
    SLACK_CLIENT_SECRET: "secret-1",
    ...overrides,
  } as Parameters<typeof worker.fetch>[1];
}

function get(path: string, requestEnv = env) {
  return worker.fetch(new Request(`${origin}${path}`), requestEnv, context);
}

function post(path: string, body: unknown, requestEnv = env) {
  return worker.fetch(
    new Request(`${origin}${path}`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Origin: origin },
      method: "POST",
    }),
    requestEnv,
    context
  );
}

function del(path: string, requestEnv = env) {
  return worker.fetch(
    new Request(`${origin}${path}`, {
      headers: { Origin: origin },
      method: "DELETE",
    }),
    requestEnv,
    context
  );
}

function asWorkspace(workspaceId: string, slackUserId = "U0USER") {
  authState.identity = {
    slackTeamId: workspaceId,
    slackUserId,
    userId: "auth-user",
  };
}

beforeEach(() => {
  ({ d1, sqlite } = createTestDatabase());
  env = baseEnv();
  asWorkspace(TEST_WORKSPACE);
});

afterEach(() => {
  sqlite.close();
});

describe("GET /api/setup/status", () => {
  it("reports an unconfigured workspace with no install, channels, projects or workflows", async () => {
    const response = await get("/api/setup/status");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      channels: unknown[];
      install: unknown;
      projects: unknown[];
      ready: boolean;
      workflows: unknown[];
    };
    expect(payload.install).toBeNull();
    expect(payload.channels).toEqual([]);
    expect(payload.projects).toEqual([]);
    expect(payload.workflows).toEqual([]);
    expect(payload.ready).toBe(false);
  });

  it("reports the install, the enabled channel and the workflow once the workspace is seeded", async () => {
    seedTenant(sqlite);
    const response = await get("/api/setup/status");
    const payload = (await response.json()) as {
      channels: Array<{
        enabled: boolean;
        id: string;
        project_id: string | null;
      }>;
      install: { team_name: string; workspace_id: string } | null;
      projects: Array<{ id: string }>;
      ready: boolean;
      workflows: Array<{ id: string }>;
    };
    expect(payload.install).toMatchObject({
      team_name: "Test Workspace",
      workspace_id: TEST_WORKSPACE,
    });
    expect(payload.channels).toEqual([
      expect.objectContaining({
        enabled: true,
        id: TEST_CHANNEL,
        project_id: TEST_PROJECT,
      }),
    ]);
    expect(payload.projects.map((project) => project.id)).toEqual([
      TEST_PROJECT,
    ]);
    expect(payload.workflows.map((workflow) => workflow.id)).toEqual([
      TEST_WORKFLOW,
    ]);
  });

  it("is ready only once OPENROUTER_API_KEY is configured on top of a full setup", async () => {
    seedTenant(sqlite);
    const withoutKey = (await (await get("/api/setup/status")).json()) as {
      ready: boolean;
    };
    expect(withoutKey.ready).toBe(false);

    env = baseEnv({ OPENROUTER_API_KEY: "sk-test" });
    const withKey = (await (await get("/api/setup/status")).json()) as {
      ready: boolean;
    };
    expect(withKey.ready).toBe(true);
  });

  it("reports missing_scopes when the stored install lacks a required bot scope", async () => {
    // seedTenant's fixture install predates a few of the scopes Ariadne now
    // requires (groups:history, groups:read, team:read); status must surface
    // that gap so the setup UI can prompt a re-install instead of silently
    // degrading.
    seedTenant(sqlite);
    const payload = (await (await get("/api/setup/status")).json()) as {
      install: { missing_scopes: string[] } | null;
    };
    expect(payload.install?.missing_scopes).toEqual([
      "groups:history",
      "groups:read",
      "team:read",
    ]);
  });
});

describe("GET /api/setup/slack/install", () => {
  it("returns an authorize URL with the client id, required scopes and a state parameter", async () => {
    const response = await get("/api/setup/slack/install");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { authorize_url: string };
    const url = new URL(payload.authorize_url);
    expect(url.searchParams.get("client_id")).toBe("client-1");
    const scopes = url.searchParams.get("scope")?.split(",") ?? [];
    for (const scope of REQUIRED_BOT_SCOPES) {
      expect(scopes).toContain(scope);
    }
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("returns 503 when the Slack app credentials are not configured", async () => {
    env = baseEnv({ SLACK_CLIENT_ID: "", SLACK_CLIENT_SECRET: "" });
    const response = await get("/api/setup/slack/install");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "slack_app_unconfigured" },
    });
  });
});

describe("POST /api/setup/channels/:id", () => {
  it("refuses to enable a channel without a project", async () => {
    seedTenant(sqlite, { enabled: false });
    const response = await post(`/api/setup/channels/${TEST_CHANNEL}`, {
      enabled: true,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "project_required" },
    });
  });

  it("refuses an unknown project", async () => {
    seedTenant(sqlite, { enabled: false });
    const response = await post(`/api/setup/channels/${TEST_CHANNEL}`, {
      enabled: true,
      project_id: "proj_does_not_exist",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unknown_project" },
    });
  });

  it("refuses a channel the Slack app cannot see", async () => {
    seedTenant(sqlite);
    const response = await post("/api/setup/channels/C0UNKNOWNCHAN", {
      enabled: true,
      project_id: TEST_PROJECT,
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unknown_channel" },
    });
  });

  it("enables a channel once it is paired with a real project", async () => {
    seedTenant(sqlite, { enabled: false });
    const response = await post(`/api/setup/channels/${TEST_CHANNEL}`, {
      enabled: true,
      project_id: TEST_PROJECT,
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      channel: { enabled: boolean; project_id: string | null };
    };
    expect(payload.channel).toMatchObject({
      enabled: true,
      project_id: TEST_PROJECT,
    });
  });
});

describe("POST /api/setup/projects and /api/setup/workflows", () => {
  it("persists a project and workflow that are then readable through status", async () => {
    const projectResponse = await post("/api/setup/projects", {
      name: "Support Escalations",
    });
    expect(projectResponse.status).toBe(200);
    const projectPayload = (await projectResponse.json()) as {
      project: { id: string };
    };
    const projectId = projectPayload.project.id;

    const workflowResponse = await post("/api/setup/workflows", {
      activities: [{ label: "Log ticket" }, { label: "Resolve ticket" }],
      name: "Escalation flow",
      project_id: projectId,
    });
    expect(workflowResponse.status).toBe(200);
    const workflowPayload = (await workflowResponse.json()) as {
      workflow: { id: string };
    };

    const status = (await (await get("/api/setup/status")).json()) as {
      projects: Array<{ id: string }>;
      workflows: Array<{ id: string }>;
    };
    expect(status.projects.map((project) => project.id)).toContain(projectId);
    expect(status.workflows.map((workflow) => workflow.id)).toContain(
      workflowPayload.workflow.id
    );
  });

  it("rejects a workflow whose project_id does not exist", async () => {
    const response = await post("/api/setup/workflows", {
      activities: [{ label: "Step" }],
      name: "Orphan flow",
      project_id: "proj_does_not_exist",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unknown_project" },
    });
  });
});

describe("POST /api/setup/policies", () => {
  it("rejects an activity that is not part of any of the workspace's workflows", async () => {
    seedTenant(sqlite);
    const response = await post("/api/setup/policies", {
      activity_slug: "not_a_real_activity",
      kind: "mandatory",
      project_id: TEST_PROJECT,
      text: "Must be reviewed first.",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unknown_activity" },
    });
  });

  it("saves a policy that references a real workflow activity", async () => {
    seedTenant(sqlite);
    const response = await post("/api/setup/policies", {
      activity_slug: "security_review",
      kind: "mandatory",
      project_id: TEST_PROJECT,
      text: "A security reviewer must sign off before deploy.",
    });
    expect(response.status).toBe(200);
  });
});

describe("POST /api/setup/people/:id/role", () => {
  it("rejects an unknown role", async () => {
    seedTenant(sqlite);
    const personId = seedPerson(sqlite, { slackUserId: "U0ENG" });
    const response = await post(`/api/setup/people/${personId}/role`, {
      role_id: "not_a_real_role",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unknown_role" },
    });
  });

  it("rejects an unknown person", async () => {
    seedTenant(sqlite);
    const response = await post("/api/setup/people/per_does_not_exist/role", {
      role_id: "support",
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unknown_person" },
    });
  });

  it("assigns a real role to a seeded person", async () => {
    seedTenant(sqlite);
    const personId = seedPerson(sqlite, { slackUserId: "U0ENG" });
    const response = await post(`/api/setup/people/${personId}/role`, {
      role_id: "engineering",
    });
    expect(response.status).toBe(200);
    const row = sqlite
      .prepare(
        "SELECT role_id FROM tenant_person WHERE workspace_id = ? AND person_id = ?"
      )
      .get(TEST_WORKSPACE, personId) as { role_id: string | null };
    expect(row.role_id).toBe("engineering");
  });
});

describe("DELETE /api/setup/slack/install", () => {
  it("revokes the install, after which status reports install: null", async () => {
    seedTenant(sqlite);
    const response = await del("/api/setup/slack/install");
    expect(response.status).toBe(200);
    const payload = (await (await get("/api/setup/status")).json()) as {
      install: unknown;
    };
    expect(payload.install).toBeNull();
  });
});

describe("tenancy isolation", () => {
  it("does not let workspace A see or mutate workspace B's channels or projects", async () => {
    seedTenant(sqlite);
    // Workspace B's channel starts disabled and unbound, so a successful cross-
    // tenant mutation from A would be directly observable as a flip to enabled.
    seedTenant(sqlite, {
      channel: OTHER_CHANNEL,
      enabled: false,
      projectId: OTHER_PROJECT,
      workflowId: OTHER_WORKFLOW,
      workspaceId: OTHER_WORKSPACE,
    });

    asWorkspace(TEST_WORKSPACE);
    const statusA = (await (await get("/api/setup/status")).json()) as {
      channels: Array<{ id: string }>;
      projects: Array<{ id: string }>;
    };
    expect(statusA.channels.map((channel) => channel.id)).toEqual([
      TEST_CHANNEL,
    ]);
    expect(statusA.projects.map((project) => project.id)).toEqual([
      TEST_PROJECT,
    ]);

    // The most important assertion: a session scoped to workspace A must not be
    // able to reach into workspace B's channel by id, even though the row exists
    // in the same database.
    const crossTenantEnable = await post(
      `/api/setup/channels/${OTHER_CHANNEL}`,
      {
        enabled: true,
        project_id: OTHER_PROJECT,
      }
    );
    expect(crossTenantEnable.status).toBe(404);
    await expect(crossTenantEnable.json()).resolves.toMatchObject({
      error: { code: "unknown_channel" },
    });

    asWorkspace(OTHER_WORKSPACE);
    const statusB = (await (await get("/api/setup/status")).json()) as {
      channels: Array<{ enabled: boolean; id: string }>;
      projects: Array<{ id: string }>;
    };
    expect(statusB.channels).toEqual([
      expect.objectContaining({ enabled: false, id: OTHER_CHANNEL }),
    ]);
    expect(statusB.projects.map((project) => project.id)).toEqual([
      OTHER_PROJECT,
    ]);

    // Workspace B's own channel row was never touched by A's failed attempt: it
    // is still disabled and unbound, not flipped on by the cross-tenant request.
    const row = sqlite
      .prepare(
        "SELECT enabled, project_id FROM slack_channel WHERE workspace_id = ? AND channel_id = ?"
      )
      .get(OTHER_WORKSPACE, OTHER_CHANNEL) as {
      enabled: number;
      project_id: string | null;
    };
    expect(row).toEqual({ enabled: 0, project_id: null });
  });
});
