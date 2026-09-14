import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractionContextFor,
  runExtraction,
} from "../server/pipeline/extraction.ts";
import { readTenantKb } from "../server/tenant/kb.ts";
import {
  createTestDatabase,
  seedPerson,
  seedTenant,
  TEST_CHANNEL,
  TEST_PROJECT,
  TEST_WORKFLOW,
  TEST_WORKSPACE,
} from "./helpers/tenant.ts";

const SCOPE = { channel: TEST_CHANNEL, workspaceId: TEST_WORKSPACE };

let sqlite: DatabaseSync;
let db: D1Database;
let modelCalls: unknown[];

/**
 * Stands in for OpenRouter. The extractor sends its prompt as the last message,
 * so the stub can answer based on the window it was actually given, which is what
 * makes "the model only sees the right messages" assertable.
 */
function stubModel(handler: (window: Record<string, unknown>[]) => unknown) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  handler(promptWindow(init?.body, input))
                ),
              },
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      )
    )
  );
}

function promptWindow(body: BodyInit | null | undefined, input: unknown) {
  modelCalls.push(String(input));
  try {
    const parsed = JSON.parse(String(body)) as {
      messages?: { content?: string }[];
    };
    const last = parsed.messages?.at(-1)?.content ?? "{}";
    const prompt = JSON.parse(last) as {
      messages?: Record<string, unknown>[];
    };
    return prompt.messages ?? [];
  } catch {
    return [];
  }
}

function envFor(overrides: Record<string, unknown> = {}) {
  return {
    DB: db,
    OPENROUTER_API_KEY: "test-key",
    ...overrides,
  } as Parameters<typeof runExtraction>[0];
}

/** Inserts an open session and its messages, plus the pending checkpoints. */
function observe(
  messages: {
    deleted?: boolean;
    eventId: string;
    isAgent?: boolean;
    text: string;
    ts: string;
  }[],
  options: { sessionId?: string; workflowId?: string | null } = {}
) {
  const sessionId = options.sessionId ?? "ses_case_one";
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO pm_session
       (id, workspace_id, channel, project_id, workflow_id, status, source,
        started_ts, suggested, missing_json, extra_json, violations_json)
       VALUES (?, ?, ?, ?, ?, 'open', 'human', '2026-09-14T00:00:00.000Z', 0,
               '[]', '[]', '[]')`
    )
    .run(
      sessionId,
      TEST_WORKSPACE,
      TEST_CHANNEL,
      TEST_PROJECT,
      options.workflowId === undefined ? TEST_WORKFLOW : options.workflowId
    );
  for (const message of messages) {
    sqlite
      .prepare(
        `INSERT INTO slack_message_events
         (team_id, event_id, channel_id, message_ts, event_ts, subtype, user_id,
          text, payload, received_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'U0OPS', ?, '{}', ?)`
      )
      .run(
        TEST_WORKSPACE,
        message.eventId,
        TEST_CHANNEL,
        message.ts,
        message.ts,
        message.text,
        Math.round(Number.parseFloat(message.ts) * 1000)
      );
    sqlite
      .prepare(
        `INSERT INTO pm_message
         (workspace_id, channel, ts, id, session_id, author_person_id,
          author_label, text, permalink, thread_ts, revision, deleted,
          availability, is_agent, received_at, source)
         VALUES (?, ?, ?, ?, ?, 'per_u0ops', 'Ada', ?, 'https://example.invalid',
                 NULL, 1, ?, ?, ?, ?, 'slack')`
      )
      .run(
        TEST_WORKSPACE,
        TEST_CHANNEL,
        message.ts,
        `${TEST_WORKSPACE}:${TEST_CHANNEL}:${message.ts}`,
        sessionId,
        message.text,
        message.deleted ? 1 : 0,
        message.deleted ? "deleted" : "available",
        message.isAgent ? 1 : 0,
        new Date(Number.parseFloat(message.ts) * 1000).toISOString()
      );
    sqlite
      .prepare(
        `INSERT INTO pm_processing
         (checkpoint_id, workspace_id, channel, observation_id, status, retries,
          extraction_window_revision, error, updated_at)
         VALUES (?, ?, ?, ?, 'pending', 0, 1, NULL, '2026-09-14T00:00:00.000Z')`
      )
      .run(
        `slack:${TEST_WORKSPACE}:${message.eventId}`,
        TEST_WORKSPACE,
        TEST_CHANNEL,
        message.eventId
      );
  }
  return sessionId;
}

const steps = () =>
  sqlite.prepare("SELECT * FROM pm_step ORDER BY seq, id").all();
const evidence = () =>
  sqlite
    .prepare("SELECT * FROM pm_step_evidence ORDER BY step_id, message_ts")
    .all();
const processing = () =>
  sqlite.prepare("SELECT * FROM pm_processing ORDER BY checkpoint_id").all();

beforeEach(() => {
  const { d1, sqlite: database } = createTestDatabase();
  sqlite = database;
  db = d1 as unknown as D1Database;
  seedTenant(sqlite);
  seedPerson(sqlite, { name: "Ada", role: "support", slackUserId: "U0OPS" });
  modelCalls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  sqlite.close();
});

describe("extraction context", () => {
  it("is unavailable until the workspace authors activities", async () => {
    const kb = await readTenantKb(db, TEST_WORKSPACE);
    expect(extractionContextFor(kb, TEST_WORKFLOW)).not.toBeNull();
    expect(extractionContextFor(kb, "wf_does_not_exist")).toBeNull();
  });

  it("offers the authored activities and resolved people to the model", async () => {
    const kb = await readTenantKb(db, TEST_WORKSPACE);
    const context = extractionContextFor(kb, TEST_WORKFLOW);
    expect(context?.activities.map((item) => item.slug)).toContain(
      "security_review"
    );
    expect(context?.people.map((item) => item.id)).toContain("per_u0ops");
    // Artifacts need a connector beyond Slack, so the model is given none rather
    // than being free to invent them.
    expect(context?.artifacts).toEqual([]);
  });
});

describe("extraction pipeline", () => {
  it("does nothing and says why without a model key", async () => {
    observe([
      {
        eventId: "Ev1",
        text: "Checkout is throwing 500s",
        ts: "1700000001.000100",
      },
    ]);
    const outcome = await runExtraction(
      envFor({ OPENROUTER_API_KEY: undefined }),
      SCOPE
    );
    expect(outcome.warnings).toContain("extraction.missing_openrouter_key");
    expect(steps()).toHaveLength(0);
    // The checkpoint stays pending, so configuring the key later mines the
    // backlog rather than losing it.
    expect(processing()[0]).toMatchObject({ status: "pending" });
  });

  it("persists extracted steps with their message evidence", async () => {
    observe([
      {
        eventId: "Ev1",
        text: "Checkout is throwing 500s",
        ts: "1700000001.000100",
      },
      { eventId: "Ev2", text: "Deployed the fix", ts: "1700000002.000100" },
    ]);
    vi.stubGlobal(
      "fetch",
      stubModel((window) => ({
        steps: window.map((message, index) => ({
          activity_slug: index === 0 ? "detect_incident" : "deploy_fix",
          actor_person_id: "per_u0ops",
          artifact_id: null,
          confidence: 0.9,
          evidence: [message.ts],
          handoff_to_person_id: null,
          intent: index === 0 ? "Detect the incident" : "Deploy the fix",
          label: index === 0 ? "Detect incident" : "Deploy fix",
          modality: "reported",
          type: "action",
        })),
      }))
    );

    const outcome = await runExtraction(envFor(), SCOPE);
    expect(outcome.stepsWritten).toBe(2);
    expect(outcome.checkpointsProcessed).toBe(2);
    expect(steps().map((step) => step.activity_id)).toEqual([
      "act_detect_incident",
      "act_deploy_fix",
    ]);
    // Every step must carry the timestamp of the message it was derived from.
    expect(evidence().map((row) => row.message_ts)).toEqual([
      "1700000002.000100",
      "1700000001.000100",
    ]);
    expect(processing().every((row) => row.status === "done")).toBe(true);
  });

  it("uses one model call for a session rather than one per message", async () => {
    observe([
      { eventId: "Ev1", text: "First", ts: "1700000001.000100" },
      { eventId: "Ev2", text: "Second", ts: "1700000002.000100" },
      { eventId: "Ev3", text: "Third", ts: "1700000003.000100" },
    ]);
    vi.stubGlobal(
      "fetch",
      stubModel(() => ({ steps: [] }))
    );
    await runExtraction(envFor(), SCOPE);
    // Extraction reads a conversation window, so three pending observations in
    // one session cost one call, not three.
    expect(modelCalls).toHaveLength(1);
  });

  it("never shows the model its own posts or deleted messages", async () => {
    observe([
      {
        eventId: "Ev1",
        text: "Checkout is throwing 500s",
        ts: "1700000001.000100",
      },
      {
        eventId: "Ev2",
        isAgent: true,
        text: "Ariadne: I mapped a step here",
        ts: "1700000002.000100",
      },
      {
        deleted: true,
        eventId: "Ev3",
        text: "Never mind",
        ts: "1700000003.000100",
      },
    ]);
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      stubModel((window) => {
        for (const message of window) {
          seen.push(String(message.text));
        }
        return { steps: [] };
      })
    );
    await runExtraction(envFor(), SCOPE);
    expect(seen).toEqual(["Checkout is throwing 500s"]);
  });

  it("drops a step the model returns without evidence", async () => {
    observe([
      {
        eventId: "Ev1",
        text: "Checkout is throwing 500s",
        ts: "1700000001.000100",
      },
    ]);
    vi.stubGlobal(
      "fetch",
      stubModel(() => ({
        steps: [
          {
            activity_slug: "detect_incident",
            actor_person_id: "per_u0ops",
            artifact_id: null,
            confidence: 0.9,
            // No evidence: this step would be an unfalsifiable claim.
            evidence: [],
            handoff_to_person_id: null,
            intent: "Detect the incident",
            label: "Detect incident",
            modality: "reported",
            type: "action",
          },
        ],
      }))
    );
    const outcome = await runExtraction(envFor(), SCOPE);
    expect(steps()).toHaveLength(0);
    expect(outcome.warnings.join(" ")).toContain("dropped_invalid");
  });

  it("drops a step whose evidence is not in the window", async () => {
    observe([
      {
        eventId: "Ev1",
        text: "Checkout is throwing 500s",
        ts: "1700000001.000100",
      },
    ]);
    vi.stubGlobal(
      "fetch",
      stubModel(() => ({
        steps: [
          {
            activity_slug: "detect_incident",
            actor_person_id: "per_u0ops",
            artifact_id: null,
            confidence: 0.9,
            // A timestamp the model invented.
            evidence: ["1699999999.000000"],
            handoff_to_person_id: null,
            intent: "Detect the incident",
            label: "Detect incident",
            modality: "reported",
            type: "action",
          },
        ],
      }))
    );
    await runExtraction(envFor(), SCOPE);
    expect(steps()).toHaveLength(0);
  });

  it("marks the checkpoint as error and retries when the model keeps failing", async () => {
    observe([
      {
        eventId: "Ev1",
        text: "Checkout is throwing 500s",
        ts: "1700000001.000100",
      },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response("upstream exploded", { status: 500 }))
      )
    );
    const outcome = await runExtraction(envFor(), SCOPE);
    expect(outcome.checkpointsFailed).toBe(1);
    expect(processing()[0]).toMatchObject({ retries: 1, status: "error" });
    expect(String(processing()[0]?.error)).toContain("model_attempt");
  });

  it("stops retrying a checkpoint that has failed too many times", async () => {
    observe([
      {
        eventId: "Ev1",
        text: "Checkout is throwing 500s",
        ts: "1700000001.000100",
      },
    ]);
    sqlite
      .prepare(
        "UPDATE pm_processing SET retries = 3, status = 'pending' WHERE observation_id = 'Ev1'"
      )
      .run();
    const fetcher = vi.fn(() =>
      Promise.resolve(new Response("nope", { status: 500 }))
    );
    vi.stubGlobal("fetch", fetcher);
    const outcome = await runExtraction(envFor(), SCOPE);
    // An exhausted checkpoint must not keep consuming model budget forever.
    expect(fetcher).not.toHaveBeenCalled();
    expect(outcome.checkpointsProcessed).toBe(0);
  });

  it("leaves observations pending when the workspace has authored no workflow", async () => {
    observe(
      [
        {
          eventId: "Ev1",
          text: "Checkout is throwing 500s",
          ts: "1700000001.000100",
        },
      ],
      { workflowId: null }
    );
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const outcome = await runExtraction(envFor(), SCOPE);
    expect(fetcher).not.toHaveBeenCalled();
    expect(outcome.warnings.join(" ")).toContain("no_authored_workflow");
    // Pending, not errored: authoring the workflow later mines this session.
    expect(processing()[0]).toMatchObject({ status: "pending" });
  });

  it("completes a session whose window holds nothing minable", async () => {
    observe([
      {
        eventId: "Ev1",
        isAgent: true,
        text: "bot chatter",
        ts: "1700000001.000100",
      },
    ]);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const outcome = await runExtraction(envFor(), SCOPE);
    // Nothing to ask the model about, so the checkpoint is closed rather than
    // left to be retried forever.
    expect(fetcher).not.toHaveBeenCalled();
    expect(outcome.checkpointsProcessed).toBe(1);
    expect(processing()[0]).toMatchObject({ status: "done" });
  });

  it("bounds how many sessions one run mines", async () => {
    for (const index of [1, 2, 3, 4, 5, 6]) {
      observe(
        [
          {
            eventId: `Ev${index}`,
            text: `Work item ${index}`,
            ts: `170000000${index}.000100`,
          },
        ],
        { sessionId: `ses_case_${index}` }
      );
    }
    vi.stubGlobal(
      "fetch",
      stubModel(() => ({ steps: [] }))
    );
    const outcome = await runExtraction(
      envFor({ EXTRACTION_MAX_SESSIONS_PER_RUN: "2" }),
      SCOPE
    );
    expect(outcome.sessions).toHaveLength(2);
    expect(modelCalls).toHaveLength(2);
    // The rest stay queued for the next pass.
    expect(processing().filter((row) => row.status === "pending")).toHaveLength(
      4
    );
  });

  it("stops once the model call budget is spent", async () => {
    for (const index of [1, 2, 3]) {
      observe(
        [
          {
            eventId: `Ev${index}`,
            text: `Work item ${index}`,
            ts: `170000000${index}.000100`,
          },
        ],
        { sessionId: `ses_case_${index}` }
      );
    }
    vi.stubGlobal(
      "fetch",
      stubModel(() => ({ steps: [] }))
    );
    const outcome = await runExtraction(
      envFor({ EXTRACTION_MAX_MODEL_CALLS: "1" }),
      SCOPE
    );
    // One call succeeds; the rest are refused by the budget rather than billed.
    expect(modelCalls).toHaveLength(1);
    expect(outcome.checkpointsFailed).toBeGreaterThan(0);
  });

  it("re-extracting a session updates its steps instead of duplicating them", async () => {
    observe([
      {
        eventId: "Ev1",
        text: "Checkout is throwing 500s",
        ts: "1700000001.000100",
      },
    ]);
    const payload = () => ({
      steps: [
        {
          activity_slug: "detect_incident",
          actor_person_id: "per_u0ops",
          artifact_id: null,
          confidence: 0.9,
          evidence: ["1700000001.000100"],
          handoff_to_person_id: null,
          intent: "Detect the incident",
          label: "Detect incident",
          modality: "reported",
          type: "action",
        },
      ],
    });
    vi.stubGlobal("fetch", stubModel(payload));
    await runExtraction(envFor(), SCOPE);
    expect(steps()).toHaveLength(1);

    // The message is edited, so the observation is re-queued.
    sqlite
      .prepare(
        "UPDATE pm_processing SET status = 'pending', retries = 0 WHERE observation_id = 'Ev1'"
      )
      .run();
    await runExtraction(envFor(), SCOPE);
    // Step ids are derived from session, activity, actor and evidence, so the
    // same observation cannot produce a second row.
    expect(steps()).toHaveLength(1);
    expect(evidence()).toHaveLength(1);
  });

  it("only mines the channel it was asked about", async () => {
    observe([
      {
        eventId: "Ev1",
        text: "Checkout is throwing 500s",
        ts: "1700000001.000100",
      },
    ]);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const outcome = await runExtraction(envFor(), {
      channel: "C0OTHERCHAN",
      workspaceId: TEST_WORKSPACE,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(outcome.sessions).toEqual([]);
    expect(processing()[0]).toMatchObject({ status: "pending" });
  });

  it("only mines the workspace it was asked about", async () => {
    observe([
      {
        eventId: "Ev1",
        text: "Checkout is throwing 500s",
        ts: "1700000001.000100",
      },
    ]);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const outcome = await runExtraction(envFor(), {
      channel: TEST_CHANNEL,
      workspaceId: "T0OTHERTEAM",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(outcome.sessions).toEqual([]);
  });
});
