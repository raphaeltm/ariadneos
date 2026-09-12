// POST /api/sim/perform — put a cached transcript into the real Slack channel.
//
// Returns 202 immediately and posts in the background. A run is ~14 messages paced at 1.2s, so
// holding the request open would sit near the Worker's wall-clock limit for no benefit: the client
// watches Slack and the graph, not this response.

import { Hono } from "hono";
import { performTranscript } from "../demo/perform.ts";
import {
  demoScenarioCatalog,
  generateDemoTranscript,
  type ScenarioId,
  type ScenarioVariantId,
} from "../demo/simulator.ts";
import type { SlackPostEnv } from "../slack/post.ts";

interface SimulationEnv extends SlackPostEnv {
  SLACK_ALLOWED_CHANNEL_ID?: string;
}

interface PerformBody {
  channel?: string;
  scenario?: string;
  seed?: number;
  variant?: string;
}

export const simulationRoutes = new Hono<{ Bindings: SimulationEnv }>();

simulationRoutes.get("/sim/scenarios", (c) =>
  c.json({
    scenarios: demoScenarioCatalog(),
    slack: {
      channel: c.env.SLACK_ALLOWED_CHANNEL_ID ?? null,
      configured: Boolean(c.env.SLACK_BOT_TOKEN),
      workspace: c.env.SLACK_WORKSPACE ?? null,
    },
  })
);

simulationRoutes.post("/sim/perform", async (c) => {
  let body: PerformBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON." }, 400);
  }

  const catalog = demoScenarioCatalog();
  const scenario = catalog.find((entry) => entry.id === body.scenario);
  if (!scenario) {
    return c.json(
      {
        error: "Unknown scenario.",
        scenarios: catalog.map((entry) => entry.id),
      },
      400
    );
  }

  const variant = scenario.variants.find((entry) => entry.id === body.variant);
  if (!variant) {
    return c.json(
      {
        error: "Unknown variant.",
        variants: scenario.variants.map((entry) => entry.id),
      },
      400
    );
  }

  // Fail before posting rather than halfway through a channel.
  if (!c.env.SLACK_BOT_TOKEN) {
    return c.json(
      {
        error:
          "Slack is not configured. Set the SLACK_BOT_TOKEN secret to perform a run.",
      },
      503
    );
  }

  const channel =
    body.channel ?? c.env.SLACK_ALLOWED_CHANNEL_ID ?? scenario.channel;
  const transcript = generateDemoTranscript(
    scenario.id as ScenarioId,
    variant.id as ScenarioVariantId,
    body.seed ?? 28
  );
  const sessionId = `ses_${scenario.id}_${variant.id}_${crypto.randomUUID().slice(0, 8)}`;

  c.executionCtx.waitUntil(
    performTranscript(c.env, { channel, sessionId, transcript }).then(
      (result) => {
        if (result.failed > 0) {
          console.error(
            `Simulation ${sessionId}: ${result.failed} of ${result.messages.length} messages failed to post.`
          );
        }
      },
      (error: unknown) => {
        console.error(
          "Simulation failed",
          error instanceof Error ? error.message : "unknown"
        );
      }
    )
  );

  return c.json(
    {
      channel,
      expected_deviations: transcript.expected_deviations,
      messages: transcript.messages.length,
      scenario: scenario.id,
      session_id: sessionId,
      status: "performing",
      variant: variant.id,
    },
    202
  );
});
