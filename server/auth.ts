import { betterAuth } from "better-auth";

export interface AuthEnv {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  DB: D1Database;
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
}

export function authConfigured(env: AuthEnv) {
  return Boolean(
    env.BETTER_AUTH_URL &&
      env.BETTER_AUTH_SECRET?.length >= 32 &&
      env.SLACK_CLIENT_ID &&
      env.SLACK_CLIENT_SECRET
  );
}

export function createAuth(env: AuthEnv) {
  return betterAuth({
    account: {
      accountLinking: { enabled: false },
      encryptOAuthTokens: true,
      modelName: "auth_account",
    },
    baseURL: env.BETTER_AUTH_URL,
    database: env.DB,
    emailAndPassword: { enabled: false },
    secret: env.BETTER_AUTH_SECRET,
    session: { modelName: "auth_session" },
    socialProviders: {
      slack: {
        clientId: env.SLACK_CLIENT_ID,
        clientSecret: env.SLACK_CLIENT_SECRET,
      },
    },
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    user: { modelName: "auth_user" },
    verification: { modelName: "auth_verification" },
  });
}
