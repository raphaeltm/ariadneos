import { afterEach, describe, expect, it, vi } from "vitest";
import { postPersonaMessage, slackPermalink } from "../server/slack/post.ts";

const persona = {
  emoji: ":woman_firefighter:",
  name: "Priya Raman",
  personId: "per_priya",
};

const input = {
  channel: "C0C1DFQL72N",
  persona,
  sessionId: "ses_helios_p1_v2",
  text: "vertex checkout throwing 500s since 09:14",
};

function mockSlack(payload: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    json: () => Promise.resolve(payload),
    ok,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("slack persona posting", () => {
  it("overrides author identity per message so six people are six authors", async () => {
    const fetchMock = mockSlack({ ok: true, ts: "1757671234.000200" });

    const result = await postPersonaMessage(
      { SLACK_BOT_TOKEN: "xoxb-test", SLACK_WORKSPACE: "ariadneos" },
      input
    );

    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.username).toBe("Priya Raman");
    expect(body.icon_emoji).toBe(":woman_firefighter:");
    expect(body.channel).toBe("C0C1DFQL72N");
  });

  it("stamps session and person into metadata so case correlation is data", async () => {
    const fetchMock = mockSlack({ ok: true, ts: "1757671234.000200" });

    await postPersonaMessage({ SLACK_BOT_TOKEN: "xoxb-test" }, input);

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.metadata.event_type).toBe("ariadne_sim");
    expect(body.metadata.event_payload).toEqual({
      person_id: "per_priya",
      session_id: "ses_helios_p1_v2",
    });
  });

  it("returns a permalink that matches the archive format", async () => {
    mockSlack({ ok: true, ts: "1757671234.000200" });

    const result = await postPersonaMessage(
      { SLACK_BOT_TOKEN: "xoxb-test", SLACK_WORKSPACE: "ariadneos" },
      input
    );

    expect(result.ok && result.permalink).toBe(
      "https://ariadneos.slack.com/archives/C0C1DFQL72N/p1757671234000200"
    );
  });

  it("reports missing configuration instead of calling Slack", async () => {
    const fetchMock = mockSlack({ ok: true, ts: "1" });

    const result = await postPersonaMessage({}, input);

    expect(result).toEqual({
      error: "SLACK_BOT_TOKEN is not configured.",
      ok: false,
      reason: "no_token",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a Slack API error without throwing", async () => {
    mockSlack({ error: "channel_not_found", ok: false });

    const result = await postPersonaMessage(
      { SLACK_BOT_TOKEN: "xoxb-test" },
      input
    );

    expect(result).toEqual({
      error: "channel_not_found",
      ok: false,
      reason: "api_error",
    });
  });

  it("surfaces a transport failure without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );

    const result = await postPersonaMessage(
      { SLACK_BOT_TOKEN: "xoxb-test" },
      input
    );

    expect(result).toEqual({
      error: "network down",
      ok: false,
      reason: "transport_error",
    });
  });
});

describe("slackPermalink", () => {
  it("drops the dot from the timestamp", () => {
    expect(slackPermalink("ariadneos", "C123", "1757671251.000300")).toBe(
      "https://ariadneos.slack.com/archives/C123/p1757671251000300"
    );
  });
});
