import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerMentions } from "../server/pipeline/answer.ts";
import { runOutbox } from "../server/pipeline/outbox.ts";
import { SlackClient } from "../server/slack/client.ts";
import type { ObservedChannel } from "../server/tenant/installs.ts";
import {
  createTestDatabase,
  observedScopedData,
  seedTenant,
  TEST_CHANNEL,
  TEST_PROJECT,
  TEST_WORKSPACE,
} from "./helpers/tenant.ts";

const BOT_USER = "U0BOT";

let sqlite: DatabaseSync;
let db: D1Database;
let channel: ObservedChannel;

function envFor(overrides: Record<string, unknown> = {}) {
  return {
    AGENT_ENABLED: "true",
    DB: db,
    ...overrides,
  } as Parameters<typeof answerMentions>[0];
}

/** Inserts an observed session with its messages and steps. */
function seedObservations(
  steps: Parameters<typeof observedScopedData>[0],
  options: { mention?: { text: string; thread_ts?: string; ts: string } } = {}
) {
  const data = observedScopedData(steps);
  for (const session of data.sessions) {
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO pm_session
         (id, workspace_id, channel, project_id, workflow_id, status, source,
          scenario_id, variant, started_ts, ended_ts, suggested, fitness,
          missing_json, extra_json, violations_json)
         VALUES (?, ?, ?, ?, ?, 'closed', 'human', NULL, NULL, ?, NULL, 0, NULL,
                 '[]', '[]', '[]')`
      )
      .run(
        session.id,
        TEST_WORKSPACE,
        TEST_CHANNEL,
        TEST_PROJECT,
        session.workflow_id,
        session.started_ts
      );
  }
  const insertMessage = (message: {
    is_agent: number;
    session_id: string;
    text: string;
    thread_ts: string | null;
    ts: string;
  }) =>
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO pm_message
         (workspace_id, channel, ts, id, session_id, author_person_id,
          author_label, text, permalink, thread_ts, revision, deleted,
          availability, is_agent, received_at, source)
         VALUES (?, ?, ?, ?, ?, NULL, 'Ada', ?, ?, ?, 1, 0, 'available', ?, ?, 'slack')`
      )
      .run(
        TEST_WORKSPACE,
        TEST_CHANNEL,
        message.ts,
        `${TEST_WORKSPACE}:${TEST_CHANNEL}:${message.ts}`,
        message.session_id,
        message.text,
        `https://testworkspace.slack.com/archives/${TEST_CHANNEL}/p${message.ts.replace(".", "")}`,
        message.thread_ts,
        message.is_agent,
        new Date(Number.parseFloat(message.ts) * 1000).toISOString()
      );

  for (const message of data.messages) {
    insertMessage({
      is_agent: 0,
      session_id: message.session_id,
      text: message.text,
      thread_ts: null,
      ts: message.ts,
    });
  }
  for (const step of data.steps) {
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO pm_step
         (id, session_id, seq, activity_id, actor_person_id, artifact_id, intent,
          type, handoff_to_person_id, modality, lifecycle_state, curation_status,
          negated, confidence, ts_start, ts_end, effort_days)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, 'reported', 'done',
                 'confirmed', 0, 0.9, ?, NULL, NULL)`
      )
      .run(
        step.id,
        step.session_id,
        step.seq,
        step.activity_id,
        step.actor_person_id,
        step.intent,
        step.type,
        step.ts_start
      );
    for (const evidence of step.evidence) {
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO pm_step_evidence
           (step_id, workspace_id, channel, message_ts, message_revision,
            span_start, span_end)
           VALUES (?, ?, ?, ?, 1, NULL, NULL)`
        )
        .run(step.id, TEST_WORKSPACE, TEST_CHANNEL, evidence.ts);
    }
  }
  if (options.mention) {
    const [session] = data.sessions;
    insertMessage({
      is_agent: 0,
      session_id: session?.id ?? "ses_alpha",
      text: options.mention.text,
      thread_ts: options.mention.thread_ts ?? null,
      ts: options.mention.ts,
    });
  }
}

const OBSERVED_STEPS = [
  {
    activitySlug: "detect_incident",
    actor: "U0OPS",
    seq: 1,
    sessionId: "ses_alpha",
    ts: "1700000001.000100",
  },
  {
    activitySlug: "triage_incident",
    actor: "U0OPS",
    seq: 2,
    sessionId: "ses_alpha",
    ts: "1700000002.000100",
  },
  {
    activitySlug: "escalate_to_ceo",
    actor: "U0OPS",
    seq: 3,
    sessionId: "ses_alpha",
    ts: "1700000003.000100",
  },
];

const outboxRows = () =>
  sqlite.prepare("SELECT * FROM pm_outbox ORDER BY operation_id").all();
const agentEvents = () =>
  sqlite.prepare("SELECT * FROM agent_event ORDER BY id").all();

beforeEach(() => {
  const created = createTestDatabase();
  sqlite = created.sqlite;
  db = created.d1 as unknown as D1Database;
  seedTenant(sqlite);
  channel = {
    backfilled_at: null,
    channel_id: TEST_CHANNEL,
    channel_name: "ops",
    enabled: true,
    last_error: null,
    project_id: TEST_PROJECT,
    session_idle_seconds: 3600,
    workspace_id: TEST_WORKSPACE,
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  sqlite.close();
});

describe("answering Slack mentions", () => {
  it("queues a grounded answer in the thread the question was asked in", async () => {
    seedObservations(OBSERVED_STEPS, {
      mention: {
        text: `<@${BOT_USER}> what has happened here?`,
        thread_ts: "1700000001.000100",
        ts: "1700000010.000100",
      },
    });
    const outcome = await answerMentions(envFor(), channel, BOT_USER);
    expect(outcome.answered).toBe(1);
    const [queued] = outboxRows();
    expect(queued).toMatchObject({
      channel: TEST_CHANNEL,
      kind: "agent_post",
      status: "pending",
      workspace_id: TEST_WORKSPACE,
    });
    const payload = JSON.parse(String(queued?.payload_json));
    // The reply threads under the question rather than posting to the channel.
    expect(payload.thread_ts).toBe("1700000001.000100");
    // Without a model key the answer is the deterministic summary, and it says so.
    expect(payload.text).toContain("Detect incident");
    expect(payload.text).toContain("not a model-generated answer");
  });

  it("records the answer as an agent event before queueing it", async () => {
    seedObservations(OBSERVED_STEPS, {
      mention: { text: `<@${BOT_USER}> status?`, ts: "1700000010.000100" },
    });
    await answerMentions(envFor(), channel, BOT_USER);
    const [event] = agentEvents();
    expect(event).toMatchObject({
      channel: TEST_CHANNEL,
      kind: "slack_post",
      project_id: TEST_PROJECT,
      workspace_id: TEST_WORKSPACE,
    });
    expect(event?.id).toBe(outboxRows()[0]?.operation_id);
  });

  it("answers each mention once, even across repeated runs", async () => {
    seedObservations(OBSERVED_STEPS, {
      mention: { text: `<@${BOT_USER}> status?`, ts: "1700000010.000100" },
    });
    expect((await answerMentions(envFor(), channel, BOT_USER)).answered).toBe(
      1
    );
    expect((await answerMentions(envFor(), channel, BOT_USER)).answered).toBe(
      0
    );
    expect(outboxRows()).toHaveLength(1);
  });

  it("ignores messages that do not mention the bot", async () => {
    seedObservations(OBSERVED_STEPS, {
      mention: { text: "just chatting, no mention", ts: "1700000010.000100" },
    });
    expect((await answerMentions(envFor(), channel, BOT_USER)).answered).toBe(
      0
    );
    expect(outboxRows()).toHaveLength(0);
  });

  it("does nothing when the agent is disabled", async () => {
    seedObservations(OBSERVED_STEPS, {
      mention: { text: `<@${BOT_USER}> status?`, ts: "1700000010.000100" },
    });
    const outcome = await answerMentions(
      envFor({ AGENT_ENABLED: "false" }),
      channel,
      BOT_USER
    );
    expect(outcome.answered).toBe(0);
    expect(outcome.warnings).toContain("answer.agent_disabled");
    expect(outboxRows()).toHaveLength(0);
  });

  it("says it has nothing yet rather than inventing a process", async () => {
    // A mention with no extracted steps behind it.
    seedObservations([], {
      mention: {
        text: `<@${BOT_USER}> what is our process?`,
        ts: "1700000010.000100",
      },
    });
    sqlite
      .prepare(
        `INSERT INTO pm_session
         (id, workspace_id, channel, project_id, workflow_id, status, source,
          started_ts, suggested, missing_json, extra_json, violations_json)
         VALUES ('ses_empty', ?, ?, ?, NULL, 'open', 'human',
                 '2026-09-14T00:00:00.000Z', 0, '[]', '[]', '[]')`
      )
      .run(TEST_WORKSPACE, TEST_CHANNEL, TEST_PROJECT);
    sqlite
      .prepare(
        `INSERT INTO pm_message
         (workspace_id, channel, ts, id, session_id, author_person_id,
          author_label, text, permalink, thread_ts, revision, deleted,
          availability, is_agent, received_at, source)
         VALUES (?, ?, '1700000011.000100', 'm1', 'ses_empty', NULL, 'Ada', ?,
                 'https://example.invalid', NULL, 1, 0, 'available', 0,
                 '2026-09-14T00:00:00.000Z', 'slack')`
      )
      .run(TEST_WORKSPACE, TEST_CHANNEL, `<@${BOT_USER}> what is our process?`);
    await answerMentions(envFor(), channel, BOT_USER);
    const texts = outboxRows().map(
      (row) => JSON.parse(String(row.payload_json)).text
    );
    expect(texts.join(" ")).toContain("not extracted any work");
  });

  it("delivers the queued answer to Slack and records the posted timestamp", async () => {
    seedObservations(OBSERVED_STEPS, {
      mention: { text: `<@${BOT_USER}> status?`, ts: "1700000010.000100" },
    });
    await answerMentions(envFor(), channel, BOT_USER);
    const posted: Array<Record<string, string>> = [];
    const client = new SlackClient("xoxb-test", {
      fetcher: async (_input, init) => {
        posted.push(
          Object.fromEntries(new URLSearchParams(String(init?.body)))
        );
        return new Response(
          JSON.stringify({ channel: TEST_CHANNEL, ok: true, ts: "1700.1" }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        );
      },
    });
    const delivery = await runOutbox(
      { DB: db },
      { channel: TEST_CHANNEL, workspaceId: TEST_WORKSPACE },
      { client }
    );
    expect(delivery.delivered).toBe(1);
    expect(posted[0]).toMatchObject({
      channel: TEST_CHANNEL,
      // Ariadne posts plain text: Slack must not render user-derived markup.
      mrkdwn: "false",
      thread_ts: "1700000010.000100",
    });
    expect(outboxRows()[0]).toMatchObject({
      slack_ts: "1700.1",
      status: "sent",
    });
  });

  it("keeps a failed delivery pending for retry", async () => {
    seedObservations(OBSERVED_STEPS, {
      mention: { text: `<@${BOT_USER}> status?`, ts: "1700000010.000100" },
    });
    await answerMentions(envFor(), channel, BOT_USER);
    const client = new SlackClient("xoxb-test", {
      fetcher: async () =>
        new Response(JSON.stringify({ error: "ratelimited", ok: false }), {
          headers: { "Content-Type": "application/json", "retry-after": "1" },
          status: 429,
        }),
      maxAttempts: 1,
      sleep: async () => undefined,
    });
    const delivery = await runOutbox(
      { DB: db },
      { channel: TEST_CHANNEL, workspaceId: TEST_WORKSPACE },
      { client }
    );
    expect(delivery.retried).toBe(1);
    expect(outboxRows()[0]).toMatchObject({ attempts: 1, status: "pending" });
  });

  it("gives up on a permanent Slack rejection instead of retrying forever", async () => {
    seedObservations(OBSERVED_STEPS, {
      mention: { text: `<@${BOT_USER}> status?`, ts: "1700000010.000100" },
    });
    await answerMentions(envFor(), channel, BOT_USER);
    const client = new SlackClient("xoxb-test", {
      fetcher: async () =>
        new Response(
          JSON.stringify({ error: "channel_not_found", ok: false }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        ),
    });
    const delivery = await runOutbox(
      { DB: db },
      { channel: TEST_CHANNEL, workspaceId: TEST_WORKSPACE },
      { client }
    );
    expect(delivery.failed).toBe(1);
    expect(outboxRows()[0]).toMatchObject({ status: "failed" });
  });
});
