# Ariadne operates only on observed Slack data

Status: accepted
Date: 2026-09-14
Supersedes: the demo-workspace and simulation-runtime portions of
`docs/SCOPE.md`, `docs/specs/03-simulation-and-slack.md`,
`docs/specs/12-simulation-runtime-and-demo.md`,
`docs/specs/13-demo-workspace.md` and `docs/specs/14-demo-and-submission.md`.
Work item: `docs/work-items/2026-09-14-demo-data-removal.md`

## Decision

The application has no simulated data, no simulator, and no checked-in knowledge
base. Every activity, transition, session and citation in a process graph derives
from a message observed in a Slack channel that a workspace explicitly connected.

The designed plane is authored by the workspace through the Setup surface and
stored per workspace in D1. It is no longer a set of JSON files in the repository.

## Why

The earlier design used a synthetic organization (two projects, six personas,
cached transcripts) to demonstrate the observation → discovery → explanation loop
without a Slack connection. That made the loop legible, but it had two
consequences that blocked production use.

First, the simulator was not a layer on top of a working product; it was the only
writer of `pm_session` rows, and the whole read path starts from `pm_session`.
Real Slack messages were being stored and were invisible to the app. The demo was
not masking an incomplete pipeline — it *was* the pipeline.

Second, the simulator wrote its fabricated sessions, messages, steps and
permalinks into the same tables and under the same channel scope as real
observations, and `pm_message` had no provenance column. Any authenticated user
could inject fabricated evidence into the production scope, and once written it
was indistinguishable from real data. A process model whose evidence cannot be
trusted is worse than no model.

## Consequences

- A new deployment renders nothing until a workspace completes setup. This is
  correct and is surfaced as an onboarding flow rather than an empty canvas.
- Conformance requires the workspace to author its intended process first. The
  discovered plane works without it; the overlay does not.
- Extraction requires `OPENROUTER_API_KEY`. Without it, messages are stored and
  queued but produce no steps, and the app says so instead of appearing broken.
- Threshold policies cannot fire. They compare artifact values, and Slack
  observation alone has no artifact source. Artifacts and their lifecycles are
  empty rather than inferred from message text.
- Tenancy is per Slack workspace, derived from the signed-in user's Slack OIDC
  profile. A session without a workspace is refused rather than defaulting to a
  shared scope.
- `RoleId` is an open, workspace-authored identifier. It was previously a closed
  union of the fictional personas' roles.

## Alternatives considered

**Keep a demo mode behind a flag.** Rejected. The failure that mattered was
fabricated rows in production tables under the production scope; a flag does not
remove that risk, it just makes it conditional. A demo also has to be maintained
against every schema change, and its keyword-matching extractor could never
exercise the real model path, so it would keep passing while the real path broke.

**Seed a sample workspace on first run.** Rejected for the same provenance
reason, and because the value of the product is a map of *your* process. A sample
map of someone else's process is a screenshot, and belongs on the marketing page.
