# Mastra agent tools

Status: in-progress
Owner: Codex agent for SAM task 01M2AZEBF2WHYAJMHTD8NNGTJT
Source: GitHub issue #39, "Expose scoped Ariadne tools and human-only edit proposals"; requested implementation of Mastra agent tool definitions for graph-RAG queries, extraction triggers, and KB lookup against current main.
Branch: sam/implement-github-issue-39-nngtjt

## Intent
Wire typed Ariadne agent tools for graph-RAG queries, extraction triggers, and knowledge-base lookup to the existing TypeScript/Cloudflare modules. The tools must validate inputs, use request-scoped context instead of module-global environment capture, keep agent edits proposed-only, and remain compatible with the in-progress Mastra runtime from #38 or the typed fallback interface allowed by spec 11.

## Acceptance criteria
- Graph-RAG, evidence, workspace search, KB lookup, extraction trigger, proposal, event, pause/resume, and Slack-post tool handlers expose typed schemas and call existing server modules or durable API boundaries.
- Tool execution requires scoped request context; user-controlled workspace or workflow arguments cannot broaden access.
- Agent-callable edit tools can only create proposed edits with rationale and agent attribution; they cannot apply, approve, or reject edits.
- `AGENT_ENABLED=false` blocks proactive agent/extraction/posting actions while deterministic graph and KB routes remain usable.
- Tests cover malformed input, cross-scope rejection, disabled-agent behavior, and the proposed-only edit boundary.

## Decisions and rationale
- Branch was fast-forwarded to `origin/main` commit `4471418` before implementation because the SAM task requested current main.
- Staging verification is intentionally skipped for this time-critical run because the user explicitly instructed "Skip staging verification for speed" for #39, even though the broader Roman spec wave normally asks for staging validation before merge.
- Use real Mastra `createTool` definitions with Zod schemas, matching the #38 runtime dependency versions, because Mastra tools are not plain objects.
- Reuse exported process route helpers for graph, scoped data, and evidence shaping so the agent and API share authorization and graph behavior.
- Do not reimplement #32's graph edit reducer or #40's memory store. This slice adds an additive proposed-only `agent_edit_proposal` table and records agent events/outbound Slack intents for later human/application paths.

## Changes
- Added `server/agent/tools/index.ts` with Mastra tool definitions and direct handlers for `queryProcessGraph`, `getEvidence`, `searchWorkspace`, `lookupKnowledgeBase`, `triggerExtraction`, `proposeEdit`, `recordAgentEvent`, `postToSlack`, `pauseRun`, and `resumeRun`.
- Added `server/agent/ariadne.ts` as the runtime integration point for Ariadne instructions and the tool map.
- Exported read-only process route helpers used by tools.
- Added migration `0008_agent_tools.sql` for proposed agent edit records and agent event records.
- Added focused coverage in `tests/agent-tools.test.ts`.
- Added direct dependencies on `@mastra/core@1.66.0` and `zod@4.6.2`, matching the in-progress #38 runtime branch.

## Validation
- `npm run typecheck`: passed.
- `npm exec -- vitest run tests/agent-tools.test.ts`: passed, 9 tests.
- `npm run fix`: passed; final run reported no fixes applied.
- `npm run check`: passed; lint, typecheck, fixture validation, 155 coverage tests, guardrail probes, migration smoke, and production build passed.
- `PATH="/workspaces/ariadneos/.local-tools/ruff-x86_64-unknown-linux-gnu:$PATH" npm run check:repo`: passed after installing local Ruff 0.16.7 and Playwright Chromium; included work-item tests, Ruff checks, full app checks, dependency audit, isolated Worker/D1/API smoke, and 6 Chromium browser tests.
- `git diff --check`: passed.
- `python3 scripts/check_work_items.py --base origin/main`: passed after staging the new work-item file.

## Risks and rollback
- #38 is still open, so this work may need to provide a narrow Mastra-compatible tool interface and integrate cleanly when the runtime branch lands.
- Rollback is removing the agent tool modules, route wiring, tests, and this work item.

## Next steps
- Inspect final staged diff, open a PR with `Closes #39`, monitor CI, and merge when green. Staging verification remains skipped per explicit task instruction.
