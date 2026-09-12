# Cloudflare implementation contract

Status: implementation plan, adapted on 2026-09-12 at the user's explicit direction.
Read this alongside [the work model](00-work-model.md), then specs 01–07. This document and the revised scope replace the original
Python/Docker/polling-only assumptions; domain behavior remains Roman's design.
These are requirements for follow-up implementation, not a claim that features are deployed.

## 1. Smallest deployment

| Concern | Decision | Reason |
|---|---|---|
| API and hosting | Existing TypeScript Hono Worker + Vite/React static assets | Keep the deployed service, domains, npm tooling and GitHub Actions |
| Persistent domain data | Existing environment-specific D1, additive SQL migrations | SQL/JSON is enough for a small property graph; retain current demo and auth data |
| Coordination | One SQLite-backed `ChannelCoordinator` Durable Object per configured workspace/channel | Persist simulation position, pause, extraction deadlines and delivery retries across requests |
| Live UI | SSE through Worker → coordinator, with D1 journal replay | Keep native EventSource; avoid an additional service or framework |
| Slack input | Existing signed Events API work in PR #5; Web API history for bounded reconciliation | Handles messages, thread replies and reactions without permanent two-second polling |
| Slack output | Native fetch to Web API with one configured bot token | Preserve six customized persona authors; MCP is not a runtime dependency |
| Models | Small typed fetch adapter to OpenRouter for spec extraction/generation/RAG | Keep sponsor/provider intent; no large orchestration SDK. Existing Workers AI demo continues to work |
| Retrieval | D1 indexed entity/synonym lookup + intent-specific bounded graph traversal | No embeddings needed for the specified graph-RAG |
| Vectorize | Deferred until semantic retrieval demonstrates a gap | Avoid ingestion/indexing, extra secrets and an additional consistency problem |
| Queues / Workflows / R2 / containers | Not required for this wave | Add only with a measured need, not as foundation work |
| UI | Existing React Flow/dagre and CSS; use existing state patterns | No second Vite project, mandatory Zustand or Tailwind migration |

The root remains marketing and the app remains `/app` (PR #7). Reuse Better Auth and
Slack login (PR #5); sign-in is not proof that a user can read every workspace's channel.
Authorize the configured demo workspace/channel explicitly on every graph, evidence,
stream and control route. No multi-workspace onboarding product in this wave.

## 2. Durable processing without an always-running server

1. Verify Slack signatures and persist the original observation before returning 2xx.
   Reuse PR #5's event deduplication and retain edits/deletions in that journal.
2. Mark observations pending in D1. Notify the channel coordinator and persist its next alarm
   before acknowledging when possible. If notification fails, retain pending work for the
   existing scheduled Worker to reconcile in bounded batches. Do not rely on `waitUntil`
   as a durable queue or on a browser staying connected.
3. Coordinator normalizes pending observations, routes sessions, schedules window extraction,
   simulation beats and close deadlines. Store the next due times in durable storage and set
   the single alarm to their minimum. Explicitly serialize domain mutations across async work;
   being in a Durable Object does not make arbitrary interleaved awaits a transaction.
4. D1 remains authoritative for messages, steps, runs, revisions, journal and outgoing intents.
   DO storage is operational state only, not a second graph database. D1 and DO writes are
   not one transaction: use stable operation IDs, recoverable checkpoints and replay.
5. Commit domain updates and their journal records together using D1 batches where possible.
   Publish only committed journal entries. A failed/retried alarm must not duplicate steps,
   support counts or control events. Recover missed broadcasts from the journal.
6. Simulation performs one due beat at a time (at least 1.2 seconds apart), persists progress,
   checks pause between beats and schedules the next alarm. Close only after final extraction
   drains and 20 seconds of silence; human-only sessions use the 90-second idle boundary.
7. Schedule no recurring alarm with no work. A demo has one active run/channel, at most
   2,000 retained steps in an aggregation window, bounded transcripts, bounded LLM calls,
   token limits, timeouts, one retry and a daily budget. Exhaustion is visible and recoverable.

Alarms are at-least-once, not exact-time or exactly-once. Persist outgoing Slack intents keyed
by session/beat or session/policy; reconcile an ambiguous post using its metadata before retrying.
Do not claim exactly-once external posting. An unresolved delivery pauses the run with a useful error.

SSE is acceptable for a short demo but connected streams keep the DO active. Limit subscribers,
close hidden-page streams, clean up disconnected clients, rotate idle connections and use replay.
Do not implement a permanent per-client D1 polling loop. Hibernating WebSockets are a later
optimization if sustained use justifies changing transport; SSE does not hibernate.

## 3. Shared contracts and resolved inconsistencies

The contracts/fixtures issue owns `shared/contracts.ts` and the initial schema migration. Other
agents consume these exports; they do not independently redefine JSON payloads or schema.

- Use `proj_helios` and `proj_atlas` throughout; Vertex is the customer, not a third project.
  Six people; Helios has 11 designed activities, Atlas eight. Five cached transcript variants.
- Activity identity remains `act_<slug>` in the shared vocabulary. Designed membership belongs
  to workflows; observed aggregates must be scoped to authorized workspace/project/workflow.
  A matching slug in Atlas does not add support to Helios. `plane` is derived per view.
- A process session is not a Better Auth session or the existing anonymous demo cookie session.
  Use `pm_` table names for new domain tables to avoid collisions with auth/current demo tables.
- Message identity is workspace + channel + Slack timestamp, all strings. Evidence must resolve
  inside that scope and session. Keep original observations and a current message projection.
  Edited/deleted evidence invalidates affected extraction and triggers a rebuild; no dangling quotes.
- Step `state` (requested/committed/in_progress/done/failed/skipped/abandoned) and curation
  `status` (proposed/confirmed/rejected) are independent. Persist work-act modality and reconcile
  a request/promise with its eventual report within the case. Rebuild input is confirmed,
  non-negated steps whose lifecycle state is `done`. Confidence >= 0.4 becomes curation `confirmed` after
  validation/canonicalization unless explicitly rejected by a human. Lower confidence remains
  `proposed` until human confirmation. Human confirmation does not silently turn a promise into
  completed work. Only evidence advances lifecycle. Never fabricate evidence or substitute fixture steps in live mode.
- Proposed steps appear as temporary cards, not aggregate support. Rejecting the last occurrence
  removes an undocumented node; documented membership survives as a ghost.
- Precedence for edge kind: rework, approval, decision, handoff, sequence. Null actors alone do not
  prove a handoff. Mark DFS back-edges deterministically and exclude them from layout/happy-path.
- Work-model role repertoires are priors, not permission gates. Keep role deviations and artifact
  lifecycle jumps as separately evidenced findings; apply deterministic confidence adjustments once.
  An artifact jump is possible missing observation, not proof that real-world work was skipped.
- Policy ordering uses session step sequence, not a cross-session topological ordering. Missing
  mandatory work on an open case is pending unless an explicit skip or downstream action proves
  a breach; close evaluates final omissions. Missing/unknown threshold values are unknown, not passed.
  Artifacts carry optional numeric `value` and `unit`; steps carry optional numeric `effort_days`.
  Approval for >20 engineer-days is required after `estimate_effort`, by CEO; credit approval uses
  artifact value >10,000 and CEO/CPO. Never invent monetary or effort values from absent data.
- Empty denominators produce null scores (UI: no observations). Roll-ups include closed sessions;
  open-case metrics are explicitly provisional. Unmatched sessions retain a discovered workflow.
- Graph-RAG and interactive Slack curation are P1, after the live mining/overlay path is green.
  Atlas content is prepared with fixtures, but live Atlas rehearsal follows the Helios P0 gate.
- Four seconds is an active-flow target, not a hard promise for single-message idle windows.
  Record ingest, extraction and UI times. With a six-second idle trigger, sparse messages take
  at least that wait plus model latency; never report a synthetic fallback as live success.

## 4. Compatibility and delivery

Existing PRs own separate work: #2 quality tooling and #7 marketing/routing are merged;
#5 owns Slack login/raw events. Roman added work-model and graph-RAG detail in 31906b5; these
requirements belong to the existing contracts, KB, extraction, conformance and RAG issues.
Rebase on their merged work where needed. Do not remove their behavior, replace auth tables,
rewrite the homepage, or bypass checks to meet the original smoke-only instruction.

Keep new routes additive until the new UI is integrated. `/api/ask` already exists: migrate it
with its consumer or version the new handler temporarily. Preserve health `environment` and
`revision`, deployment smoke compatibility, account isolation and existing demo routes meanwhile.

Only the runtime owner changes Wrangler bindings/DO class migrations and deployment wiring;
only the schema owner allocates the initial `pm_` migration after checking current main. Subsequent
schema changes require a new numbered migration, never editing an applied migration. Configure
separate staging/production namespaces and D1 bindings. Apply schema before code; no destructive
migration or production reseed. KB seeding is idempotent and explicit, not every request/Worker boot.

Every implementation issue requires its agent to create a PR, run repository gates, watch CI
through the staging deployment, verify the deployed revision and issue acceptance criteria, fix
failures and merge when green. A draft PR does not trigger the existing staging job: mark ready
when ready. Staging is shared; verify the Actions run's deployed merge SHA, not merely the PR head
or the latest hostname contents. If another PR replaces staging, rerun the intended deployment
and verification. Rebase after dependency merges and rerun checks for the resulting revision.
Do not use an admin bypass. After merge monitor the main deployment and report its outcome.
Keep a work-item log with changes, rationale, validation, PR/run URLs and remaining limitations.

## 5. Platform references checked 2026-09-12

- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/): one alarm
  per object, durable scheduling, at-least-once retry; drives the coordinator choice.
- [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): active duration
  and requests matter; bounded demo activity matters more than adding infrastructure.
- [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/): transactional batches
  for related writes; no transaction spanning D1 and a DO.
- [Worker lifetime limits](https://developers.cloudflare.com/workers/platform/limits/): background
  continuation is bounded; persistent work belongs in durable scheduling.
- [Slack Events API](https://docs.slack.dev/apis/events-api/): events and retries support push ingestion.
- [Slack Web API limits](https://docs.slack.dev/apis/web-api/rate-limits/) and
  [history](https://docs.slack.dev/reference/methods/conversations.history/): honor Retry-After;
  history is not a complete thread/reaction change stream and app-class rate limits differ.

No new paid service or fixed price is assumed. Verify account capabilities and credentials in the
runtime issue; if unavailable, report the precise blocker without switching hosting architecture.
