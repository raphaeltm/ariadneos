# Cloudflare deployments

| Environment | URL | Worker | D1 database |
| --- | --- | --- | --- |
| Staging | https://staging.ariadneos.com | `ariadneos-staging` | `ariadneos-staging` |
| Production | https://ariadneos.com | `ariadneos-demo` | `ariadneos-demo` |

Production keeps the existing database and domain. Staging has separate installs, observations, migrations, quotas and cleanup. Workers AI is available in both environments and uses the same Cloudflare account billing.

Both databases now hold real Slack message content for any workspace that installs
the app. Treat them as customer data: message text, author names and permalinks are
stored for every observed channel. Install the app into a workspace you are
authorized to observe.

The production Worker and D1 database are still named `ariadneos-demo`. That name
is historical and is the last remaining "demo" string in the deployment. Renaming a
Cloudflare Worker creates a new Worker, which would orphan the channel Durable
Object namespace and require reattaching the custom domains, so it is deliberately
left as a separate, manually sequenced change rather than bundled with a code
deploy.

## Automatic deployment

The [Deploy workflow](../.github/workflows/deploy.yml) runs:

| Trigger | Result |
| --- | --- |
| Open, update, reopen, or mark ready a non-draft PR targeting main, from this repository | Validate and deploy to shared staging. |
| Merge to main (a push to main) | Validate, deploy staging, verify it, then deploy the same revision to production. |
| Actions → Deploy → Run workflow, on main | Run the full staging → production pipeline again. |
| Manual run on another branch | Deploy staging only. |
| Fork PR or Dependabot PR | Deployment skipped; ordinary Checks still run. |

The workflow becomes available for main pushes and manual dispatch once merged. Staging always shows the last successful deployment; it is not a separate URL per pull request. One global concurrency group serializes deployment pipelines, with cancellation of a running deployment disabled. GitHub may replace an older pending run with a newer pending run; this is continuous deployment of the latest queued work, not a guarantee that every intermediate commit is deployed.

Validation runs npm ci, available lint checks, tests, TypeScript checking, and the production build. It also runs the shared quality script if it has been merged from the repository-quality PR. The validated frontend artifact is used for both staging and production; the Worker source comes from the same workflow commit.

Each deployment applies that environment's D1 migrations before publishing. Readiness checks require a valid HTTPS response, the expected environment and commit from `/api/health`, and a working frontend bundle. There is no seeded process data to check: a deployment starts empty until a workspace connects a channel. Staging additionally verifies that anonymous access is refused. Production verification is read-only and does not consume AI inference.

A failed staging build, migration, deployment, or smoke check prevents production. A failure after production deploy is reported in Actions but does not automatically roll back.

## Credentials and GitHub environments

These repository Actions secrets were configured from the existing workspace credentials without printing their values:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Only migration/deploy steps receive these secrets through their environment. Jobs have read-only repository permissions; checkout does not persist its GitHub token. No secrets are stored in Wrangler vars, source files, work-item logs, or build artifacts.

Jobs reference GitHub environments `staging` and `production` for deployment tracking. GitHub creates a referenced environment on first use. Production's main-only guard is in workflow code. The current GitHub integration returned HTTP 403 when attempting to administer environments, so environment-level branch restrictions or approval rules were **not** configured.

Repository secrets are available to eligible repository workflows; contributors trusted to change workflow code can change its guards. The Cloudflare token is shared across the two deployments, so separate Workers/databases provide data separation, not a credential security boundary. A repository administrator can later restrict the production GitHub environment to main and move credentials to environment secrets with the same names. Do not enable a required approval rule if automatic deployment on merge is desired.

For rotation, with the new token already in your shell, use stdin rather than a command-line value:

```sh
printf '%s' "$CLOUDFLARE_API_TOKEN" | gh secret set CLOUDFLARE_API_TOKEN --repo raphaeltm/ariadneos
printf '%s' "$CLOUDFLARE_ACCOUNT_ID" | gh secret set CLOUDFLARE_ACCOUNT_ID --repo raphaeltm/ariadneos
```

## Manual operations

Normally let Actions deploy. For an authorized manual repair, explicitly choose the environment:

```sh
npm ci
npm test
npm run build
npm run db:staging
npm run deploy:staging
# Production equivalents:
# npm run db:production
# npm run deploy:production
```

The existing unqualified commands still target the production default for compatibility. Prefer explicit environment commands. Never point staging bindings at the production database. Non-inherited Wrangler bindings (D1, vars, AI) and domain routes are listed explicitly for each environment.

Actions stamps `APP_ENV` and `RELEASE_SHA` during deployment. Manual deployments default the revision to `local`; to stamp a manual deployment, add `--var APP_ENV:staging --var RELEASE_SHA:COMMIT_SHA` to the Wrangler command (adjust the environment appropriately). `/api/health` exposes these nonsecret values for provenance checks.

## Failure and rollback

Inspect the failed job in Actions and the target environment's Worker logs. Retry the workflow after correcting a transient error. Migration failures leave the prior Worker serving; already-applied migrations are not automatically undone. Use additive, backward-compatible migrations, especially because deployment can fail after schema changes.

For application rollback, select a previous version of the appropriate Worker in Cloudflare or use `npx wrangler rollback VERSION_ID --env staging` (or `--env production`). Verify the environment and app again. Worker rollback does not revert D1 data or schema; plan database recovery separately. A safer code rollback is a revert merged to main, which follows the same tested pipeline.

The daily cron closes cases in channels that went quiet, prunes expired quota buckets and OAuth state, and nudges each observed channel's coordinator so a channel whose alarm was lost resumes mining. Readiness retries allow time for DNS and revision propagation.
