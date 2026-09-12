# Spec 00 — The Work Model

> What counts as work, who can do it, what it acts on, and how an utterance becomes a node.
> Conceptually this comes before spec 01: the graph model stores what this document defines.

---

## 1. The ladder

Six levels. Confusing two of them is the single most common way conversational process mining
produces garbage, so they are named separately and never used interchangeably.

| Level | Is | Example | Persisted as |
|---|---|---|---|
| **Utterance** | a Slack message | `"skipping the security checklist to save time"` | `Message` |
| **Work act** | a claim *about* work carried inside an utterance | Tom declares `security_review` will not happen | (transient — the extractor's output unit) |
| **Step** | one atomic unit of work, materialised | `security_review` · actor `per_tom` · state `skipped` | `Step` |
| **Activity** | the *type* a step instantiates | `security_review` | `Activity` |
| **Case** | one connected pursuit of an outcome | resolving INC-4412 | `Session` |
| **Process** | the recurring pattern over activities | Enterprise P1 incident response | `Workflow` |

**An utterance is not work. It is evidence of work.** People narrate, promise, argue and complain;
only some of that corresponds to a state change in the world.

---

## 2. Definition of work

> **A unit of work is a state change in the world, attributable to one actor, acting on one object,
> with an intent, at a time — evidenced by one or more utterances.**

All five are required. Drop any one and it is not a step:

| Component | Field | If missing |
|---|---|---|
| actor | `actor_person_id` | unattributable → confidence penalty, held as `proposed` |
| action | `activity_slug` | not a step |
| object | `artifact_id` | allowed to be null, but `intent` must then carry the target |
| time | `ts_start` | comes free from the evidence message |
| **evidence** | `evidence[]` | **discarded in code — the hard invariant** |

---

## 3. Modality — the extractor's core decision

The same activity appears in an utterance in five different modalities, and the modality decides
whether a step is created and in what state. **This is the most important table in the spec.**

| Modality | Linguistic shape | Example | Creates | Initial state |
|---|---|---|---|---|
| **Reported** | past tense, completive | *"fix is deployed"* | step | `done` |
| **Committed** | first person future, volitional | *"i'll push a mitigation"* | step | `committed` |
| **Requested** | imperative, second person, interrogative-directive | *"tom can you look right now"* | step **+ handoff edge** | `requested` |
| **Negated** | explicit refusal or skip | *"skipping the checklist"* | step, **excluded from the graph** | `skipped` |
| **Discussed** | hypothetical, opinion, question about worth | *"we should probably do a postmortem at some point"* | **nothing** | — |

Two rules that keep this honest:

1. **Discussed is the default.** When the model cannot tell, it emits nothing. A missing node costs
   one node; a fabricated node costs the credibility of the whole graph.
2. **Negated steps are stored but never enter the aggregate graph.** They are the highest-value
   signal we have — an explicit, quotable admission that the documented process was bypassed — and
   they feed the drift alert directly.

---

## 4. Step lifecycle

```
                    ┌──────────────────────────────────────────┐
                    │                                          │
  requested ──────► committed ──────► in_progress ──────► done │
      │                  │                  │                  │
      │                  │                  └──► failed ───────┘ (reopens as rework)
      │                  └──► skipped   (negated — policy evidence)
      └──────────────────────► abandoned  (case closes, never reconciled)
```

- A step may enter at **any** state. `"fix is deployed"` with no prior promise enters directly at `done`.
- **Reconciliation** is how a promise becomes a fact: when a `reported` work act matches an open
  `committed` or `requested` step on `(activity, actor)` within the same case, the existing step is
  advanced rather than a duplicate created. Reconciliation window: the whole case.
- `abandoned` steps are counted but excluded from the directly-follows graph. They are their own
  finding — *"work promised in-channel and never confirmed"* — and in a real workspace this is the
  metric people would actually pay for.

**Only `done` steps build the discovered graph.** Everything else is state the UI can show and the
observer can ask about.

---

## 5. Work act taxonomy

`Step.type` — six kinds, chosen because each one carries different graph semantics rather than
because they sound distinct:

| type | Meaning | Graph consequence |
|---|---|---|
| `action` | changes the world | ordinary DFG node |
| `decision` | selects between options | out-edges become `decision` branches |
| `approval` | authorises another's work | satisfies `approval` and `threshold` policies |
| `handoff` | transfers ownership | in-edge typed `handoff`; actor changes |
| `wait` | blocked on something external | contributes dwell time, no state change |
| `rework` | repeats an activity already done in this case | back-edge, excluded from DAG layout |

Activity slugs are always `verb_object` in snake case — `triage_incident`, `deploy_fix`,
`escalate_to_ceo`. The verb carries the type, the object ties to the artifact.

---

## 6. Who does what — the role capability matrix

Each role has a repertoire. This does triple duty: it constrains the simulation, it gives the
extractor a prior, and it is the basis of **role conformance** (§8.3).

| Role | Person | Performs | Never performs |
|---|---|---|---|
| `support` | Priya Raman | `detect_incident` · `triage_incident` · `open_incident_ticket` · `verify_resolution` | deploy, approve |
| `eng` | Tom Becker | `reproduce_issue` · `root_cause_analysis` · `security_review` · `deploy_fix` · `improvise_hotfix` | approve spend, commit to customers |
| `pm` | Marc Delacroix | `assign_owner` · `notify_customer` · `capture_request` · `communicate_decision` | deploy, approve roadmap |
| `cpo` | Sofia Lindqvist | `roadmap_review` · `update_roadmap` · `qualify_business_case` | deploy, triage |
| `ceo` | Dana Okafor | `exec_approval` · `escalate_to_ceo` | deploy, triage, estimate |
| `pmo` | Léa Moreau | `write_postmortem` · `create_epic` | deploy, approve |

**Capability is a prior, not a gate.** A step attributed to a role outside its repertoire is *not*
rejected — it is the interesting case. It takes a confidence penalty (×0.8) and is flagged as a
**role deviation**, because "the CEO performed `assign_owner`, which the documentation assigns to the
PM, in 3 of 4 incidents" is exactly the kind of finding this product exists to surface.

---

## 7. Work objects and their states

Work acts on artifacts, and artifacts have lifecycles. Artifact state is an **orthogonal
corroboration signal**: it is derived independently of the activity sequence, so when the two agree
the mining is probably right, and when they disagree we have found either a bad extraction or a
genuinely broken process.

| Artifact type | Lifecycle | Advanced by |
|---|---|---|
| `incident` | `detected → triaged → owned → mitigated → resolved → post-mortemed` | support, eng |
| `ticket` (request) | `captured → qualified → estimated → approved → scheduled` | pm, cpo, ceo |
| `doc` | `draft → reviewed → published` | any |
| `contract` | `proposed → approved → signed` | cpo, ceo |

Rule: a step that advances an artifact **more than one state at a time** implies skipped work.
`detected → mitigated` on an incident means triage and ownership never happened in the channel —
which is either a mining gap or a real one, and either way it is worth surfacing.

---

## 8. How work is processed

### 8.1 The pipeline

```
 utterance                     ← Slack message, polled
    │
    ├─ 1  attribute            author → Person            deterministic
    ├─ 2  correlate            → case (session/thread/gap) deterministic
    ├─ 3  window              8 messages, 4 overlap        deterministic
    │
    ├─ 4  detect work acts     modality + activity + actor + object     LLM
    ├─ 5  materialise          work act → Step at its initial state    deterministic
    ├─ 6  reconcile            promise ↔ report, dedupe within case     deterministic
    ├─ 7  canonicalise         Step → Activity, designed-first          LLM (only if unmatched)
    │
    ├─ 8  order                seq by evidence ts within case           deterministic
    ├─ 9  connect              directly-follows over `done` steps       deterministic
    ├─ 10 classify edges       handoff / rework / decision / approval   deterministic
    └─ 11 score               control-flow · policy · role conformance  deterministic
```

Two of eleven stages use a model. Everything downstream of stage 7 is arithmetic over the step
table, recomputed in full on every change — so aggregates can never drift out of sync with evidence.

### 8.2 Reconciliation rules (stage 6)

Applied in order, first match wins:

1. **Exact** — same `(activity_slug, actor_person_id)`, open state, same case → advance that step.
2. **Fulfilment** — a `reported` act matching an open `requested` step on `(activity_slug)` where the
   reporter is the requestee → advance, and mark the handoff edge complete.
3. **Repeat** — same `(activity_slug, actor)` already `done` in this case → new step, `type: rework`,
   back-edge.
4. **Otherwise** — new step.

Dedupe guard: two steps sharing `(activity, actor)` whose evidence sets overlap are the same step.

### 8.3 Conformance has three dimensions

Standard process mining separates these, and so do we — each answers a different question a manager
would actually ask:

| Dimension | Question | Computation | Output |
|---|---|---|---|
| **Control flow** | Did the right things happen in the right order? | `D ∩ O`, `D \ O`, `O \ D`, matrix order breaks | fitness, precision, ghost + gold nodes |
| **Policy** | Were the rules followed? | the four policy kinds from spec 01 §5 | violations, each with a quote and permalink |
| **Role** | Did the right people do it? | `role_expected` vs `roles_observed` per activity | role deviations |

### 8.4 What the simulated agents actually do

Each persona is an LLM given a profile, a project spec, their capability repertoire, and a scripted
**intent** for this turn — then asked to write one Slack message. They never emit structured work
acts; they only talk. **The observer has to do the real work of inferring the process**, which is
the point: if the simulation handed over labelled steps, we would be demonstrating nothing.

Scripted intents drive the shape of the case; generated language provides the mess the extractor has
to survive. Planted deviations (skip a step, escalate out of band, ship before review) are what make
conformance non-trivial.

---

## 9. Worked example

Six real messages from `helios_p1 / v2_skip_review`, and exactly what each produces.

| # | Utterance | Modality | Step produced | State |
|---|---|---|---|---|
| 1 | Priya 09:14 — *"vertex checkout throwing 500s since 09:14, ~40% of card payments failing"* | reported | `detect_incident` · per_priya · art_inc_4412 | `done` |
| 2 | Priya 09:14 — *"calling this a P1"* | reported | `triage_incident` · per_priya · type `decision` | `done` |
| 3 | Priya 09:15 — *"opening INC-4412"* | reported | `open_incident_ticket` · per_priya | `done` |
| 4 | Dana 09:16 — *"tom can you look right now, skip the queue"* | **requested** | `assign_owner` · **per_dana** · handoff→per_tom | `done` + **role deviation** (expected `pm`) |
| 5 | Tom 09:38 — *"i'll push a mitigation before i have the full root cause"* | **committed** | `improvise_hotfix` · per_tom | `committed` |
| 6 | Tom 09:41 — *"skipping the security checklist to save time"* | **negated** | `security_review` · per_tom | `skipped` → **policy violation** `pol_sec_review` |
| 7 | Tom 09:47 — *"fix is deployed"* | reported | reconciles #5 → `deploy_fix` | `committed` → `done` |

Yield from seven utterances: **six steps, one role deviation, one policy violation, one
reconciliation, and one gold activity** (`improvise_hotfix`, which appears in no matrix). Message 4
alone produces a control-flow edge, a handoff, and an organisational finding — which is why the
role dimension is worth the twenty lines it costs.

---

## 10. Confidence

Starts at the extractor's own score, then adjusted deterministically:

| Signal | Adjustment |
|---|---|
| actor outside role repertoire (§6) | ×0.8 |
| artifact state jump >1 (§7) | ×0.9 |
| activity matched a designed slug | ×1.1 (capped at 1.0) |
| evidence spans >4 messages | ×0.9 |
| human ✅ reaction in Slack | → 1.0, `confirmed` |
| human ❌ reaction in Slack | → `rejected`, removed from the graph |

Below **0.4** a step stays `proposed`: visible in the UI, dimmed, excluded from the aggregate graph
until a human confirms it. The ontology is never silently edited by a model alone.

---

## 11. Definition of done

- [ ] The extractor returns a `modality` for every work act and `{"steps": []}` for idle chatter
- [ ] A promise followed by a report yields **one** step that advanced, not two steps
- [ ] A negated step is stored, excluded from the graph, and quoted in the drift alert
- [ ] A step performed outside its role repertoire is flagged, not dropped
- [ ] The worked example in §9 reproduces exactly — it is the regression test
