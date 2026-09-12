# Cloudflare spec implementation assignments

Roman's product design is adapted to the deployed TypeScript/Hono Worker, D1, Vite/React and
GitHub Actions. Use one channel Durable Object for durable scheduling and replayable SSE.
Use existing Slack Events API/auth work; defer Vectorize, extra hosting and new frameworks.

Read [scope](SCOPE.md), [architecture/contracts](specs/00-cloudflare-architecture.md), then the
issue's domain specs. This is a plan and assignment backlog, not implemented product behavior.

Tracking: [GitHub issue #29](https://github.com/raphaeltm/ariadneos/issues/29).

## Assignments

Each row is one bounded agent assignment/PR. Issue bodies contain owned modules, explicit
exclusions, acceptance checks, dependencies and the full delivery requirements.

| Issue | Deliverable | Priority | Dependencies |
|---|---|---|---|
| [#14](https://github.com/raphaeltm/ariadneos/issues/14) | Freeze TypeScript graph contracts, D1 schema and integration fixtures | P0 | None |
| [#15](https://github.com/raphaeltm/ariadneos/issues/15) | Author and seed the organization KB and designed workflows | P0 | [#14](https://github.com/raphaeltm/ariadneos/issues/14) |
| [#16](https://github.com/raphaeltm/ariadneos/issues/16) | Add channel Durable Object scheduling and journal SSE transport | P0 | [#14](https://github.com/raphaeltm/ariadneos/issues/14) |
| [#17](https://github.com/raphaeltm/ariadneos/issues/17) | Normalize signed Slack observations into scoped mining input | P0 | [#14](https://github.com/raphaeltm/ariadneos/issues/14), [#16](https://github.com/raphaeltm/ariadneos/issues/16), [PR #5](https://github.com/raphaeltm/ariadneos/pull/5) |
| [#18](https://github.com/raphaeltm/ariadneos/issues/18) | Perform cached persona transcripts with durable run controls | P0 | [#14](https://github.com/raphaeltm/ariadneos/issues/14), [#15](https://github.com/raphaeltm/ariadneos/issues/15), [#16](https://github.com/raphaeltm/ariadneos/issues/16), [#17](https://github.com/raphaeltm/ariadneos/issues/17) |
| [#19](https://github.com/raphaeltm/ariadneos/issues/19) | Extract and canonicalize evidence-backed steps with bounded model calls | P0 | [#14](https://github.com/raphaeltm/ariadneos/issues/14), [#15](https://github.com/raphaeltm/ariadneos/issues/15) |
| [#20](https://github.com/raphaeltm/ariadneos/issues/20) | Implement deterministic instance and aggregate graph mining | P0 | [#14](https://github.com/raphaeltm/ariadneos/issues/14) |
| [#21](https://github.com/raphaeltm/ariadneos/issues/21) | Score workflow conformance and evidence-linked policy violations | P0 | [#14](https://github.com/raphaeltm/ariadneos/issues/14), [#15](https://github.com/raphaeltm/ariadneos/issues/15), [#20](https://github.com/raphaeltm/ariadneos/issues/20) |
| [#22](https://github.com/raphaeltm/ariadneos/issues/22) | Connect mining services to authenticated snapshot and graph APIs | P0 | [#16](https://github.com/raphaeltm/ariadneos/issues/16), [#17](https://github.com/raphaeltm/ariadneos/issues/17), [#19](https://github.com/raphaeltm/ariadneos/issues/19), [#20](https://github.com/raphaeltm/ariadneos/issues/20), [#21](https://github.com/raphaeltm/ariadneos/issues/21), [#18](https://github.com/raphaeltm/ariadneos/issues/18) |
| [#23](https://github.com/raphaeltm/ariadneos/issues/23) | Build typed snapshot/SSE client and app state against fixtures | P0 | [#14](https://github.com/raphaeltm/ariadneos/issues/14) |
| [#24](https://github.com/raphaeltm/ariadneos/issues/24) | Render designed/discovered workflow canvas and support controls | P0 | [#14](https://github.com/raphaeltm/ariadneos/issues/14), [#23](https://github.com/raphaeltm/ariadneos/issues/23) |
| [#25](https://github.com/raphaeltm/ariadneos/issues/25) | Integrate the /app shell, Slack rail and evidence inspector | P0 | [#14](https://github.com/raphaeltm/ariadneos/issues/14), [#23](https://github.com/raphaeltm/ariadneos/issues/23), [#24](https://github.com/raphaeltm/ariadneos/issues/24), [PR #7](https://github.com/raphaeltm/ariadneos/pull/7), [PR #5](https://github.com/raphaeltm/ariadneos/pull/5), [#22](https://github.com/raphaeltm/ariadneos/issues/22) for live integration |
| [#26](https://github.com/raphaeltm/ariadneos/issues/26) | Add playbook, drift and reaction-driven observer actions | P1 | [#22](https://github.com/raphaeltm/ariadneos/issues/22), [#25](https://github.com/raphaeltm/ariadneos/issues/25) |
| [#27](https://github.com/raphaeltm/ariadneos/issues/27) | Answer process questions with bounded graph retrieval and Slack citations | P1 | [#22](https://github.com/raphaeltm/ariadneos/issues/22) |
| [#28](https://github.com/raphaeltm/ariadneos/issues/28) | Verify the deployed Slack mining demo and record acceptance evidence | P0 gate / P1 follow-up | [#22](https://github.com/raphaeltm/ariadneos/issues/22), [#25](https://github.com/raphaeltm/ariadneos/issues/25) |

## Parallel assignment order

1. Start #14 contracts/schema/fixtures. Keep #2 quality (now merged), #5 Slack auth/events and
   #7 homepage/routing under their existing owners; do not dispatch duplicates.
2. After #14, parallel lanes are #15 KB, #16 runtime, #20 deterministic graph and #23 client.
   With four available agents, these are four independent assignments.
3. #19 extraction follows KB; #21 conformance follows KB + graph; #24 canvas follows client;
   #17 Slack input follows runtime + existing PR #5. Each lane can progress independently.
4. #18 simulator follows Slack/runtime/KB. #22 connects the merged backend modules. #25 integrates
   the UI after canvas and API; it can prepare evidence components against fixtures earlier.
5. #28 records the P0 rehearsal checkpoint after #22/#25. A successful P0 checkpoint unlocks
   #26 observer and #27 RAG in parallel. #28 then records P1 verification after those merge.
   Do not require #28 to be closed before P1: its documented P0 checkpoint is the gate.

No implementation agents were launched as part of preparing this backlog. Assign issues when ready.

## Shared-file ownership and merge rules

- #14 owns initial schema/contracts. All agents propose contract changes there before changing consumers.
- #16 owns Wrangler, DO class/alarm transport, deployment and recovery scheduling.
- #17 owns the narrow hook into existing Slack events. #18 owns simulator control handler module;
  #22 mounts/composes route modules and service hooks without rewriting their implementations.
- #23 owns store/network interfaces; #24 owns canvas subtree; #25 owns the /app composition and
  evidence panels. Use existing naming conventions from merged main, not historical filenames.
- #19 owns shared model adapter. Simulator can perform committed transcripts independently;
  optional generator integration follows the adapter contract, without changing model module ownership.
- Add npm scripts/dependencies only for the owned feature; rebase lockfile changes sequentially.

Foundation PRs (#14–#16, #19–#21, #23–#24) prove their module behavior using contract fixtures,
local runtime/DB checks and unchanged-app staging smoke. They may merge before their consumers.
Full live UI/model acceptance belongs to #22/#25/#28, not a circular dependency on unfinished APIs.
#18 can validate controlled staging Slack posting through its own authorized run/control module;
mining-drain integration is completed by #22. Fixtures never count as evidence of live extraction.

Every agent must **create a PR → run required checks → monitor staging deployment → verify the
current deployed revision → fix failures → merge when green**. Record PR/Actions URLs and staging
acceptance in a dated work-item log. Rebase and rerun after dependency updates. Do not bypass checks.
Staging is shared: confirm the Actions merge SHA still matches the deployed revision when verifying.
Mark PR ready to trigger staging; skipped staging is not green. Monitor main deployment after merge.

## External prerequisites and cut line

PR #5 owns Slack login/signing configuration. Live demo needs the configured dedicated workspace,
bot token with persona customization, subscriptions/channel membership and OpenRouter secret.
Verify staging and production use different channels/resources. Record missing inputs as blockers;
do not launch a company-workspace simulation or claim an offline fixture is live evidence.

P0 is Helios observation → extraction → overlay/evidence with pause/replay and human input.
P1 adds observer actions, cited Q&A and live Atlas. Defer Vectorize, CopilotKit, Exa, replay UI and
additional connectors. Preserve existing auth, marketing route and deployment gates throughout.
