import { betterAuth } from "better-auth";

export type AuthEnv = {
  DB: D1Database;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
};

export function authConfigured(env: AuthEnv) {
  return Boolean(
    env.BETTER_AUTH_URL &&
    env.BETTER_AUTH_SECRET?.length >= 32 &&
    env.SLACK_CLIENT_ID &&
    env.SLACK_CLIENT_SECRET,
  );
}

export function createAuth(env: AuthEnv) {
  return betterAuth({
    database: env.DB,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    emailAndPassword: { enabled: false },
    socialProviders: {
      slack: {
        clientId: env.SLACK_CLIENT_ID,
        clientSecret: env.SLACK_CLIENT_SECRET,
      },
    },
    user: { modelName: "auth_user" },
    session: { modelName: "auth_session" },
    account: {
      modelName: "auth_account",
      encryptOAuthTokens: true,
      accountLinking: { enabled: false },
    },
    verification: { modelName: "auth_verification" },
  });
}
