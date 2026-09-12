import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../server/index.ts";

const secret = "test-only-slack-signing-secret";
let db: DatabaseSync;
let failWrites = false;
let env: Record<string, unknown>;
const event = (
  id = "Ev1",
  team = "T1",
  message: Record<string, unknown> = {}
) => ({
  event: {
    channel: "C1",
    channel_type: "channel",
    event_ts: "1700000000.000001",
    text: "Hello",
    ts: "1700000000.000001",
    type: "message",
    user: "U1",
    ...message,
  },
  event_id: id,
  team_id: team,
  type: "event_callback",
});
function request(
  payload: unknown,
  options: {
    timestamp?: number;
    signingSecret?: string;
    raw?: string;
    signature?: string;
    bindings?: Record<string, unknown>;
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
    (options.bindings ?? env) as never
  );
}
const rows = () =>
  db
    .prepare(
      "SELECT * FROM slack_message_events ORDER BY received_at, event_id"
    )
    .all();
const pmMessages = () =>
  db
    .prepare("SELECT * FROM pm_message ORDER BY workspace_id, channel, ts")
    .all();
const processingRows = () =>
  db
    .prepare(
      "SELECT * FROM pm_processing ORDER BY workspace_id, channel, observation_id"
    )
    .all();
const journalRows = () =>
  db.prepare("SELECT * FROM pm_journal ORDER BY id, operation_key").all();
const createD1 = () => ({
  batch: async (statements: D1PreparedStatement[]) => {
    if (failWrites) {
      throw new Error("Database unavailable");
    }
    return await Promise.all(statements.map((statement) => statement.run()));
  },
  prepare: (sql: string) => ({
    bind: (...values: unknown[]) => {
      const sqliteValues = values as (string | number | null)[];
      return {
        all: async () => ({ results: db.prepare(sql).all(...sqliteValues) }),
        first: async () => db.prepare(sql).get(...sqliteValues),
        run: () => {
          if (failWrites) {
            throw new Error("Database unavailable");
          }
          return Promise.resolve(db.prepare(sql).run(...sqliteValues));
        },
      };
    },
  }),
});
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/0004_slack_message_events.sql", "utf8"));
  db.exec(readFileSync("migrations/0005_pm_foundation.sql", "utf8"));
  db.exec(
    readFileSync("migrations/0006_channel_coordinator_runtime.sql", "utf8")
  );
  failWrites = false;
  env = {
    DB: createD1(),
    SLACK_PROJECT_ID: "proj_helios",
    SLACK_SIGNING_SECRET: secret,
    SLACK_WORKSPACE: "ariadneos",
  };
});
afterEach(() => db.close());
describe("Slack Events HTTP receiver and storage", () => {
  it("verifies the challenge without requiring browser Origin or login", async () => {
    const response = await request({
      challenge: "challenge-value",
      type: "url_verification",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "challenge-value" });
    expect(rows()).toHaveLength(0);
  });
  it("persists a message before acknowledging and deduplicates retries", async () => {
    expect((await request(event())).status).toBe(200);
    expect((await request(event())).status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM pm_processing").get()
    ).toEqual({ count: 1 });
    expect(rows()[0]).toMatchObject({
      channel_id: "C1",
      event_id: "Ev1",
      message_ts: "1700000000.000001",
      team_id: "T1",
      text: "Hello",
      user_id: "U1",
    });
    expect(pmMessages()).toHaveLength(1);
    expect(pmMessages()[0]).toMatchObject({
      author_label: "U1",
      channel: "C1",
      id: "T1:C1:1700000000.000001",
      is_agent: 0,
      permalink: "https://ariadneos.slack.com/archives/C1/p1700000000000001",
      revision: 1,
      session_id: "ses_slack_T1_C1_1700000000_000001",
      text: "Hello",
      workspace_id: "T1",
    });
    expect(processingRows()).toMatchObject([
      {
        channel: "C1",
        checkpoint_id: "slack:T1:Ev1",
        extraction_window_revision: 1,
        observation_id: "Ev1",
        status: "pending",
        workspace_id: "T1",
      },
    ]);
    expect(journalRows()).toHaveLength(1);
    expect(journalRows()[0]).toMatchObject({
      channel: "C1",
      kind: "message",
      operation_key: "slack-message:T1:Ev1",
      project_id: "proj_helios",
      session_id: "ses_slack_T1_C1_1700000000_000001",
      workspace_id: "T1",
    });
  });
  it("keeps workspace identities separate", async () => {
    await request(event());
    await request(event("Ev1", "T2"));
    expect(rows()).toHaveLength(2);
    expect(pmMessages()).toMatchObject([
      { id: "T1:C1:1700000000.000001", workspace_id: "T1" },
      { id: "T2:C1:1700000000.000001", workspace_id: "T2" },
    ]);
  });
  it("retains edits and deletions arriving before the original message", async () => {
    await request(
      event("Ev2", "T1", {
        event_ts: "1700000000.000002",
        message: { text: "Edited", ts: "1700000000.000001", user: "U1" },
        subtype: "message_changed",
      })
    );
    await request(
      event("Ev3", "T1", {
        deleted_ts: "1700000000.000001",
        event_ts: "1700000000.000003",
        subtype: "message_deleted",
        text: undefined,
      })
    );
    await request(event());
    expect(rows()).toHaveLength(3);
    expect(rows().find((r) => r.event_id === "Ev2")).toMatchObject({
      message_ts: "1700000000.000001",
      text: "Edited",
    });
    expect(rows().find((r) => r.event_id === "Ev3")).toMatchObject({
      subtype: "message_deleted",
      text: null,
    });
    expect(pmMessages()).toMatchObject([
      {
        availability: "deleted",
        deleted: 1,
        id: "T1:C1:1700000000.000001",
        revision: 3,
        text: "Edited",
      },
    ]);
    expect(processingRows()).toHaveLength(3);
    expect(journalRows()).toHaveLength(3);
  });
  it("uses trusted Slack metadata for mining scope and persona provenance", async () => {
    await request(
      event("EvPersona", "T1", {
        bot_id: "B1",
        metadata: {
          event_payload: {
            person_id: "per_priya",
            session_id: "ses_helios_live",
          },
          event_type: "ariadne_sim",
        },
        thread_ts: "1700000000.000000",
        username: "Priya Raman",
      })
    );
    expect(pmMessages()).toMatchObject([
      {
        author_label: "per_priya",
        author_person_id: "per_priya",
        is_agent: 0,
        session_id: "ses_helios_live",
        thread_ts: "1700000000.000000",
      },
    ]);
    const payload = JSON.parse(journalRows()[0]?.payload_json as string);
    expect(payload).toMatchObject({
      author_person_id: "per_priya",
      id: "T1:C1:1700000000.000001",
      session_id: "ses_helios_live",
    });
  });
  it("falls back to thread root for human messages without trusted metadata", async () => {
    await request(
      event("EvThread", "T1", {
        text: "Human reply",
        thread_ts: "1700000000.000000",
      })
    );
    expect(pmMessages()).toMatchObject([
      {
        author_label: "U1",
        author_person_id: null,
        session_id: "ses_slack_T1_C1_1700000000_000000",
        text: "Human reply",
        thread_ts: "1700000000.000000",
      },
    ]);
  });
  it("marks observer bot output separately from mineable persona messages", async () => {
    await request(
      event("EvAgent", "T1", {
        bot_id: "B1",
        metadata: {
          event_payload: { session_id: "ses_helios_live" },
          event_type: "ariadne_agent",
        },
        username: "Ariadne",
      })
    );
    expect(pmMessages()).toMatchObject([
      {
        author_label: "Ariadne",
        author_person_id: null,
        is_agent: 1,
        session_id: "ses_helios_live",
      },
    ]);
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
      expect(rows()).toHaveLength(0);
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
    expect(rows()).toHaveLength(0);
  });
  it("fails closed without the signing secret", async () => {
    expect(
      (
        await request(event(), {
          bindings: { ...env, SLACK_SIGNING_SECRET: undefined },
        })
      ).status
    ).toBe(503);
    expect(rows()).toHaveLength(0);
  });
  it("rejects invalid JSON and missing message identity", async () => {
    expect((await request(null, { raw: "{" })).status).toBe(400);
    expect((await request(event("Ev1", "T1", { ts: undefined }))).status).toBe(
      400
    );
  });
  it("accepts messages larger than the browser API's 4KB limit", async () => {
    expect(
      (await request(event("Ev1", "T1", { text: "x".repeat(5000) }))).status
    ).toBe(200);
    expect(rows()).toHaveLength(1);
  });
  it("rejects events above the webhook body limit", async () => {
    expect(
      (await request(event("Ev1", "T1", { text: "x".repeat(1024 * 1024) })))
        .status
    ).toBe(413);
    expect(rows()).toHaveLength(0);
  });
  it("returns a retryable failure when persistence fails", async () => {
    failWrites = true;
    expect((await request(event())).status).toBe(500);
    expect(rows()).toHaveLength(0);
    expect(pmMessages()).toHaveLength(0);
  });
  it("acknowledges unrelated events without storing them", async () => {
    expect(
      (await request({ ...event(), event: { type: "app_home_opened" } })).status
    ).toBe(200);
    expect(rows()).toHaveLength(0);
  });
});
