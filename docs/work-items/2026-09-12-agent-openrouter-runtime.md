# Validate Mastra and OpenRouter runtime in Cloudflare

Status: in-progress
Owner: Codex agent for raphaeltm
Source: GitHub issue #38 and SAM task 01M2AT7S24G36V51T506602YPD: validate whether Mastra/OpenRouter can execute within the Cloudflare Worker deployment, with an explicit typed-fetch fallback if Mastra is unsuitable.
Branch: sam/implement-github-issue-38-602ypd

## Intent
Prove the narrow agent execution foundation before downstream extraction or graph/RAG work depends on it. The task should add a timeboxed runtime smoke path in the existing Hono Worker, configure OpenRouter model routing and budgets without exposing secrets, and record which execution path passes against current official documentation.

## Acceptance criteria
- A staging deployment proves one configured OpenRouter call and real Cloudflare bundle/runtime compatibility.
- `AGENT_ENABLED=false` leaves the existing application and mining behavior unaffected.
- The runtime path is explicit and observable when disabled, configured, or falling back.
- `MODEL_ANSWER` and `MODEL_CLASSIFY` are documented in relation to existing `MODEL_RAG` and `MODEL_SIM`.
- No separate database, public Mastra server, or non-Cloudflare hosting target is introduced.

## Decisions and rationale
- Chose the embedded Worker path. A local Wrangler dry-run bundle using `@mastra/core/agent` and `@openrouter/ai-sdk-provider` succeeded at `Total Upload: 10639.51 KiB / gzip: 1900.51 KiB`, below Cloudflare's documented 64 MiB Worker size limit. A local `wrangler dev --local` probe instantiated the Mastra Agent and returned `{ok:true, agent:true}`.
- Kept the spec 11 typed-fetch adapter as an explicit runtime fallback rather than a separate deployment path. This preserves the same model/env interface and keeps failures observable without adding a second Worker, public Mastra server, database, or hosting target.
- Verified current official documentation on 2026-09-12: Mastra documents `Agent` usage and workflows, OpenRouter documents the Mastra provider plus native chat-completions headers, Mastra's Cloudflare deployer docs say existing web-framework deployments can deploy normally, and Cloudflare Workers docs say Node compatibility behavior is enabled by this repo's 2026 compatibility date.

## Changes
- Added `server/agent/models.ts` for OpenRouter model IDs, answer/classify/extract token budgets, app attribution, and compatibility fallbacks from `MODEL_ANSWER` to `MODEL_RAG` and `MODEL_CLASSIFY`/`MODEL_EXTRACT` to `MODEL_SIM`.
- Added `server/agent/runtime.ts` with a Mastra-first smoke executor, timeout handling, and typed-fetch fallback that reports which executor passed.
- Added `GET /api/agent/status` and `POST /api/agent/smoke` to the Hono Worker. The smoke route uses the existing D1-backed quota table and a fixed prompt, and returns disabled/missing-key/fallback states without logging or returning secrets.
- Configured non-secret Wrangler vars for models, budgets, attribution, and `AGENT_ENABLED`. Staging enables the smoke path; production/local default to disabled.
- Updated deployment and local smoke checks. Staging deployment now requires one successful OpenRouter smoke call for the deployed revision; local smoke verifies the disabled path and strips `OPENROUTER_API_KEY`.
- Documented the runtime path and model-name mapping in `README.md`.

## Validation
- `npm ci` passed; installed locked dependencies.
- Unsaved Mastra compatibility probe: `wrangler deploy --dry-run` for a minimal embedded Mastra/OpenRouter Worker passed with `Total Upload: 10639.51 KiB / gzip: 1900.51 KiB`.
- Unsaved runtime probe: `wrangler dev --local` for the minimal embedded Mastra/OpenRouter Worker returned `{"ok":true,"status":200,"data":{"ok":true,"agent":true}}`.
- `npm run typecheck` passed.
- `npx vitest run tests/request.test.ts` passed: 16 tests.
- `npm run fix` passed after adding exhaustive switch defaults.
- `npm run check` passed.
- `wrangler deploy --dry-run --outdir` to a temporary directory for the real Worker passed with `Total Upload: 10732.38 KiB / gzip: 1924.88 KiB`; output listed non-secret agent vars and no `OPENROUTER_API_KEY` var.
- First `npm run check:repo` attempt failed because Ruff was not installed. Installed Ruff 0.16.7 with the official versioned standalone installer.
- Second `npm run check:repo` passed, including isolated Worker/D1 smoke and four Playwright Chromium tests.
- `python3 scripts/check_quality.py` passed when run directly with Ruff 0.16.7 on `PATH`.
- `python3 scripts/check_work_items.py --base origin/main` passed after staging this new work item. The first unstaged run correctly reported that new work items must be staged.
- Rebased on `origin/main` commit `a8cc249` after PR #52 merged Better Auth, Slack events, and PM foundation work. Resolved conflicts by preserving the new auth/Slack gates and keeping the agent status/smoke routes outside the login-required API section for deployment verification.
- Post-rebase `npm run fix` passed.
- Post-rebase `npm run typecheck && npx vitest run tests/request.test.ts` passed.
- Post-rebase `npm run check` passed, including fixture validation and migration smoke added on main.
- Post-rebase real Worker `wrangler deploy --dry-run --outdir` passed with `Total Upload: 12372.96 KiB / gzip: 2212.28 KiB`; output listed Better Auth and non-secret agent vars, with no `OPENROUTER_API_KEY` var.
- Post-rebase `npm run check:repo` passed, including five local D1 migrations and five Playwright Chromium tests.
- Post-rebase `python3 scripts/check_quality.py` passed directly with Ruff 0.16.7 on `PATH`.
- Rebased again on `origin/main` commit `54d6b1b` after PR #57 merged extraction work. No conflicts.
- Latest-base `npm run fix` passed.
- Latest-base `npm run check` passed, including 80 Vitest tests, fixture validation, guardrails, migration smoke and build.
- Latest-base real Worker `wrangler deploy --dry-run --outdir` passed with `Total Upload: 12372.96 KiB / gzip: 2212.28 KiB`; output still listed no `OPENROUTER_API_KEY` var.
- Latest-base `npm run check:repo` passed, including five local D1 migrations and five Playwright Chromium tests.
- Latest-base `python3 scripts/check_quality.py` passed directly with Ruff 0.16.7 on `PATH`.
- Rebased again on `origin/main` commit `7292906` after additional spec-contract work merged. No conflicts.
- Current-base `npm run fix` passed.
- Current-base `npm run check` passed, including 97 Vitest tests, fixture validation, guardrails, migration smoke and build.
- Current-base real Worker `wrangler deploy --dry-run --outdir` passed with `Total Upload: 12373.73 KiB / gzip: 2212.50 KiB`; output still listed no `OPENROUTER_API_KEY` var.
- Current-base `npm run check:repo` passed, including five local D1 migrations and five Playwright Chromium tests.
- Current-base `python3 scripts/check_quality.py` passed directly with Ruff 0.16.7 on `PATH`.

- Rebased again on `origin/main` commit `464d0f6` after issue #16 merged the channel coordinator Durable Object. Resolved conflicts by preserving `ChannelCoordinatorEnv`, the `CHANNEL_COORDINATOR` binding/migrations, and Slack channel/team allow-list vars while keeping the issue #38 agent runtime routes and non-secret model config.
- Current-base `npm run fix` passed and formatted the merged `Env` interface.
- Current-base `npm run check` passed, including 101 Vitest tests, fixture validation, guardrails, migration smoke and build.
- Current-base real Worker `wrangler deploy --dry-run --outdir` passed with `Total Upload: 12394.83 KiB / gzip: 2217.34 KiB`; output listed the channel coordinator Durable Object, non-secret agent vars, Slack allow-list vars, and no `OPENROUTER_API_KEY` var.
- Current-base `npm run check:repo` passed, including six local D1 migrations and five Playwright Chromium tests.
- Current-base `python3 scripts/check_quality.py` passed directly with Ruff 0.16.7 on `PATH`, including six local D1 migrations and five Playwright Chromium tests.
- Current-base staging `wrangler deploy --dry-run --env staging --outdir` passed with `AGENT_ENABLED=true`, the staging D1 database, the channel coordinator Durable Object, non-secret agent vars, Slack allow-list vars, and no `OPENROUTER_API_KEY` var.

- Rebased again on `origin/main` commit `e1ffff0` after typed snapshot/SSE client work merged. No conflicts.
- Latest-base `npm run fix` passed with no changes.
- Latest-base `npm run check` passed, including 117 Vitest tests, fixture validation, guardrails, migration smoke and build.
- Latest-base real Worker `wrangler deploy --dry-run --outdir` and staging `wrangler deploy --dry-run --env staging --outdir` both passed with `Total Upload: 12394.83 KiB / gzip: 2217.34 KiB`; staging listed `AGENT_ENABLED=true`, both listed the channel coordinator Durable Object and non-secret agent vars, and neither listed `OPENROUTER_API_KEY`.
- Latest-base `npm run check:repo` passed, including six local D1 migrations and five Playwright Chromium tests.
- Latest-base `python3 scripts/check_quality.py` passed directly with Ruff 0.16.7 on `PATH`, including six local D1 migrations and five Playwright Chromium tests.

- Rebased again on `origin/main` commit `4b1fd80` after Slack observation normalization merged. No conflicts.
- Latest-base `npm run fix` passed with no changes.
- Latest-base `npm run check` passed, including 120 Vitest tests, fixture validation, guardrails, migration smoke and build.
- Latest-base real Worker `wrangler deploy --dry-run --outdir` and staging `wrangler deploy --dry-run --env staging --outdir` both passed with `Total Upload: 12403.51 KiB / gzip: 2219.30 KiB`; staging listed `AGENT_ENABLED=true`, both listed the channel coordinator Durable Object and non-secret agent vars, and neither listed `OPENROUTER_API_KEY`.
- Latest-base `npm run check:repo` passed, including six local D1 migrations and five Playwright Chromium tests.
- Latest-base `python3 scripts/check_quality.py` passed directly with Ruff 0.16.7 on `PATH`, including six local D1 migrations and five Playwright Chromium tests.

- First live staging deploy for head `5eadade` deployed the Worker and passed secret validation, migrations, Quality, Security, and CodeQL, but readiness failed because `/api/agent/status` reported `hasOpenRouterKey=false`. The failing log repeated `Staging is missing the OPENROUTER_API_KEY secret`; no secret value was printed.
- Diagnosed the staging failure as a deployment configuration gap: the helper synced auth and Slack secrets to Cloudflare but did not include `OPENROUTER_API_KEY`, so even a configured GitHub environment secret would not reach the Worker. Updated the deploy workflow and `scripts/deployment-config.ts` so staging requires and syncs `OPENROUTER_API_KEY`; production remains agent-disabled and syncs OpenRouter only when supplied.
- Rebased again on `origin/main` commit `f1e89de` after workflow canvas work merged. No conflicts; deployment-secret sync patch reapplied.
- Latest-base `npm run fix` passed with no changes.
- Latest-base focused checks passed: `npx vitest run tests/deployment-config.test.ts` (6 tests) and `npm run typecheck`.
- Latest-base `npm run check` passed, including 131 Vitest tests, fixture validation, guardrails, migration smoke and build.
- Latest-base real Worker `wrangler deploy --dry-run --outdir` and staging `wrangler deploy --dry-run --env staging --outdir` both passed with `Total Upload: 12403.51 KiB / gzip: 2219.30 KiB`; staging listed `AGENT_ENABLED=true`, both listed the channel coordinator Durable Object and non-secret agent vars, and neither listed `OPENROUTER_API_KEY`.
- Latest-base `npm run check:repo` passed, including seven local D1 migrations and five Playwright Chromium tests.
- Latest-base `python3 scripts/check_quality.py` passed directly with Ruff 0.16.7 on `PATH`, including seven local D1 migrations and five Playwright Chromium tests.

- Rebased again on `origin/main` commit `1d6b789` after app-shell layout work merged. No conflicts.
- Latest-base `npm run fix` passed with no changes.
- Latest-base `npm run check` passed, including 137 Vitest tests, fixture validation, guardrails, migration smoke and build.
- Latest-base real Worker `wrangler deploy --dry-run --outdir` and staging `wrangler deploy --dry-run --env staging --outdir` both passed with `Total Upload: 12515.83 KiB / gzip: 2243.99 KiB`; staging listed `AGENT_ENABLED=true`, both listed the channel coordinator Durable Object and non-secret agent vars, and neither listed `OPENROUTER_API_KEY`.
- Latest-base `npm run check:repo` passed, including seven local D1 migrations and six Playwright Chromium tests.
- Latest-base `python3 scripts/check_quality.py` passed directly with Ruff 0.16.7 on `PATH`, including seven local D1 migrations and six Playwright Chromium tests.

- Rebased again on `origin/main` commit `9f10991` after step-edge inspector work merged. No conflicts.
- Latest-base `npm run fix` passed with no changes.
- Latest-base `npm run check` passed, including 140 Vitest tests, fixture validation, guardrails, migration smoke and build.
- Latest-base real Worker `wrangler deploy --dry-run --outdir` and staging `wrangler deploy --dry-run --env staging --outdir` both passed with `Total Upload: 12515.83 KiB / gzip: 2243.99 KiB`; staging listed `AGENT_ENABLED=true`, both listed the channel coordinator Durable Object and non-secret agent vars, and neither listed `OPENROUTER_API_KEY`.
- Latest-base `npm run check:repo` passed, including seven local D1 migrations and six Playwright Chromium tests.
- Latest-base `python3 scripts/check_quality.py` passed directly with Ruff 0.16.7 on `PATH`, including seven local D1 migrations and six Playwright Chromium tests.

- Rebased again on `origin/main` commit `cefc1ce` after demo simulator readiness work merged. No conflicts; ran `npm ci` because `package.json` changed on main.
- Latest-base `npm ci` passed.
- Latest-base `npm run fix` passed with no changes.
- Latest-base `npm run check` passed, including 146 Vitest tests, fixture validation, guardrails, migration smoke and build.
- Latest-base real Worker `wrangler deploy --dry-run --outdir` and staging `wrangler deploy --dry-run --env staging --outdir` both passed with `Total Upload: 12515.83 KiB / gzip: 2243.99 KiB`; staging listed `AGENT_ENABLED=true`, both listed the channel coordinator Durable Object and non-secret agent vars, and neither listed `OPENROUTER_API_KEY`.
- Latest-base `npm run check:repo` passed, including seven local D1 migrations and six Playwright Chromium tests.
- Latest-base `python3 scripts/check_quality.py` passed directly with Ruff 0.16.7 on `PATH`, including seven local D1 migrations and six Playwright Chromium tests.

- Rebased again on `origin/main` commit `08b87e5` after conformance diff overlay and inline graph curation work merged. Resolved conflicts in `server/index.ts` and `tests/request.test.ts` by preserving new agent-memory imports/request validation and the issue #38 agent runtime imports/routes/tests.
- Latest-base focused `npx vitest run tests/request.test.ts` passed, 17 tests.
- Latest-base `npm run fix` passed and formatted one conflict resolution file.
- Latest-base `npm run check` passed, including 161 Vitest tests, fixture validation, guardrails, migration smoke and build.
- Latest-base real Worker `wrangler deploy --dry-run --outdir` and staging `wrangler deploy --dry-run --env staging --outdir` both passed with `Total Upload: 12527.48 KiB / gzip: 2246.58 KiB`; staging listed `AGENT_ENABLED=true`, both listed the channel coordinator Durable Object and non-secret agent vars, and neither listed `OPENROUTER_API_KEY`.
- Latest-base `npm run check:repo` passed, including eight local D1 migrations and six Playwright Chromium tests.
- Latest-base `python3 scripts/check_quality.py` passed directly with Ruff 0.16.7 on `PATH`, including eight local D1 migrations and six Playwright Chromium tests.

- Rebased again on `origin/main` commit `78b28df` after graph edit persistence merged. No conflicts.
- Latest-base `npm run fix` passed with no changes.
- Latest-base `npm run check` passed, including 167 Vitest tests, fixture validation, guardrails, migration smoke and build.
- Latest-base real Worker `wrangler deploy --dry-run --outdir` and staging `wrangler deploy --dry-run --env staging --outdir` both passed with `Total Upload: 12568.55 KiB / gzip: 2254.30 KiB`; staging listed `AGENT_ENABLED=true`, both listed the channel coordinator Durable Object and non-secret agent vars, and neither listed `OPENROUTER_API_KEY`.
- Latest-base `npm run check:repo` passed, including nine local D1 migrations and six Playwright Chromium tests.
- Latest-base `python3 scripts/check_quality.py` passed directly with Ruff 0.16.7 on `PATH`, including nine local D1 migrations and six Playwright Chromium tests.

## Risks and rollback
- Missing OpenRouter or Cloudflare deployment credentials would block live staging proof; that must be reported explicitly rather than inferred from local checks.
- Rollback is expected to be removing the narrow agent runtime configuration and smoke endpoint if the foundation proves unsuitable.

## Next steps
- Push the latest rebased PR branch, verify PR checks and staging deployment for the latest commit, and merge only if required checks and staging acceptance are green. If staging lacks `OPENROUTER_API_KEY`, report that as an explicit blocker.
