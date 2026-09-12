import { describe, expect, it } from "vitest";
import { deploymentSecrets } from "../scripts/deployment-config.ts";

const configured = {
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-thirty-two-characters",
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  CLOUDFLARE_API_TOKEN: "test-cloudflare-token",
  DEPLOY_ENV: "staging",
  SLACK_CLIENT_ID: "test-client",
  SLACK_CLIENT_SECRET: "private-client-value",
  SLACK_SIGNING_SECRET: "private-signing-value",
};
describe("deployment configuration", () => {
  it("reports every missing key without printing configured values", () => {
    expect(() =>
      deploymentSecrets({
        DEPLOY_ENV: "staging",
        SLACK_CLIENT_SECRET: configured.SLACK_CLIENT_SECRET,
      })
    ).toThrow(
      "Missing GitHub staging environment secrets: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, BETTER_AUTH_SECRET, SLACK_CLIENT_ID, SLACK_SIGNING_SECRET."
    );
  });
  it.each(["staging", "production"])(
    "syncs only Worker auth secrets for %s",
    (target) => {
      expect(deploymentSecrets({ ...configured, DEPLOY_ENV: target })).toEqual({
        BETTER_AUTH_SECRET: configured.BETTER_AUTH_SECRET,
        SLACK_CLIENT_ID: configured.SLACK_CLIENT_ID,
        SLACK_CLIENT_SECRET: configured.SLACK_CLIENT_SECRET,
        SLACK_SIGNING_SECRET: configured.SLACK_SIGNING_SECRET,
      });
    }
  );
  it("rejects invalid target and weak signing secret", () => {
    expect(() =>
      deploymentSecrets({ ...configured, DEPLOY_ENV: "typo" })
    ).toThrow("DEPLOY_ENV must be staging or production.");
    expect(() =>
      deploymentSecrets({ ...configured, BETTER_AUTH_SECRET: "short" })
    ).toThrow("at least 32 characters");
  });
});
