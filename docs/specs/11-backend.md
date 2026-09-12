# Spec 11 — Editing & Agent API (delta over spec 05)

> **Not a competing backend spec.** [Spec 05](05-backend-api.md) and the
> [Cloudflare implementation contract](00-cloudflare-architecture.md) are the runtime authority:
> Hono Worker, D1, `ChannelCoordinator` Durable Object, SSE with journal replay, Slack Events API.
> This document adds only what those two do not cover — the **graph editing verbs** from spec 09 and
> the **agent surface** from spec 10.

An earlier revision of this file duplicated spec 05 with a polling-based design. That was written
before the Cloudflare contract landed. It has been cut; where the two disagreed, **spec 05 wins**.

---

## 1. What spec 05 already covers — do not redefine

`/api/health` · `/api/kb` · `/api/snapshot` · `/api/graph/designed` · `/api/graph/discovered` ·
`/api/graph/overlay` · `/api/sessions` · `/api/sessions/{id}` · `/api/sessions/{id}/graph` ·
`/api/messages` · `/api/steps/{id}/evidence` · `/api/steps/{id}/status` · `/api/sim/run` ·
`/api/sim/pause` · `/api/sim/resume` · `/api/ask` · `/api/graph/rebuild` · `/api/stream`

Transport is SSE from the coordinator with durable replay. Ingestion is the signed Events API with
Web API history for bounded reconciliation. Nothing below changes any of that.

---

## 2. New: graph editing

Spec 09 makes the canvas the place the process model is repaired. Spec 05 has `/api/steps/{id}/status`
for confirming a mined step, but nothing for the **model-level** verbs.

| Method | Path | Body → Returns |
|---|---|---|
| `POST` | `/api/model/edit` | `{action, payload, request_id, workflow_id}` → `{conformance, designed, edit, revision}` |
| `POST` | `/api/model/edit/undo` | `{workflow_id}` → `{conformance, designed, revision}` |
| `POST` | `/api/model/reconcile` | `{accept: string[], request_id, workflow_id}` → one `Edit` covering all |
| `GET` | `/api/model/edits?workflow_id=` | `Edit[]`, including agent proposals awaiting a human |

`action` ∈ `confirm | merge | promote | reject | rename | require | retire` (spec 09 §4).

**Rules, inherited from spec 05's conventions rather than invented here:**

- Every response carries the **recomputed conformance and the new graph revision**, so the client
  never guesses what an edit did and SSE consumers can reconcile by revision.
- Edits emit a `graph_delta` on the coordinator stream like any other change — an edit made in one
  browser must appear in another.
- `request_id` for idempotency, matching `/api/sim/run`.
- Server-side legality: promoting a node that is not `discovered`, or retiring one that is not
  `designed`, is a `400`. The UI is not the only enforcement.
- Scope authorization applies exactly as it does to every graph route.

### 2.1 Storage

```sql
-- migration: additive, alongside the spec 05 tables
CREATE TABLE edits (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, workflow_id TEXT NOT NULL,
  action TEXT NOT NULL, payload TEXT NOT NULL, actor TEXT NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'applied',    -- applied | proposed | rejected
  request_id TEXT, created_at INTEGER NOT NULL, undone INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX edits_request ON edits(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX edits_scope_workflow ON edits(scope, workflow_id, created_at);
```

The authored designed model stays **immutable**; the effective model is baseline + edit log
(spec 09 §8). Undo is dropping the last entry and recomputing — which also gives the audit trail,
the diff view, and a demo that resets by clearing the log.

---

## 3. New: the agent surface

| Method | Path | Body → Returns |
|---|---|---|
| `GET` | `/api/agent/events?session_id=` | `AgentEvent[]` — playbook, drift, answer |
| `POST` | `/api/agent/decision` | `{decision: approve\|hold\|reject, event_id, request_id}` → resolves a paused run |

`AgentEvent` is defined in spec 08 §5.4. Agent events are journaled and replayed on the existing SSE
stream as `agent_post`; they are not a second transport.

`/api/agent/decision` with `approve` is what resumes a run paused by a `playbook` event — it calls
the same coordinator control path as `/api/sim/resume` rather than a parallel one.

### 3.1 Agent-proposed edits

`proposeEdit` (spec 10 §5.3) writes an `edits` row with `status: 'proposed'` and a `rationale`. It
**cannot** write `applied`. A human promotes it via `/api/model/edit`, and the log records that the
agent proposed and a person decided.

This is the guarantee worth stating in the write-up: an LLM cannot silently rewrite the process
model, structurally rather than by convention.

---

## 4. Reconciling the model layer with spec 10

The Cloudflare contract says: *"Small typed fetch adapter to OpenRouter… no large orchestration SDK."*
Spec 10 introduces **Mastra**, at the user's explicit direction on 2026-09-12. Where they conflict,
Mastra wins for the agent and mining-workflow layer, and the contract wins for everything else —
runtime, storage, transport, ingestion, auth.

Practical consequence, and the thing to check first:

- Mastra must run **inside the existing Worker** or as a second Worker reached by service binding.
  It must not introduce a second hosting target, a second database, or its own HTTP server.
- If Mastra's bundle size or Node-compat fights Workers, **fall back to the contract's typed fetch
  adapter** and keep the agent's tool boundaries and prompts exactly as spec 10 defines them. The
  design in spec 10 — two surfaces, tool set, `proposeEdit`, guardrails — is independent of whether
  Mastra or a hand-rolled adapter executes it.
- `AGENT_ENABLED=false` leaves graph, conformance and editing fully working either way.

---

## 5. Definition of done

- [ ] Editing verbs return recomputed conformance **and** a graph revision
- [ ] An edit in one browser reaches another through the existing SSE stream
- [ ] Replayed `request_id` returns the original result rather than editing twice
- [ ] Illegal edits are rejected server-side with a `400`
- [ ] `⌘Z` undoes a bulk reconcile as one step
- [ ] An agent proposal is visible on the canvas as pending, with its rationale, and cannot self-apply
- [ ] Nothing in this spec duplicates or contradicts spec 05
