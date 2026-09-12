# Spec 11 — Backend (Cloudflare Workers)

> **Supersedes spec 05**, which described a FastAPI/SQLite backend that does not exist.
> This is the real thing: Hono on Workers, D1, additive migrations, and the endpoints specs 08, 09
> and 10 need.

---

## 1. Shape

```
                       ┌──────────────────────────────────────────────┐
  Slack #ops-war-room  │  WORKER (Hono)                               │
      │  ▲             │   /api/*        API surface (§4)             │
      │  │             │   /*            static assets (ASSETS)       │
      │  │             │   scheduled()   cleanup + safety-net poll    │
      │  └─── post ────┤                                              │
      └────── poll ───►│   D1: events · messages · edits · agent_events│
                       └───────────────┬──────────────────────────────┘
                                       │ service binding (env.AGENT)
                                       ▼
                       ┌──────────────────────────────────────────────┐
                       │  MASTRA WORKER — miningWorkflow + ariadne    │  spec 10
                       └──────────────────────────────────────────────┘
```

Everything stays scoped by `session_id` exactly as `events` already is, so one visitor's run never
touches another's and the existing 24-hour cleanup sweeps all new tables too.

---

## 2. Migrations — additive only

`0001` and `0002` are untouched. Three new migrations:

```sql
-- 0003_edits.sql
CREATE TABLE edits (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, workflow TEXT NOT NULL,
  action TEXT NOT NULL, payload TEXT NOT NULL, actor TEXT NOT NULL,
  rationale TEXT, status TEXT NOT NULL DEFAULT 'applied',   -- applied | proposed | rejected
  created_at INTEGER NOT NULL, undone INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX edits_session_workflow ON edits(session_id, workflow, created_at);

-- 0004_messages.sql
CREATE TABLE messages (
  ts TEXT NOT NULL, channel TEXT NOT NULL, session_id TEXT NOT NULL,
  author_id TEXT, author_label TEXT NOT NULL, text TEXT NOT NULL,
  permalink TEXT NOT NULL, thread_ts TEXT, is_agent INTEGER NOT NULL DEFAULT 0,
  workspace TEXT NOT NULL DEFAULT 'demo', reactions TEXT,
  PRIMARY KEY (channel, ts)
);
CREATE INDEX messages_session ON messages(session_id, ts);
CREATE TABLE cursors (channel TEXT PRIMARY KEY, last_ts TEXT NOT NULL);

-- 0005_agent_events.sql
CREATE TABLE agent_events (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, workflow TEXT NOT NULL,
  kind TEXT NOT NULL, text TEXT NOT NULL, citations TEXT NOT NULL DEFAULT '[]',
  nodes TEXT NOT NULL DEFAULT '[]', case_id TEXT, policy_id TEXT,
  pauses INTEGER NOT NULL DEFAULT 0, resolution TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX agent_events_session ON agent_events(session_id, created_at);
```

`events` keeps its shape. New per-event fields from spec 08 §5.1 (`messages`, `modality`, `state`,
`status`, `confidence`, `workspace`) live inside the existing `payload` JSON blob — **no ALTER
TABLE, no backfill, and old rows keep parsing** because every new field is optional.

---

## 3. The designed plane

Authored in TypeScript, not the database — it is code, it is reviewed in PRs, and it needs no
migration:

```ts
// shared/designed.ts
export const designed: Record<WorkflowId, DesignedModel> = { access: {...}, refund: {...}, vendor: {...} };
```

The **effective** model is the authored baseline plus the session's edit log (spec 09 §8):

```ts
effectiveDesigned(designed[workflow], editsFor(sessionId, workflow))
```

Baseline immutable, edits replayable, undo trivial, demo resettable by clearing the log.

---

## 4. Endpoints

Existing endpoints keep every field they return today. New fields are added, none removed.

### Existing, extended

| Endpoint | Change |
|---|---|
| `GET /api/health` | add `agent: boolean`, `slack: boolean` — what is actually wired |
| `GET /api/model` | add `conformance`, `designed`, `designedEdges`, `links`, `workspace` |
| `GET /api/context` | add `conformance`; keep the limitations array and **keep it accurate** |
| `POST /api/simulate` | **return `events[]`** — this is what makes UJ1's prefix replay work |
| `POST /api/ask` | route through the Mastra agent; add `citations: MessageRef[]`, `nodes: string[]`; keep the statistics fallback exactly as it is |

### New

| Method | Path | Body → Returns |
|---|---|---|
| `GET` | `/api/designed?workflow=` | the documented plane alone — renderable before any run |
| `GET` | `/api/workspaces` | `[{ channel, id, name, workflows }]` |
| `GET` | `/api/links?workspace=` | `WorkflowLink[]` for the L0 graph |
| `GET` | `/api/messages?sessionId=&limit=` | the conversation rail |
| `GET` | `/api/agent/events?workflow=` | `AgentEvent[]` |
| `POST` | `/api/agent/decision` | `{ caseId, decision, eventId }` → resumes a paused run |
| `POST` | `/api/model/edit` | `{ action, payload, workflow }` → `{ conformance, designed, edit }` |
| `POST` | `/api/model/edit/undo` | `{ workflow }` → `{ conformance, designed }` |
| `POST` | `/api/model/reconcile` | `{ accept: string[], workflow }` → one `Edit` covering all |
| `GET` | `/api/model/edits?workflow=` | the audit trail, including `proposed` agent edits |
| `POST` | `/api/steps/:id/status` | `{ status }` → confirm / reject a mined step |
| `POST` | `/api/slack/poll` | drains new Slack messages → runs `miningWorkflow` → returns new events + agent events |

**Every mutating endpoint returns the recomputed conformance**, so the UI never guesses what an edit
did and never needs a follow-up fetch.

Validation stays server-side and independent of the UI: promoting a node that is not `discovered`,
or retiring one that is not `designed`, is a `400`.

All new `POST` routes inherit the existing middleware — 4 KB body limit, same-origin check,
`no-store`. New routes must not bypass it.

---

## 5. Slack ingestion

**Client-driven during a run, cron as the safety net.** Workers cron fires at best once a minute,
which is far too slow to watch a graph build; a Durable Object with alarms would be correct and
costs time we don't have.

```
UI open and a run active  →  POST /api/slack/poll every 2 s
scheduled() (existing)    →  drain once per minute as a backstop + the existing cleanup
```

`/api/slack/poll`:

1. read `cursors.last_ts` for the channel
2. `conversations.history(channel, oldest=last_ts)` — ascending
3. drop `is_agent` messages (never mine our own output)
4. insert into `messages`, construct permalinks locally (no extra API call):
   `https://{workspace}.slack.com/archives/{channel}/p{ts without the dot}`
5. correlate to a case: message `metadata.session_id` → `thread_ts` → open session → 90 s idle gap
6. hand the window to `miningWorkflow` (spec 10 §4) via the service binding
7. advance the cursor, return `{ agentEvents, events, messages }`

Rate discipline: ≥1.1 s between posts, one channel. Poll is idempotent — the cursor only advances
on a successful write, so a failed poll replays rather than skipping.

### Degradation ladder — the UI renders all three

| Mode | When | Grounding |
|---|---|---|
| **Slack live** | token present, poll succeeding | real permalinks, steps `grounded` |
| **Seeded** | no token, or Slack failing | synthetic `MessageRef`s, no permalink, steps `inferred` |
| **Today's behaviour** | mining disabled | events only, no message layer |

**Never claim a permalink that does not exist.** A step is `grounded` only when it carries a real
Slack message reference, and the header's "grounded %" must reflect that honestly.

---

## 6. Module map

```
shared/
  process.ts        mine(events, designed?) → + conformance, designedEdges   [spec 08 §5.2]
  designed.ts       authored designed models + policies for the 3 workflows  [§3]
  conform.ts        control-flow · policy · role scoring                     [spec 01 §5]
  edits.ts          effectiveDesigned(base, edits), applyEdit, undo          [spec 09 §8]
  links.ts          WorkflowLink derivation from shared artifacts            [spec 08 §3]
  simulation.ts     unchanged
server/
  index.ts          routes only — thin, delegates to shared/*
  slack.ts          post · poll · permalink · reactions                      [§5]
  agent.ts          service-binding client for the Mastra worker             [spec 10 §3]
src/agent/          Mastra worker: models · tools · ariadne · miningWorkflow [spec 10]
```

`server/index.ts` is already 325 lines of routing. Keep logic in `shared/` so it stays testable by
`vitest` without a Worker runtime — that is why the mining core is testable today and must remain so.

---

## 7. Non-negotiables

| Rule | Why |
|---|---|
| `model.edges` stays **discovered-only** | `tests/process.test.ts` asserts `count === evidence.length` and probabilities summing to 1 |
| Every new `ActivityEvent` field is optional | seeded rows must keep parsing |
| No `ALTER TABLE` on `events` | new fields ride inside `payload` |
| `npm run check` passes before every push | lint, typecheck, tests, coverage, guardrails, build |
| Secrets only via `wrangler secret` | never in `wrangler.jsonc`, never committed |
| Quotas apply to agent calls too | the existing `usage` table already does this — reuse it |

---

## 8. Definition of done

- [ ] `npm run check` green
- [ ] `GET /api/designed?workflow=access` returns a documented DAG with zero events present
- [ ] `POST /api/simulate` returns its events and the client replays them into a growing graph
- [ ] `POST /api/slack/poll` is idempotent — running it twice ingests nothing twice
- [ ] `POST /api/model/edit` returns recomputed conformance in the same response
- [ ] Illegal edits are rejected with a 400 by the server, not only by the UI
- [ ] With no Slack token the app still runs, and reports steps as `inferred`, not `grounded`
- [ ] `/api/health` reports honestly which of Slack and the agent are actually wired
