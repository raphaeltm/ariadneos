# Complete Slack and GitHub setup

Use two Slack apps: **AriadneOS Staging** and **AriadneOS**. A Slack app has a single Events API request URL; separate apps keep staging and production message delivery independent. Both may be installed into the same Slack workspace if desired.

## 1. Create each Slack app

At https://api.slack.com/apps choose **Create New App → From a manifest**, choose your workspace, then upload the corresponding bootstrap manifest:

- Staging: [slack-app-staging-bootstrap.yaml](slack-app-staging-bootstrap.yaml)
- Production: [slack-app-production-bootstrap.yaml](slack-app-production-bootstrap.yaml)

The bootstrap files omit Event Subscriptions so app creation does not depend on a working, secret-configured endpoint. The full manifests are applied after deployment.

## 2. Save three Slack values in each GitHub environment

In Slack **Basic Information → App Credentials**, copy these values into **GitHub → Settings → Environments → staging/production → Environment secrets**:

| GitHub environment secret | Slack value | User action |
| --- | --- | --- |
| `SLACK_CLIENT_ID` | Client ID | Add, using the app for that environment |
| `SLACK_CLIENT_SECRET` | Client Secret | Add, using the app for that environment |
| `SLACK_SIGNING_SECRET` | Signing Secret | Add, using the app for that environment |
| `BETTER_AUTH_SECRET` | Generated application secret, not from Slack | Already created separately in both environments; leave unchanged |

[GitHub environment settings](https://github.com/raphaeltm/ariadneos/settings/environments).

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` already exist as repository secrets and are inherited by both deployment jobs. No copying is needed. The workflow syncs the four app secrets above into the environment's Worker. Do not put secrets in GitHub Variables, Wrangler vars, client-side Vite config, or the Slack manifest. Saving a GitHub secret does not immediately update a Worker: run Deploy afterward.

The current receive-only integration needs no `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, Slack verification token, Incoming Webhook URL, or Socket Mode token. Client ID/Secret authenticate login; Signing Secret verifies Events API requests. Automated bot installation OAuth and historical backfill are not implemented yet.

## 3. Deploy with GitHub Actions

Open [Actions → Deploy](https://github.com/raphaeltm/ariadneos/actions/workflows/deploy.yml), choose **Run workflow**, and select `sam/look-agents-working-betterauth-mqjv37` while this PR is pending. This deploys staging only. The branch's workflow is used; dispatching main before the auth PR merges uses the older implementation.

After this PR merges, ready same-repository PRs deploy staging automatically; drafts can be dispatched manually. Merge/push to main validates and deploys staging, then production after staging passes. The production job permits `main` only. No manual approval wait was added. GitHub denied this agent permission to add an environment-level branch restriction (HTTP 403). A repository administrator can add **production → Deployment branches and tags → Selected branches and tags → main (branch)** for additional enforcement.

Actions runs full quality gates, checks all required secret names before migrations/Worker changes, applies the environment's D1 migrations, syncs secrets, deploys the exact revision, then checks TLS, revision, frontend, auth availability, anonymous API rejection, and a signed webhook URL challenge. It rejects unsigned events too. The challenge does not write message data. These automated checks do not replace a real Slack login and message-delivery acceptance test.

## 4. Enable Event Subscriptions and install the bot

After deployment, open Slack **App Manifest** and apply the full environment manifest:

- Staging: [slack-app-staging.yaml](slack-app-staging.yaml)
- Production: [slack-app-production.yaml](slack-app-production.yaml)

| Configuration | Staging | Production |
| --- | --- | --- |
| Login redirect URL | `https://staging.ariadneos.com/api/auth/callback/slack` | `https://ariadneos.com/api/auth/callback/slack` |
| Events request URL | `https://staging.ariadneos.com/api/slack/events` | `https://ariadneos.com/api/slack/events` |
| Application URL | `https://staging.ariadneos.com/app` | `https://ariadneos.com/app` |
| Worker | `ariadneos-staging` | `ariadneos-demo` (historical name; see [deployment](deployment.md)) |
| Database | `ariadneos-staging` | `ariadneos-demo` (historical name) |

These origins, Worker names, separate D1 bindings, `nodejs_compat`, and per-environment `BETTER_AUTH_URL` are already configured in `wrangler.jsonc`. Actions supplies `RELEASE_SHA`; no GitHub environment variables are required.

Confirm **Event Subscriptions → Enable Events** shows **Verified** for the request URL, and **Subscribe to bot events** includes `message.channels`. Bot scopes are `channels:read`, `channels:history`, and `users:read`. Login requests `openid profile email` through its separate OpenID flow.

Under **OAuth & Permissions**, choose **Install to Workspace** or **Reinstall to Workspace** after changing permissions. If your workspace requires administrator approval, obtain it in Slack. Invite the bot into each public channel whose messages should be captured. Existing history is not backfilled; private channels and DMs are not subscribed. Leave Socket Mode and Incoming Webhooks off. If expanding beyond the development workspace, Slack app distribution must also be configured; that is not needed for the initial single-workspace test.

## 5. Test end to end

1. Open `/app`, choose **Sign in with Slack**, complete consent, and verify return to `/app`.
2. Refresh to verify session persistence; sign out and confirm `/app` shows login again.
3. In a channel where the bot is a member, post, edit, and delete a test message yourself.
4. Confirm rows appear in the matching D1 `slack_message_events` table. A read-only metadata query is `SELECT team_id,event_id,channel_id,message_ts,subtype,received_at FROM slack_message_events ORDER BY received_at DESC LIMIT 10;`.
5. Confirm Slack **Event Subscriptions** shows successful delivery, then check the app: an enabled channel's messages appear in the activity list and, once extraction runs, as steps on the graph with links back to Slack.

Message storage is an append-only observation history: earlier message contents remain when later edits/deletions arrive. See [implementation details and limits](slack-login.md#live-message-delivery-events-api).

## Audit status

Both GitHub environments exist and now contain all four required app secrets: BETTER_AUTH_SECRET, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and SLACK_SIGNING_SECRET. The Slack app owner supplied the Slack values during the audit. SLACK_APP_ID is also present but is not required or consumed by the current implementation. Cloudflare repository secrets are present.

Actions run 34692614105 passed validation and staging deployment for application revision a72829a, including signed webhook verification and anonymous API checks. The login button reaches Slack's workspace sign-in page. Production credentials are staged in GitHub; the production Worker will receive them through the main-only deployment after this PR merges. Full user login/consent and real channel-event delivery still need the app owner's acceptance test. Secret values cannot be read back from GitHub, so presence alone is not proof of valid Slack credentials.
