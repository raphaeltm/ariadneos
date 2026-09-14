// End-to-end: a signed Slack message becomes a node on the graph.
//
// The unit tests cover ingestion and extraction separately. This one runs the
// whole chain against the real migrations, the real Worker, the real segmenter,
// the real extractor and the real graph builder, because the bug this whole
// change fixed was a missing link *between* two individually working parts:
// nothing wrote pm_session, so nothing downstream ever saw a real message.

import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../server/index.ts";
import { runExtraction } from "../server/pipeline/extraction.ts";
import { buildScopedGraphView } from "../server/process-data.ts";
import { closeSession } from "../server/tenant/sessions.ts";
import {
  createTestDatabase,
  seedTenant,
  TEST_CHANNEL,
  TEST_PROJECT,
  TEST_WORKSPACE,
} from "./helpers/tenant.ts";

const SIGNING_SECRET = "test-only-signing-secret";

let sqlite: DatabaseSync;
let db: D1Database;

/** Slack responses the chain needs: users.info on ingest, the model on extract. */
function slackAndModel(activityBySlug: Record<string, string>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/users.info")) {
      return Promise.resolve(
        jsonResponse({
          ok: true,
          user: {
            id: "U0OPS",
            is_bot: false,
            profile: { display_name: "Ada" },
            real_name: "Ada Lovelace",
          },
        })
      );
    }
    if (url.includes("openrouter")) {
      const prompt = extractionPrompt(init?.body);
      return Promise.resolve(
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  steps: prompt.flatMap((message) => {
                    const slug = activityBySlug[String(message.text)];
                    return slug
                      ? [
                          {
                            activity_slug: slug,
                            actor_person_id: "per_u0ops",
                            artifact_id: null,
                            confidence: 0.9,
                            evidence: [message.ts],
                            handoff_to_person_id: null,
                            intent: slug,
                            label: slug,
                            modality: "reported",
                            type: "action",
                          },
                        ]
                      : [];
                  }),
                }),
              },
            },
          ],
        })
      );
    }
    return Promise.resolve(jsonResponse({ ok: true }));
  });
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function extractionPrompt(body: BodyInit | null | undefined) {
  try {
    const parsed = JSON.parse(String(body)) as {
      messages?: { content?: string }[];
    };
    const prompt = JSON.parse(parsed.messages?.at(-1)?.content ?? "{}") as {
      messages?: { text?: string; ts?: string }[];
    };
    return prompt.messages ?? [];
  } catch {
    return [];
  }
}

/** Posts a signed Slack message event through the real Worker. */
function postMessage(text: string, ts: string, eventId: string) {
  const raw = JSON.stringify({
    event: {
      channel: TEST_CHANNEL,
      channel_type: "channel",
      event_ts: ts,
      text,
      ts,
      type: "message",
      user: "U0OPS",
    },
    event_id: eventId,
    team_id: TEST_WORKSPACE,
    type: "event_callback",
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac("sha256", SIGNING_SECRET)
    .update(`v0:${timestamp}:${raw}`)
    .digest("hex")}`;
  return worker.fetch(
    new Request("https://ariadneos.com/api/slack/events", {
      body: raw,
      headers: {
        "Content-Type": "application/json",
        "X-Slack-Request-Timestamp": timestamp,
        "X-Slack-Signature": signature,
      },
      method: "POST",
    }),
    { DB: db, SLACK_SIGNING_SECRET: SIGNING_SECRET } as never,
    {
      passThroughOnException: () => undefined,
      props: {},
      waitUntil: () => undefined,
    } as unknown as ExecutionContext
  );
}

beforeEach(() => {
  const { d1, sqlite: database } = createTestDatabase();
  sqlite = database;
  db = d1 as unknown as D1Database;
  seedTenant(sqlite);
});
afterEach(() => {
  vi.unstubAllGlobals();
  sqlite.close();
});

describe("a Slack message becomes a graph node", () => {
  it("runs ingestion, segmentation, extraction and graph build on real data", async () => {
    vi.stubGlobal(
      "fetch",
      slackAndModel({
        "Checkout is returning 500s": "detect_incident",
        "Deployed the fix": "deploy_fix",
        "Emailed the customer": "notify_customer",
      })
    );

    expect(
      (
        await postMessage(
          "Checkout is returning 500s",
          "1700000001.000100",
          "Ev1"
        )
      ).status
    ).toBe(200);
    expect(
      (await postMessage("Deployed the fix", "1700000002.000100", "Ev2")).status
    ).toBe(200);
    expect(
      (await postMessage("Emailed the customer", "1700000003.000100", "Ev3"))
        .status
    ).toBe(200);

    // Ingestion opened one case and resolved the real author.
    const sessions = sqlite.prepare("SELECT * FROM pm_session").all();
    expect(sessions).toHaveLength(1);
    expect(
      sqlite.prepare("SELECT * FROM pm_message ORDER BY ts").all()[0]
    ).toMatchObject({
      author_label: "Ada Lovelace",
      author_person_id: "per_u0ops",
      source: "slack",
    });

    const outcome = await runExtraction(
      { DB: db, OPENROUTER_API_KEY: "test-key" } as Parameters<
        typeof runExtraction
      >[0],
      { channel: TEST_CHANNEL, workspaceId: TEST_WORKSPACE }
    );
    expect(outcome.stepsWritten).toBe(3);

    // Conformance only scores completed cases: a step is not "missing" from a
    // case that is still running. The coordinator's beat closes a case once its
    // channel goes quiet; this does the same thing directly.
    const [session] = sessions;
    await closeSession(db, String(session?.id), "2026-09-14T01:00:00.000Z");

    const built = await buildScopedGraphView(
      db,
      { channel: TEST_CHANNEL, workspaceId: TEST_WORKSPACE },
      { projectId: TEST_PROJECT }
    );
    if (!built) {
      throw new Error("Expected a graph for the observed project.");
    }

    // The three observed activities now carry support, and the designed step
    // nobody performed is still present with none.
    const bySlug = new Map(
      built.graph.nodes.map((node) => [node.activity.slug, node.activity])
    );
    expect(bySlug.get("detect_incident")?.occurrences).toBe(1);
    expect(bySlug.get("deploy_fix")?.occurrences).toBe(1);
    expect(bySlug.get("notify_customer")?.occurrences).toBe(1);
    expect(bySlug.get("security_review")?.occurrences).toBe(0);

    // Conformance sees the skipped review, which is the entire point of the
    // designed-versus-observed overlay.
    expect(built.graph.conformance?.missing.map((item) => item.slug)).toContain(
      "security_review"
    );

    // Every observed step traces back to the Slack message that produced it.
    const evidence = sqlite
      .prepare(
        `SELECT ev.message_ts AS ts, msg.text AS text, msg.permalink AS permalink
         FROM pm_step_evidence ev
         JOIN pm_message msg ON msg.workspace_id = ev.workspace_id
           AND msg.channel = ev.channel AND msg.ts = ev.message_ts
         ORDER BY ev.message_ts`
      )
      .all();
    expect(evidence).toHaveLength(3);
    for (const row of evidence) {
      expect(String(row.permalink)).toContain("/archives/");
      expect(String(row.text)).not.toBe("");
    }
  });

  it("produces no graph content for a channel the workspace has not enabled", async () => {
    sqlite
      .prepare(
        "UPDATE slack_channel SET enabled = 0 WHERE workspace_id = ? AND channel_id = ?"
      )
      .run(TEST_WORKSPACE, TEST_CHANNEL);
    vi.stubGlobal(
      "fetch",
      slackAndModel({ "Checkout is down": "detect_incident" })
    );

    expect(
      (await postMessage("Checkout is down", "1700000001.000100", "Ev1")).status
    ).toBe(200);

    // The raw event is retained for diagnosis, but nothing enters the process
    // tables, so a bot present in extra channels cannot mine them.
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM slack_message_events").get()
    ).toMatchObject({ n: 1 });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM pm_session").get()
    ).toMatchObject({ n: 0 });

    const built = await buildScopedGraphView(
      db,
      { channel: TEST_CHANNEL, workspaceId: TEST_WORKSPACE },
      { projectId: TEST_PROJECT }
    );
    for (const node of built?.graph.nodes ?? []) {
      expect(node.activity.occurrences).toBe(0);
    }
  });
});
