// Perform a cached transcript into a real Slack channel, one persona message at a time.
//
// `generate` (server/demo/simulator.ts) writes what people say. `perform` puts it in the channel.
// Only the authoring of the text is cached — ingestion, extraction and the graph all run live
// against what Slack actually returns.

import { loadKb } from "../kb.ts";
import {
  postPersonaMessage,
  type SlackPersona,
  type SlackPostEnv,
} from "../slack/post.ts";
import type { DemoTranscript } from "./simulator.ts";

// Slack allows roughly one message per second per channel. 1.2s leaves headroom and is also about
// the cadence at which a human can read the channel while watching the graph build.
const MIN_POST_INTERVAL_MS = 1200;

export interface PerformInput {
  channel: string;
  sessionId: string;
  transcript: DemoTranscript;
}

export interface PerformedMessage {
  error?: string;
  permalink?: string;
  personId: string;
  posted: boolean;
  ts?: string;
}

export interface PerformResult {
  channel: string;
  failed: number;
  messages: PerformedMessage[];
  posted: number;
  sessionId: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function personaIndex(): Map<string, SlackPersona> {
  const index = new Map<string, SlackPersona>();
  for (const person of loadKb().people) {
    index.set(person.id, {
      emoji: person.emoji,
      name: person.name,
      personId: person.id,
    });
  }
  return index;
}

/**
 * Post every message in the transcript, in order, pacing between them.
 *
 * Sequential by design: Slack orders by receipt, so parallel posts would scramble the conversation
 * and with it the directly-follows ordering the graph is built from.
 */
export async function performTranscript(
  env: SlackPostEnv,
  input: PerformInput
): Promise<PerformResult> {
  const personas = personaIndex();
  const messages: PerformedMessage[] = [];

  for (const [index, message] of input.transcript.messages.entries()) {
    const persona = personas.get(message.person_id);
    if (!persona) {
      messages.push({
        error: `Unknown person_id ${message.person_id}`,
        personId: message.person_id,
        posted: false,
      });
      continue;
    }

    if (index > 0) {
      const requested = Math.round(message.delay * 1000);
      await sleep(Math.max(MIN_POST_INTERVAL_MS, requested));
    }

    const result = await postPersonaMessage(env, {
      channel: input.channel,
      persona,
      sessionId: input.sessionId,
      text: message.text,
    });

    messages.push(
      result.ok
        ? {
            permalink: result.permalink,
            personId: persona.personId,
            posted: true,
            ts: result.ts,
          }
        : { error: result.error, personId: persona.personId, posted: false }
    );
  }

  return {
    channel: input.channel,
    failed: messages.filter((m) => !m.posted).length,
    messages,
    posted: messages.filter((m) => m.posted).length,
    sessionId: input.sessionId,
  };
}
