# Working in AriadneOS

1. Read `CONTRIBUTING.md`, then relevant records in `docs/work-items/` before changing files. Check the current branch, working tree, open PRs, and remote commits; another agent may be working concurrently.
2. Create or update a dated work item from `docs/work-items/TEMPLATE.md` at the start of every task, including documentation and maintenance. Record intent and acceptance criteria before implementation. Use a separate file for unrelated work to reduce conflicts.
3. Record decisions and their reasons, changed behavior, commands and actual results, unresolved risks, and concrete next steps as work progresses. Identify the human/task/session when available; never require access to a private chat to understand the result.
4. Keep work on a task branch. Preserve unrelated edits. Link related work items and PRs; do not silently absorb another agent's unfinished branch.
5. Run `python3 scripts/check_quality.py` and the context check described in `CONTRIBUTING.md`. Application changes also need meaningful behavior checks and the app's test/typecheck/build commands.
6. Open a PR using the template. Update the work item for review feedback. A reviewer should be able to understand what changed, why, and how it was checked from repository files alone.
7. Leave explicit handoff instructions when stopping. Distinguish observed facts, previous-session reports, proposals, and verified deployments. Never put credentials, tokens, private payloads, or full chat transcripts in logs.

Follow explicit user authorization for publishing/deployment; opening a PR does not itself authorize merging or deployment. Durable cross-cutting decisions belong in `docs/decisions/` when needed, linked from the work item. Correct outdated decisions with a superseding record instead of silently rewriting history.
