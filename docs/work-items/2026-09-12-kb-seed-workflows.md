# Issue 15 KB Seed Workflows

Status: in-review
Owner: Codex agent for issue #15
Source: GitHub issue #15, authoring the organization KB, designed workflows, and explicit D1 seed/read helpers for the Roman spec wave.
Branch: sam/implement-github-issue-15-n8bkqb

## Intent
Provide bundled authored knowledge-base data for the Helios and Atlas demos, preserve the legacy vendor/refund/access designed workflow lineage, and expose explicit idempotent D1 seed/read helpers without route mounting, request-time seeding, transcript generation, aggregation, or schema ownership.

## Acceptance criteria
- Bundled data contains six people, two projects, about ten artifacts, five policies, role capability priors, artifact lifecycle state definitions, activity synonyms, and designed workflow models for Helios, Atlas, vendor, refund, and access.
- Helios has an 11-activity matrix and Atlas has an 8-activity matrix; every matrix row, policy id, person id, project id, artifact id, and workflow activity reference validates.
- Two seed executions preserve non-authored rows and produce identical authored membership; designed graph read helpers return zero observed support and keep Helios and Atlas scoped separately.

## Decisions and rationale
- No schema migration is added because issue #15 explicitly excludes schema ownership. The D1 helpers target a small authored-KB contract that a schema-owning PR can provide.
- Seed helpers only upsert authored rows and never delete table contents, so observed and curated rows can coexist with the authored bundle.

## Changes
- Added bundled JSON under `kb/` for six people, two projects, ten artifacts, five policies, role capability priors, artifact lifecycles, Helios and Atlas designed workflows, legacy vendor/refund/access designed workflows, and the Helios demo workspace cast/agendas/process beliefs.
- Added `server/kb.ts` with typed runtime validation, designed graph builders, idempotent D1 seed helpers, and authored read helpers. The helper contract uses authored-only upserts and does not delete or reseed observed/curated data.
- Added `scripts/seed-kb.ts` for explicit D1 seeding via Wrangler; no Worker route, startup hook, or request path invokes seeding.
- Added `tests/kb.test.ts` covering bundle counts, Helios/Atlas dimensions and scoped policies, legacy access security review, workspace deviation traceability, seed idempotency, non-authored row preservation, and zero-observation designed graph reads.

## Validation
- `npm exec vitest run tests/kb.test.ts` passed.
- `npm run typecheck` passed.
- `npm exec -- tsx scripts/seed-kb.ts --dry-run` passed and produced the authored SQL plus summary: 6 people, 2 projects, 10 artifacts, 5 policies, 5 workflows, 35 workflow activities, 40 designed edges.
- `npm run fix` passed after formatting and style refactors.
- `npm run check` passed: Biome, TypeScript, coverage tests, guardrail probes, and production build.
- `python3 scripts/check_work_items.py --base origin/main` passed after staging this work item.
- `PATH="$HOME/.local/bin:$PATH" python3 scripts/check_quality.py` passed after installing Ruff 0.16.7 and Playwright Chromium in the workspace; it covered work-item tests, Ruff, full app check, dependency audit, isolated Worker/D1 API smoke, and browser smoke.

## Risks and rollback
- Risk: the eventual schema owner may choose different table names or columns; the helper contract is isolated in `server/kb.ts` for rebasing.
- Risk: live D1 seeding requires the schema-owning PR to create the `pm_kb_*` tables. This issue intentionally does not add migrations.
- Rollback: remove the KB bundle, `server/kb.ts`, `scripts/seed-kb.ts`, associated tests, and this work item.

## Next steps
- Implement the bundle, helpers, tests, then run quality and work-item checks.
