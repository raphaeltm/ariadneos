# Operating AriadneOS

Marketing homepage: **https://ariadneos.com**

Application: **https://ariadneos.com/app**

AriadneOS observes real Slack channels. There is no demo mode and no simulated
data: every activity, transition and citation in a graph traces back to a message
someone posted in a channel the workspace connected. A new deployment starts
empty, and stays empty until a workspace completes setup.

## What a workspace has to do

Open `/app` and sign in with Slack, then work through the four steps on the
**Setup** tab.

1. **Connect Slack.** Installs the Slack app into your workspace and stores a bot
   token. The install requests these scopes, and setup warns if any are missing:

   | Scope | Why |
   | --- | --- |
   | `channels:history`, `groups:history` | Read the messages that describe work |
   | `channels:read`, `groups:read` | List the channels the bot can see |
   | `users:read` | Resolve Slack user ids to people's names |
   | `chat:write` | Let the agent answer in the channel |
   | `team:read` | Read the workspace name and domain for permalinks |

2. **Define the process.** Create a project, then name the steps the process is
   meant to follow, in order, with the role expected to perform each one. This is
   the *designed* plane. It is what observed behaviour gets compared against, so
   the conformance overlay is only meaningful once it exists. Roles are created
   from the role you type on an activity.

3. **Connect a channel.** Invite the bot to the channel, sync the channel list,
   then enable the channel and bind it to a project. Optionally import recent
   history: signed events only cover messages that arrive after install, so
   without a backfill the graph starts from now. Backfill reads a bounded window
   (14 days) of `conversations.history` plus thread replies.

4. **Assign roles.** Slack tells us who posted, not what they do. Assign each
   resolved person a role so role deviations can be scored.

Setup reports `ready` once there is an install, at least one enabled channel bound
to a project, a workflow with activities, and an extraction key configured.

## Required Worker configuration

| Name | Kind | Required for |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | secret | Sign-in (32+ characters) |
| `BETTER_AUTH_URL` | var | Sign-in and the OAuth redirect URI |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | secret | Sign-in and the bot install |
| `SLACK_SIGNING_SECRET` | secret | Accepting Slack events |
| `OPENROUTER_API_KEY` | secret | **Extraction.** Without it messages are stored and queued but no steps are produced, and the app reports the gap on Setup and Settings |

Optional tuning: `EXTRACTION_WINDOW_SIZE`, `EXTRACTION_MAX_SESSIONS_PER_RUN`,
`EXTRACTION_MAX_MODEL_CALLS`, `OUTBOX_MAX_PER_RUN`.

Point the Slack app's Event Subscriptions request URL at
`https://YOUR-HOST/api/slack/events` and its OAuth redirect URL at
`https://YOUR-HOST/api/setup/slack/callback`. Subscribe to `message.channels`,
`message.groups`, `channel_rename`, `app_uninstalled` and `tokens_revoked`.

## How a message becomes a step

1. Slack posts a signed event to `/api/slack/events`. The signature and a 5-minute
   replay window are checked before anything is stored.
2. The raw event is appended to `slack_message_events`. Nothing is overwritten, so
   edits, deletions and out-of-order deliveries keep their own provenance.
3. If the channel is enabled and bound to a project, the message is projected to
   its current state, its author is resolved through `users.info`, and it is
   assigned to a process session. A thread is one case; channel-level messages
   group by the channel's idle window.
4. A `pm_processing` checkpoint is queued and the channel's Durable Object woken.
5. The coordinator's extraction deadline drains the queue: one model call per
   session window produces steps with message citations, which are canonicalized
   against the workspace's authored activities and written to `pm_step` and
   `pm_step_evidence`.
6. The rebuilt graph and conformance are committed to the journal, so connected
   browsers see them over SSE without polling.

A channel that is not enabled, or a workspace with no install, stores the raw
event and derives nothing. That is deliberate: a bot present in extra channels
must not mine them.

## Local development

Requires Node.js 22 and npm.

```sh
npm ci
npm run db:local
npm run dev
```

Open `/app` on the URL Wrangler prints (normally `http://localhost:8787/app`).
The root `/` is the marketing homepage. `npm run dev` builds the frontend first;
for hot reload keep the Worker running and run `npm run dev:ui` in another
terminal, which proxies `/api` to the local Worker.

Local Slack events need a public URL for Slack to reach. Either point a tunnel at
the dev server, or exercise the pipeline through the tests, which run the real
receiver against the real migrations.

The Workers AI binding used by `/api/ask` calls Cloudflare even in local
development. Authenticate Wrangler or supply `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` in your shell. If inference fails, the app returns a
computed statistical summary and labels it as one; a failed call never blocks
browsing or mining.

## Deploy

For staging, production and rollback see [Cloudflare deployments](deployment.md).
Migrations are applied by the deploy workflow before the Worker is published.

Deploying publishes an app that reads whatever Slack workspaces install it. Treat
the D1 database as containing customer message content: it stores message text,
author names and permalinks for every observed channel.

## Verification

```sh
npm run check          # lint, types, auth schema, coverage, guardrails, migrations, build
npm run test:migration # fresh and upgrade migration smoke on local D1
npm run test:smoke     # with Wrangler running on 127.0.0.1:8787
npm run check:repo     # the complete gate, including Python checks and browser tests
```

The smoke test checks health, that anonymous access is refused, origin
enforcement, body limits and error shapes. It does not consume AI inference.

## API

| Endpoint | Behavior |
| --- | --- |
| `GET /api/health` | Verifies D1 access. Public. |
| `POST /api/slack/events` | Signed Slack event receiver. HMAC authenticated. |
| `GET /api/setup/status` | Setup progress for the caller's workspace. |
| `GET /api/setup/slack/install` | Returns the Slack authorize URL. |
| `POST /api/setup/channels/:id` | Enable or disable an observed channel. |
| `POST /api/setup/channels/:id/backfill` | Bounded history import. |
| `POST /api/setup/projects`, `/workflows`, `/policies` | Author the designed process. |
| `GET /api/snapshot` | Graph, sessions, messages, steps and conformance. |
| `GET /api/graph/designed`, `/discovered`, `/overlay` | Individual planes. |
| `GET /api/stream` | SSE journal replay from a cursor. |
| `POST /api/model/edit`, `/api/model/edit/undo` | Curate the designed graph. |
| `POST /api/steps/:id/status` | Confirm or reject an extracted step. |
| `POST /api/ask` | Question answered from the observed graph. |
| `GET /api/settings` | Runtime, install and extraction status. |

Every endpoint other than health and the Slack receiver requires a Slack session,
and is scoped to the workspace that session was created from.
