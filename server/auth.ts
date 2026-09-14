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

/**
 * Slack OIDC returns the signing user's workspace in the profile. Capturing it on
 * the user record is what makes tenancy work: a request is scoped to the Slack
 * workspace the session was created from, not to a server-wide configured channel.
 */
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
        mapProfileToUser: (profile) => ({
          slackTeamId: profile["https://slack.com/team_id"] ?? "",
          slackTeamName: profile["https://slack.com/team_name"] ?? "",
          slackUserId: profile["https://slack.com/user_id"] ?? "",
        }),
      },
    },
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    user: {
      additionalFields: {
        slackTeamId: { input: false, required: false, type: "string" },
        slackTeamName: { input: false, required: false, type: "string" },
        slackUserId: { input: false, required: false, type: "string" },
      },
      modelName: "auth_user",
    },
    verification: { modelName: "auth_verification" },
  });
}

export interface SessionIdentity {
  slackTeamId: string;
  slackUserId: string;
  userId: string;
}

/**
 * Resolves the caller's identity and Slack workspace from the session.
 *
 * Returns null when the session predates workspace capture or the profile did not
 * include a team, so callers reject the request instead of falling back to a
 * shared scope.
 */
export async function sessionIdentity(
  env: AuthEnv,
  headers: Headers
): Promise<SessionIdentity | null> {
  const session = await createAuth(env).api.getSession({ headers });
  if (!session) {
    return null;
  }
  const user = session.user as typeof session.user & {
    slackTeamId?: unknown;
    slackUserId?: unknown;
  };
  const slackTeamId =
    typeof user.slackTeamId === "string" ? user.slackTeamId : "";
  if (!slackTeamId) {
    return null;
  }
  return {
    slackTeamId,
    slackUserId: typeof user.slackUserId === "string" ? user.slackUserId : "",
    userId: session.user.id,
  };
}
