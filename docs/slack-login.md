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

## Live message delivery (Events API)

Import `docs/slack-app-staging.yaml` into the Slack app manifest. This subscribes the bot to `message.channels` at `https://staging.ariadneos.com/api/slack/events`. Slack's **Incoming Webhooks** feature sends messages *into Slack*; receiving messages uses **Event Subscriptions** instead.

1. Create the Slack app first using the name/bot/scopes/redirect portion of the manifest if Slack cannot verify the event URL yet.
2. In **Basic Information → App Credentials**, copy the **Signing Secret** into the GitHub staging environment secret `SLACK_SIGNING_SECRET`. This is distinct from the Client Secret. The deployment workflow syncs it to the staging Worker.
3. Deploy the branch through GitHub Actions. Migration `0004_slack_message_events.sql` creates the durable message-event table. Webhook delivery is independent of browser login and only needs the signing secret.
4. Save the full manifest, or enable **Event Subscriptions**, enter the request URL, wait for **Verified**, and add bot event **message.channels**.
5. **Install App to Workspace** (or reinstall to grant changed scopes), then invite `@AriadneOS` into each public channel to observe. No bot token is required by the receive-only endpoint; Slack grants delivery based on the installed bot scopes. A separate automated bot installation OAuth flow is not yet implemented.
6. Send a test message yourself. Check D1 with `SELECT team_id, event_id, channel_id, message_ts, subtype, received_at FROM slack_message_events ORDER BY received_at DESC LIMIT 10;` in the staging database. Send/edit/delete the test message and confirm separate events; retries of one event must not add rows.

Receiver checks the raw-body HMAC and a five-minute timestamp window, supports signed URL challenges, limits bodies to 1 MiB, and awaits the D1 insert before returning 200. Failed writes return 500 so Slack can retry. Keep the request path fast: Slack requires acknowledgement within three seconds. No model calls or Slack API lookups run on this path. For higher volume, introduce a durable queue before downstream processing.

Storage is an append-only observation log partitioned by team, channel, and message timestamp, with a unique `(team_id, event_id)` retry key. It preserves new messages, replies, bot messages, edits and deletion observations as delivered, including their event JSON. Original text remains in earlier records after a deletion event; this is an observation history, not a current-state mirror. It is not subject to the synthetic demo's daily purge. File metadata in delivered events is retained; file contents are not downloaded. No historical backfill, private-channel/DM subscription, message display, or inference pipeline is included yet. No read API exposes stored Slack data until workspace authorization is implemented.

For production, create/configure the appropriate Slack app and signing secret separately, and replace both manifest URLs with the production origin.

References: [Slack request signatures](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [Events API delivery](https://docs.slack.dev/apis/events-api/), [public-channel message events](https://docs.slack.dev/reference/events/message.channels/).
