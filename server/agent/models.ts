import { createOpenRouter } from "@openrouter/ai-sdk-provider";

export type AgentModelPurpose = "answer" | "classify" | "extract";

export interface AgentModelEnv {
  AGENT_DAILY_OPENROUTER_LIMIT?: string;
  AGENT_ENABLED?: string;
  AGENT_TIMEOUT_MS?: string;
  MODEL_ANSWER?: string;
  MODEL_ANSWER_MAX_TOKENS?: string;
  MODEL_CLASSIFY?: string;
  MODEL_CLASSIFY_MAX_TOKENS?: string;
  MODEL_EXTRACT?: string;
  MODEL_EXTRACT_MAX_TOKENS?: string;
  MODEL_RAG?: string;
  MODEL_SIM?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_APP_TITLE?: string;
  OPENROUTER_SITE_URL?: string;
}

const DEFAULT_MODELS = {
  answer: "anthropic/claude-sonnet-4",
  classify: "openai/gpt-4.1-mini",
  extract: "openai/gpt-4.1-mini",
} as const satisfies Record<AgentModelPurpose, string>;

const DEFAULT_MAX_TOKENS = {
  answer: 96,
  classify: 128,
  extract: 256,
} as const satisfies Record<AgentModelPurpose, number>;

function fromEnvNumber(
  value: string | undefined,
  fallback: number,
  { max, min }: { max: number; min: number }
) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

export function isAgentEnabled(env: AgentModelEnv) {
  return env.AGENT_ENABLED === "true";
}

export function modelIdFor(env: AgentModelEnv, purpose: AgentModelPurpose) {
  switch (purpose) {
    case "answer":
      return env.MODEL_ANSWER ?? env.MODEL_RAG ?? DEFAULT_MODELS.answer;
    case "classify":
      return env.MODEL_CLASSIFY ?? env.MODEL_SIM ?? DEFAULT_MODELS.classify;
    case "extract":
      return env.MODEL_EXTRACT ?? env.MODEL_SIM ?? DEFAULT_MODELS.extract;
    default: {
      const exhaustive: never = purpose;
      throw new Error(`Unknown model purpose: ${exhaustive}`);
    }
  }
}

export function maxTokensFor(env: AgentModelEnv, purpose: AgentModelPurpose) {
  switch (purpose) {
    case "answer":
      return fromEnvNumber(
        env.MODEL_ANSWER_MAX_TOKENS,
        DEFAULT_MAX_TOKENS.answer,
        { max: 512, min: 16 }
      );
    case "classify":
      return fromEnvNumber(
        env.MODEL_CLASSIFY_MAX_TOKENS,
        DEFAULT_MAX_TOKENS.classify,
        { max: 512, min: 16 }
      );
    case "extract":
      return fromEnvNumber(
        env.MODEL_EXTRACT_MAX_TOKENS,
        DEFAULT_MAX_TOKENS.extract,
        { max: 1024, min: 16 }
      );
    default: {
      const exhaustive: never = purpose;
      throw new Error(`Unknown model purpose: ${exhaustive}`);
    }
  }
}

export function agentBudget(env: AgentModelEnv) {
  return {
    dailyOpenRouterCalls: fromEnvNumber(env.AGENT_DAILY_OPENROUTER_LIMIT, 5, {
      max: 100,
      min: 0,
    }),
    timeoutMs: fromEnvNumber(env.AGENT_TIMEOUT_MS, 12_000, {
      max: 30_000,
      min: 1000,
    }),
  };
}

export function openRouterAttribution(env: AgentModelEnv) {
  return {
    appName: env.OPENROUTER_APP_TITLE ?? "AriadneOS",
    appUrl: env.OPENROUTER_SITE_URL ?? "https://ariadneos.com",
  };
}

export function openRouterModel(
  env: AgentModelEnv,
  purpose: AgentModelPurpose
) {
  const attribution = openRouterAttribution(env);
  const openrouter = createOpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
    appName: attribution.appName,
    appUrl: attribution.appUrl,
    compatibility: "strict",
  });
  return openrouter(modelIdFor(env, purpose));
}

export function publicAgentModelConfig(env: AgentModelEnv) {
  return {
    attribution: openRouterAttribution(env),
    budgets: {
      ...agentBudget(env),
      maxTokens: {
        answer: maxTokensFor(env, "answer"),
        classify: maxTokensFor(env, "classify"),
        extract: maxTokensFor(env, "extract"),
      },
    },
    enabled: isAgentEnabled(env),
    hasOpenRouterKey: !!env.OPENROUTER_API_KEY,
    models: {
      answer: modelIdFor(env, "answer"),
      classify: modelIdFor(env, "classify"),
      extract: modelIdFor(env, "extract"),
    },
  };
}
