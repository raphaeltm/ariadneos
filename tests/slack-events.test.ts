import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../server/index";

const secret = "test-only-slack-signing-secret";
let db: DatabaseSync;
let run: ReturnType<typeof vi.fn<(sql: string, values: unknown[]) => unknown>>;
let env: Record<string, unknown>;
const event = (
  id = "Ev1",
  team = "T1",
  message: Record<string, unknown> = {},
) => ({
  type: "event_callback",
  team_id: team,
  event_id: id,
  event: {
    type: "message",
    channel: "C1",
    channel_type: "channel",
    ts: "1700000000.000001",
    text: "Hello",
    user: "U1",
    ...message,
  },
});
function request(
  payload: unknown,
  options: {
    timestamp?: number;
    signingSecret?: string;
    raw?: string;
    signature?: string;
    bindings?: Record<string, unknown>;
  } = {},
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
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Slack-Request-Timestamp": timestamp,
        "X-Slack-Signature": signature,
      },
      body: raw,
    }),
    (options.bindings ?? env) as never,
  );
}
const rows = () =>
  db
    .prepare(
      "SELECT * FROM slack_message_events ORDER BY received_at, event_id",
    )
    .all();
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/0004_slack_message_events.sql", "utf8"));
  run = vi.fn((sql: string, values: unknown[]) =>
    db.prepare(sql).run(...(values as (string | number | null)[])),
  );
  env = {
    SLACK_SIGNING_SECRET: secret,
    DB: {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({ run: async () => run(sql, values) }),
      }),
    },
  };
});
afterEach(() => db.close());
describe("Slack Events HTTP receiver and storage", () => {
  it("verifies the challenge without requiring browser Origin or login", async () => {
    const response = await request({
      type: "url_verification",
      challenge: "challenge-value",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "challenge-value" });
    expect(rows()).toHaveLength(0);
  });
  it("persists a message before acknowledging and deduplicates retries", async () => {
    expect((await request(event())).status).toBe(200);
    expect((await request(event())).status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      team_id: "T1",
      event_id: "Ev1",
      channel_id: "C1",
      message_ts: "1700000000.000001",
      text: "Hello",
      user_id: "U1",
    });
  });
  it("keeps workspace identities separate", async () => {
    await request(event());
    await request(event("Ev1", "T2"));
    expect(rows()).toHaveLength(2);
  });
  it("retains edits and deletions arriving before the original message", async () => {
    await request(
      event("Ev2", "T1", {
        subtype: "message_changed",
        message: { ts: "1700000000.000001", text: "Edited", user: "U1" },
      }),
    );
    await request(
      event("Ev3", "T1", {
        subtype: "message_deleted",
        deleted_ts: "1700000000.000001",
        text: undefined,
      }),
    );
    await request(event());
    expect(rows()).toHaveLength(3);
    expect(rows().find((r) => r.event_id === "Ev2")).toMatchObject({
      text: "Edited",
      message_ts: "1700000000.000001",
    });
    expect(rows().find((r) => r.event_id === "Ev3")).toMatchObject({
      subtype: "message_deleted",
      text: null,
    });
  });
  it.each([-301, 301])(
    "rejects timestamps outside the replay window (%s seconds)",
    async (offset) => {
      expect(
        (
          await request(event(), {
            timestamp: Math.floor(Date.now() / 1000) + offset,
          })
        ).status,
      ).toBe(401);
      expect(rows()).toHaveLength(0);
    },
  );
  it("rejects invalid signatures including challenges", async () => {
    expect((await request(event(), { signingSecret: "wrong" })).status).toBe(
      401,
    );
    expect(
      (
        await request(
          { type: "url_verification", challenge: "x" },
          { signature: "v0=bad" },
        )
      ).status,
    ).toBe(401);
    expect(rows()).toHaveLength(0);
  });
  it("fails closed without the signing secret", async () => {
    expect(
      (
        await request(event(), {
          bindings: { ...env, SLACK_SIGNING_SECRET: undefined },
        })
      ).status,
    ).toBe(503);
    expect(rows()).toHaveLength(0);
  });
  it("rejects invalid JSON and missing message identity", async () => {
    expect((await request(null, { raw: "{" })).status).toBe(400);
    expect((await request(event("Ev1", "T1", { ts: undefined }))).status).toBe(
      400,
    );
  });
  it("accepts messages larger than the browser API's 4KB limit", async () => {
    expect(
      (await request(event("Ev1", "T1", { text: "x".repeat(5000) }))).status,
    ).toBe(200);
    expect(rows()).toHaveLength(1);
  });
  it("rejects events above the webhook body limit", async () => {
    expect(
      (await request(event("Ev1", "T1", { text: "x".repeat(1024 * 1024) })))
        .status,
    ).toBe(413);
    expect(rows()).toHaveLength(0);
  });
  it("returns a retryable failure when persistence fails", async () => {
    run.mockImplementation(() => {
      throw new Error("Database unavailable");
    });
    expect((await request(event())).status).toBe(500);
    expect(rows()).toHaveLength(0);
  });
  it("acknowledges unrelated events without storing them", async () => {
    expect(
      (await request({ ...event(), event: { type: "app_home_opened" } }))
        .status,
    ).toBe(200);
    expect(rows()).toHaveLength(0);
  });
});
