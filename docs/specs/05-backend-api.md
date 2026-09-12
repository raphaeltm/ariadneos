# Spec 05 — Worker, D1 and API

Read [the Cloudflare contract](00-cloudflare-architecture.md) first. Extend the existing Hono
Worker and D1 database; no Python process, local SQLite server or second deployment project.
The contracts issue freezes types/schema/fixtures; runtime and API issues implement them.

## 1. D1 storage

New domain tables use `pm_` names. Existing `events`, `sessions`, usage and Better Auth tables
retain their current meanings. The schema owner must inspect merged migrations before assigning
the next migration number; PR #5 already proposes auth and Slack observation tables.

| Table | Key and contents |
|---|---|
| `pm_person`, `pm_project`, `pm_artifact`, `pm_policy` | Authored KB IDs and fields from spec 02; JSON text for arrays; optional artifact value/unit |
| `pm_workflow` | Workflow ID, project, entry/exits, ordered activity slugs, matrix, policy IDs |
| `pm_activity` | Canonical ID/slug, label, description, authored synonyms; designed workflow membership is separate |
| `pm_workflow_activity` | Workflow + activity key, expected role, rank; never overwrite another workflow's membership |
| `pm_designed_edge` | Workflow + from + to key, expected probability; authored independently of observations |
| `pm_session` | Process session ID, workspace/channel, project/workflow, status/source, scenario/variant, timestamps, suggested flag |
| `pm_message` | Composite workspace/channel/ts key, session, author, text/permalink/thread, persona/observer identity, revision, deleted flag |
| `pm_step` | ID, session/sequence, canonical activity, actor/artifact/handoff, type/intent/modality, lifecycle state, confidence/status/negated, timestamps, optional effort_days |
| `pm_step_evidence` | Step + workspace/channel/ts key, message revision; real scoped references with indexes for invalidation |
| `pm_journal` | Monotonic integer ID, scope, kind, timestamp, JSON payload, stable operation key |
| `pm_outbox` | Stable operation ID, scope, kind, payload, pending/sent/uncertain/failed, Slack ts, attempt count and next due time |
| `pm_processing` | Observation/checkpoint IDs, pending/done/error, retry and extraction-window revision metadata |

Reuse PR #5's append-only Slack observations. Do not replace that table with the mutable message
projection. Index session+sequence, scope+message timestamp, scope+journal ID, pending operations,
workflow membership and evidence references. Unique keys make retries safe. Migration smoke covers
fresh and existing demo/auth databases; never drop/reseed production data.

D1 batches commit domain updates plus journal records together. Aggregates are pure functions of
scoped done + confirmed steps and authored KB; caches may be rebuilt. Do not persist independently mutable
support counters. Seed bundled KB JSON explicitly after migrations, idempotently.

## 2. HTTP API

All data/control routes require existing authentication plus configured workspace/channel access.
Reject foreign IDs before reading evidence or controlling a runner. Health exposes readiness and
revision without channel content. Validate enums, limits and request bodies; errors use
`{error: {code, message}}`. Apply bounded pagination to lists. No secrets reach the browser.

| Method | Path | Result / behavior |
|---|---|---|
| GET | `/api/health` | Preserve `ok, environment, revision`; add KB/Slack readiness without calling Slack on every health request |
| GET | `/api/kb` | Authorized people/projects/artifacts/policies/workflows, role repertoires/artifact lifecycle definitions and allowed scenario catalog |
| GET | `/api/snapshot?project_id=&workflow_id=` | Consistent initial graph, messages, sessions, steps, conformance and journal cursor |
| GET | `/api/graph/designed?workflow_id=` | Designed graph, available before a run |
| GET | `/api/graph/discovered?project_id=&min_support=1` | Scoped aggregate mined graph |
| GET | `/api/graph/overlay?workflow_id=&min_support=1` | Union graph with derived plane, conformance, happy_path |
| GET | `/api/sessions?project_id=` | Process sessions, status, fitness and step count |
| GET | `/api/sessions/{id}` | Session, ordered steps and conformance |
| GET | `/api/sessions/{id}/graph` | Instance graph keyed by step IDs so repeated activities remain distinct |
| GET | `/api/messages?session_id=&limit=&cursor=` | Authorized Slack mirror, bounded page |
| GET | `/api/steps/{id}/evidence` | Actual author/text/permalink/message refs; deleted evidence is unavailable |
| POST | `/api/steps/{id}/status` | P1 `{status: confirmed|rejected}` → commit curation and graph diff |
| POST | `/api/sim/run` | `{scenario_id, variant, request_id}` → 202 `{session_id}`; duplicate request returns same run; busy channel returns 409 |
| POST | `/api/sim/pause`, `/api/sim/resume` | `{session_id}` → persist control before success |
| POST | `/api/ask` | P1 `{question, project_id}` → `{answer, citations, subgraph}`; adapt existing consumer with handler |
| POST | `/api/graph/rebuild` | Scoped bounded rebuild and committed deltas; no reseed |
| GET | `/api/stream?project_id=&after=` | Authorized SSE from coordinator with durable replay |

Snapshot cursor and state must describe the same committed point. Route snapshots through the
coordinator's serialized mutation boundary and return state plus cursor before later publications.
Subscribe after that cursor so a change between snapshot and stream connection is replayed.
Every scope switch obtains a new snapshot/cursor. Contract fixtures include each response and error.

Graph node fields follow spec 01; edges have a stable ID, from/to, derived plane, kind, weight,
cases, probability, is_back_edge and violates. Preserve separate designed probability and observed
session support when both planes share an edge. Session conformance uses detailed objects from
spec 04; workflow roll-up has a separately named type so missing-slug arrays and violation objects
are not confused. Empty data returns null scores, not NaN or an invented perfect score.

## 3. SSE and graph revisions

Wire frame: `id: <journal ID>` and `data: <JSON envelope>` separated by a blank line. JSON is
`{id, kind, ts, workspace_id, channel, project_id, session_id?, payload}`. Use `onmessage` and the
`kind` discriminator consistently; do not mix named SSE events with an onmessage-only client.
Native reconnect honors `Last-Event-ID`; explicit reconnect uses `after`. The header wins when both
exist. Replayed messages retain their original IDs; clients ignore already-applied IDs.

| kind | Payload |
|---|---|
| `message` | Current Message row (upsert, including edited/deleted state) |
| `session_started` | Session plus scenario/variant/project identifiers |
| `step` | Step upsert, activity label and evidence refs, including status changes |
| `graph_delta` | `{view_key, base_revision, revision, nodes_added, nodes_updated, nodes_removed, edges_added, edges_updated, edges_removed}` |
| `conformance` | `{session_id?, workflow_id, value}`; replace the relevant score object |
| `agent_post` | P1 `{kind: playbook|drift|answer, text, session_id, slack_ts}` |
| `paused`, `resumed` | `{session_id, by, reason}` |
| `session_closed` | `{session_id, conformance}` |
| `reset` | `{reason}` → obtain a new snapshot; used for expired cursor or incompatible revision |

Journal replay is P0 reconnect correctness; a user-facing time-travel interface remains P2.
Maintain graph state per view, not a single unscoped mutable graph. Remove incident edges before
removing nodes. Rejecting a final observed step either removes a discovered-only node or updates
it to a designed ghost. Updates may change topology without changing the node set.

Fan-out comes from committed journal records in the DO, not module-global Worker memory.
Bound subscriber buffers; disconnect slow clients to reconnect/replay. Clean up aborted streams,
send heartbeat comments, cap idle connection duration, and retain a documented journal window.
Unknown/expired cursor or mismatched base_revision triggers snapshot reset. On hidden pages close
the stream; on visibility restore resume from cursor. No permanent per-client D1 polling.

## 4. Bindings, configuration and local development

Keep `DB`, `AI`, `ASSETS`, `APP_ENV`, `RELEASE_SHA` and auth configuration. Add a
`CHANNEL_COORDINATOR` SQLite-backed DO binding/class migration in each environment, with isolated
staging/production namespaces. Runtime owner alone edits Wrangler and deployment workflows.

Local secrets go in ignored `.dev.vars`; deployed secrets go through the existing GitHub Actions
secret workflow per environment. `.env.example` contains names/placeholders only.

- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, existing Slack login credentials; configured allowed
  workspace/channel and workspace subdomain. A missing token leaves live features unavailable.
- `OPENROUTER_API_KEY`, `MODEL_SIM`, `MODEL_EXTRACT`, `MODEL_RAG`: configurable, server-only.
  Use native fetch with OpenRouter's OpenAI-compatible API, app attribution headers, schema output,
  timeouts/token budgets and one retry. Validate returned JSON locally regardless of provider claims.
- Window defaults: size 8, trigger 4 new messages, idle 6 seconds. Human idle gap 90 seconds,
  simulation close silence 20 seconds, post spacing >=1.2 seconds, observer spacing >=8 seconds.
- Explicit daily model/run limits and maximum run duration; suspend idle simulation and report failure.

Keep `npm ci`, `npm run db:local`, `npm run dev` and the current build/deployment commands.
Add KB-seed and transcript-generation scripts as their issues land. No Worker filesystem access,
Python dependencies, docker-compose or frontend migration. Existing Cron cleanup remains; add only
a bounded pending-work recovery pass, not a two-second cron or unbounded retry loop.

## 5. Definition of done

- Additive migrations and repeatable seed preserve old demo/auth data; designed overlay works with no runs.
- Unauthorized user cannot read another workspace's evidence, stream or control its simulator.
- Multi-client SSE agrees; reload, five-minute idle, scope switch and simulated reconnect recover correctly.
- Restart/retried alarm does not duplicate steps or support; curation removals replay correctly.
- Pure graph computation target <50 ms at demo scale; measure D1/API latency separately. Do not promise
  <100 ms end-to-end D1 rebuilds without measurements.
- A clean clone runs with existing npm/Wrangler commands; absent Slack/model credentials are explicit.
- PR checks and staging deployment pass for the recorded deployed SHA before merge.
