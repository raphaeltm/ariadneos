# Spec 04 — Mining Engine & Observer Agent

**Implementation authority:** [Cloudflare contract](00-cloudflare-architecture.md) and
[scope](../SCOPE.md). Runtime, priorities and resolved edge cases there supersede older examples.


> Slack messages in → structured event log → discovered process graph → conformance → the agent acts.
> The LLM does the part only an LLM can do. Arithmetic does everything that must be reliable.

**Owners:** extraction, graph, conformance and observer issues · **Modules:** `server/mining/`, `shared/mining/`, `server/observer.ts`

---

## 1. The loop

```text
Signed Slack event → persist/dedupe → channel coordinator
  → normalize and route session → journal: message
  → schedule window deadline → validated extraction → canonicalize → journal: step
  → deterministic rebuild/diff → journal: graph_delta + conformance
  → P1 observer creates outgoing intent → rate-limited Slack post
```

The coordinator processes persisted pending work and durable alarms. No module-level background
poll loop. Latency target is ~4 seconds during active flow; sparse windows wait six seconds plus
model latency. Record actual timings. See spec 00 for retry/restart semantics.

---

## 2. Windowing (step 4–5)

- Window = **last 8 messages** of the session (sliding, 4-message overlap).
- Fires on **4 new messages** or **6 s idle**, whichever first. Also fires immediately on
  `session_closed`.
- The prompt receives the steps already extracted for this session, so the model continues an event
  log rather than restarting one.
- **Dedupe:** a returned step is dropped if an existing step in the session shares
  `(activity_slug, actor_person_id)` and their evidence sets overlap.

---

## 3. Extraction (the one hard LLM call)

`server/mining/extract.ts::extract(window, priorSteps, kbContext)` returns validated steps

`kb_context` is compact: the 6 people (`id`, name, role), the project's artifacts (`id`, name), and
the **designed activity slugs for this project** — so the model reaches for the documented
vocabulary first, and only invents when reality genuinely differs.

Structured output schema (enforced via `response_format: json_schema`, `strict: true`):

```jsonc
{ "steps": [{
    "activity_slug":   "security_review",        // snake_case verb_object
    "label":           "Security review",
    "actor_person_id": "per_tom",                // MUST be a KB id or null
    "artifact_id":     "art_sec_checklist",      // MUST be a KB id or null
    "intent":          "Confirm the pre-deploy checklist passed",
    "type":            "action|decision|handoff|wait|rework|approval",
    "handoff_to_person_id": "per_priya",
    "evidence":        ["1757671251.000300"],    // ≥1 Slack ts from THIS window
    "confidence":      0.86,
    "modality":        "reported"                // reported|committed|requested|negated
                                                 // work-model spec 00 §3 — decides IF a step is created
                                                 // and at which lifecycle state. "discussed"
                                                 // is never returned; it means emit nothing.
}]}
```

Prompt rules, in this order of emphasis:

1. **Classify work modality** before materializing a step. Reported work enters done; requests
   and commitments stay open. Discussion, hypothetical proposals and general questions emit nothing.
2. **Return the `modality`** (work-model spec 00 §3). It, not the prose, decides what happens next:
   `reported` → step at `done` · `committed` / `requested` → step opened, awaiting reconciliation ·
   `negated` → step at `skipped`, stored but excluded from the graph. Negated acts are **gold for the
   drift alert** — a direct, quotable admission that the documented process was bypassed.
   When in doubt the act is `discussed`, and `discussed` means emit nothing.
3. Prefer a `designed` slug from the provided list when the meaning matches.
4. `evidence` must contain real `ts` values from the window. No ts → the step is discarded by code.
5. Two-shot: one example producing 2 steps, one producing `{"steps": []}` (idle chatter).

**Failure handling:** invalid JSON → one retry at `temperature 0` → on second failure, log and skip
the window. A dropped window costs one node; a crash costs the demo.

---

## 4. Canonicalisation

Reconcile same-case requests/promises/reports per work-model spec 00 before emitting duplicate
steps; only done + confirmed steps enter the DFG. Retain modality, lifecycle and curation separately.

Per spec 01 §7: exact slug → designed match → discovered match → new activity.
The LLM adjudication call is **batched per window** and only sees unmatched slugs plus a compact
`[{id, slug, label}]` list. Typical cost: 0 or 1 call per window.

Guards: slug regex `^[a-z][a-z0-9_]{2,40}$`; edit distance ≤2 to an existing slug → merge;
`confidence < 0.4` → step stays `proposed` and is excluded from `rebuild()`.

---

## 5. Graph construction (deterministic — no LLM)

```text
def directly_follows(steps) -> Edges:
    for session in group_by_session(steps):
        for a, b in pairwise(sorted(session, key=seq)):
            e = edges[(a.activity_id, b.activity_id)]
            e.cases.add(session.id)
            e.kind = classify(a, b)      # handoff | rework | decision | approval | sequence
    for e in edges: e.weight = len(e.cases)
```

Then `mark_back_edges()` (DFS, spec 01 §3) and `merge_designed_plane()`, which sets each activity's
`plane` to `designed` / `discovered` / `both` — the field that drives the entire overlay visual.

**Derived metrics** (free, all on the canvas):

| Metric | Definition |
|---|---|
| `support` | distinct sessions containing the activity |
| `rework_rate` | sessions where the activity occurs >1× / support |
| `handoff_count` | in-edges with `kind == handoff` |
| `avg_dwell` | mean seconds between first and last evidence ts |
| `happy_path` | highest-weight path from entry to exit over the DAG (greedy, ties → higher support) |

---

## 6. Conformance

Per spec 01 §5. Runs on every `graph_delta` for the open session and on `session_closed` for the
roll-up. Output shape:

```jsonc
{ "session_id":"ses_…", "workflow_id":"wf_p1_incident",
  "fitness":0.78, "precision":0.70,
  "missing":[{"slug":"security_review","seen_in_sessions":3,"of":4}],
  "extra":[{"slug":"escalate_to_ceo","occurrences":4},{"slug":"improvise_hotfix","occurrences":2}],
  "order_breaks":[{"from":"root_cause_analysis","to":"deploy_fix","expected_between":"security_review"}],
  "violations":[{"policy_id":"pol_sec_review","text":"A security review must complete before any production deploy.",
                 "evidence":["1757671251.000300"],"quote":"skipping the checklist to save time"}],
  "role_deviations":[{"slug":"assign_owner","expected":"pm","observed":"ceo",
                      "sessions":3,"of":4,"evidence":["1757671001.000100"]}],
  "unreconciled":[{"slug":"write_postmortem","state":"committed","actor":"per_lea",
                   "quote":"i'll write it up monday"}] }
```

The `quote` + `evidence` pair is what makes the Slack alert land: it names the policy **and** shows
the message that broke it.

---

## 7. The observer acts (`server/observer.ts`, P1)

### 7.1 Process-start recognition → suggest → **pause**

After each `graph_delta` on an **open** session with ≥2 confirmed steps:

```
match = best_workflow_match(session.activities)      # Jaccard over entry + first activities
if match.score ≥ 0.5 and not session.suggested:
    post playbook to Slack, react with ✅/❌/✋, set session.suggested = True
    if match.workflow has unfinished mandatory policies → PAUSE the simulator
```

Slack message:

> 🧵 **This looks like _Enterprise P1 incident response_** — I've seen it 3 times.
> Typical path: `triage → open ticket → assign owner → reproduce → root cause → ` **`security review`** ` → deploy → verify → notify`
> ⚠️ In 2 of 3 previous runs the team skipped **security review** at exactly this point.
> ✅ follow the playbook · ❌ not this process · ✋ hold, I'll decide

Pausing here is the point: **the simulated team stops and waits for a human.** That is the agentic
beat, and it is what separates this from a dashboard.

### 7.2 Drift alert

Fires when, within an open session, (a) a `negated` step maps to a designed activity, or (b) an
observed transition has `matrix[a][b] == 0` and skips a mandatory activity.

> ⚠️ **Process drift — INC-4412**
> `deploy_fix` followed `root_cause_analysis` directly. The documented process requires
> **`security_review`** in between (policy `pol_sec_review`).
> Evidence: _"skipping the checklist to save time"_ — Tom Becker, 09:41 → [open in Slack ↗]
> This is the 3rd time in 4 runs. Conformance on this session: **72%**.

### 7.3 `@Ariadne` Q&A

Any non-agent message containing the bot mention → `rag.answer()` (spec 02 §6) → threaded reply
with permalink citations. Answers come from the **mined** graph, so the good demo question is one no
document can answer: *"what do we actually do when a P1 hits an enterprise account?"*

### 7.4 Reaction curation

Consume signed reaction events for existing messages, idempotently. An oldest-ts history cursor
will not observe later reactions on old messages. Resolve the target proposal or suggestion from
a persisted Slack-ts → step/session mapping. On an Ariadne step-proposal message:
✅ → `step.status = confirmed` (enters the graph) · ❌ → `rejected` (removed, activity support
decremented) · ✋ → pause. Every reaction emits `graph_delta`, so the canvas moves when a human
reacts in Slack. **Do this on camera.**

### 7.5 Evidence acknowledgement

When a message becomes evidence for a confirmed step, Ariadne adds a 🧵 reaction to it. Cheap,
constant, and it makes the channel visibly *watched* — the thread motif, literally.

---

## 8. Guard rails

| Rule | Why |
|---|---|
| Never mine Ariadne's own messages (`is_agent`) | no feedback loops |
| Max 1 Slack post per 8 s from the observer | the channel must stay readable |
| Never post two drift alerts for the same policy in one session | no nagging |
| Step with no evidence ts → discarded in code, not by the prompt | provenance invariant |
| `rebuild()` is a pure function of the step table | one source of truth |

---

## 9. Definition of done

- [ ] A performed transcript yields ≥8 steps with ≥90% having a resolvable `actor_person_id`
- [ ] `expected_deviations` in the transcript are all present in `conformance.extra` or `violations`
- [ ] Measure active-flow message-to-node latency against ~4 s target; report sparse-window latency separately
- [ ] Running helios v2 after v1 raises `support` on shared activities and creates ≥2 gold nodes
- [ ] P1: The drift alert fires in Slack with a real quote and a working permalink
- [ ] P1: ❌ on a proposed step removes the node from the canvas within 3 s
