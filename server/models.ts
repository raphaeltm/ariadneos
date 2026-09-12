export type ModelTask = "answer" | "canonicalize" | "classify" | "extract";

export interface ModelMessage {
  content: string;
  role: "assistant" | "system" | "user";
}

export interface JsonSchemaResponseFormat {
  json_schema: {
    name: string;
    schema: unknown;
    strict?: boolean;
  };
  type: "json_schema";
}

export interface ModelJsonCall {
  maxTokens: number;
  messages: readonly ModelMessage[];
  responseFormat?: JsonSchemaResponseFormat;
  signal?: AbortSignal;
  task: ModelTask;
  temperature: number;
}

export interface ModelAdapter {
  generateJson: (call: ModelJsonCall) => Promise<unknown>;
}

export interface ModelEnv {
  MODEL_ANSWER?: string;
  MODEL_CANONICALIZE?: string;
  MODEL_CLASSIFY?: string;
  MODEL_DAILY_LIMIT?: string;
  MODEL_EXTRACT?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
}

export class ModelCallError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ModelCallError";
  }
}

function modelFor(task: ModelTask, env: ModelEnv) {
  switch (task) {
    case "answer":
      return env.MODEL_ANSWER ?? "anthropic/claude-sonnet-4";
    case "canonicalize":
      return (
        env.MODEL_CANONICALIZE ?? env.MODEL_CLASSIFY ?? "openai/gpt-4.1-mini"
      );
    case "classify":
      return env.MODEL_CLASSIFY ?? "openai/gpt-4.1-mini";
    case "extract":
      return env.MODEL_EXTRACT ?? "openai/gpt-4.1-mini";
    default: {
      const exhaustive: never = task;
      return exhaustive;
    }
  }
}

function parseJsonContent(value: unknown) {
  if (typeof value !== "string") {
    throw new ModelCallError("Model response did not contain text content.");
  }
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: ModelCallError attaches the original value as Error.cause.
    throw new ModelCallError(
      error instanceof Error ? error.message : "Model response was not JSON.",
      error
    );
  }
}

export function createOpenRouterModelAdapter(
  env: ModelEnv,
  fetcher: typeof fetch = fetch
): ModelAdapter {
  return {
    async generateJson(call) {
      if (!env.OPENROUTER_API_KEY) {
        throw new ModelCallError("OPENROUTER_API_KEY is not configured.");
      }
      const response = await fetcher(
        `${env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"}/chat/completions`,
        {
          body: JSON.stringify({
            max_tokens: call.maxTokens,
            messages: call.messages,
            model: modelFor(call.task, env),
            response_format: call.responseFormat,
            temperature: call.temperature,
          }),
          headers: {
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://ariadneos.com",
            "X-Title": "AriadneOS",
          },
          method: "POST",
          signal: call.signal,
        }
      );
      if (!response.ok) {
        throw new ModelCallError(
          `OpenRouter returned HTTP ${response.status}.`
        );
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      return parseJsonContent(payload.choices?.[0]?.message?.content);
    },
  };
}

export function createBudgetedModelAdapter(
  adapter: ModelAdapter,
  maxCalls: number
): ModelAdapter {
  let calls = 0;
  return {
    async generateJson(call) {
      if (calls >= maxCalls) {
        throw new ModelCallError("Model call budget exhausted.");
      }
      calls += 1;
      return await adapter.generateJson(call);
    },
  };
}
