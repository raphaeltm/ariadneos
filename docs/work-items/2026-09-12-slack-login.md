# Better Auth and Slack message ingestion

Status: in-review
Owner: Codex for Raphael
Source: User requested required Slack login, then live webhook message storage and staging deployment.
Branch: sam/look-agents-working-betterauth-mqjv37

## Intent
Implement Slack authentication and persistent message observations on the existing Cloudflare stack.

## Acceptance criteria
- Verify login on staging with real Slack credentials.
- Receive signed Slack messages durably and deduplicate retries.

## Decisions and rationale
- Better Auth handles identity; Slack signatures authenticate server event delivery.
- Store message changes as an append-only history separate from synthetic simulations.

## Changes
The following historical notes record implementation and verification milestones.

# Better Auth with required Slack login

- Task: Configure BetterAuth with Slack login integration
- Branch: `sam/look-agents-working-betterauth-mqjv37`
- Context: Reviewed active SAM agents and open PRs. PR #2 owns shared work logs/quality gates; PR #4 owns GitHub Actions staging/production deployment. This change adds auth to the existing Hono/React/D1 demo.
- Changes: Better Auth 1.7.4 with Slack as the only provider; encrypted OAuth tokens; account linking disabled; D1 `auth_*` migration; login gate and sign-out; verified-session API boundary; simulation ownership moved from arbitrary browser cookies to authenticated account IDs. Health remains public. Local dev host explicitly avoids canonical-domain redirect loops.
- Rationale: Slack login is the user's initial integration scope. Identity scopes do not ingest Slack messages; synthetic baseline remains shared demo data.
- Validation: 13 tests pass, TypeScript/Vite build passes, local D1 migrations pass, Wrangler deploy dry-run passes. Local Worker smoke checks reject anonymous access. Actual Better Auth/D1 OAuth initiation verified Slack endpoint, exact identity scopes, callback URL, state and cookie using dummy local credentials. npm audit reports zero vulnerabilities. Vite reports a non-blocking >500 kB frontend chunk warning.
- Pending: Real Slack OAuth callback/session/sign-out acceptance test requires Slack Client ID/Secret and callback registration. Follow `docs/slack-login.md`. Configure per-environment secrets and apply migration via GitHub Actions before rollout. No live deployment performed.
- Integration note for PR #4: Keep `nodejs_compat`; set staging `BETTER_AUTH_URL=https://staging.ariadneos.com`; provide BETTER_AUTH_SECRET, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET independently per environment. Auth configuration fails closed if absent. Preserve separate staging D1.

## Staging rollout follow-up

User requested merging main and deploying this branch to staging. Merged the deployment automation from main, reconciled Worker environment types, and fixed the merged duplicate vars block with explicit auth origins per environment. GitHub Actions now syncs supplied auth environment secrets to each Worker while preserving secrets already provisioned there. Generated a random staging BETTER_AUTH_SECRET directly into GitHub's staging environment without exposing it. Slack app secrets were absent in both the runtime and GitHub/Worker staging configuration; requested their location from the user. Dispatching this branch deploys only staging, with production restricted to main.

Staging Actions run 34691134416 deployed revision 7e1b763; live `/api/health` confirms staging, D1, and the exact revision. `/api/auth/get-session` returns 503 because Slack credentials are absent, so the deployment readiness gate correctly remains unsuccessful. Updated the inherited deployment checker to expect authenticated API protection (401) rather than public baseline reads and require an available auth session endpoint. Login testing remains blocked on Slack credentials, not on the merge or Worker deployment.

## Live Slack message ingestion

User expanded scope to webhook delivery and storing messages as they arrive. Added `/api/slack/events` before browser-only Origin/session middleware with independent raw-body HMAC verification, five-minute replay protection, signed URL verification, and a 1 MiB body bound. Acknowledges message events only after D1 persistence; failed writes allow Slack retries. Migration 0004 stores an append-only observation history of messages/edits/deletions, keyed by workspace and Slack event ID, isolated from simulation data. No read endpoint is exposed without a workspace authorization design. Added full staging manifest with `message.channels` and workflow synchronization of SLACK_SIGNING_SECRET.

Validation includes real SQLite schema/storage tests for duplicate retries, workspace separation, out-of-order edits/deletions, bad/stale signatures, missing configuration, signed challenges, payload limits, and storage failures. Staging webhook activation requires the Slack Signing Secret, manifest URL verification, workspace app installation, and inviting the bot into public channels. No private-message access or automated bot installation flow added.


## Validation
- Prior implementation: 26 tests, build, migrations, and Worker dry-run passed; staging revision db80797 and message table verified.
- Current integration/audit validation is recorded in 2026-09-12-slack-deployment-config.md.

## Risks and rollback
- Slack app secrets and real provider acceptance tests remain outstanding. Revert Worker code to roll back; keep additive auth/message tables and signing secrets stable.

## Next steps
- Complete GitHub environment audit and integration with main, then supply Slack credentials and verify login/event delivery.
