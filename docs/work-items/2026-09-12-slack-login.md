# Better Auth with required Slack login

- Task: Configure BetterAuth with Slack login integration
- Branch: `sam/look-agents-working-betterauth-mqjv37`
- Context: Reviewed active SAM agents and open PRs. PR #2 owns shared work logs/quality gates; PR #4 owns GitHub Actions staging/production deployment. This change adds auth to the existing Hono/React/D1 demo.
- Changes: Better Auth 1.7.4 with Slack as the only provider; encrypted OAuth tokens; account linking disabled; D1 `auth_*` migration; login gate and sign-out; verified-session API boundary; simulation ownership moved from arbitrary browser cookies to authenticated account IDs. Health remains public. Local dev host explicitly avoids canonical-domain redirect loops.
- Rationale: Slack login is the user's initial integration scope. Identity scopes do not ingest Slack messages; synthetic baseline remains shared demo data.
- Validation: 13 tests pass, TypeScript/Vite build passes, local D1 migrations pass, Wrangler deploy dry-run passes. Local Worker smoke checks reject anonymous access. Actual Better Auth/D1 OAuth initiation verified Slack endpoint, exact identity scopes, callback URL, state and cookie using dummy local credentials. npm audit reports zero vulnerabilities. Vite reports a non-blocking >500 kB frontend chunk warning.
- Pending: Real Slack OAuth callback/session/sign-out acceptance test requires Slack Client ID/Secret and callback registration. Follow `docs/slack-login.md`. Configure per-environment secrets and apply migration via GitHub Actions before rollout. No live deployment performed.
- Integration note for PR #4: Keep `nodejs_compat`; set staging `BETTER_AUTH_URL=https://staging.ariadneos.com`; provide BETTER_AUTH_SECRET, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET independently per environment. Auth configuration fails closed if absent. Preserve separate staging D1.
