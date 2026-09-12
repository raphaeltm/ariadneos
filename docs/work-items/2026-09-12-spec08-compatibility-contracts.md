# Spec 08 compatibility contracts

Status: in-review
Owner: Codex agent for SAM task 01M2ATA6BXC0QWRYD3DYV6CB42
Source: GitHub issue #31 requests an additive Spec 08 bridge between the current vendor/refund/access demo and the process-mining contracts, with compatibility fixtures for designed workflows, grounding, curation, lifecycle and agent events.
Branch: sam/implement-github-issue-31-v6cb42

## Intent
Add the optional interface vocabulary needed by Spec 08 consumers without changing current API fields, route behavior, live extraction, UI behavior or edit persistence. The bridge should let downstream work import MessageRef, designed edge, conformance, AgentEvent, pipeline event and workspace/link DTO shapes while the existing demo mining output remains compatible.

## Acceptance criteria
- Existing mining consumers keep all current fields; new fields are optional or supplied only when a designed model is passed.
- Fixtures cover an empty designed access graph, the Security review skip, all grounding/curation/lifecycle states, scoped references and AgentEvent decisions.
- Runtime fixture validation rejects malformed message references and inconsistent scoped records.
- Existing discovered-edge evidence/count, probability normalization, duplicate/out-of-order invariants continue to pass.

## Decisions and rationale
- Start from current `origin/main` because issue #14 is still open; inspect its branch for shared contract coordination but avoid editing its unmerged files.
- Keep this issue in `shared/process.ts` and `fixtures/contracts/` on main. `shared/contracts.ts` extension remains a rebase step after #14 merges because #14 owns that file today.
- Represent designed transitions with a `designedEdges` return field derived from a `DesignedModel` matrix. Observed `model.edges` remains discovered-only so current evidence/count/probability invariants keep their meaning.
- Provide small default adapters for workspace, confidence, grounding and aggregate eligibility rather than changing mining behavior for proposed/rejected/negated events in this bridge-only task.
- Rebased after #14 merged as PR #52 at `a8cc249` and added a type-only `shared/contracts.ts` bridge that re-exports the Spec 08 demo compatibility shapes from `shared/process.ts`.

## Changes
- Added additive Spec 08 bridge types/default adapters in `shared/process.ts`: `MessageRef`, designed model/policy/conformance shapes, `AgentEvent`, `PipelineEvent`, workspace/link DTOs, optional event lifecycle/curation/grounding fields and optional node/edge plane fields.
- Extended `shared/contracts.ts` with `Spec08*` aliases and `Spec08CompatibilityBridge` so downstream consumers can import the compatibility bridge from the canonical contract module after #14.
- Added `fixtures/contracts/spec08-compatibility.ts` with a designed access model, empty designed access graph, Security review skip, all requested grounding/curation/lifecycle/modality states, scoped message references, pipeline events, workspace/link DTOs and approve/hold/reject AgentEvent decisions.
- Added fixture validation for malformed message refs, unknown case/activity/workflow references, inconsistent designed matrices and workflow-link count mismatches.
- Added `tests/spec08-compatibility.test.ts` to verify fixture coverage, invalid reference rejection, default adapters and the separation between designed and discovered edges.

## Validation
- `npm ci`: passed, 232 packages installed/audited and 0 vulnerabilities found.
- `npm run fix`: passed after manual validator-loop cleanup; final run reported no fixes applied.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run test -- tests/spec08-compatibility.test.ts tests/process.test.ts`: passed, 18 tests.
- `npm run test -- tests/spec08-compatibility.test.ts tests/process.test.ts`: passed after adding aggregate-eligibility coverage, 19 tests.
- `npm run check`: initially failed because the new shared aggregate helper lacked coverage; passed after adding focused coverage. Final run passed lint, typecheck, 57 coverage tests, guardrail probes and production build.
- `npm run check:repo`: initially failed because the container lacked Ruff, then because Playwright Chromium/browser system dependencies were missing. Installed Ruff 0.16.7 to `/home/node/.local/bin`, ran `npm exec --no -- playwright install chromium`, then `npm exec --no -- playwright install --with-deps chromium`. Final `PATH="/home/node/.local/bin:$PATH" npm run check:repo` passed work-item unit tests, all work-item context, Ruff, npm checks, dependency audit, isolated D1/API smoke and 5 Chromium browser tests.
- `python3 scripts/check_work_items.py --base origin/main`: first attempt failed with "Add or update a dated docs/work-items/*.md record (stage new files locally)" because the new work item was not staged yet.
- `python3 scripts/check_work_items.py --base origin/main`: passed after staging the changed work item.
- After rebasing onto #14: `npm run test -- tests/spec08-compatibility.test.ts tests/fixtures.test.ts tests/process.test.ts` passed, 30 tests.
- After rebasing onto #14: `npm run check` passed lint, typecheck, `fixtures:validate`, 68 coverage tests, guardrails, `test:migration` and production build.
- After rebasing onto #14: `PATH="/home/node/.local/bin:$PATH" npm run check:repo` passed work-item unit tests, work-item context, Ruff, npm checks, dependency audit, isolated D1/API smoke with migrations through `0005_pm_foundation.sql`, and 5 Chromium browser tests.
- PR: https://github.com/raphaeltm/ariadneos/pull/58.

## Risks and rollback
- No route, algorithm, live extraction, UI or persistence behavior changed. Rollback is a code revert; fixture and type additions have no remote runtime side effects.
- The bridge intentionally keeps demo workflow ids (`vendor`, `refund`, `access`) separate from #14's canonical `wf_*` ids by using `Spec08*` aliases rather than replacing the foundation graph vocabulary.

## Next steps
- Monitor PR #58 CI, skip staging verification per the time-critical user instruction, and merge only once CI is green.
