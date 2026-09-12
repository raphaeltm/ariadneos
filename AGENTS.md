# Working in AriadneOS

1. Read `CONTRIBUTING.md`, then relevant records in `docs/work-items/` before changing files. Check the current branch, working tree, open PRs, and remote commits; another agent may be working concurrently.
2. Create or update a dated work item from `docs/work-items/TEMPLATE.md` at the start of every task, including documentation and maintenance. Record intent and acceptance criteria before implementation. Use a separate file for unrelated work to reduce conflicts.
3. Record decisions and their reasons, changed behavior, commands and actual results, unresolved risks, and concrete next steps as work progresses. Identify the human/task/session when available; never require access to a private chat to understand the result.
4. Keep work on a task branch. Preserve unrelated edits. Link related work items and PRs; do not silently absorb another agent's unfinished branch.
5. Run `python3 scripts/check_quality.py` and the context check described in `CONTRIBUTING.md`. Application changes also need meaningful behavior checks and the app's test/typecheck/build commands.
6. Open a PR using the template. Update the work item for review feedback. A reviewer should be able to understand what changed, why, and how it was checked from repository files alone.
7. Leave explicit handoff instructions when stopping. Distinguish observed facts, previous-session reports, proposals, and verified deployments. Never put credentials, tokens, private payloads, or full chat transcripts in logs.

Follow explicit user authorization for publishing/deployment; opening a PR does not itself authorize merging or deployment. Durable cross-cutting decisions belong in `docs/decisions/` when needed, linked from the work item. Correct outdated decisions with a superseding record instead of silently rewriting history.

## Agent quality loop

- Read `docs/code-quality.md` before implementation. Install the locked tools with `npm ci`; use Node 22 and Ruff 0.16.7. Editor/agent tooling must use this repository's Biome configuration.
- Work in small changes. Run `npm run fix` for safe mechanical fixes, inspect the diff, then run `npm run check`. Never run unsafe autofixes without reviewing each changed behavior. Use `npm run check:repo` before handoff for Python checks, dependency audit, and isolated API/browser tests too.
- Fix causes of diagnostics. Do not lower coverage, disable tests, add broad ignores, remove strict compiler flags, or bypass hooks to make a change pass. A legitimate exception needs a narrow scope and a reason in the config/work item, with equivalent verification where possible.
- Add regression tests for changed behavior: malformed inputs and failure paths for APIs, ordering/deduplication/evidence for mining, and keyboard/navigation/refresh for UI. Do not equate a passing linter or high coverage with correctness.
- Keep external data untrusted until validated; TypeScript assertions are not runtime validation. Preserve session isolation, parameterized SQL, body/origin limits, and the separation of observations from simulation truth.
- Review the final diff after tools run. Check accidental public API changes, unchecked promises, secrets, permissions, and unrelated churn. Record exact check outcomes and unresolved limitations in the work item.
- Dependabot PRs need the same context and review: add a work item with compatibility evidence before merge. Never exempt bots from the quality gates.
