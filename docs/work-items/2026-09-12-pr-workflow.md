# PR workflow and shared agent context

Status: in-review
Owner: Workflow agent for raphaeltm
Source: User request to establish PR gates and shared work logs; SAM task 01M2AK4S0C30WKNCRV70Z2229J, session 45c35065-4036-440a-bf64-267a6c6fd343
Branch: sam/use-sam-mcp-tools-z2229j

## Intent
Make every change reviewable and understandable by agents working for different developers, with durable reasons, validation evidence, and explicit next actions in the repository.

## Acceptance criteria
- Contributors and agents have one documented workflow and a reusable work-item template.
- PR checks require an added/updated work item and a PR-body link to it.
- Quality checks validate the gate itself and define an application test/typecheck/build contract.
- Capture available parent-session context without presenting reported progress as verified deployment.
- Open a PR and report any enforcement limitations.

## Decisions and rationale
- Use one Markdown file per work item to keep records readable in Git and reduce shared-index conflicts; no external service or new runtime dependency is required.
- Use Python's standard library for the context gate so it runs on the current documentation-only base and remains independent of the demo stack.
- Treat semantic quality, independent review, and deployment evidence as human review responsibilities; structural checks cannot establish their truth.
- Keep this PR independent of the ongoing demo branch, with an explicit integration contract for its application checks.

## Changes
- Added agent instructions, contribution guide, PR template, work-item template and recovered demo handoff.
- Added read-only GitHub Actions checks on all PRs and main pushes, with pinned actions, timeouts, and cancellation of superseded runs.
- Added work-item validation with PR-link enforcement and gate regression tests covering missing context, incomplete metadata, placeholders, deletion, updates, and symlinks.
- Documented admin settings for protected main and a separate deployment evidence workflow.

## Validation
- `python3 scripts/check_quality.py` passed: eight regression tests, all work-item records, and tracked-file whitespace checks. No root application package exists on this base, so application tests were not run.
- `python3 scripts/check_work_items.py --base origin/main` and `git diff --cached --check` passed.
- Both pinned action SHAs were verified against their GitHub release tags.
- GitHub branch-protection read returned HTTP 403 (Resource not accessible by integration); settings cannot be verified or configured with this access.
- Parent-session messages and remote branch snapshot were inspected; see the linked [demo handoff](2026-09-12-cloudflare-demo-handoff.md).

## Risks and rollback
- CI checks become mandatory only after an administrator enables the documented ruleset. This PR does not claim merge enforcement is active.
- PR authors can change CI scripts; independent review of workflow changes remains necessary.
- Application checks depend on integrating the demo with the documented root npm contract or an equivalent adaptation.
- Revert this PR to remove the workflow, or correct the gate in a follow-up PR with a work item if it blocks legitimate work. No runtime or deployment state is changed.

## Next steps
- Workflow agent: run checks, publish this branch, create the PR, and inspect CI results.
- Repository administrator: configure the main ruleset from `CONTRIBUTING.md` after checks appear, then verify enforcement with a failing PR.
- Demo integrator: follow the [demo handoff](2026-09-12-cloudflare-demo-handoff.md) and wire equivalent application checks when merging the implementation.
