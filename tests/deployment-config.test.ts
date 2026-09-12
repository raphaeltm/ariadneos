import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";
import { deploymentSecrets } from "../scripts/deployment-config.ts";

const config = parse(readFileSync("wrangler.jsonc", "utf8")) as {
  durable_objects: { bindings: { class_name: string; name: string }[] };
  env: {
    production: {
      d1_databases: { database_id: string }[];
      durable_objects: { bindings: { class_name: string; name: string }[] };
      name: string;
    };
    staging: {
      d1_databases: { database_id: string }[];
      durable_objects: { bindings: { class_name: string; name: string }[] };
      name: string;
    };
  };
  migrations: { new_sqlite_classes: string[]; tag: string }[];
};

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
  it("keeps channel coordinator bindings isolated by Worker environment", () => {
    expect(config.durable_objects.bindings).toEqual([
      {
        class_name: "ChannelCoordinator",
        name: "CHANNEL_COORDINATOR",
      },
    ]);
    expect(config.migrations).toEqual([
      {
        new_sqlite_classes: ["ChannelCoordinator"],
        tag: "v1_channel_coordinator",
      },
    ]);
    expect(config.env.staging.name).toBe("ariadneos-staging");
    expect(config.env.production.name).toBe("ariadneos-demo");
    expect(config.env.staging.name).not.toBe(config.env.production.name);
    expect(config.env.staging.durable_objects.bindings).toEqual(
      config.durable_objects.bindings
    );
    expect(config.env.production.durable_objects.bindings).toEqual(
      config.durable_objects.bindings
    );
    expect(config.env.staging.d1_databases.at(0)?.database_id).not.toBe(
      config.env.production.d1_databases.at(0)?.database_id
    );
  });
});
