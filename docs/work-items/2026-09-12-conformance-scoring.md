# Conformance scoring and policy violations

Status: in-review
Owner: Codex, requested by the repository owner
Source: GitHub issue #21 / SAM task 01M2ATED1RVSTBAPM209AY8QX1. Implement pure workflow conformance scoring, evidence-linked policy violations, and role deviations against designed workflow and KB inputs.
Branch: sam/implement-github-issue-21-ay8qx1

## Intent
Add the foundation conformance module owned by issue #21 without waiting for unmerged graph-mining and KB PRs. The module should consume compatible mining output and KB-shaped inputs, return deterministic control-flow, policy, role, and unreconciled-commitment findings, and keep routes/UI/runtime state unchanged.

## Acceptance criteria
- Pure TypeScript functions score session fitness, precision, missing/extra activities, order breaks, and workflow rollups with null scores when denominators are empty.
- Policy checks distinguish passed, pending, unknown, and violation outcomes, with violations linked to authorized evidence references.
- Role deviations and abandoned promises are surfaced without rejecting out-of-repertoire work.
- Fixtures cover textbook, skipped-review, rework, actor-role deviation, abandoned promise, open-case pending work, and missing numeric threshold data.
- Repository quality and work-item checks run locally; staging verification is skipped per the time-critical task instruction.

## Decisions and rationale
- Start from current `origin/main` while dependency issues #14, #15, and #20 remain open; use exported local interfaces that match the specs so later merged contracts can replace them with minimal adapter work.
- Keep implementation in `shared/mining/conformance.ts` because issue #21 owns conformance scoring and policy violation logic, not API routes, graph mutation, Slack alerts, or UI.
- Treat policy breaches as evidence-linked findings: if a breach is inferable but lacks an authorized, resolvable message citation, return `unknown` with an unresolved-evidence reason instead of emitting an uncited violation.
- Roll up conformance over closed sessions only; open sessions still return provisional per-session scores and pending policy results so unfinished later work is not overreported as a violation.

## Changes
- Added `shared/mining/conformance.ts` with pure scoring types and `scoreConformance()`.
- Computes per-session fitness, precision, missing/extra slugs, designed-matrix order breaks with expected-between hints, policy outcomes, evidence-backed violations, role summaries/deviations, unreconciled/abandoned commitments, grounding ratios, and workflow rollups.
- Added `tests/conformance.test.ts` fixtures for textbook incident flow, skipped security review, undocumented hotfix work, role deviation, open-case pending policies, unreconciled and abandoned promises, threshold approval rules, authorization-safe evidence citation, null denominators, and closed-session rollups.

## Validation
- `npm ci` passed and installed locked JS dependencies.
- Downloaded Ruff 0.16.7 to `/tmp/ariadneos-tools/ruff-x86_64-unknown-linux-gnu/ruff` because the container had no `ruff`, `pip`, `pipx`, or `uv`.
- `npm run fix` passed after mechanical style fixes; final run reported no fixes needed.
- `npm exec -- vitest run tests/conformance.test.ts` passed: 7 tests initially, then covered by full suite after additional fixtures.
- `npm run typecheck` passed.
- `npm run check` passed: Biome lint, TypeScript, coverage with 59 tests, guardrail probes, and Vite build.
- `PATH=/tmp/ariadneos-tools/ruff-x86_64-unknown-linux-gnu:$PATH npm run check:repo` passed after installing Playwright Chromium and documented OS dependencies with `npm exec --no -- playwright install --with-deps chromium`; this included work-item tests, Ruff, full app checks, dependency audit, isolated Worker/D1/API smoke, and 5 Chromium browser tests.
- `python3 scripts/check_work_items.py --base origin/main` passed.
- Staging verification not run per the user's time-critical instruction to skip staging verification.

## Risks and rollback
- Dependency modules are not merged yet, so shape compatibility is based on the frozen specs and issue #21 text. Roll back by removing the new shared conformance module, tests, and this work item.
- This is a foundation module only; no routes, UI, Slack alerts, database schema, or live mining integration consume it yet. Rebase after #14, #15, and #20 merge and adapt imports if their exported contracts differ.

## Next steps
- Open the PR with `Closes #21`, monitor CI, rebase after dependency PRs merge, and merge only when required checks are green.
