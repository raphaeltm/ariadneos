# Automate staging and production deployment

Status: in progress
Owner: Codex, requested by the repository owner
Source: User merged the demo and requested GitHub Actions, appropriate secrets, staging.ariadneos.com, and production deployment on merge.
Branch: ci/cloudflare-environments

## Intent
Automate tested Cloudflare deployments with isolated staging data and a production deployment on pushes to main after merges.

## Acceptance criteria
- Staging uses its own Worker and D1 database at staging.ariadneos.com.
- Same-repository PRs deploy to staging after checks; main deploys staging then production after validation.
- Production deployment is restricted to main in the workflow; fork PRs cannot deploy.
- GitHub environment secrets are set without exposing values in logs or files.
- Deployments apply migrations, serialize updates, and check the expected environment and deployed revision.

## Decisions and rationale
- Keep existing production Worker/database identities to preserve current data and domains.
- Use a shared staging hostname for trusted PRs; this is not one preview per PR.
- Store the available Cloudflare account ID/token as repository Actions secrets. GitHub returned 403 for environment administration; repository secret creation succeeded. Production restriction is a workflow condition, not a configured environment protection rule.

## Changes
- Added explicit staging/production Wrangler configurations and a separate staging database.
- Added check/build → staging migration/deployment/smoke → main-only production migration/deployment/readiness workflow, with serialized deployments and the same built frontend artifact.
- Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN repository secrets through stdin, without printing their values.
- Health responses now identify environment and revision so checks catch wrong-origin or stale deployments.

## Validation
- Synced merged main at 1405bc6. No root AGENTS.md or CONTRIBUTING.md exists yet; PR #2 contains the pending shared quality-gate conventions.

## Risks and rollback
- The shared staging environment shows the last deployed trusted PR or main revision.
- D1 migrations must be backward compatible; Worker rollback does not roll back database schema.

## Next steps
- Create isolated staging resources, configure GitHub environments/secrets, implement workflow, and verify through an actual Actions deployment.
