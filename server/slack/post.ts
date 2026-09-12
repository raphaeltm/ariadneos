// Outbound Slack Web API. The inbound half lives in server/slack-events.ts.
//
// One bot token posts as six different people via chat:write.customize: `username` and
// `icon_emoji` are overridden per message. Without that the whole channel renders as a single
// author, handoff edges become meaningless, and the simulation reads as a monologue.

export interface SlackPostEnv {
  SLACK_BOT_TOKEN?: string;
  SLACK_WORKSPACE?: string;
}

export interface SlackPersona {
  emoji: string;
  name: string;
  personId: string;
}

export interface SlackPostInput {
  channel: string;
  persona: SlackPersona;
  sessionId: string;
  text: string;
  threadTs?: string;
}

export type SlackPostResult =
  | {
      ok: false;
      reason: "api_error" | "no_token" | "transport_error";
      error: string;
    }
  | {
      ok: true;
      permalink: string;
      ts: string;
    };

interface SlackApiResponse {
  error?: string;
  ok: boolean;
  ts?: string;
}

const SLACK_POST_URL = "https://slack.com/api/chat.postMessage";

/**
 * Build the archive permalink locally rather than calling `chat.getPermalink`, which would double
 * the subrequest count for no benefit — the URL is a pure function of channel and ts.
 */
export function slackPermalink(
  workspace: string,
  channel: string,
  ts: string
): string {
  return `https://${workspace}.slack.com/archives/${channel}/p${ts.replace(".", "")}`;
}

/**
 * Post one message as a persona. Never throws: a failed post degrades the run to `inferred`
 * grounding rather than taking down the request that triggered it.
 */
export async function postPersonaMessage(
  env: SlackPostEnv,
  input: SlackPostInput
): Promise<SlackPostResult> {
  const token = env.SLACK_BOT_TOKEN;
  if (!token) {
    return {
      error: "SLACK_BOT_TOKEN is not configured.",
      ok: false,
      reason: "no_token",
    };
  }

  const body = {
    channel: input.channel,
    icon_emoji: input.persona.emoji,
    // Read back on ingestion so case correlation is data rather than a heuristic.
    metadata: {
      event_payload: {
        person_id: input.persona.personId,
        session_id: input.sessionId,
      },
      event_type: "ariadne_sim",
    },
    text: input.text,
    thread_ts: input.threadTs,
    username: input.persona.name,
  };

  let payload: SlackApiResponse;
  try {
    const response = await fetch(SLACK_POST_URL, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    });
    payload = (await response.json()) as SlackApiResponse;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Slack request failed.",
      ok: false,
      reason: "transport_error",
    };
  }

  if (!(payload.ok && payload.ts)) {
    return {
      error: payload.error ?? "Slack rejected the message.",
      ok: false,
      reason: "api_error",
    };
  }

  return {
    ok: true,
    permalink: slackPermalink(
      env.SLACK_WORKSPACE ?? "ariadneos",
      input.channel,
      payload.ts
    ),
    ts: payload.ts,
  };
}
