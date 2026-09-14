> **Historical input spec — superseded.** The simulation, demo-workspace and
> checked-in knowledge base described here are not part of the application. See
> [../decisions/2026-09-14-no-simulated-data.md](../decisions/2026-09-14-no-simulated-data.md).

# Spec 13 — The Demo Workspace

> A **workspace** is everything needed to run one reproducible demo: a channel, a cast with agendas,
> a documented process, a scenario, and a baseline. One declarative bundle, one launch command.
>
> Extends [spec 03](03-simulation-and-slack.md) (personas, beats, Slack) and
> [spec 12](12-simulation-runtime-and-demo.md) (agendas, run lifecycle, demo mode).

---

## 1. Readiness — what actually exists, 2026-09-12 15:05

The intended shape is: **LLM agents impersonate people, talk to each other from their agendas, and
the graph is built by extracting structure from what they said.** Measured against that:

| Stage | Specced | Built | Reality |
|---|---|---|---|
| Cast with agendas | ✅ 12 §1 | ❌ | no agendas exist in code |
| Agents converse as people | ✅ 03 §3 | ❌ | `simulate()` is a **path sampler** — three hardcoded `paths` arrays, a fixed actor per action name, zero LLM calls |
| Messages posted to Slack | ✅ 03 §2 | ❌ | no Slack code in the Worker |
| Ingestion | ✅ 00-cf, 05 | ❌ | — |
| **Extraction: text → work acts** | ✅ 00 §3, 04 §3 | ❌ | **nothing consumes text anywhere** |
| Canonicalisation | ✅ 01 §7 | ❌ | — |
| Graph from events | ✅ 01 | ✅ | `mine()` works and is tested |
| Conformance vs designed | ✅ 01 §5 | ❌ | no designed plane in code |
| Agent interventions | ✅ 10 | ❌ | — |

**The load-bearing gap:** `mine()` consumes `ActivityEvent`s that are *born already labelled* —
`action`, `actor`, `role` and `caseId` are set by the generator. No text ever enters the pipeline, so
there is nothing to extract. Today the graph is drawn from answers, not derived from evidence.

Everything else on this list is plumbing. **That one line is the project.** Until text flows in and
structure comes out, the demo shows process mining over synthetic events — which is a real thing,
but it is not what we are claiming.

---

## 2. What a workspace is

```
workspaces/<workspace_id>/
├── workspace.yaml        identity, Slack channel, which project + process + cast
├── cast.yaml             people, agendas, process beliefs           §3
├── process.yaml          designed activities, N×N matrix, policies  (spec 02 §4)
├── scenario.yaml         variants, beat sheets, expected deviations (spec 03 §4)
├── transcripts/          cached conversations for `perform` mode    (spec 03 §5)
└── baseline.json         prior sessions so the graph is never empty §6
```

```yaml
# workspace.yaml
id: helios-ops
name: Helios Payments — incident response
slack:
  channel_id: C0C1DFQL72N
  channel_name: ops-war-room
  workspace: ariadneos
project_id: proj_helios
process: wf_p1_incident
cast: [per_priya, per_dana, per_tom, per_marc, per_sofia, per_lea]
scenarios: [helios_p1]
baseline_sessions: 2          # mined before the demo, so support counts already exist
```

One workspace = one Slack channel = one case space. Two workspaces never share a channel, because
two concurrent runs in one channel make case correlation meaningless (spec 12 §3).

---

## 3. The cast — agenda *and* process belief

Spec 12 §1 defines the agenda. A workspace adds the second half, which is what actually produces
disagreement:

```yaml
per_tom:
  agenda:
    objective: "Ship a correct fix. Do not create the next incident."
    pressure:  "Being told to skip the checklist by someone who outranks him."
    bypasses:  []
    tell:      "States the risk once, complies under pressure, records that he complied."
  process_belief:
    - reproduce_issue
    - root_cause_analysis
    - security_review        # ← Tom believes this is mandatory
    - deploy_fix

per_dana:
  agenda:
    objective: "Keep the Vertex renewal. €2.1M ARR, signs in November."
    pressure:  "Every hour of downtime is a line in the renewal call."
    bypasses:  [assign_owner, security_review]
    tell:      "Pings the engineer directly and overrules objections with authority, not argument."
  process_belief:
    - triage_incident
    - deploy_fix             # ← Dana believes the process is: find it, fix it
    - notify_customer
```

**This is the mechanism.** Nobody is lying and nobody is being careless — Tom and Dana hold
*different models of the same process*, and Dana outranks Tom. The deviation is the predictable
result of that collision, not a planted quirk.

Three consequences worth stating:

1. The discovered process is the **resolution of six competing beliefs under pressure**, which is a
   far more honest description of how organisations work than "the documented process, with errors".
2. `process_belief` feeds each persona's prompt, so an agent argues *from its model* rather than
   being told to deviate on cue.
3. Every `expected_deviation` must trace to a belief conflict or an `agenda.bypasses` entry
   (spec 12 §1). Generation fails loudly otherwise.

---

## 4. The conversation loop

One turn = one agent writes **one Slack message**. The agent sees:

```
identity        name, role, voice                      (KB Person)
situation       project spec, what's happened          (Project + last 8 messages)
agenda          objective, pressure, tell              (§3)
process_belief  what you think should happen next      (§3)
beat intent     what this turn is for                  (scenario beat)
```

and returns **plain text, nothing else**.

| Mode | Speaker order | Use |
|---|---|---|
| `scripted` | beat sheet | the demo — deterministic, guaranteed to reach a resolution |
| `directed` | a cheap LLM picks who speaks next from the last 6 messages | more lifelike, can loop or stall |

`scripted` for anything a judge watches. `directed` exists so the claim "these are agents, not a
script" is demonstrably true — show it once, off the critical path.

### 4.1 The honesty invariant

> **Personas emit text and nothing else.** No agent ever returns an `action`, `activity_slug`,
> `role` or any structured field. The only path from conversation to graph is the extractor.

If a persona could label its own step, we would be demonstrating nothing — the graph would be the
script, redrawn. This is the rule that makes the whole project mean something, and it is worth one
sentence in the video.

The generator enforces it: transcript entries carry `{person_id, text, delay}` and no other domain
fields. A transcript containing an activity slug fails validation.

---

## 5. From conversation to graph

```
agent writes text
   └─► posted to Slack as that persona  (chat:write.customize, spec 03 §2.1)
        └─► ingested                     (signed Events API, spec 00-cf)
             └─► windowed                (8 messages, spec 04 §2)
                  └─► EXTRACTED          ← modality, actor, object  (spec 00 §3)   ★ the missing piece
                       └─► canonicalised (designed slugs first, spec 01 §7)
                            └─► mine()   ← already built and tested
                                 └─► conformance vs process.yaml
```

Everything left of `mine()` is unbuilt. Everything from `mine()` rightward works today.

**Minimum viable path to the real thing**, if the clock beats us: run `perform` mode from cached
transcripts, ingest them, and extract live. That is still genuine extraction from unstructured text —
only the authoring of the text is cached. It is honest, it is fast, and it is the demo.

---

## 6. Baseline — never demo into an empty graph

`baseline.json` holds 2 already-mined sessions, loaded at workspace install.

Two reasons, both learned from measuring the current app: a graph that starts empty has nothing to
compare a new run against, and **a graph that starts with 24 identical cases cannot visibly change**
when you add 6 more. Two baseline sessions is the number that makes support counts meaningful
(`×2` → `×3` is legible) while leaving room for the third run to visibly add something.

**The third run must introduce something the baseline does not contain** — a new activity, a skipped
step, a rework loop. A run that only shifts percentages is invisible on camera. The workspace
declares this explicitly:

```yaml
# scenario.yaml
demo_sequence:
  - {variant: v1_by_the_book, mode: baseline}   # pre-mined
  - {variant: v2_skip_review, mode: baseline}   # pre-mined
  - {variant: v3_rework,      mode: live}       # ← run on camera
    introduces: [improvise_hotfix, rework_edge, pol_sec_review_violation]
```

`introduces` is asserted after the run. If the live variant adds nothing new, the preflight says so
**before** the demo rather than the audience noticing during it.

---

## 7. Launch and verify

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/workspaces` | installed workspaces + readiness |
| `GET` | `/api/workspaces/:id` | cast, agendas, process, scenarios, baseline state |
| `POST` | `/api/workspaces/:id/install` | load cast/process/baseline into D1. Idempotent. |
| `POST` | `/api/workspaces/:id/run` | `{scenario, variant, mode, seed, request_id}` → `{session_id}` |
| `POST` | `/api/workspaces/:id/reset` | clear sessions/events/edits for this scope; **keeps baseline** |
| `GET` | `/api/workspaces/:id/preflight` | §7.1 |

### 7.1 Preflight

One screen the presenter reads once, before going live:

```
WORKSPACE helios-ops                              ariadneos · #ops-war-room
  ✓ Slack reachable          bot in channel, 7 scopes granted
  ✓ Model reachable          OpenRouter, 3 models resolved
  ✓ Cast                     6 personas, 6 agendas, 6 process beliefs
  ✓ Deviations traceable     5 expected → 5 explained by agenda or belief conflict
  ✓ Designed process         wf_p1_incident · 11 activities · 3 policies
  ✓ Baseline                 2 sessions mined · 9 activities · support ≥2 on 6
  ✓ Transcripts cached       v1 v2 v3
  ⚠ Live variant introduces  improvise_hotfix ✓ · rework_edge ✓ · violation ✗ NOT REACHED
  ✓ Reset                    returns to baseline in one action
```

Any ✗ shows the fix next to it. The presenter never discovers a broken dependency while a judge is
watching.

---

## 8. The shipped workspace

`helios-ops`, matching `SCOPE.md` and specs 02/03. Channel `#ops-war-room` in `ariadneos`.

> **Domain note.** The seeded `vendor` / `refund` / `access` workflows in D1 are a *different*
> lineage (spec 08). The workspace format wraps either — `access` in particular already contains a
> skipped-security-review story and would need only a `process.yaml` and a cast. This remains
> unadjudicated; `helios-ops` ships because `SCOPE.md` says so.

---

## 9. Critical path

Ordered by what unblocks the claim, not by what is easy:

| # | Item | Unblocks |
|---|---|---|
| 1 | **Extractor: text → work acts** (spec 00 §3, one LLM call, strict schema) | everything — without this there is no product |
| 2 | Transcript generation from cast + agendas + beliefs | agents that argue from a position |
| 3 | Slack post as personas + ingest | grounding, real permalinks |
| 4 | `process.yaml` loader + conformance | documented vs actual |
| 5 | Workspace install / run / reset / preflight | a demo that can be rehearsed and repeated |
| 6 | Baseline + `introduces` assertion | a run that visibly changes something |

**If only one lands, it must be #1**, run over cached transcripts. Text in, structure out, graph
built from the structure — that is the whole claim, and everything else is production value around it.

---

## 10. Definition of done

- [ ] A transcript containing any structured domain field fails validation
- [ ] Every expected deviation traces to an agenda bypass or a belief conflict
- [ ] `install` is idempotent; `reset` returns to baseline and never clears it
- [ ] The live variant's `introduces` list is asserted, and preflight fails loudly if unreached
- [ ] The graph after a live run contains at least one activity or edge the baseline lacked
- [ ] Preflight reports all ten checks with a fix beside any failure
- [ ] Extraction runs live even in `perform` mode — only the authoring of text is cached
