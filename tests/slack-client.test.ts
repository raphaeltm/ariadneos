import { describe, expect, it, vi } from "vitest";
import {
  exchangeOauthCode,
  SlackApiError,
  SlackClient,
  type SlackConversation,
} from "../server/slack/client.ts";

function jsonResponse(
  body: unknown,
  init: { headers?: Record<string, string>; status?: number } = {}
) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...init.headers },
    status: init.status ?? 200,
  });
}

function makeChannel(id: string) {
  return {
    id,
    is_archived: false,
    is_member: true,
    is_private: false,
    name: `channel-${id}`,
    topic: { value: "" },
  };
}

type FetchCall = [input: unknown, init?: RequestInit];

function paramsFromCall(call: FetchCall) {
  const [, init] = call;
  return new URLSearchParams(String(init?.body));
}

describe("SlackClient#usersInfo", () => {
  it("maps a full Slack payload to the normalized shape", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        user: {
          color: "9f69e7",
          deleted: true,
          id: "U1",
          is_bot: true,
          profile: {
            display_name: "Ada",
            image_72: "https://img/72.png",
            image_192: "https://img/192.png",
            real_name: "Profile Real",
            title: "Engineer",
          },
          real_name: "Ada Lovelace",
          tz: "America/New_York",
        },
      })
    );
    const client = new SlackClient("xoxb-test", { fetcher });
    const user = await client.usersInfo("U1");
    expect(user).toEqual({
      color: "#9f69e7",
      deleted: true,
      display_name: "Ada",
      id: "U1",
      image_url: "https://img/192.png",
      is_bot: true,
      real_name: "Ada Lovelace",
      title: "Engineer",
      tz: "America/New_York",
    });
  });

  // The setup UI shows whichever name Slack can supply; a user who never set a
  // display name must still get a readable label rather than an empty string.
  it("falls back to real_name when profile.display_name is absent", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        user: { id: "U2", profile: {}, real_name: "Grace Hopper" },
      })
    );
    const client = new SlackClient("xoxb-test", { fetcher });
    const user = await client.usersInfo("U2");
    expect(user.display_name).toBe("Grace Hopper");
  });

  it("falls back to name when display_name and real_name are both absent", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ ok: true, user: { id: "U3", name: "ghopper" } })
      );
    const client = new SlackClient("xoxb-test", { fetcher });
    const user = await client.usersInfo("U3");
    expect(user.display_name).toBe("ghopper");
  });

  it("falls back to the raw Slack id when no name field is present", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, user: {} }));
    const client = new SlackClient("xoxb-test", { fetcher });
    const user = await client.usersInfo("U4");
    expect(user.display_name).toBe("U4");
    expect(user.real_name).toBe("U4");
    expect(user.id).toBe("U4");
  });

  it("defaults color to null and booleans to false when the fields are absent", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, user: { id: "U5" } }));
    const client = new SlackClient("xoxb-test", { fetcher });
    const user = await client.usersInfo("U5");
    expect(user.color).toBeNull();
    expect(user.image_url).toBeNull();
    expect(user.is_bot).toBe(false);
    expect(user.deleted).toBe(false);
  });
});

describe("SlackClient#conversationsList", () => {
  it("follows response_metadata.next_cursor and stops once the requested limit is reached", async () => {
    const pageOne = Array.from({ length: 200 }, (_, index) =>
      makeChannel(`C${index}`)
    );
    const pageTwo = Array.from({ length: 50 }, (_, index) =>
      makeChannel(`D${index}`)
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          channels: pageOne,
          ok: true,
          response_metadata: { next_cursor: "cursor-1" },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          channels: pageTwo,
          ok: true,
          // Slack still offers a cursor; the client must stop anyway because it
          // has already satisfied the caller's limit.
          response_metadata: { next_cursor: "cursor-2" },
        })
      );
    const client = new SlackClient("xoxb-test", { fetcher });
    const result: SlackConversation[] = await client.conversationsList({
      limit: 250,
    });
    expect(result).toHaveLength(250);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = fetcher.mock.calls as FetchCall[];
    expect(firstCall).toBeDefined();
    expect(secondCall).toBeDefined();
    if (!(firstCall && secondCall)) {
      return;
    }
    const firstParams = paramsFromCall(firstCall);
    const secondParams = paramsFromCall(secondCall);
    // The second page must ask for exactly what's left (250 - 200), not another
    // full page, and must carry the cursor forward.
    expect(firstParams.get("limit")).toBe("200");
    expect(firstParams.has("cursor")).toBe(false);
    expect(secondParams.get("limit")).toBe("50");
    expect(secondParams.get("cursor")).toBe("cursor-1");
  });

  it("makes a single request when the first page already satisfies the limit", async () => {
    const page = Array.from({ length: 5 }, (_, index) =>
      makeChannel(`C${index}`)
    );
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        channels: page,
        ok: true,
        response_metadata: { next_cursor: "more-available" },
      })
    );
    const client = new SlackClient("xoxb-test", { fetcher });
    const result = await client.conversationsList({ limit: 5 });
    expect(result).toHaveLength(5);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("SlackClient#conversationsHistory", () => {
  it("returns messages oldest-first even though Slack returns them newest-first", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        messages: [
          { text: "third", ts: "1700000003.000100" },
          { text: "second", ts: "1700000002.000100" },
          { text: "first", ts: "1700000001.000100" },
        ],
        ok: true,
      })
    );
    const client = new SlackClient("xoxb-test", { fetcher });
    const messages = await client.conversationsHistory("C1");
    expect(messages.map((message) => message.text)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("forwards the oldest option to the Slack request", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse({ messages: [], ok: true }));
    const client = new SlackClient("xoxb-test", { fetcher });
    await client.conversationsHistory("C1", { oldest: "1700000000.000000" });
    const [call] = fetcher.mock.calls as FetchCall[];
    expect(call).toBeDefined();
    if (call) {
      expect(paramsFromCall(call).get("oldest")).toBe("1700000000.000000");
    }
  });
});

describe("SlackClient#conversationsReplies", () => {
  it("excludes the thread parent message from the replies", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        messages: [
          { text: "parent", ts: "1700000000.000100" },
          { text: "reply two", ts: "1700000002.000100" },
          { text: "reply one", ts: "1700000001.000100" },
        ],
        ok: true,
      })
    );
    const client = new SlackClient("xoxb-test", { fetcher });
    const replies = await client.conversationsReplies(
      "C1",
      "1700000000.000100"
    );
    expect(replies.map((message) => message.text)).toEqual([
      "reply one",
      "reply two",
    ]);
    expect(replies.some((message) => message.ts === "1700000000.000100")).toBe(
      false
    );
  });
});

describe("SlackClient#chatPostMessage", () => {
  it("sends mrkdwn=false and truncates text over 3000 characters", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ channel: "C1", ok: true, ts: "1700000010.000100" })
      );
    const client = new SlackClient("xoxb-test", { fetcher });
    const longText = "x".repeat(3050);
    const result = await client.chatPostMessage({
      channel: "C1",
      text: longText,
    });
    const [call] = fetcher.mock.calls as FetchCall[];
    expect(call).toBeDefined();
    if (call) {
      const params = paramsFromCall(call);
      expect(params.get("mrkdwn")).toBe("false");
      // Slack silently truncates oversized text server-side; the client shapes
      // the request so the truncation point is predictable to the caller too.
      expect(params.get("text")).toHaveLength(3000);
    }
    expect(result).toEqual({ channel: "C1", ts: "1700000010.000100" });
  });
});

describe("SlackClient retry behaviour", () => {
  it("retries a 429 response and honours the Retry-After header via the injected sleep", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "ratelimited", ok: false }), {
          headers: { "Content-Type": "application/json", "retry-after": "2" },
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, team: "T1", team_id: "T1", user_id: "U0BOT" })
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new SlackClient("xoxb-test", {
      fetcher,
      maxAttempts: 2,
      sleep,
    });
    const result = await client.authTest();
    expect(result.botUserId).toBe("U0BOT");
    expect(fetcher).toHaveBeenCalledTimes(2);
    // Retry-After is a seconds count on the wire; the client must convert it to
    // milliseconds before handing it to sleep.
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("retries an ok:false ratelimited body even without an HTTP 429 status", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "ratelimited", ok: false }))
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, team: "T1", team_id: "T1", user_id: "U0BOT" })
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new SlackClient("xoxb-test", {
      fetcher,
      maxAttempts: 2,
      sleep,
    });
    await client.authTest();
    expect(fetcher).toHaveBeenCalledTimes(2);
    // No Retry-After header, so the client falls back to exponential backoff
    // starting at one second.
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("does not retry a non-retryable Slack error such as channel_not_found", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: "channel_not_found", ok: false })
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new SlackClient("xoxb-test", {
      fetcher,
      maxAttempts: 3,
      sleep,
    });
    await expect(client.authTest()).rejects.toMatchObject({
      retryable: false,
      slackError: "channel_not_found",
      status: 200,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("stops retrying once maxAttempts is reached and surfaces the final error", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "ratelimited", ok: false }), {
        headers: { "Content-Type": "application/json", "retry-after": "1" },
        status: 429,
      })
    );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new SlackClient("xoxb-test", {
      fetcher,
      maxAttempts: 2,
      sleep,
    });
    await expect(client.authTest()).rejects.toMatchObject({
      retryable: true,
      slackError: "ratelimited",
      status: 429,
    });
    // Two attempts total: the initial call plus exactly one retry.
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

describe("SlackClient malformed responses", () => {
  it("turns a non-JSON response body into a SlackApiError instead of an unhandled throw", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("not json", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    );
    const client = new SlackClient("xoxb-test", { fetcher, maxAttempts: 1 });
    await expect(client.authTest()).rejects.toMatchObject({
      slackError: "invalid_json_response",
    });
  });

  it("turns a non-object JSON body (e.g. an array) into a SlackApiError", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse([]));
    const client = new SlackClient("xoxb-test", { fetcher, maxAttempts: 1 });
    await expect(client.authTest()).rejects.toMatchObject({
      slackError: "invalid_json_response",
    });
  });
});

describe("exchangeOauthCode", () => {
  const input = {
    clientId: "client-1",
    clientSecret: "secret-1",
    code: "code-1",
    redirectUri: "https://app.example/api/setup/slack/callback",
  };

  it("returns the bot install on a successful exchange", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "xoxb-abc",
        app_id: "A1",
        bot_user_id: "U0BOT",
        ok: true,
        scope: "chat:write,channels:read",
        team: { domain: "acme", id: "T1", name: "Acme" },
        token_type: "bot",
      })
    );
    const access = await exchangeOauthCode(input, fetcher);
    expect(access).toEqual({
      app_id: "A1",
      bot_token: "xoxb-abc",
      bot_user_id: "U0BOT",
      scopes: "chat:write,channels:read",
      team_domain: "acme",
      team_id: "T1",
      team_name: "Acme",
    });
  });

  // A user-token grant cannot act as the workspace bot; the install must be
  // rejected rather than silently stored as if it could post messages.
  it("rejects when the grant is a user token rather than a bot token", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "xoxp-user",
        bot_user_id: "U0BOT",
        ok: true,
        team: { id: "T1" },
        token_type: "user",
      })
    );
    await expect(exchangeOauthCode(input, fetcher)).rejects.toMatchObject({
      slackError: "expected_bot_token",
    });
  });

  it("rejects when a required field is missing from the grant", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "xoxb-abc",
        ok: true,
        team: { id: "T1" },
        token_type: "bot",
      })
    );
    await expect(exchangeOauthCode(input, fetcher)).rejects.toMatchObject({
      slackError: "incomplete_install",
    });
  });

  it("rejects on a non-2xx response", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 400 }));
    await expect(exchangeOauthCode(input, fetcher)).rejects.toMatchObject({
      slackError: "http_400",
      status: 400,
    });
  });

  it("surfaces Slack's own error code when the grant itself is rejected", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "invalid_code", ok: false }));
    await expect(exchangeOauthCode(input, fetcher)).rejects.toMatchObject({
      slackError: "invalid_code",
    });
  });

  it("defaults to invalid_grant when Slack rejects the grant without an error code", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ok: false }));
    await expect(exchangeOauthCode(input, fetcher)).rejects.toMatchObject({
      slackError: "invalid_grant",
    });
  });
});

describe("SlackClient constructor", () => {
  it("throws when constructed with an empty token", () => {
    expect.assertions(2);
    try {
      // biome-ignore lint/complexity/noVoid: the constructor is only exercised for its throw.
      void new SlackClient("");
    } catch (error) {
      expect(error).toBeInstanceOf(SlackApiError);
      expect((error as SlackApiError).slackError).toBe("not_authed");
    }
  });
});
