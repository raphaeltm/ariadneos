# Slack observation normalization

Status: done
Owner: Codex for Raphael
Source: GitHub issue #17 asks for signed Slack webhook events to become typed, scoped mining observation records with evidence provenance and workspace/channel boundaries. PR #5 Slack login/raw event storage is merged; issue #14 contracts/schema are merged; issue #16 coordinator work merged while this branch was in review.
Branch: sam/implement-github-issue-17-sb92kb

## Intent
Normalize already-verified Slack Events API message callbacks into the process-mining foundation tables without replacing PR #5's append-only raw event journal. The change should produce scoped message records, processing checkpoints and journal entries that the coordinator/mining work can consume while preserving workspace/channel isolation and source provenance.

## Acceptance criteria
- Signed Slack message, edit and delete events update `pm_message` by workspace/channel/Slack timestamp with stable evidence identity and provenance.
- Duplicate Slack retries remain idempotent across raw storage, current message projection, processing checkpoint and journal operation keys.
- Workspace/channel boundaries are part of every normalized record; same event/message timestamp in another workspace remains separate.
- Out-of-order edits/deletes preserve raw observations and update the current projection without fabricating sessions or work acts.
- Local focused behavior tests plus repository quality/context checks pass.

## Decisions and rationale
- Keep raw signed delivery in `slack_message_events` as the source record because PR #5 owns that durable observation table.
- Use the merged #14 `pm_message`, `pm_processing` and `pm_journal` tables as the mining handoff surface instead of adding another persistence path.
- After rebasing on merged issue #16, preserve its allowed workspace/channel coordinator wakeup while replacing its minimal pending row write with the richer normalized message projection.

## Changes
- Added `server/slack-observations.ts` to replay the append-only `slack_message_events` history for a scoped Slack message and project it into `pm_message`, `pm_processing` and `pm_journal`.
- Wired the signed Slack Events API handler to normalize only after raw event persistence succeeds, preserving retry behavior when storage fails.
- Added optional `SLACK_WORKSPACE` and `SLACK_PROJECT_ID` configuration for permalink construction and journal project scope, with `proj_helios` as the current Slack demo default.
- Extended Slack event tests for retry deduplication, workspace isolation, edits/deletes arriving before originals, metadata-derived session/person provenance, observer bot exclusion and retryable persistence failures.
- Rebased onto merged issue #16 and kept the real `ChannelCoordinator` wakeup after normalization succeeds.

## Validation
- `npm test -- tests/slack-events.test.ts` passed: 16 Slack receiver/normalization tests.
- `npm run fix` passed after style fixes.
- `npm run check` passed: Biome, strict TypeScript, fixture validation, 60 coverage tests, guardrail probes, process-mining migration smoke and production build.
- `python3 scripts/check_work_items.py --base origin/main` passed after staging this task's work item for the gate.
- `PATH=/tmp/ariadneos-tools/ruff-x86_64-unknown-linux-gnu:$PATH npm run check:repo` passed before and after rebasing onto origin/main at 7292906 and e1ffff0: Python work-item tests, work-item validation, Ruff check/format, full app check with 116 coverage tests after the latest rebase, dependency audit, isolated Worker/D1 smoke and 5 Chromium browser tests.
- PR #61 CI passed: Work item context, Quality, Secret scan, CodeQL analysis, deploy validate and automated staging job in Actions run 34696313618. Manual staging verification was skipped per the user's time-critical instruction.
- A later PR #61 CI run failed because main advanced through issue #16 and made the PR merge ref dirty. Rebased onto origin/main at e1ffff0 and resolved the Slack receiver by combining #16 coordinator wakeup with this normalization layer.

## Risks and rollback
- The normalizer creates deterministic Slack session routing IDs for messages without trusted `metadata.event_payload.session_id`; the merged coordinator owns promotion into the full channel/session lifecycle.
- Rollback is to revert the server/test/work-item changes. The schema is already additive from issue #14.

## Next steps
- Merge PR #61 and monitor the main deployment outcome.
