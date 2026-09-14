import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../server/index.ts";
import {
  createTestDatabase,
  seedPerson,
  seedTenant,
  TEST_CHANNEL,
  TEST_PROJECT,
  TEST_WORKSPACE,
} from "./helpers/tenant.ts";

const secret = "test-only-slack-signing-secret";
let sqlite: DatabaseSync;
let failWrites = false;
let env: Record<string, unknown>;

// The receiver resolves message authors through users.info. Stubbing fetch keeps
// the test offline while still exercising the real resolution path.
const slackFetch = vi.fn(
  async (input: RequestInfo | URL) =>
    new Response(
      JSON.stringify(
        String(input).endsWith("/users.info")
          ? {
              ok: true,
              user: {
                id: "U0HUMAN",
                is_bot: false,
                profile: { display_name: "Ada", title: "Engineer" },
                real_name: "Ada Lovelace",
              },
            }
          : { ok: true }
      ),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    )
);

const event = (
  id = "Ev1",
  team = TEST_WORKSPACE,
  message: Record<string, unknown> = {}
) => ({
  event: {
    channel: TEST_CHANNEL,
    channel_type: "channel",
    event_ts: "1700000000.000001",
    text: "Checkout is returning 500s",
    ts: "1700000000.000001",
    type: "message",
    user: "U0HUMAN",
    ...message,
  },
  event_id: id,
  team_id: team,
  type: "event_callback",
});

function request(
  payload: unknown,
  options: {
    bindings?: Record<string, unknown>;
    raw?: string;
    signature?: string;
    signingSecret?: string;
    timestamp?: number;
  } = {}
) {
  const raw = options.raw ?? JSON.stringify(payload);
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const signature =
    options.signature ??
    `v0=${createHmac("sha256", options.signingSecret ?? secret)
      .update(`v0:${timestamp}:${raw}`)
      .digest("hex")}`;
  return worker.fetch(
    new Request("https://staging.ariadneos.com/api/slack/events", {
      body: raw,
      headers: {
        "Content-Type": "application/json",
        "X-Slack-Request-Timestamp": timestamp,
        "X-Slack-Signature": signature,
      },
      method: "POST",
    }),
    (options.bindings ?? env) as never,
    {
      passThroughOnException: () => undefined,
      props: {},
      waitUntil: () => undefined,
    } as unknown as ExecutionContext
  );
}

const rawEvents = () =>
  sqlite
    .prepare(
      "SELECT * FROM slack_message_events ORDER BY received_at, event_id"
    )
    .all();
const pmMessages = () =>
  sqlite
    .prepare("SELECT * FROM pm_message ORDER BY workspace_id, channel, ts")
    .all();
const pmSessions = () =>
  sqlite.prepare("SELECT * FROM pm_session ORDER BY started_ts, id").all();
const processingRows = () =>
  sqlite
    .prepare(
      "SELECT * FROM pm_processing ORDER BY workspace_id, channel, observation_id"
    )
    .all();
const journalRows = () =>
  sqlite.prepare("SELECT * FROM pm_journal ORDER BY id, operation_key").all();

beforeEach(() => {
  const { d1, sqlite: database } = createTestDatabase({
    failWrites: () => failWrites,
  });
  sqlite = database;
  seedTenant(sqlite);
  failWrites = false;
  slackFetch.mockClear();
  vi.stubGlobal("fetch", slackFetch);
  env = {
    DB: d1,
    SLACK_SIGNING_SECRET: secret,
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  sqlite.close();
});

describe("Slack Events HTTP receiver and storage", () => {
  it("verifies the challenge without requiring browser Origin or login", async () => {
    const response = await request({
      challenge: "challenge-value",
      type: "url_verification",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "challenge-value" });
    expect(rawEvents()).toHaveLength(0);
  });

  it("persists a message before acknowledging and deduplicates retries", async () => {
    expect((await request(event())).status).toBe(200);
    expect((await request(event())).status).toBe(200);
    expect(rawEvents()).toHaveLength(1);
    expect(rawEvents()[0]).toMatchObject({
      channel_id: TEST_CHANNEL,
      event_id: "Ev1",
      message_ts: "1700000000.000001",
      team_id: TEST_WORKSPACE,
      text: "Checkout is returning 500s",
      user_id: "U0HUMAN",
    });
    expect(pmMessages()).toHaveLength(1);
    expect(pmMessages()[0]).toMatchObject({
      author_label: "Ada Lovelace",
      author_person_id: "per_u0human",
      channel: TEST_CHANNEL,
      id: `${TEST_WORKSPACE}:${TEST_CHANNEL}:1700000000.000001`,
      is_agent: 0,
      permalink: `https://testworkspace.slack.com/archives/${TEST_CHANNEL}/p1700000000000001`,
      revision: 1,
      source: "slack",
      text: "Checkout is returning 500s",
      workspace_id: TEST_WORKSPACE,
    });
  });

  it("opens a real process session so the message is visible to the app", async () => {
    await request(event());
    const [session] = pmSessions();
    expect(session).toMatchObject({
      channel: TEST_CHANNEL,
      project_id: TEST_PROJECT,
      source: "human",
      status: "open",
      workspace_id: TEST_WORKSPACE,
    });
    expect(pmMessages()[0]).toMatchObject({ session_id: session?.id });
  });

  it("queues the observation for extraction and publishes it to the journal", async () => {
    await request(event());
    expect(processingRows()).toMatchObject([
      {
        channel: TEST_CHANNEL,
        checkpoint_id: `slack:${TEST_WORKSPACE}:Ev1`,
        extraction_window_revision: 1,
        observation_id: "Ev1",
        status: "pending",
        workspace_id: TEST_WORKSPACE,
      },
    ]);
    expect(journalRows()).toHaveLength(1);
    expect(journalRows()[0]).toMatchObject({
      channel: TEST_CHANNEL,
      kind: "message",
      operation_key: `slack-message:${TEST_WORKSPACE}:Ev1`,
      project_id: TEST_PROJECT,
      workspace_id: TEST_WORKSPACE,
    });
  });

  it("groups a thread into one session and a later burst into another", async () => {
    await request(event("EvRoot"));
    await request(
      event("EvReply", TEST_WORKSPACE, {
        text: "Calling this a P1",
        thread_ts: "1700000000.000001",
        ts: "1700000500.000001",
      })
    );
    // Far outside the one hour idle window, so this opens a new case.
    await request(
      event("EvLater", TEST_WORKSPACE, {
        text: "Unrelated work starts here",
        ts: "1700900000.000001",
      })
    );
    const sessions = pmSessions();
    expect(sessions).toHaveLength(2);
    const bySession = new Map(
      pmMessages().map((message) => [message.ts, message.session_id])
    );
    expect(bySession.get("1700000000.000001")).toBe(
      bySession.get("1700000500.000001")
    );
    expect(bySession.get("1700900000.000001")).not.toBe(
      bySession.get("1700000000.000001")
    );
  });

  it("closes the previous session when a new one opens", async () => {
    await request(event("EvFirst"));
    await request(
      event("EvLater", TEST_WORKSPACE, { ts: "1700900000.000001" })
    );
    const statuses = pmSessions().map((session) => session.status);
    expect(statuses).toContain("closed");
    expect(statuses).toContain("open");
  });

  it("stores the raw event but derives nothing for a channel that is not enabled", async () => {
    sqlite
      .prepare(
        "UPDATE slack_channel SET enabled = 0 WHERE workspace_id = ? AND channel_id = ?"
      )
      .run(TEST_WORKSPACE, TEST_CHANNEL);
    expect((await request(event())).status).toBe(200);
    expect(rawEvents()).toHaveLength(1);
    expect(pmMessages()).toHaveLength(0);
    expect(pmSessions()).toHaveLength(0);
    expect(processingRows()).toHaveLength(0);
  });

  it("derives nothing for a workspace that has not installed the app", async () => {
    expect((await request(event("EvForeign", "T0OTHERTEAM"))).status).toBe(200);
    expect(rawEvents()).toHaveLength(1);
    expect(pmMessages()).toHaveLength(0);
  });

  it("records an unconfigured channel so setup can offer it, without mining it", async () => {
    expect(
      (await request(event("EvNew", TEST_WORKSPACE, { channel: "C0NEWCHAN" })))
        .status
    ).toBe(200);
    expect(
      sqlite
        .prepare(
          "SELECT channel_id, enabled FROM slack_channel WHERE channel_id = ?"
        )
        .get("C0NEWCHAN")
    ).toMatchObject({ channel_id: "C0NEWCHAN", enabled: 0 });
    expect(pmMessages()).toHaveLength(0);
  });

  it("retains edits and deletions arriving before the original message", async () => {
    await request(
      event("Ev2", TEST_WORKSPACE, {
        event_ts: "1700000000.000002",
        message: {
          text: "Edited",
          ts: "1700000000.000001",
          user: "U0HUMAN",
        },
        subtype: "message_changed",
      })
    );
    await request(
      event("Ev3", TEST_WORKSPACE, {
        deleted_ts: "1700000000.000001",
        event_ts: "1700000000.000003",
        subtype: "message_deleted",
        text: undefined,
      })
    );
    await request(event());
    expect(rawEvents()).toHaveLength(3);
    expect(pmMessages()).toMatchObject([
      {
        availability: "deleted",
        deleted: 1,
        id: `${TEST_WORKSPACE}:${TEST_CHANNEL}:1700000000.000001`,
        revision: 3,
        text: "Edited",
      },
    ]);
    expect(processingRows()).toHaveLength(3);
    expect(journalRows()).toHaveLength(3);
  });

  it("re-queues a revised message for extraction", async () => {
    await request(event());
    sqlite
      .prepare(
        "UPDATE pm_processing SET status = 'done' WHERE observation_id = ?"
      )
      .run("Ev1");
    await request(
      event("Ev2", TEST_WORKSPACE, {
        event_ts: "1700000000.000002",
        message: {
          text: "Actually it is only EU traffic",
          ts: "1700000000.000001",
          user: "U0HUMAN",
        },
        subtype: "message_changed",
      })
    );
    const pending = processingRows().filter((row) => row.status === "pending");
    expect(pending.length).toBeGreaterThan(0);
  });

  it("marks Ariadne's own posts as agent output so they are not mined", async () => {
    await request(
      event("EvAgent", TEST_WORKSPACE, {
        bot_id: "B0BOT",
        metadata: { event_type: "ariadne_agent" },
        user: undefined,
        username: "Ariadne",
      })
    );
    expect(pmMessages()).toMatchObject([
      { author_person_id: null, is_agent: 1 },
    ]);
  });

  it("reuses an already resolved person without calling Slack again", async () => {
    seedPerson(sqlite, { name: "Ada Lovelace", slackUserId: "U0HUMAN" });
    await request(event());
    expect(
      slackFetch.mock.calls.filter(([input]) =>
        String(input).endsWith("/users.info")
      )
    ).toHaveLength(0);
    expect(pmMessages()[0]).toMatchObject({
      author_person_id: "per_u0human",
    });
  });

  it("stops observing a workspace that uninstalls the app", async () => {
    const response = await request({
      event: { type: "app_uninstalled" },
      event_id: "EvUninstall",
      team_id: TEST_WORKSPACE,
      type: "event_callback",
    });
    expect(response.status).toBe(200);
    expect(
      sqlite
        .prepare("SELECT revoked_at FROM slack_install WHERE workspace_id = ?")
        .get(TEST_WORKSPACE)
    ).not.toMatchObject({ revoked_at: null });
    await request(event());
    expect(pmMessages()).toHaveLength(0);
  });

  it("keeps the channel list current when a channel is renamed", async () => {
    await request({
      event: {
        channel: { id: TEST_CHANNEL, name: "incidents" },
        type: "channel_rename",
      },
      event_id: "EvRename",
      team_id: TEST_WORKSPACE,
      type: "event_callback",
    });
    expect(
      sqlite
        .prepare("SELECT channel_name FROM slack_channel WHERE channel_id = ?")
        .get(TEST_CHANNEL)
    ).toMatchObject({ channel_name: "incidents" });
  });

  it.each([-301, 301])(
    "rejects timestamps outside the replay window (%s seconds)",
    async (offset) => {
      expect(
        (
          await request(event(), {
            timestamp: Math.floor(Date.now() / 1000) + offset,
          })
        ).status
      ).toBe(401);
      expect(rawEvents()).toHaveLength(0);
    }
  );

  it("rejects invalid signatures including challenges", async () => {
    expect((await request(event(), { signingSecret: "wrong" })).status).toBe(
      401
    );
    expect(
      (
        await request(
          { challenge: "x", type: "url_verification" },
          { signature: "v0=bad" }
        )
      ).status
    ).toBe(401);
    expect(rawEvents()).toHaveLength(0);
  });

  it("fails closed without the signing secret", async () => {
    expect(
      (
        await request(event(), {
          bindings: { ...env, SLACK_SIGNING_SECRET: undefined },
        })
      ).status
    ).toBe(503);
    expect(rawEvents()).toHaveLength(0);
  });

  it("rejects invalid JSON and missing message identity", async () => {
    expect((await request(null, { raw: "{" })).status).toBe(400);
    expect(
      (await request(event("Ev1", TEST_WORKSPACE, { ts: undefined }))).status
    ).toBe(400);
  });

  it("accepts messages larger than the browser API's body limit", async () => {
    expect(
      (
        await request(
          event("Ev1", TEST_WORKSPACE, { text: "x".repeat(70_000) })
        )
      ).status
    ).toBe(200);
    expect(rawEvents()).toHaveLength(1);
  });

  it("rejects events above the webhook body limit", async () => {
    expect(
      (
        await request(
          event("Ev1", TEST_WORKSPACE, { text: "x".repeat(1024 * 1024) })
        )
      ).status
    ).toBe(413);
    expect(rawEvents()).toHaveLength(0);
  });

  it("returns a retryable failure when persistence fails", async () => {
    failWrites = true;
    expect((await request(event())).status).toBe(500);
    expect(rawEvents()).toHaveLength(0);
    expect(pmMessages()).toHaveLength(0);
  });

  it("acknowledges unrelated events without storing them", async () => {
    expect(
      (await request({ ...event(), event: { type: "app_home_opened" } })).status
    ).toBe(200);
    expect(rawEvents()).toHaveLength(0);
  });
});
