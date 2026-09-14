# Remove all demo data and operate on real Slack data

Status: in-progress
Owner: Claude agent (Opus 5) for Raphaël Titsworth-Morin
Source: SAM task 01M2G63M344A7561TBGK02DX26. The requester asked to remove every
piece of demo data and make the app production ready on real Slack data only, and
authorized doing the work in-session including creating and merging PRs. The audit
that preceded this is `2026-09-14-demo-data-removal-audit.md`.
Branch: sam/still-bunch-demo-data-02dx26

## Intent

Make the application operate exclusively on observed Slack messages, and remove the
synthetic organization and the simulator that produced it.

The audit found this is not a deletion task. The simulator was the only writer of
`pm_session` rows, and the whole read path starts from `pm_session`, so real Slack
messages were already invisible to the app. Five pipeline links had to be built
before the demo content could be removed without leaving a non-functional app.

## Acceptance criteria

- No file under `src/`, `server/`, `shared/`, `migrations/`, `fixtures/` or `kb/`
  contains a fictional organization, persona or synthetic event generator.
- A message posted in a configured real Slack channel becomes a visible process
  session, an extracted step with message citations, and a graph node, with no
  simulator invocation.
- A workspace can define its own project and workflow; `project_id` is validated
  against tenant rows in D1, not against checked-in JSON.
- Demo-only routes and their UI controls are gone.
- Marketing, auth-gate and in-app copy make no claim of simulated data.
- `npm run check:repo` passes with the fixture-dependent tests replaced by tests
  against the real pipeline.

## Decisions and rationale

- **Tenancy from Slack identity.** The Slack OIDC profile carries the signing
  user's workspace, so `slackTeamId` is captured on the user record and scopes
  every request. The alternative, keeping a server-configured channel, cannot
  isolate one workspace's messages from another's. Recorded as
  `docs/decisions/2026-09-14-no-simulated-data.md`.
- **Session segmentation is deterministic and model-free.** A thread is one case;
  channel-level messages group by an idle window. Using a model to decide case
  boundaries would make the same message history produce different cases on each
  run, which destroys the comparability process mining depends on.
- **Kept the `AuthoredKb` shape, moved its source.** `readTenantKb(db, workspaceId)`
  returns the same shape the mining, conformance and UI layers already consumed, so
  the designed-vs-discovered comparison is unchanged and only authorship moved from
  repository files to rows a workspace owns. This avoided rewriting the mining stack.
- **`0002_seed.sql` is a tombstone, not a deletion.** It is already recorded as
  applied in the deployed databases. Keeping an empty file preserves a gap-free
  history; deleting it would leave an unexplained gap for the next reader.
- **Auth schema generator became a validator.** It was rewriting
  `0003_better_auth.sql` in place. On a deployed database that silently does
  nothing, because 0003 is already applied, so the new columns would never exist in
  production while passing locally. It now fails if a migration is missing a column
  Better Auth expects, and the new columns are added additively in 0010.
- **Artifacts and threshold policies return empty rather than inferred.** Slack
  observation has no artifact value source. Inventing one from message text would
  produce conformance findings with no evidence behind them.
- **Worker and D1 are still named `ariadneos-demo`.** Renaming a Cloudflare Worker
  creates a new Worker, orphaning the channel Durable Object namespace and requiring
  the custom domains to be reattached. That is a manually sequenced infrastructure
  change, not something to bundle with a code deploy, and it cannot be verified from
  here. Flagged in `docs/deployment.md` and reported to the requester.

## Changes

Pipeline (new):
- `server/slack/client.ts` — the first Slack Web API client in the repository:
  `auth.test`, `users.info`, `conversations.list/info/history/replies`,
  `chat.postMessage`, and OAuth v2 bot-token exchange, with rate-limit aware retry.
- `server/tenant/sessions.ts` — session segmentation. This is the link whose absence
  made real Slack data invisible.
- `server/pipeline/extraction.ts` — drains `pm_processing` through the real
  OpenRouter adapter, canonicalizes against authored activities, persists `pm_step`
  and `pm_step_evidence`.
- `server/pipeline/outbox.ts` — delivers queued agent posts with backoff.
  `pm_outbox` rows were previously written and never read.
- `server/pipeline/backfill.ts` — bounded `conversations.history` reconciliation.
- `server/pipeline/hooks.ts` — wires the above into the coordinator's extraction,
  beat and recovery deadlines, which previously returned `undefined`.
- `server/tenant/{installs,people,kb,authoring}.ts` — install and channel records,
  Slack user resolution to stable person ids, the D1-backed knowledge base, and
  validated authoring of projects, workflows and policies.
- `server/routes/setup.ts` — install, channel configuration, process authoring and
  role assignment.
- `server/process-data.ts` — scoped reads, graph construction and conformance moved
  out of the route module so routes and the background pipeline share one
  implementation.

Removed (~6,500 lines): `shared/fixtures.ts`, `shared/fixture-validation.ts`,
`shared/simulation.ts`, `shared/process.ts`, `shared/graph-edits.ts`,
`server/demo/`, `server/kb.ts`, `src/demo-walkthrough.ts`, `src/process-graph.tsx`,
`src/legacy-canvas-bridge.ts`, `src/curation.ts`, `kb/`, `fixtures/`, the
seed/simulator/fixture scripts, the legacy simulation API in `server/index.ts`,
`/api/sim/*`, and the demo walkthrough and run controls in the client.

Bugs found and fixed while removing the demo layer:
- The canvas emitted a `reject` graph edit action the server did not accept, so
  "Reject node" returned `invalid_action`. It now maps to `remove_node`.
- `scripts/generate-auth-schema.ts` rewrote an applied migration (above).
- `pm_message` had no provenance column, so simulated and real messages were
  indistinguishable once written. Added `source`.

## Validation

- `npm run typecheck` — clean across `server/`, `src/`, `shared/`, `scripts/`.
- `npx biome check --error-on-warnings` — clean across `server/`, `src/`, `shared/`,
  `scripts/`, zero warnings.
- `npm run build` — passes.
- `npm run test:migration` — passes on a fresh database and on an upgraded one,
  asserting the synthetic stores are dropped while auth users and raw
  signature-verified Slack events survive.
- `npx vitest run tests/slack-events.test.ts` — 24 pass. Covers author resolution,
  session opening, thread grouping, idle-window segmentation, re-queue on edit, and
  that an unenabled channel or uninstalled workspace derives no process data.
- `npx vitest run tests/process-canvas.test.ts` — 14 pass, against graphs built by
  the real miner rather than a hand-written fixture.
- `npx vitest run tests/auth.test.ts` — 21 pass, including that a session without a
  Slack workspace is refused rather than falling back to a shared scope.
- `npx vitest run tests/client-state.test.ts tests/inspector.test.ts` — 13 pass.
- Not yet run at the time of writing: the full `npm run check:repo`, the browser
  suite, and staging verification. Four test files were still being migrated.
- Not verified: end-to-end behaviour against a real Slack workspace. That needs a
  Slack app install against a deployed host and is the main outstanding risk.

## Risks and rollback

- The migration deletes all existing `pm_*` process rows and drops the legacy
  tables. That is the intent, and the rows are synthetic, but it is not reversible
  without a database restore. Raw `slack_message_events` and `auth_*` rows are
  preserved.
- Extraction quality on real messages is unproven. The extractor and its retry and
  validation paths are unchanged and well covered, but their behaviour on arbitrary
  Slack text has not been observed. The failure mode is degraded extraction that
  produces no steps, not corrupted ones: a step is only written when it carries
  evidence timestamps from the window.
- Rollback is `git revert` of this branch plus a D1 restore if observations matter.

## Next steps

- Finish migrating `tests/agent-tools.test.ts`, `tests/agent-memory-route.test.ts`,
  `tests/process-routes.test.ts`, `tests/model-edit-consistency.test.ts` and the
  browser suite, then run `npm run check:repo`.
- Style the `setup-` class hooks in `src/components/setup/setup-view.tsx`; the
  markup reuses existing classes but the new wrappers are unstyled.
- Install the Slack app into a real workspace against staging and verify the loop
  end to end. Until that happens, "works on real Slack data" is an argument from
  code and tests, not an observation.
- Decide whether to rename the `ariadneos-demo` Worker and database, which requires
  a manual Cloudflare sequence.
