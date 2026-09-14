// Slack Web API client. The only place in the server that talks to Slack outbound.
//
// Every call is bot-token scoped to one workspace install, so a caller cannot
// accidentally read or post into a workspace it does not hold a token for.

const SLACK_API_BASE = "https://slack.com/api";

export class SlackApiError extends Error {
  readonly retryAfterSeconds: number | null;
  readonly slackError: string;
  readonly status: number;

  constructor(
    method: string,
    slackError: string,
    options: { retryAfterSeconds?: number | null; status?: number } = {}
  ) {
    super(`Slack ${method} failed: ${slackError}`);
    this.name = "SlackApiError";
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.slackError = slackError;
    this.status = options.status ?? 200;
  }

  /** Slack rate limits and transient upstream faults are worth retrying. */
  get retryable() {
    return (
      this.slackError === "ratelimited" ||
      this.slackError === "internal_error" ||
      this.slackError === "service_unavailable" ||
      this.slackError === "fatal_error" ||
      this.status >= 500
    );
  }
}

export interface SlackUser {
  color: string | null;
  deleted: boolean;
  display_name: string;
  id: string;
  image_url: string | null;
  is_bot: boolean;
  real_name: string;
  title: string;
  tz: string | null;
}

export interface SlackConversation {
  id: string;
  is_archived: boolean;
  is_member: boolean;
  is_private: boolean;
  name: string;
  topic: string;
}

export interface SlackHistoryMessage {
  bot_id: string | null;
  subtype: string | null;
  text: string;
  thread_ts: string | null;
  ts: string;
  user: string | null;
}

export interface SlackOauthAccess {
  app_id: string;
  bot_token: string;
  bot_user_id: string;
  scopes: string;
  team_domain: string | null;
  team_id: string;
  team_name: string;
}

export interface SlackClientOptions {
  fetcher?: typeof fetch;
  maxAttempts?: number;
  /** Wall clock, injected so retry backoff is testable without real delays. */
  sleep?: (ms: number) => Promise<void>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBoolean(value: unknown) {
  return value === true;
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Slack rejects unexpected fields and silently truncates oversized text, so the
 * client keeps request shaping in one place.
 */
export class SlackClient {
  private readonly fetcher: typeof fetch;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly token: string;

  constructor(token: string, options: SlackClientOptions = {}) {
    if (!token) {
      throw new SlackApiError("constructor", "not_authed");
    }
    this.token = token;
    this.fetcher = options.fetcher ?? fetch;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.sleep = options.sleep ?? defaultSleep;
  }

  async authTest() {
    const payload = await this.call("auth.test", {});
    return {
      botUserId: readString(payload.user_id) ?? "",
      teamId: readString(payload.team_id) ?? "",
      teamName: readString(payload.team) ?? "",
    };
  }

  async usersInfo(userId: string): Promise<SlackUser> {
    const payload = await this.call("users.info", { user: userId });
    const user = isObject(payload.user) ? payload.user : {};
    const profile = isObject(user.profile) ? user.profile : {};
    return {
      color: readString(user.color) ? `#${String(user.color)}` : null,
      deleted: readBoolean(user.deleted),
      display_name:
        readString(profile.display_name) ??
        readString(user.real_name) ??
        readString(user.name) ??
        userId,
      id: readString(user.id) ?? userId,
      image_url:
        readString(profile.image_192) ?? readString(profile.image_72) ?? null,
      is_bot: readBoolean(user.is_bot),
      real_name:
        readString(user.real_name) ??
        readString(profile.real_name) ??
        readString(user.name) ??
        userId,
      title: readString(profile.title) ?? "",
      tz: readString(user.tz) ?? null,
    };
  }

  /** Channels the bot can see. Paginated; caller supplies an upper bound. */
  async conversationsList(
    options: { limit?: number; types?: string } = {}
  ): Promise<SlackConversation[]> {
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
    const conversations: SlackConversation[] = [];
    let cursor: string | undefined;
    do {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination is inherently sequential.
      const payload = await this.call("conversations.list", {
        exclude_archived: "true",
        limit: String(Math.min(limit - conversations.length, 200)),
        types: options.types ?? "public_channel,private_channel",
        ...(cursor ? { cursor } : {}),
      });
      const channels = Array.isArray(payload.channels) ? payload.channels : [];
      for (const raw of channels) {
        if (!isObject(raw)) {
          continue;
        }
        conversations.push({
          id: readString(raw.id) ?? "",
          is_archived: readBoolean(raw.is_archived),
          is_member: readBoolean(raw.is_member),
          is_private: readBoolean(raw.is_private),
          name: readString(raw.name) ?? "",
          topic: isObject(raw.topic) ? (readString(raw.topic.value) ?? "") : "",
        });
      }
      cursor = nextCursor(payload);
    } while (cursor && conversations.length < limit);
    return conversations.filter((channel) => channel.id);
  }

  async conversationsInfo(channelId: string): Promise<SlackConversation> {
    const payload = await this.call("conversations.info", {
      channel: channelId,
    });
    const channel = isObject(payload.channel) ? payload.channel : {};
    return {
      id: readString(channel.id) ?? channelId,
      is_archived: readBoolean(channel.is_archived),
      is_member: readBoolean(channel.is_member),
      is_private: readBoolean(channel.is_private),
      name: readString(channel.name) ?? channelId,
      topic: isObject(channel.topic)
        ? (readString(channel.topic.value) ?? "")
        : "",
    };
  }

  /**
   * Bounded history read used to reconcile a channel at enable time. Slack returns
   * newest first; the result is re-sorted oldest first so ingestion can replay it
   * in the same order as live events.
   */
  async conversationsHistory(
    channelId: string,
    options: { limit?: number; oldest?: string } = {}
  ): Promise<SlackHistoryMessage[]> {
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
    const messages: SlackHistoryMessage[] = [];
    let cursor: string | undefined;
    do {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination is inherently sequential.
      const payload = await this.call("conversations.history", {
        channel: channelId,
        limit: String(Math.min(limit - messages.length, 200)),
        ...(options.oldest ? { oldest: options.oldest } : {}),
        ...(cursor ? { cursor } : {}),
      });
      messages.push(...readHistoryMessages(payload.messages));
      cursor = nextCursor(payload);
    } while (cursor && messages.length < limit);
    return messages.sort((a, b) => Number(a.ts) - Number(b.ts));
  }

  /** Replies in a thread, oldest first, excluding the parent message. */
  async conversationsReplies(
    channelId: string,
    threadTs: string,
    options: { limit?: number } = {}
  ): Promise<SlackHistoryMessage[]> {
    const payload = await this.call("conversations.replies", {
      channel: channelId,
      limit: String(Math.min(Math.max(options.limit ?? 200, 1), 200)),
      ts: threadTs,
    });
    return readHistoryMessages(payload.messages)
      .filter((message) => message.ts !== threadTs)
      .sort((a, b) => Number(a.ts) - Number(b.ts));
  }

  async chatPostMessage(input: {
    channel: string;
    text: string;
    thread_ts?: string | null;
  }) {
    const payload = await this.call("chat.postMessage", {
      channel: input.channel,
      // Slack renders user-supplied markup; Ariadne posts plain text only.
      mrkdwn: "false",
      text: input.text.slice(0, 3000),
      ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
    });
    return {
      channel: readString(payload.channel) ?? input.channel,
      ts: readString(payload.ts) ?? "",
    };
  }

  private async call(
    method: string,
    body: Record<string, string>
  ): Promise<Record<string, unknown>> {
    let lastError: SlackApiError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: retries must be sequential and honour Retry-After.
      const outcome = await this.attempt(method, body);
      if (!("error" in outcome)) {
        return outcome.payload;
      }
      lastError = outcome.error;
      if (!(outcome.error.retryable && attempt < this.maxAttempts)) {
        throw outcome.error;
      }
      const backoffMs =
        (outcome.error.retryAfterSeconds ?? 2 ** (attempt - 1)) * 1000;
      await this.sleep(Math.min(backoffMs, 30_000));
    }
    throw lastError ?? new SlackApiError(method, "unknown_error");
  }

  private async attempt(
    method: string,
    body: Record<string, string>
  ): Promise<{ payload: Record<string, unknown> } | { error: SlackApiError }> {
    let response: Response;
    try {
      response = await this.fetcher(`${SLACK_API_BASE}/${method}`, {
        body: new URLSearchParams(body).toString(),
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        method: "POST",
      });
    } catch {
      return {
        error: new SlackApiError(method, "service_unavailable", {
          status: 503,
        }),
      };
    }
    const retryAfterSeconds = Number.parseInt(
      response.headers.get("retry-after") ?? "",
      10
    );
    if (response.status === 429) {
      return {
        error: new SlackApiError(method, "ratelimited", {
          retryAfterSeconds: Number.isFinite(retryAfterSeconds)
            ? retryAfterSeconds
            : 1,
          status: 429,
        }),
      };
    }
    if (!response.ok) {
      return {
        error: new SlackApiError(method, `http_${response.status}`, {
          status: response.status,
        }),
      };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { error: new SlackApiError(method, "invalid_json_response") };
    }
    if (!isObject(payload)) {
      return { error: new SlackApiError(method, "invalid_json_response") };
    }
    if (payload.ok !== true) {
      return {
        error: new SlackApiError(
          method,
          readString(payload.error) ?? "unknown_error",
          {
            retryAfterSeconds: Number.isFinite(retryAfterSeconds)
              ? retryAfterSeconds
              : null,
          }
        ),
      };
    }
    return { payload };
  }
}

function readHistoryMessages(raw: unknown): SlackHistoryMessage[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isObject).flatMap((entry) => {
    const ts = readString(entry.ts);
    if (!ts) {
      return [];
    }
    return [
      {
        bot_id: readString(entry.bot_id) ?? null,
        subtype: readString(entry.subtype) ?? null,
        text: typeof entry.text === "string" ? entry.text : "",
        thread_ts: readString(entry.thread_ts) ?? null,
        ts,
        user: readString(entry.user) ?? null,
      },
    ];
  });
}

function nextCursor(payload: Record<string, unknown>) {
  const metadata = isObject(payload.response_metadata)
    ? payload.response_metadata
    : {};
  return readString(metadata.next_cursor);
}

/**
 * Exchanges an OAuth v2 authorization code for a workspace bot token. Separate
 * from SlackClient because it authenticates with the app credentials, not a token.
 */
export async function exchangeOauthCode(
  input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  },
  fetcher: typeof fetch = fetch
): Promise<SlackOauthAccess> {
  const response = await fetcher(`${SLACK_API_BASE}/oauth.v2.access`, {
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }).toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new SlackApiError("oauth.v2.access", `http_${response.status}`, {
      status: response.status,
    });
  }
  const payload: unknown = await response.json();
  if (!isObject(payload) || payload.ok !== true) {
    throw new SlackApiError(
      "oauth.v2.access",
      (isObject(payload) ? readString(payload.error) : undefined) ??
        "invalid_grant"
    );
  }
  const team = isObject(payload.team) ? payload.team : {};
  const botToken = readString(payload.access_token);
  const botUserId = readString(payload.bot_user_id);
  const teamId = readString(team.id);
  if (!(botToken && botUserId && teamId)) {
    throw new SlackApiError("oauth.v2.access", "incomplete_install");
  }
  // A user-token grant cannot act as the workspace bot.
  if (readString(payload.token_type) !== "bot") {
    throw new SlackApiError("oauth.v2.access", "expected_bot_token");
  }
  return {
    app_id: readString(payload.app_id) ?? "",
    bot_token: botToken,
    bot_user_id: botUserId,
    scopes: readString(payload.scope) ?? "",
    team_domain: readString(team.domain) ?? null,
    team_id: teamId,
    team_name: readString(team.name) ?? teamId,
  };
}
