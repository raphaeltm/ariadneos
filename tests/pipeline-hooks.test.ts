import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backfillChannel } from "../server/pipeline/backfill.ts";
import { pipelineHooks } from "../server/pipeline/hooks.ts";
import type {
  ChannelHookContext,
  JournalWrite,
} from "../server/runtime/channel.ts";
import { SlackClient } from "../server/slack/client.ts";
import type { ObservedChannel } from "../server/tenant/installs.ts";
import {
  createTestDatabase,
  seedTenant,
  TEST_CHANNEL,
  TEST_PROJECT,
  TEST_WORKSPACE,
} from "./helpers/tenant.ts";

const MISSING_SCOPE = /missing_scope/;

let sqlite: DatabaseSync;
let db: D1Database;
let committed: JournalWrite[];

const SCOPE = { channel: TEST_CHANNEL, workspaceId: TEST_WORKSPACE };

function observedChannel(
  overrides: Partial<ObservedChannel> = {}
): ObservedChannel {
  return {
    backfilled_at: null,
    channel_id: TEST_CHANNEL,
    channel_name: "ops",
    enabled: true,
    last_error: null,
    project_id: TEST_PROJECT,
    session_idle_seconds: 3600,
    workspace_id: TEST_WORKSPACE,
    ...overrides,
  };
}

function hookContext(now = Date.parse("2026-09-14T12:00:00.000Z")) {
  const checkpoints: Record<string, string> = {};
  const context: ChannelHookContext = {
    checkpoint: (name, value) => {
      checkpoints[name] = value;
    },
    commit: (entry) => {
      committed.push(entry);
      return Promise.resolve(null);
    },
    now,
    scope: SCOPE,
  };
  return { checkpoints, context };
}

function envFor(overrides: Record<string, unknown> = {}) {
  return {
    DB: db,
    ...overrides,
  } as Parameters<typeof pipelineHooks>[0];
}

const sessions = () =>
  sqlite.prepare("SELECT * FROM pm_session ORDER BY id").all();
const messages = () =>
  sqlite.prepare("SELECT * FROM pm_message ORDER BY ts").all();
const processing = () =>
  sqlite.prepare("SELECT * FROM pm_processing ORDER BY checkpoint_id").all();
const channelRow = () =>
  sqlite
    .prepare(
      "SELECT * FROM slack_channel WHERE workspace_id = ? AND channel_id = ?"
    )
    .get(TEST_WORKSPACE, TEST_CHANNEL);

beforeEach(() => {
  const { d1, sqlite: database } = createTestDatabase();
  sqlite = database;
  db = d1 as unknown as D1Database;
  seedTenant(sqlite);
  committed = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  sqlite.close();
});

describe("extraction deadline hook", () => {
  it("stops scheduling itself for a channel that is no longer observed", async () => {
    sqlite
      .prepare(
        "UPDATE slack_channel SET enabled = 0 WHERE workspace_id = ? AND channel_id = ?"
      )
      .run(TEST_WORKSPACE, TEST_CHANNEL);
    const { context } = hookContext();
    const result = await pipelineHooks(envFor()).extraction?.(context);
    // A null reschedule removes the deadline, so a disabled channel stops
    // consuming alarms.
    expect(result?.rescheduleAt).toBeNull();
  });

  it("reschedules tightly while a queue remains and slowly when idle", async () => {
    const { context } = hookContext();
    const hooks = pipelineHooks(envFor());

    const idle = await hooks.extraction?.(context);
    const idleDelay = Number(idle?.rescheduleAt) - context.now;

    sqlite
      .prepare(
        `INSERT INTO pm_processing
         (checkpoint_id, workspace_id, channel, observation_id, status, retries,
          extraction_window_revision, error, updated_at)
         VALUES ('slack:T:Ev1', ?, ?, 'Ev1', 'pending', 0, 1, NULL,
                 '2026-09-14T00:00:00.000Z')`
      )
      .run(TEST_WORKSPACE, TEST_CHANNEL);
    const busy = await hooks.extraction?.(context);
    const busyDelay = Number(busy?.rescheduleAt) - context.now;

    // A burst of Slack traffic must be caught up quickly rather than one batch
    // per idle interval.
    expect(busyDelay).toBeLessThan(idleDelay);
    expect(busy?.checkpoint?.extraction_pending).toBe("1");
  });
});

describe("beat deadline hook", () => {
  it("keeps beating for a channel that is not observed, without doing work", async () => {
    sqlite
      .prepare(
        "UPDATE slack_channel SET enabled = 0 WHERE workspace_id = ? AND channel_id = ?"
      )
      .run(TEST_WORKSPACE, TEST_CHANNEL);
    const { context } = hookContext();
    const result = await pipelineHooks(envFor()).beat?.(context);
    expect(result?.rescheduleAt).toBeGreaterThan(context.now);
    expect(committed).toEqual([]);
  });

  it("closes a case whose channel has gone quiet and publishes it", async () => {
    sqlite
      .prepare(
        `INSERT INTO pm_session
         (id, workspace_id, channel, project_id, workflow_id, status, source,
          started_ts, suggested, missing_json, extra_json, violations_json)
         VALUES ('ses_quiet', ?, ?, ?, NULL, 'open', 'human',
                 '2026-09-14T00:00:00.000Z', 0, '[]', '[]', '[]')`
      )
      .run(TEST_WORKSPACE, TEST_CHANNEL, TEST_PROJECT);
    sqlite
      .prepare(
        `INSERT INTO pm_message
         (workspace_id, channel, ts, id, session_id, author_person_id,
          author_label, text, permalink, thread_ts, revision, deleted,
          availability, is_agent, received_at, source)
         VALUES (?, ?, '1700000001.000100', 'm1', 'ses_quiet', NULL, 'Ada',
                 'hello', 'https://example.invalid', NULL, 1, 0, 'available', 0,
                 '2026-09-14T00:00:00.000Z', 'slack')`
      )
      .run(TEST_WORKSPACE, TEST_CHANNEL);

    // Two hours later, well past the one hour idle window.
    const { context } = hookContext(Date.parse("2026-09-14T02:00:00.000Z"));
    await pipelineHooks(envFor()).beat?.(context);

    expect(sessions()[0]).toMatchObject({ status: "closed" });
    expect(committed.map((entry) => entry.kind)).toContain("session_closed");
  });

  it("leaves an active case open", async () => {
    sqlite
      .prepare(
        `INSERT INTO pm_session
         (id, workspace_id, channel, project_id, workflow_id, status, source,
          started_ts, suggested, missing_json, extra_json, violations_json)
         VALUES ('ses_live', ?, ?, ?, NULL, 'open', 'human',
                 '2026-09-14T11:59:00.000Z', 0, '[]', '[]', '[]')`
      )
      .run(TEST_WORKSPACE, TEST_CHANNEL, TEST_PROJECT);
    sqlite
      .prepare(
        `INSERT INTO pm_message
         (workspace_id, channel, ts, id, session_id, author_person_id,
          author_label, text, permalink, thread_ts, revision, deleted,
          availability, is_agent, received_at, source)
         VALUES (?, ?, '1700000001.000100', 'm1', 'ses_live', NULL, 'Ada',
                 'still working', 'https://example.invalid', NULL, 1, 0,
                 'available', 0, '2026-09-14T11:59:00.000Z', 'slack')`
      )
      .run(TEST_WORKSPACE, TEST_CHANNEL);
    const { context } = hookContext();
    await pipelineHooks(envFor()).beat?.(context);
    expect(sessions()[0]).toMatchObject({ status: "open" });
  });
});

describe("recovery deadline hook", () => {
  it("requeues transiently failed checkpoints and reports the backlog", async () => {
    sqlite
      .prepare(
        `INSERT INTO pm_processing
         (checkpoint_id, workspace_id, channel, observation_id, status, retries,
          extraction_window_revision, error, updated_at)
         VALUES ('slack:T:Ev1', ?, ?, 'Ev1', 'error', 1, 1, 'boom',
                 '2026-09-14T00:00:00.000Z'),
                ('slack:T:Ev2', ?, ?, 'Ev2', 'error', 3, 1, 'boom',
                 '2026-09-14T00:00:00.000Z')`
      )
      .run(TEST_WORKSPACE, TEST_CHANNEL, TEST_WORKSPACE, TEST_CHANNEL);
    const { context } = hookContext();
    const result = await pipelineHooks(envFor()).recovery?.(context);
    const rows = processing();
    // The one with retries left is requeued; the exhausted one is not, so a
    // permanently broken observation cannot loop forever.
    expect(rows.find((row) => row.observation_id === "Ev1")).toMatchObject({
      status: "pending",
    });
    expect(rows.find((row) => row.observation_id === "Ev2")).toMatchObject({
      status: "error",
    });
    expect(result?.checkpoint?.pending_processing).toBe("1");
  });
});

describe("channel history backfill", () => {
  function slackClient(handler: (method: string) => Record<string, unknown>) {
    return new SlackClient("xoxb-test", {
      fetcher: (input) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ ok: true, ...handler(String(input)) }),
            { headers: { "Content-Type": "application/json" }, status: 200 }
          )
        ),
    });
  }

  it("ingests history oldest first so segmentation sees real order", async () => {
    const client = slackClient((method) => {
      if (method.endsWith("/conversations.history")) {
        // Slack returns newest first.
        return {
          messages: [
            {
              text: "Deployed the fix",
              ts: "1700000003.000100",
              user: "U0OPS",
            },
            { text: "Looking into it", ts: "1700000002.000100", user: "U0OPS" },
            {
              text: "Checkout is down",
              ts: "1700000001.000100",
              user: "U0OPS",
            },
          ],
        };
      }
      if (method.endsWith("/users.info")) {
        return { user: { id: "U0OPS", real_name: "Ada" } };
      }
      return {};
    });
    const outcome = await backfillChannel(db, observedChannel(), client, {
      teamDomain: "testworkspace",
    });
    expect(outcome.ingested).toBe(3);
    expect(messages().map((row) => row.ts)).toEqual([
      "1700000001.000100",
      "1700000002.000100",
      "1700000003.000100",
    ]);
    // All three arrived inside the idle window, so they are one case.
    expect(sessions()).toHaveLength(1);
    expect(processing()).toHaveLength(3);
  });

  it("skips channel notices and empty messages", async () => {
    const client = slackClient((method) =>
      method.endsWith("/conversations.history")
        ? {
            messages: [
              {
                subtype: "channel_join",
                text: "Ada joined",
                ts: "1700000001.000100",
                user: "U0OPS",
              },
              { text: "   ", ts: "1700000002.000100", user: "U0OPS" },
              {
                text: "Real work happened",
                ts: "1700000003.000100",
                user: "U0OPS",
              },
            ],
          }
        : { user: { id: "U0OPS", real_name: "Ada" } }
    );
    await backfillChannel(db, observedChannel(), client, {});
    expect(messages().map((row) => row.text)).toEqual(["Real work happened"]);
  });

  it("is idempotent, so replaying a backfill cannot duplicate evidence", async () => {
    const client = slackClient((method) =>
      method.endsWith("/conversations.history")
        ? {
            messages: [
              {
                text: "Checkout is down",
                ts: "1700000001.000100",
                user: "U0OPS",
              },
            ],
          }
        : { user: { id: "U0OPS", real_name: "Ada" } }
    );
    await backfillChannel(db, observedChannel(), client, {});
    await backfillChannel(db, observedChannel(), client, {});
    expect(messages()).toHaveLength(1);
    expect(processing()).toHaveLength(1);
  });

  it("records the backfill time and clears any previous error", async () => {
    sqlite
      .prepare(
        "UPDATE slack_channel SET last_error = 'earlier failure' WHERE workspace_id = ? AND channel_id = ?"
      )
      .run(TEST_WORKSPACE, TEST_CHANNEL);
    const client = slackClient((method) =>
      method.endsWith("/conversations.history") ? { messages: [] } : {}
    );
    await backfillChannel(db, observedChannel(), client, {});
    expect(channelRow()).toMatchObject({ last_error: null });
    expect(channelRow()?.backfilled_at).not.toBeNull();
  });

  it("records the failure and rethrows when Slack refuses the read", async () => {
    const client = new SlackClient("xoxb-test", {
      fetcher: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "missing_scope", ok: false }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          })
        ),
    });
    await expect(
      backfillChannel(db, observedChannel(), client, {})
    ).rejects.toThrow(MISSING_SCOPE);
    // The channel surfaces why, so setup can tell the user to reinstall.
    expect(String(channelRow()?.last_error)).toContain("missing_scope");
  });

  it("derives nothing for a channel that is not enabled", async () => {
    const client = slackClient((method) =>
      method.endsWith("/conversations.history")
        ? {
            messages: [
              {
                text: "Checkout is down",
                ts: "1700000001.000100",
                user: "U0OPS",
              },
            ],
          }
        : { user: { id: "U0OPS", real_name: "Ada" } }
    );
    const outcome = await backfillChannel(
      db,
      observedChannel({ enabled: false, project_id: null }),
      client,
      {}
    );
    expect(outcome.skipped).toBe(1);
    expect(messages()).toHaveLength(0);
  });
});
