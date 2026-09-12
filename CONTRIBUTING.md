# Contributing and sharing context

Every change travels with a small work item in [`docs/work-items/`](docs/work-items/README.md). This is the shared memory for humans and agents across developers. Chat and SAM can supply background; repository records must explain the work without requiring access to those systems.

## Start and hand off work

1. Fetch the remote, inspect open PRs and related work items, and create a task branch from the intended base. Avoid editing another task's branch without coordination.
2. Copy the template to `docs/work-items/YYYY-MM-DD-short-topic.md`. Fill in ownership, source, intent, acceptance criteria, and initial next steps. Commit it with the work; keep it current at useful milestones.
3. Implement a focused change. Log reasons and evidence, including failed checks that affect the handoff. Link durable architecture decisions rather than duplicating them.
4. Run the checks below, open a PR, and link the work item in the PR body. Set its status to `in-review`. Update the same record when review changes the implementation.
5. Before merge, resolve discussions and have a human assess behavior, evidence, scope, and operational risks. Mark the item `done` when acceptance criteria are met, or leave the next owner a concrete remaining action. `done` means implementation is complete; GitHub is authoritative for merge status.

Keep notes concise and factual. A good next step names the action, relevant file/system, prerequisite, and expected evidence. Use `None — <reason>` for sections with nothing to report. Do not mark unrun tests as passing. Small documentation changes still need a short record, not a large design document.

## Local and PR checks

Run from the repository root with Python 3.11+ (standard library only):

```sh
python3 scripts/check_quality.py
git fetch origin main
python3 scripts/check_work_items.py --base origin/main
```

The context check uses the merge base and requires an added or modified work-item file in the change. It checks required metadata and nonempty sections, rejects template placeholders, and rejects deletion of historical records. It cannot judge whether the explanation is accurate; that is a review responsibility. CI also checks that the PR body links a changed work item. Editing only the template or index does not satisfy the gate.

The `Quality` job runs gate regression tests and checks whitespace. When a root `package.json` exists, it requires a committed `package-lock.json` and `test`, `typecheck`, and `build` scripts, then runs `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`. This is the contract for integrating the pending demo. If its package layout or script names differ, adapt the quality runner in the application PR and preserve equivalent checks. CI uses Node 22. No application exists on this PR's base, so current checks do not claim to validate the demo.

GitHub Actions runs `Work item context` and `Quality` for every PR and push to `main`, without path filters. CI has read-only repository permissions and no deployment credentials. Pull request code runs with `pull_request`, never `pull_request_target`. Changes to gates themselves require particularly careful review; a PR can modify its own workflow.

## Repository settings to enforce before relying on gates

A repository administrator must configure an active ruleset for `main`:

- Require a pull request and at least one approval from someone other than the author; dismiss stale approvals after new commits.
- Require resolution of review conversations.
- Require checks named `Work item context` and `Quality`, with the branch up to date before merging.
- Block force pushes and branch deletion; keep bypass access limited and explicit.

These are recommended settings, **not settings applied by this PR**. The available integration returned HTTP 403 when reading branch protection. After this workflow has run, select its exact check names in GitHub settings and verify enforcement with a deliberately failing PR. If there is only one maintainer, decide explicitly how independent review will be provided before enabling the approval rule.

## Review and deployment

Review the work item alongside the diff. Confirm acceptance criteria, test evidence, user-visible behavior, compatibility, and rollback implications. For UI changes include a screenshot or describe the manual check. For database changes explain migration order and recovery. Keep secrets and personal/customer data out of both CI and work records.

Deployment is a separate action after review and relevant authorization. Record the commit deployed, target environment, migration steps, smoke-check evidence, and rollback procedure in the work item. A successful build is not proof of a successful deployment. Never treat an unverified URL or a previous agent's progress message as deployment evidence.
