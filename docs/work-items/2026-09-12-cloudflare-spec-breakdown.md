# Adapt Roman's specs and prepare agent assignments

Status: in-review
Owner: Codex, requested by the repository owner
Source: SAM task 01M2APERJ9K2AYZKCFXXN93Q5P; user requested scoped issues for Roman's specs, PR/staging/green-merge instructions, then explicitly directed TypeScript/Cloudflare adaptation.
Branch: sam/specs-pushed-roman-take-n93q5p

## Intent
Make Roman's process-mining design implementable on the existing deployment and divide it into
independent, reviewable agent assignments with concrete acceptance criteria and dependency order.

## Acceptance criteria
- Revised scope/specs use existing Worker/D1/React, bounded DO coordination and Slack webhook work.
- Real GitHub issues specify owners, exclusions, dependencies, validation and PR/staging/merge requirements.
- Plan preserves six bot personas, evidence fidelity, existing auth/marketing work and quality gates.
- Documentation checks and required PR CI/staging checks pass; implementation is clearly future work.

## Decisions and rationale
- User chose existing TypeScript/Cloudflare over original Python/FastAPI/Docker. D1 holds the small
  graph; one channel DO handles timed jobs and SSE. Vectorize is deferred because bounded SQL graph
  retrieval satisfies the specified behavior without embedding/index infrastructure.
- Reuse PR #5 signed observations and Slack login instead of building polling-only infrastructure.
  Keep PR #7 homepage ownership. Synced main after quality PR #2 merged and read its new instructions.
- Added one contract owner and resolved session naming, scoped evidence, deletion deltas, snapshot
  replay, provisional conformance, numeric policy inputs and unrealistic sparse-message latency.
- Preserve Roman's latest persona change from 1536070; no Slack MCP runtime or separate persona apps.

## Changes
- Added docs/specs/00-cloudflare-architecture.md and rewrote scope/backend requirements; aligned
  all domain specs while retaining domain examples and the six-person simulator design.
- Added docs/implementation-plan.md with 15 implementation issues (#14–#28), tracking issue #29,
  parallel lanes and shared-file ownership. Issues are created but no agents have been dispatched.
- Every issue directs its agent to open a PR, watch required CI through staging, verify its deployed
  revision, repair failures and merge when green; full live acceptance belongs to integration gates.

- Incorporated Roman's concurrent 31906b5 work-model/graph-RAG specs, preserving modality/lifecycle,
  role conformance, authored synonyms and six retrieval intents; mapped additions into existing issues.
  Resolved the KB merge conflict and corrected the lifecycle example to reconcile the same activity.

## Validation
- Read all specs, source/API, migrations, deployment workflow, open PRs and SAM task context.
- Checked official Cloudflare alarms/D1/Worker lifetime/pricing and Slack event/history/rate-limit
  documentation; supporting links are in spec 00. No exact price or account capability is assumed.
- git diff --check, relative Markdown links/code fences and 15-issue dependency DAG checks passed.
- python3 scripts/check_work_items.py --base origin/main passed. Full quality runner passed context
  tests, Ruff, lint/types, 22 unit tests/coverage, guardrail probes, build, dependency audit and
  isolated D1/API smoke; local Chromium launch initially failed due to missing libnspr4.so.
  Installed documented Playwright OS dependencies and reran npm run test:e2e successfully:
  isolated API smoke and both Chromium tests passed. No gate was disabled.
- After integrating main 31906b5, python3 scripts/check_quality.py passed in full, including
  all 22 unit tests, isolated D1/API smoke and four Chromium homepage/app tests.
- Documentation PR: https://github.com/raphaeltm/ariadneos/pull/30. Its Actions checks and deployment
  record are authoritative for current CI/staging status; no planned feature is claimed deployed.

## Risks and rollback
- Documentation/issue changes only; no runtime resources or Slack messages were created. Revert
  this documentation PR to recover prior specs; issues can be edited/closed independently.
- Slack/model configuration and actual future features remain unverified. Original timeline is
  historical; P0 rehearsal gates P1. SSE connections have active-duration cost and must be bounded.
- Staging is shared; each implementing agent must check its own deployed Actions revision.

## Next steps
- Watch PR #30 checks/staging and merge when green under the requested workflow; record final
  Actions/revision evidence in the PR description. GitHub is authoritative for merge status.
- Assign #14 first, then follow docs/implementation-plan.md. Future implementation agents own live acceptance.
