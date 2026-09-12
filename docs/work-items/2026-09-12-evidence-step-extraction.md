# Evidence-backed step extraction

Status: in-review
Owner: Codex agent for SAM task 01M2ATE8X9RRS9A482DHPGQ9MZ
Source: GitHub issue #19 and SAM task to implement evidence-backed extraction and canonicalization with bounded model calls.
Branch: sam/implement-github-issue-19-pgq9mz

## Intent
Implement the extraction and canonicalization foundation for normalized observations: validate evidence-backed work acts, retain modality/lifecycle/curation separately, reconcile requests and commitments with reported completion, and bound model calls behind a shared adapter.

## Acceptance criteria
- Extraction emits no steps for chatter and discards model output without evidence from the current window.
- Invalid JSON is retried once and then reported as a degraded extraction without fabricating steps.
- Modalities map to lifecycle state, negated work stays excluded from graph input, and low-confidence steps remain proposed.
- Canonicalization prefers designed activities, batches unmatched model adjudication, merges near-duplicate slugs, and reconciles promise or request completion inside a case.
- Local repository checks and the work item context check pass before PR handoff.

## Decisions and rationale
- Keep this layer independent of unmerged #14/#15 contracts while mirroring their domain vocabulary, so the branch can rebase cleanly after those dependencies land.
- Use a small native-fetch OpenRouter adapter interface instead of introducing Mastra dependencies in this PR; issue #38 remains the runtime compatibility owner.

## Changes
- Added `server/models.ts` with a shared JSON model adapter interface, OpenRouter native-fetch implementation, task-based model selection, and an operation-level budget wrapper.
- Added `server/mining/types.ts`, `server/mining/extract.ts`, and `server/mining/canonicalize.ts` for normalized-observation extraction, evidence validation, modality-to-lifecycle materialization, role-prior confidence adjustment, designed-first canonicalization, one batched unmatched canonicalization call, promise/request reconciliation, duplicate evidence dropping, rework marking, and graph-eligible step filtering.
- Added `tests/mining.test.ts` covering chatter, invalid model retries, out-of-window evidence rejection, role deviation confidence, unmatched canonicalization, near-slug merging, negated exclusion, and the corrected seven-utterance reconciliation example.

## Validation
- `npm ci` — passed; 0 vulnerabilities.
- `npm run fix` — passed.
- `npm run check` — passed: lint, typecheck, coverage tests, guardrail probes, and production build.
- `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo` — passed after installing Ruff 0.16.7 and Playwright Chromium/system dependencies in the local environment. Includes script unit tests, all work-item checks, Ruff, app checks, dependency audit, isolated Worker/D1 smoke, and 5 Chromium browser tests.
- `python3 scripts/check_work_items.py --base origin/main` — pending staged-file rerun before PR.

## Risks and rollback
- #14/#15/#38 are still open, so integration imports may need a follow-up rebase once their contracts/runtime modules merge. Runtime wiring is intentionally excluded to avoid competing with those owners. Rollback is deleting the new mining/model modules and tests.

## Next steps
- Open a PR with `Closes #19`, monitor CI, rebase if #14/#15 merge before this lands, and merge only after required checks are green.
