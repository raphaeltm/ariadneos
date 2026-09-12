# Graph edit round-trip consistency validation

Status: in-progress
Owner: Codex via SAM task 01M2AZCYGH5AGP62DMDRYJHWKA for Raphael
Source: SAM/user task to implement GitHub issue #37, "Validate graph-edit round-trip persistence and multi-client consistency." Observed note: `gh issue view 37` on 2026-09-12 returned the title "Expose a provenance-linked mining activity log"; this work follows the SAM/user task text as authoritative.
Branch: sam/implement-github-issue-37-yjhwka

## Intent
Add focused validation for the graph-edit pipeline so edit application, persistence, reload, journal broadcast, multi-client replay, curation and conformance interactions remain consistent across the TypeScript/Hono Worker, D1 and React client-state architecture.

## Acceptance criteria
- Round-trip validation proves edit -> persist -> reload produces the same effective graph state.
- Multi-client validation proves edits from different clients converge through the journal/SSE replay path and preserve idempotent request handling.
- Integration tests cover client API adapter -> API route -> D1 persistence -> journal/SSE broadcast behavior without staging verification.
- Regression coverage proves graph edits continue to respect curation and conformance semantics.
- Required local checks run: `npm run fix`, `npm run check`, `npm run check:repo`, `python3 scripts/check_quality.py` and the work-item context check.

## Decisions and rationale
- Started from current `origin/main` at `1d6b789`, where the user reported prerequisite issues #14, #15, #16, #17, #18, #19, #20, #21, #22, #23, #24, #25 and #31 already merged.
- An initial implementation added a separate `pm_model_edit` table because that checkout did not yet include graph-edit persistence. Before final delivery, `origin/main` advanced to `78b28df` with PR #75 / issue #34, including `pm_graph_edit_revision`, `/api/model/edit`, undo support, edit validation and revision replay helpers. Rebased onto that implementation and removed the duplicate model-edit table/routes from this branch.
- Kept the final PR scoped to issue #37 validation plus one required consistency fix: graph edits now publish a graph journal event, and graph rebuild deltas are marked as replacement payloads with conformance so SSE clients converge without a reload.
- Skip staging verification per the explicit time-critical instruction; rely on local checks and CI for this test-focused PR.

## Changes
- Added `tests/model-edit-consistency.test.ts` covering client adapter -> Worker route -> D1 graph edit persistence -> journal replay, round-trip reload equality, duplicate `request_id` idempotency, multi-client replay convergence, and promoted-edit interaction with curation/conformance.
- Added typed production and fixture API adapter support for graph model edits, including `base_revision` and the normalized edit response shape from `/api/model/edit`.
- Updated graph edit responses to publish an idempotent `graph_delta` journal entry keyed by the stored edit id, so the persisted edit path also drives the SSE/client replay path.
- Extended `GraphDelta` with optional `replace` and `conformance` fields. Replacement deltas represent full rebuilt graph views and allow clients to apply edit/curation graph broadcasts even when the payload is not a small additive diff.
- Updated client graph-delta handling to replace the current graph for server-marked full rebuilds while preserving the existing snapshot-required behavior for ordinary stale deltas.

## Validation
- Before rebase, validation passed on the initial implementation: `npm ci`; `npm exec -- vitest run tests/model-edit-consistency.test.ts`; `npm run fix`; `npm run check`; `PATH="/tmp/ariadneos-ruff-0.16.7:$PATH" npm run check:repo`; `PATH="/tmp/ariadneos-ruff-0.16.7:$PATH" python3 scripts/check_quality.py`; and `python3 scripts/check_work_items.py --base origin/main` after staging. Ruff 0.16.7 was installed under `/tmp/ariadneos-ruff-0.16.7`; Playwright Chromium was installed with `npm exec --no -- playwright install --with-deps chromium`.
- Rebased onto `origin/main` after PR #75 introduced graph-edit persistence upstream. Resolved conflicts by keeping upstream `server/routes/process.ts`, upstream process-route tests and migration `0008_graph_edit_revisions.sql`, then reapplied validation and client convergence changes.
- Post-rebase focused validation passed: `npm exec -- vitest run tests/model-edit-consistency.test.ts tests/client-state.test.ts tests/process-routes.test.ts tests/model-edits.test.ts` with 23 tests passing.
- `npm run fix` passed with no fixes applied.
- `npm run typecheck` passed after aligning the fixture edit response type with the real `/api/model/edit` shape.
- `npm run check` passed: Biome lint, TypeScript, fixture validation, 165 coverage tests, guardrail probes, PM migration smoke and production build.
- `PATH="/tmp/ariadneos-ruff-0.16.7:$PATH" npm run check:repo` passed: work-item tests, Ruff, full app checks, dependency audit, isolated Worker/D1/API smoke with migrations through `0008_graph_edit_revisions.sql`, and 6 Chromium browser tests.
- `PATH="/tmp/ariadneos-ruff-0.16.7:$PATH" python3 scripts/check_quality.py` passed with the same quality suite and 6 Chromium browser tests.
- `python3 scripts/check_work_items.py --base origin/main` passed.
- Staging verification intentionally not run per the explicit time-critical instruction.

## Risks and rollback
- Risk: the live GitHub issue title currently differs from the SAM/user task title, so the PR body will make the task source explicit for review.
- Risk: edit response graph revisions use the persisted graph-revision counter while snapshot reloads use the aggregate graph hash revision. Tests compare graph content and conformance across that boundary and assert the response-level persisted revision separately.
- Rollback is a code revert. No new migration remains in this branch after rebasing onto upstream graph-edit persistence.

## Next steps
- Force-push the rebased branch and update PR #77 with the final scope, `Closes #37`, acceptance evidence and this work item.
- Monitor CI, skip staging verification per instruction, and merge only after required checks are green.
