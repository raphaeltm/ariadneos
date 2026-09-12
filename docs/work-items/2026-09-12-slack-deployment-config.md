# Slack environment and deployment configuration audit

Status: in-review
Owner: Codex for Raphael
Source: User requested a complete Slack configuration checklist and verification of GitHub environments/Actions.
Branch: sam/look-agents-working-betterauth-mqjv37

## Intent
Make Slack setup reproducible for staging and production, identify missing credentials, and ensure Actions validates and synchronizes the correct environment secrets.

## Acceptance criteria
- Both GitHub environments exist and have separate Better Auth signing secrets.
- Deployment checks required secrets before changing the target Worker or database.
- Slack manifests and setup checklist cover login, event delivery, install, and verification.
- Integrate main's quality workflow and marketing/app route split without bypassing auth or checks.

## Decisions and rationale
- Use separate Slack apps for staging and production because each app has one Events API request URL.
- GitHub environment secrets are the source of truth; missing values fail before deployment instead of silently preserving stale Worker config.
- Keep production main-only and staging deployments available through explicit branch dispatch.

## Changes
- Audited GitHub and Worker secret names without retrieving or logging secret values.
- Integrated current main quality gates and /app routing with Slack authentication, including real signed local test sessions for the API/browser gates.
- Generated production BETTER_AUTH_SECRET separately; staging signing secret preserved. Added preflight validation, explicit four-secret synchronization, signed remote webhook challenge and rejection checks, and complete environment-specific manifests/checklist.

## Validation
- Initial audit: repository Cloudflare credentials exist; staging contains only BETTER_AUTH_SECRET; production contains no auth secrets. Slack credentials are missing in both Workers.
- `npm run check:repo` passed: Python/work-item checks, Biome, strict TypeScript, 48 unit tests with coverage thresholds, negative guardrail probes, build, dependency audit (zero vulnerabilities), isolated Worker/D1 smoke checks, and all 5 Chromium tests.
- `python3 scripts/check_work_items.py --base origin/main` and staged diff whitespace checks passed.
- New sign-out regression found an off-viewport control; moved account actions into the top bar. Test harness now retains its dynamic port in the forwarded origin, so real Better Auth CSRF checks stay enabled.
- Production environment branch restriction API calls returned HTTP 403; no environment branch policy was changed. Workflow main-only condition is preserved.

- Live Actions run 34692614105 passed full validation and staging deployment for a72829a, including signed webhook challenge and anonymous API rejection. An initial smoke request returned 200 instead of 401; subsequent live probes and rerunning the same job passed with no relaxed checks. Production was skipped as intended for this branch.
- Browser verification: staging /app shows the Slack login screen; clicking login reaches Slack's workspace sign-in page. Full Slack consent/callback is left to the user. Both GitHub environments now contain all required secret names; staging Worker names verified. Production values await the main-only deployment.

## Risks and rollback
- Real Slack login and delivery remain unverified until the app credentials are supplied and a user completes the Slack flow.
- Revert code changes to undo workflow behavior; do not rotate or remove established signing secrets during rollback.

## Next steps
- Slack credentials were supplied in both GitHub environments during the audit. User completes Slack URL verification, workspace installation, channel invitations, and real login/message-delivery acceptance tests.
- A repository administrator may add production environment main-only branch restriction; workflow already enforces it.

## Merge acceptance — 2026-09-12
- User explicitly authorized merging PR #5 after reviewing staging login and webhook delivery findings.
- Real Slack login succeeded at 12:13:42 UTC. Slack deliveries at 12:34–12:35 reached staging but returned 403 after main deployments replaced the integration branch. No message rows were stored at that check.
- Merged current origin/main (a0ccbcd) without conflicts; incoming changes are specifications and work records. Run complete gates before merging and verify both Actions deployments, including signed Slack URL challenges.
- Merge validation: `npm run check:repo` passed, including all 5 Chromium tests; work-item context and whitespace checks passed. Real Slack login is confirmed; message persistence awaits the restored receiver deployment and a new Slack delivery.
