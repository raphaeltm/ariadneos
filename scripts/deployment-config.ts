import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const authNames = [
  "BETTER_AUTH_SECRET",
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "SLACK_SIGNING_SECRET",
] as const;
const cloudflareNames = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
] as const;
const stagingAgentNames = ["OPENROUTER_API_KEY"] as const;
export function deploymentSecrets(env: NodeJS.ProcessEnv) {
  if (env.DEPLOY_ENV !== "staging" && env.DEPLOY_ENV !== "production") {
    throw new Error("DEPLOY_ENV must be staging or production.");
  }
  const requiredNames = [
    ...cloudflareNames,
    ...authNames,
    ...(env.DEPLOY_ENV === "staging" ? stagingAgentNames : []),
  ] as const;
  const missing = requiredNames.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing GitHub ${env.DEPLOY_ENV} environment secrets: ${missing.join(", ")}. Add them under Settings > Environments > ${env.DEPLOY_ENV}, then rerun Deploy.`
    );
  }
  if ((env.BETTER_AUTH_SECRET?.length ?? 0) < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  const syncedNames = [
    ...authNames,
    ...(env.OPENROUTER_API_KEY?.trim() ? stagingAgentNames : []),
  ];
  return Object.fromEntries(syncedNames.map((name) => [name, env[name]]));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const secrets = deploymentSecrets(process.env);
    if (process.argv[2] === "sync") {
      const result = spawnSync(
        "npx",
        [
          "--no-install",
          "wrangler",
          "secret",
          "bulk",
          "--env",
          process.env.DEPLOY_ENV ?? "",
        ],
        {
          encoding: "utf8",
          input: JSON.stringify(secrets),
          stdio: ["pipe", "inherit", "inherit"],
        }
      );
      if (result.status !== 0) {
        throw new Error("Worker secret synchronization failed.");
      }
    } else if (process.argv[2] !== "check") {
      throw new Error("Usage: tsx scripts/deployment-config.ts check|sync");
    }
    console.log(
      `Deployment secrets ${process.argv[2] === "sync" ? "synchronized" : "configured"} for ${process.env.DEPLOY_ENV}.`
    );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Deployment configuration failed."
    );
    process.exitCode = 1;
  }
}
