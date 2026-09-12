# Spec 01 — The Graph Model

**Implementation authority:** [Cloudflare contract](00-cloudflare-architecture.md) and
[scope](../SCOPE.md). Runtime, priorities and resolved edge cases there supersede older examples.


> The single most important document in this repo. Every other component reads or writes this model.
> If you change a node or edge type here, both tracks stop and re-sync.

---

## 0. The one-paragraph idea

One property graph, **three planes**. The **Org plane** is authored truth about people, projects and
policies. The **Process plane** holds activity types and the edges between them, and exists in *two
versions over the same node id-space* — `designed` (what the documentation says) and `discovered`
(what Slack proves). The **Execution plane** is the observed reality: sessions, steps and the
messages that evidence them. Because designed and discovered activities share one id-space,
**overlaying them is a set operation**, and that set operation is the product.

```
  ORG PLANE  (authored)            Person ── Project ── Artifact ── Policy
       │                              │                              │
       │ PERFORMED_BY / ACTS_ON       │ WORKS_ON                     │ GOVERNS
       ▼                              ▼                              ▼
  PROCESS PLANE                 ┌──────────────────────────────────────┐
   (designed ∪ discovered)      │            Activity                  │
                                │   slug · label · role_expected       │
                                │   plane: designed | discovered | both│
                                └───────┬──────────────────────────────┘
                                        │ FOLLOWS {plane, weight, kind}
                                        │  designed  ← N×N matrix
                                        │  discovered← directly-follows counts
                                        ▲
                                        │ INSTANCE_OF
  EXECUTION PLANE               Session ─┴─ Step ── EVIDENCED_BY ── Message
    (observed)                    (case)                              (Slack)
```

---

## 1. Node types

### 1.1 Org plane — authored, loaded from `kb/*.yaml`

| Node | Key fields | Notes |
|---|---|---|
| `Person` | `id, name, role, seniority, emoji, color, goals[], biases[], comms_style, project_ids[]` | Drives both the simulation persona **and** actor resolution in mining |
| `Project` | `id, name, summary, spec_md, constraints[], workflow_id` | Two of these. Each owns one designed workflow |
| `Artifact` | `id, type(doc\|ticket\|repo\|dashboard\|contract\|incident), name, uri, project_id` | Objects that steps act on |
| `Policy` | `id, text, kind(mandatory\|approval\|ordering\|threshold), activity_slug, project_id, params{}` | The rules the designed process claims to enforce |
| `Role` | `id, name` | Thin; mostly a label on Person and Activity |

### 1.2 Process plane — the canonical vocabulary of work

```jsonc
Activity {
  "id": "act_triage_incident",
  "slug": "triage_incident",            // snake_case verb_object — the identity key
  "label": "Triage incident",
  "description": "Assess severity and assign an owner",
  "project_id": "proj_helios" | null,   // null = cross-project activity
  "plane": "designed" | "discovered" | "both",   // ← computed, drives the overlay colours
  "role_expected": "support",           // from the designed model
  "roles_observed": ["support","eng"],  // from execution
  "support": 3,                         // distinct sessions containing it
  "occurrences": 7,                     // total steps
  "first_seen_ts": "...",
  "policy_ids": ["pol_sec_review"]
}
```

**`plane` is the whole trick.** It is derived, never authored:

| `plane` | Means | Renders as |
|---|---|---|
| `designed` | In the documentation, never observed | **dashed grey ghost node** — "documented, never happens" |
| `discovered` | Observed repeatedly, in no document | **gold node** — "nobody wrote this down, but it's how work happens" |
| `both` | Documented and observed | **green node** — conformant |

### 1.3 Execution plane

```jsonc
Session {            // the CASE. One instance of a process.
  "id": "ses_vertex_p1_002",
  "channel": "C09...",
  "project_id": "proj_helios",
  "workflow_id": "wf_p1_incident",     // designed workflow it was matched to (or null)
  "started_ts": "1757...", "ended_ts": "1757...",
  "status": "open" | "closed",
  "source": "simulation" | "human",
  "fitness": 0.78,                      // computed, see §5
  "missing": ["security_review"],       // designed-but-absent
  "extra": ["ping_ceo_directly"],       // observed-but-undocumented
  "violations": ["pol_sec_review"]
}

Step {               // one atomic unit of work, an INSTANCE of an Activity
  "id": "stp_...",
  "session_id": "ses_...",
  "seq": 4,                             // order within the session
  "activity_id": "act_triage_incident", // ← canonicalised; null until resolved
  "actor_person_id": "per_priya",       // resolved against the Org plane
  "artifact_id": "art_inc_4412",        // what it acted on
  "intent": "Decide if this is a P1 and who owns it",
  "type": "action" | "decision" | "handoff" | "wait" | "rework" | "approval",
  "handoff_to_person_id": "per_marc",
  "ts_start": "...", "ts_end": "...",
  "confidence": 0.86,
  "evidence": ["1757671234.000200", "1757671251.000300"],   // Slack message ts

  // two ORTHOGONAL axes — see work-model spec 00 §4 and §10. Do not collapse them.
  "state":  "requested" | "committed" | "in_progress" | "done"
          | "failed" | "skipped" | "abandoned",   // work lifecycle
  "status": "proposed" | "confirmed" | "rejected"  // human curation via ✅/❌
}

Message {            // evidence. The ground floor of provenance.
  "ts": "1757671234.000200",            // key with workspace_id + channel
  "channel": "C09...",
  "session_id": "ses_...",
  "author_person_id": "per_priya" | null,
  "author_label": "Priya Raman",        // falls back to Slack username for humans
  "text": "...",
  "permalink": "https://<ws>.slack.com/archives/C09.../p1757671234000200",
  "thread_ts": null
}
```

**Invariant: no Step exists without at least one `evidence` message ts.** A node you cannot click
through to a real Slack message is a hallucination, and we do not render hallucinations.

---

## 2. Edge types

| Edge | From → To | Properties | Plane |
|---|---|---|---|
| `FOLLOWS` | Activity → Activity | `plane, weight, kind, cases[], probability, is_back_edge` | Process |
| `CONTAINS` | Workflow → Activity | `rank` | Process |
| `INSTANCE_OF` | Step → Activity | `confidence` | Exec→Process |
| `NEXT` | Step → Step | `gap_seconds, kind` | Exec |
| `EVIDENCED_BY` | Step → Message | `span` | Exec→Evidence |
| `PERFORMED_BY` | Step → Person | — | Exec→Org |
| `ACTS_ON` | Step → Artifact | — | Exec→Org |
| `IN_SESSION` | Step → Session | — | Exec |
| `GOVERNS` | Policy → Activity | — | Org→Process |
| `VIOLATES` | Session → Policy | `reason, evidence[]` | derived |
| `WORKS_ON` | Person → Project | — | Org |
| `ABOUT` | Artifact → Project | — | Org |

### 2.1 `FOLLOWS.kind`

Derived deterministically from the two steps it connects — no LLM involved:

| kind | Rule |
|---|---|
| `sequence` | default |
| `handoff` | `actor_person_id` differs between the two steps |
| `rework` | target activity already appeared earlier in this session |
| `decision` | source step `type == "decision"` |
| `approval` | target step `type == "approval"` |

### 2.2 `FOLLOWS.weight`

- **discovered:** number of *distinct sessions* in which this transition directly occurs. (Not raw
  count — session support is what makes the frequency filter meaningful.)
- **designed:** `1.0` if the N×N matrix marks the transition as expected; the matrix may also carry a
  probability in `[0,1]` for likely-but-optional paths.

---

## 3. Keeping it a DAG

Work is not acyclic — rework loops back. We keep the *rendered* graph a DAG and treat cycles as
first-class annotation:

1. Build the discovered directly-follows graph.
2. Run a DFS; any edge pointing at a node already on the current DFS stack is a **back-edge** →
   `is_back_edge = true, kind = "rework"`.
3. **Layout uses the DAG (back-edges removed).** Back-edges are rendered on top as curved arcs in the
   rework colour.
4. Topological order of the DAG gives the canonical step ordering used for conformance and for the
   "happy path".

This is the whole cycle story. No SCC algorithms, no loop unrolling.

---

## 4. Workflows

```jsonc
Workflow {
  "id": "wf_p1_incident",
  "name": "Enterprise P1 incident response",
  "project_id": "proj_helios",
  "plane": "designed" | "discovered",
  "entry_activity": "detect_incident",
  "exit_activities": ["notify_customer"],
  "activity_slugs": ["detect_incident", "triage_incident", ...],
  "matrix": [[0,1,0,...], ...]          // N×N, designed plane only — see spec 02 §4
}
```

- A **designed workflow** is authored (spec 02): activity list + N×N matrix + attached policies.
- A **discovered workflow** is the subgraph of discovered activities reachable from the sessions
  matched to it — i.e. the same DAG, mined.
- **Session → workflow matching:** the entry activity of a session votes; ties break on project_id.
  If nothing matches, the session becomes a *new* discovered workflow — an entire process nobody
  documented. (Keep this; it is a great demo line.)

---

## 5. Conformance — the numbers on the screen

Computed per session and rolled up per workflow. All deterministic set arithmetic over the event log:

```
D = designed activity slugs for the matched workflow
O = observed activity slugs in this session

fitness       = |D ∩ O| / |D|                  → "78% of the documented process actually happened"
missing       = D \ O                          → dashed ghost nodes  ("documented, skipped")
extra         = O \ D                          → gold nodes          ("undocumented reality")
precision     = |D ∩ O| / |O|                  → how much of reality the doc covers
order_breaks  = observed NEXT pairs whose (a,b) is 0 in the designed matrix
violations    = policies whose constraint fails (see below)
role_dev      = activities where roles_observed ⊄ {role_expected}
                → "the CEO performed assign_owner, documented as PM, in 3 of 4 cases"
```

Three independent dimensions, per work-model spec 00 §8.3 — **control flow** (did the right things happen in
the right order), **policy** (were the rules followed), **role** (did the right people do it). Each
answers a different question a manager would actually ask, and each is cheap set arithmetic.

**Policy checks** (four kinds, each ~5 lines of code):

| kind | Check |
|---|---|
| `mandatory` | `activity_slug ∈ O` |
| `ordering` | `params.before` appears earlier in session step sequence than `params.after` |
| `approval` | a Step of type `approval` by a Person with `role ∈ params.roles` exists after `activity_slug` |
| `threshold` | if any Step's artifact carries `value > params.limit`, an `approval` must exist |

A failed check produces a `VIOLATES` edge **with the evidencing message ts attached** — so the Slack
alert can quote the exact message where the process went off the rails.

---

## 6. Near-real-time rebuild

Target: **~4s during active flow**, measured separately from the six-second sparse-window wait.
The timing below is illustrative, not a platform or model latency guarantee.

```
 t+0.0s  message posted to Slack
 t+≤2.0s webhook persists it            → SSE: message
 t+2.2s  buffered; window triggers (4 new msgs OR 6s idle)
 t+3.7s  extractor returns steps      → SSE: step  (node appears, "proposed" state, dimmed)
 t+4.5s  canonicalised → activity     → SSE: graph_delta (node settles, edge draws)
 t+4.6s  conformance recomputed       → SSE: conformance
```

**Rebuild strategy — deliberately simple:** on every delta, **recompute the entire aggregate graph
from the step table** (it is arithmetic; <50ms at our scale), then diff against the last emitted
graph and send only the delta over SSE. Correctness by construction, no incremental-update bugs at
16:00 with a judge watching.

```text
def rebuild() -> Graph:          # pure function of the step/session tables
    steps = db.steps_ordered()
    activities = aggregate_activities(steps)        # support, occurrences, roles_observed
    edges = directly_follows(steps)                 # weight = distinct sessions
    mark_back_edges(edges)
    merge_designed_plane(activities, edges)         # sets plane: designed|discovered|both
    conformance = score(sessions, designed)
    return Graph(activities, edges, conformance)
```

SSE event contract lives in spec 05 §3.

---

## 7. Canonicalisation (how a Step gets its Activity)

The only place we allow fuzzy matching, and it is guarded:

1. **Exact slug hit** on an existing Activity → attach. (Covers most steps after run 1.)
2. **Designed-first match:** ask the LLM to match the step against the *designed* activity list for
   the project. A hit here is what makes conformance possible — always try this before inventing.
3. **Discovered match:** same call, against existing discovered activities.
4. **New activity:** the LLM proposes `slug`, `label`, `description`; the activity is created with
   `plane = "discovered"` and `support = 1`.

Guard rails: slug must match `^[a-z][a-z0-9_]{2,40}$`; a new activity whose slug is within edit
distance 2 of an existing one is merged instead of created; confidence < 0.4 → the step is held as
`proposed` and never enters the aggregate graph until confirmed.

---

## 8. Graph-RAG retrieval (P1, powers `@Ariadne`)

No embeddings, no vector store. The graph *is* the index:

1. **Entity link** — one LLM call extracts mentioned entities from the question; match against
   `Person.name`, `Project.name`, `Artifact.name`, `Activity.slug/label` by normalised string match.
2. **Expand** — 2 hops from the matched seed nodes, capped at 40 nodes, preferring
   `GOVERNS`, `INSTANCE_OF`, `FOLLOWS`, `WORKS_ON`.
3. **Attach evidence** — for each Activity in the subgraph, pull its top 3 evidencing messages.
4. **Answer** — serialise the subgraph as compact JSON, one LLM call, **required to cite
   `permalink`s**. Uncited claims are stripped before posting.

---

## 9. Storage

D1 in the existing Worker binding, additive numbered migrations, and JSON text for lists.
Use `pm_` domain tables to avoid auth/demo collisions (spec 05). Load a bounded set of accepted
steps, compute aggregates in TypeScript and discard the cache safely between invocations.
Designed membership comes from the KB; observed support comes only from steps.
