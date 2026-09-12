import { Agent } from "@mastra/core/agent";
import {
  type AgentModelEnv,
  agentBudget,
  maxTokensFor,
  modelIdFor,
  openRouterAttribution,
  openRouterModel,
  publicAgentModelConfig,
} from "./models.ts";

export type AgentExecutor = "disabled" | "mastra-embedded" | "typed-fetch";

export interface AgentSmokeResult {
  answer?: string;
  executor: AgentExecutor;
  fallbackReason?: string;
  model?: string;
  ok: boolean;
  status: "disabled" | "failed" | "missing_key" | "ok";
}

const SMOKE_SYSTEM_PROMPT =
  "You are a deployment smoke test for AriadneOS. Reply with exactly ariadne_openrouter_smoke_ok and no extra text.";
const SMOKE_USER_PROMPT =
  "Confirm the AriadneOS OpenRouter smoke path is live.";

function redactError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 240);
  }
  return String(error).slice(0, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function responseText(data: unknown) {
  if (!(isRecord(data) && Array.isArray(data.choices))) {
    return "";
  }
  const [choice] = data.choices;
  if (!(isRecord(choice) && isRecord(choice.message))) {
    return "";
  }
  const { content } = choice.message;
  return typeof content === "string" ? content.trim() : "";
}

async function typedFetchSmoke(env: AgentModelEnv, signal: AbortSignal) {
  const attribution = openRouterAttribution(env);
  const model = modelIdFor(env, "answer");
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      body: JSON.stringify({
        max_tokens: maxTokensFor(env, "answer"),
        messages: [
          { content: SMOKE_SYSTEM_PROMPT, role: "system" },
          { content: SMOKE_USER_PROMPT, role: "user" },
        ],
        model,
        temperature: 0,
      }),
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY ?? ""}`,
        "Content-Type": "application/json",
        "HTTP-Referer": attribution.appUrl,
        "X-OpenRouter-Title": attribution.appName,
      },
      method: "POST",
      signal,
    }
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenRouter typed fetch failed with ${response.status}`);
  }
  const answer = responseText(body);
  if (!answer) {
    throw new Error("OpenRouter typed fetch returned an empty answer");
  }
  return {
    answer,
    executor: "typed-fetch" as const,
    model,
    ok: true,
    status: "ok" as const,
  };
}

async function mastraSmoke(env: AgentModelEnv, signal: AbortSignal) {
  const model = modelIdFor(env, "answer");
  const agent = new Agent({
    id: "ariadne-runtime-smoke",
    instructions: SMOKE_SYSTEM_PROMPT,
    model: openRouterModel(env, "answer"),
    name: "Ariadne runtime smoke",
  });
  const response = await agent.generate(
    [{ content: SMOKE_USER_PROMPT, role: "user" }],
    {
      abortSignal: signal,
      maxSteps: 1,
      modelSettings: {
        maxOutputTokens: maxTokensFor(env, "answer"),
        temperature: 0,
      },
    }
  );
  const answer = response.text.trim();
  if (!answer) {
    throw new Error("Mastra returned an empty answer");
  }
  return {
    answer,
    executor: "mastra-embedded" as const,
    model,
    ok: true,
    status: "ok" as const,
  };
}

export function agentRuntimeStatus(env: AgentModelEnv) {
  return {
    config: publicAgentModelConfig(env),
    executor: "mastra-embedded",
    fallback: "typed-fetch",
    path: "embedded-worker",
  };
}

export async function runAgentSmoke(
  env: AgentModelEnv
): Promise<AgentSmokeResult> {
  const config = publicAgentModelConfig(env);
  if (!config.enabled) {
    return {
      executor: "disabled",
      ok: true,
      status: "disabled",
    };
  }
  if (!env.OPENROUTER_API_KEY) {
    return {
      executor: "disabled",
      ok: false,
      status: "missing_key",
    };
  }
  const budget = agentBudget(env);
  try {
    return await mastraSmoke(env, AbortSignal.timeout(budget.timeoutMs));
  } catch (error) {
    const fallbackReason = redactError(error);
    try {
      return {
        ...(await typedFetchSmoke(env, AbortSignal.timeout(budget.timeoutMs))),
        fallbackReason,
      };
    } catch (fallbackError) {
      return {
        executor: "mastra-embedded",
        fallbackReason: `${fallbackReason}; typed-fetch: ${redactError(
          fallbackError
        )}`,
        model: modelIdFor(env, "answer"),
        ok: false,
        status: "failed",
      };
    }
  }
}
