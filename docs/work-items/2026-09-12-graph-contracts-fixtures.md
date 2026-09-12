# Freeze graph contracts and fixtures

Status: in-review
Owner: Codex agent for SAM task 01M2ARMXW198KNZA4PJ6QMN3H7
Source: GitHub issue #14 requests the P0 TypeScript graph contracts, initial additive D1 schema, integration fixtures, fixture validation, and runtime module interface documentation.
Branch: sam/implement-github-issue-14-qmn3h7

## Intent
Create the foundation other Roman-spec implementation issues can import without implementing runtime behavior. The work freezes shared TypeScript shapes for KB, process graphs, execution sessions, evidence, commands and journal events; allocates the first `pm_` D1 schema migration without colliding with current main or PR #5; and supplies synthetic fixtures that exercise Helios, Atlas isolation, lifecycle/curation states, graph deltas, replay, errors and citation references.

## Acceptance criteria
- Fixture validation catches invalid evidence references, unknown IDs, inconsistent graph revisions and wrong delta shapes.
- Fresh and existing database migration smoke succeeds without table collisions or loss of existing demo/auth/raw-observation tables.
- Runtime ingestion, extraction, graph and observer hook interfaces are documented and exported for downstream modules.

## Decisions and rationale
- Use migration `0005_pm_foundation.sql` because current main now contains `0001_initial.sql` through `0004_slack_message_events.sql` after PR #5 merged; keeping the `0005` name avoids collisions with the auth and Slack raw-observation migrations.
- Keep fixtures as typed TypeScript exports so downstream React, Worker and tests can import the same contract definitions without JSON parsing glue.
- Keep the `pm_` migration schema-only and seed-free. KB seeding remains explicit follow-up work, while the migration smoke proves current demo rows and real PR #5 auth/raw observation tables keep existing synthetic rows after `0005` applies.

## Changes
- Added `shared/contracts.ts` with typed KB, workflow, graph view, session, message, evidence, step, conformance, command, journal, outbox, processing and module-port contracts.
- Added `shared/fixtures.ts` with clearly synthetic Helios and Atlas data covering an empty designed graph, three Helios runs, Atlas isolation, proposed/rejected/negated steps, rework, removal deltas, replay journal events, API errors, promise-report reconciliation inputs and typed KB/count/evidence citations.
- Added `shared/fixture-validation.ts`, `scripts/validate-fixtures.ts` and `tests/fixtures.test.ts` to validate evidence references, known IDs, graph revisions and delta shapes.
- Added additive migration `migrations/0005_pm_foundation.sql` with only `pm_` tables and indexes.
- Added `scripts/check-pm-migration.mjs` and wired `fixtures:validate` plus `test:migration` into `npm run check`.
- Added `docs/runtime-module-interfaces.md` documenting ingestion, extraction, graph and observer hook boundaries for downstream runtime modules.

## Validation
- `npm ci`: passed.
- `npm run fixtures:validate`: passed.
- `npm run test -- tests/fixtures.test.ts`: passed, 10 tests covering valid fixtures and required invalid evidence/ID/revision/delta/support/reconciliation cases.
- `npm run test:migration`: passed fresh local D1 migration and existing local D1 migration preserving demo, Better Auth and raw Slack observation rows after rebasing onto the merged PR #5 migrations.
- `npm run check`: passed lint, typecheck, fixture validation, coverage, guardrails, migration smoke and build.
- `PATH="$HOME/.local/bin:$PATH" python3 scripts/check_quality.py`: passed after rebasing onto current `main` and refreshing dependencies with `npm ci`. Includes work-item checks, Ruff, npm checks, dependency audit, isolated Worker/D1 API smoke and five Chromium browser tests. Earlier attempts stopped before completion because Ruff, then Playwright Chromium, then Chromium system libraries were missing from the container; a post-rebase attempt also exposed stale local dependencies before `npm ci`.

## Risks and rollback
- No production runtime or seed logic is included by design. Downstream implementations still need to wire these contracts to real KB loading, Slack ingestion, extraction, graph rebuilds, SSE and observer behavior.
- Rollback is a code revert before remote migration. After a remote D1 migration, Worker rollback does not remove the additive `pm_` tables; leave them unused or apply an explicit follow-up cleanup migration if a maintainer decides to remove the foundation schema.

## Next steps
- Open PR with `Closes #14`, monitor CI/staging, verify the deployed revision, then merge only after required checks and staging acceptance are green.

## Review feedback and CI follow-up
- Initial PR checks failed because the PR body listed the work item path without a Markdown link; updated the PR body to link this file as required by `scripts/check_work_items.py --event`.
- Initial CI quality/deploy validation failed after PR #5 merged because the existing-database smoke simulated auth/Slack tables and then applied real `0003`/`0004` migrations. Rebased onto current `main` and changed the smoke to apply `0001`-`0004`, seed synthetic rows into the real tables, then apply `0005`.
