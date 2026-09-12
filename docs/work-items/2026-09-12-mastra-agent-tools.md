# Mastra agent tools

Status: in-review
Owner: Codex agent for SAM task 01M2AZEBF2WHYAJMHTD8NNGTJT
Source: GitHub issue #39, "Expose scoped Ariadne tools and human-only edit proposals"; requested implementation of Mastra agent tool definitions for graph-RAG queries, extraction triggers, and KB lookup against current main.
Branch: sam/implement-github-issue-39-nngtjt
PR: https://github.com/raphaeltm/ariadneos/pull/81

## Intent
Wire typed Ariadne agent tools for graph-RAG queries, extraction triggers, and knowledge-base lookup to the existing TypeScript/Cloudflare modules. The tools must validate inputs, use request-scoped context instead of module-global environment capture, keep agent edits proposed-only, and integrate with the Mastra runtime from #38 now merged to main.

## Acceptance criteria
- Graph-RAG, evidence, workspace search, KB lookup, extraction trigger, proposal, event, pause/resume, and Slack-post tool handlers expose typed schemas and call existing server modules or durable API boundaries.
- Tool execution requires scoped request context; user-controlled workspace or workflow arguments cannot broaden access.
- Agent-callable edit tools can only create proposed edits with rationale and agent attribution; they cannot apply, approve, or reject edits.
- `AGENT_ENABLED=false` blocks proactive agent/extraction/posting actions while deterministic graph and KB routes remain usable.
- Tests cover malformed input, cross-scope rejection, disabled-agent behavior, and the proposed-only edit boundary.

## Decisions and rationale
- Branch was fast-forwarded to `origin/main` commit `4471418` before implementation because the SAM task requested current main.
- Branch was later rebased onto `origin/main` commit `22564d5` after #38 merged.
- Staging verification is intentionally skipped for this time-critical run because the user explicitly instructed "Skip staging verification for speed" for #39, even though the broader Roman spec wave normally asks for staging validation before merge.
- Use real Mastra `createTool` definitions with Zod schemas from the merged #38 runtime dependencies, because Mastra tools are not plain objects.
- Reuse exported process route helpers for graph, scoped data, and evidence shaping so the agent and API share authorization and graph behavior.
- Do not reimplement #32's graph edit reducer. This slice adds an additive proposed-only `agent_edit_proposal` table and records agent events/outbound Slack intents for later human/application paths.

## Changes
- Added `server/agent/tools/index.ts` with Mastra tool definitions and direct handlers for `queryProcessGraph`, `getEvidence`, `searchWorkspace`, `lookupKnowledgeBase`, `triggerExtraction`, `proposeEdit`, `recordAgentEvent`, `postToSlack`, `pauseRun`, and `resumeRun`.
- Added `server/agent/ariadne.ts` as the runtime integration point for Ariadne instructions and the tool map.
- Exported read-only process route helpers used by tools.
- Added migration `0008_agent_tools.sql` for proposed agent edit records and agent event records.
- Added focused coverage in `tests/agent-tools.test.ts`.
- Opened PR #81 for review.

## Validation
- `npm run typecheck`: passed.
- `npm exec -- vitest run tests/agent-tools.test.ts`: passed, 9 tests.
- `npm run fix`: passed; final run reported no fixes applied.
- `npm run check`: passed before rebase with 155 coverage tests; passed again after rebase with lint, typecheck, fixture validation, 176 coverage tests, guardrail probes, migration smoke, and production build.
- `PATH="/tmp/ariadneos-local-tools-ruff-0.16.7-issue39/ruff-x86_64-unknown-linux-gnu:$PATH" npm run check:repo`: passed after installing local Ruff 0.16.7 and Playwright Chromium; included work-item tests, Ruff checks, full app checks, dependency audit, isolated Worker/D1/API smoke, and 6 Chromium browser tests.
- `git diff --check`: passed.
- `python3 scripts/check_work_items.py --base origin/main`: passed after staging the new work-item file.

## Risks and rollback
- #32 is still open, so proposed edits are recorded for human/application paths rather than applying graph edits directly.
- Rollback is removing the agent tool modules, route helper exports, additive migration, tests, and this work item.

## Next steps
- Monitor PR #81 CI and merge when green. Staging verification remains skipped per explicit task instruction.
