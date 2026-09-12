# Slack login

AriadneOS requires Slack login via Better Auth 1.7.4. Hono handles `/api/auth/*`; all other APIs except `/api/health` require a verified session. D1 stores auth records in `auth_*` tables separately from simulation records. Simulations belong to the authenticated user, not the old browser cookie. All users see the shared synthetic baseline; this is not a Slack workspace data tenancy implementation.

## Configure

1. Create an app at https://api.slack.com/apps (From scratch). In **OAuth & Permissions → Redirect URLs**, register:
   - Production: `https://ariadneos.com/api/auth/callback/slack`
   - Staging: `https://staging.ariadneos.com/api/auth/callback/slack`
   - Development: your HTTPS tunnel URL followed by `/api/auth/callback/slack` (Slack may reject plain HTTP).
2. Copy **Client ID** and **Client Secret** from **Basic Information** into the target Worker's secrets: `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`. Add `BETTER_AUTH_SECRET`, generated with `openssl rand -base64 32`. Keep it stable across releases; it signs sessions and encrypts OAuth tokens.
3. Set `BETTER_AUTH_URL` to the exact application origin in each environment. Production defaults to `https://ariadneos.com`; staging must override this with `https://staging.ariadneos.com`. Each environment needs separate D1 storage and secrets.
4. Apply D1 migration `0003_better_auth.sql` before deploying the Worker. Use the project's GitHub Actions deployment workflow for staging and production. Provision the three Worker secrets securely before rollout; do not put them in Wrangler vars or Vite variables. Missing config returns 503 and never enables anonymous access.
5. Locally: copy `.env.example` to `.dev.vars`, fill credentials, `npm run db:local`, then `npm run dev`. For a tunnel, use its HTTPS origin for `BETTER_AUTH_URL` and access the UI through that origin. Use the Worker-served UI so cookies and Origin checks match.
6. Verify login, cancellation, reload persistence, sign out, and rejected unauthenticated API access in staging. `npm run test:smoke -- https://staging.ariadneos.com` checks health and rejected access; supply `ARIADNE_TEST_COOKIE` privately for full demo checks with a fresh test account.

Only `openid profile email` identity scopes are requested. No bot token, message ingestion, channel permissions, or Slack notifications are configured. Workspace selection is not an access restriction: any Slack identity allowed by the Slack app can sign in. A future private workspace rollout needs an explicit server-side membership policy.

The schema is generated from the pinned dependency with `npx tsx scripts/generate-auth-schema.ts` (Node 22+); do not overwrite an already-applied migration after a dependency upgrade—create a new migration instead.

References: [Better Auth Slack](https://better-auth.com/docs/authentication/slack), [Better Auth database](https://better-auth.com/docs/concepts/database), [Slack OpenID flow](https://docs.slack.dev/authentication/sign-in-with-slack/). Slack identity and bot scopes must use separate authorization flows.
