> **Historical input spec — superseded.** The simulation, demo-workspace and
> checked-in knowledge base described here are not part of the application. See
> [../decisions/2026-09-14-no-simulated-data.md](../decisions/2026-09-14-no-simulated-data.md).

# Spec 12 — Simulation Runtime, Agendas & Demo Mode

> Extends [spec 03](03-simulation-and-slack.md) (personas, beats, Slack client) and
> [spec 08](08-ux-and-interface.md) (UX). Spec 03 says *what* the personas say. This says **why they
> say it**, how a run is controlled, and how the whole thing survives being demoed live.
>
> **Runtime authority** remains [the Cloudflare contract](00-cloudflare-architecture.md) — the
> `ChannelCoordinator` Durable Object owns run position, pause state and beat alarms.

**Domain:** Helios / Atlas, matching `SCOPE.md` and specs 02/03/05. Spec 08 was written against the
shipped `vendor`/`refund`/`access` workflows; where the two disagree, **this spec follows SCOPE.md**
and spec 08's UX patterns apply unchanged to whichever workflow is loaded.

---

## 1. Agendas — why the process breaks

The weakest version of this demo is *"we planted a deviation."* The strong version is:

> **Process doesn't break at random. It breaks where incentives collide.**

So every persona in a scenario carries an explicit **agenda**, and every planted deviation is the
*consequence* of one. That makes the deviations legible instead of arbitrary — a viewer watching
Dana bypass the security review already knows why, because her agenda is on screen.

```yaml
# kb/agendas/helios_p1.yaml — agendas are per (persona, scenario), not global
per_dana:
  objective:  "Keep the Vertex renewal. €2.1M ARR, signs in November."
  pressure:   "Every hour of downtime is a line in the renewal call."
  bypasses:   [assign_owner, security_review]     # what this agenda will override
  tell:       "Pings the engineer directly and overrules objections with authority, not argument."
  deviates_as: [escalate_to_ceo]

per_tom:
  objective:  "Ship a correct fix. Do not create the next incident."
  pressure:   "Being asked to skip the checklist by someone who outranks him."
  bypasses:   []
  tell:       "States the risk once, complies under pressure, records that he complied."
  deviates_as: [improvise_hotfix]

per_lea:
  objective:  "The process is followed and the record is accurate."
  pressure:   "Nobody wants the postmortem."
  bypasses:   []
  tell:       "Asks whether it was logged. Objects on policy grounds, not technical ones."
  deviates_as: []
```

| Field | Purpose |
|---|---|
| `objective` | what this person is optimising for — one sentence, in their terms |
| `pressure` | the force acting on them in *this* scenario |
| `bypasses` | which activities this agenda is willing to skip. **This is what produces drift.** |
| `tell` | the behavioural signature that makes them recognisable in the channel |
| `deviates_as` | the undocumented activities this agenda generates |

**The invariant:** every entry in a scenario's `expected_deviations` must be traceable to exactly one
persona's `bypasses` or `deviates_as`. A deviation with no agenda behind it is a bug in the scenario,
not a finding — and the generator must fail loudly on one.

Agendas feed the persona prompt (spec 03 §3) between the profile and the beat intent:

```
Your standing goals: {person.goals}
In this situation: {agenda.objective}
The pressure on you right now: {agenda.pressure}
You are willing to bypass: {agenda.bypasses}   ← only if the beat calls for it
How you come across: {agenda.tell}
```

---

## 2. Assuming a role — one function, no ambiguity

```ts
assumeRole(personId, scenarioId): PersonaRuntime
// = KB Person (identity, voice)
// + Project (what they're working on)
// + Agenda for THIS scenario (objective, pressure, bypasses, tell)
// + Slack identity (username, icon_url)
// → { prompt, slackIdentity, personId, role }
```

Called once per persona at run start and cached for the run. One place assembles a role; nothing
else builds a persona prompt. If a message needs a voice, it goes through `assumeRole`.

Slack identity comes from the same object, so **the person speaking and the person posting can never
drift apart** — a class of bug that is invisible until it ruins a demo.

---

## 3. The runner — one entry point, one state machine

```
        POST /api/sim/run {scenario_id, variant, request_id}
                      │
                      ▼
   ┌──────────┐   beat alarm    ┌──────────┐  last beat  ┌──────────┐  20s quiet  ┌────────┐
   │ PREPARED │───────────────► │ RUNNING  │────────────►│ DRAINING │────────────►│ CLOSED │
   └──────────┘                 └────┬─────┘             └──────────┘             └────────┘
                                     │ ▲
                          pause      │ │  resume / decision(approve)
                                     ▼ │
                                ┌──────────┐
                                │  PAUSED  │  ← agent intervention, UI button, or ✋ in Slack
                                └──────────┘
```

Owned by the `ChannelCoordinator` Durable Object. One beat per alarm; the alarm is only rescheduled
when `state === RUNNING`, so **pause is always clean** — it can never land mid-beat.

| Rule | Why |
|---|---|
| One active run per channel | two runs interleaving in one channel makes case correlation meaningless. Second `run` → `409` |
| `request_id` idempotency | a retried POST resumes the same run rather than starting a second |
| Beat position persisted before posting | a Worker eviction resumes at the right beat instead of replaying the channel |
| `CLOSED` is terminal | reruns create a new session; sessions are never reopened |
| Every posted message carries `session_id` in metadata | the case boundary is data, not a heuristic (spec 00 §2) |

**Determinism.** `POST /api/sim/run` accepts an optional `seed`. Same `(scenario, variant, seed)`
produces the same transcript in `generate` mode and the same timing in `perform` mode. The demo runs
a known seed; rehearsal and the live run are then the same run.

---

## 4. Three modes

| Mode | Transcript | Slack | Mining | Use |
|---|---|---|---|---|
| `generate` | written by the LLM, cached to a fixture | not posted | no | before the demo, offline |
| `perform` | replayed from the cached fixture | **posted for real** | **live** | **the demo** |
| `live` | personas generate turn by turn | posted | live | the honest version, slower and riskier |

**The demo always uses `perform`.** The chatter is pre-written; the intelligence is not. Mining,
conformance, interventions and the graph all run live against real Slack messages — the only thing
cached is what the humans say, which is the one part that doesn't need to be proved.

Say this out loud rather than hiding it. *"The conversation is pre-written so you can watch a week of
work in ninety seconds. Everything downstream of it is live, and here's a message I'll type myself."*

---

## 5. Control surface

Per spec 05: `POST /api/sim/run` · `/api/sim/pause` · `/api/sim/resume`, and
`POST /api/agent/decision` (spec 11 §3) for resuming a run the agent paused.

Additions for demo control:

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/sim/speed` | `{session_id, multiplier}` — `1 \| 2 \| 4`, applied to the next alarm |
| `POST` | `/api/sim/reset` | `{scope}` — clears this scope's sessions, events, edits; **never touches the baseline seed** |
| `GET` | `/api/sim/scenarios` | catalog: scenarios, variants, personas + agendas, expected deviations |

`/api/sim/reset` is the single most important demo endpoint. Between the rehearsal and the real run
there must be exactly one action that returns the app to a known state, and it must be impossible to
half-reset.

---

## 6. The cast — agendas on screen

A collapsible **Cast** panel in the left rail, above the conversation. Six rows, one per persona:

```
┌─ CAST ─────────────────────── Helios · P1 incident ─┐
│ ▣ Priya Raman      Support                          │
│   Protect the SLA clock. Escalates past rotation.   │
│ ▣ Dana Okafor      CEO                    ⚠ bypasses│
│   Keep the Vertex renewal. Overrules objections.    │
│ ▣ Tom Becker       Engineering                      │
│   Ship a correct fix. Complies under pressure.      │
└─────────────────────────────────────────────────────┘
```

- The `⚠ bypasses` chip marks personas whose agenda will override process — **visible before they do
  it**, which converts a surprise into a prediction the viewer gets to confirm.
- The speaking persona highlights as their message lands.
- Clicking a persona filters the conversation and dims graph nodes they didn't perform.
- Hovering the `⚠` chip lists which activities that agenda bypasses.

This panel is cheap and it does more narrative work than anything else on the screen: it turns
"watch some bots chat" into "watch these six incentives collide."

---

## 7. Demo optimisation

### 7.1 Presenter mode

Toggle `D`, persisted per browser:

| Change | Why |
|---|---|
| Type scale +15%, graph min-zoom raised | readable on a projector and in a 1080p recording |
| Dev affordances hidden — revision string, latency, raw ids | nothing on screen that invites a question you don't want |
| Toasts move bottom-centre and hold 5 s | a toast in the corner is invisible on a recording |
| Tooltips delayed 600 ms | no accidental tooltip covering the graph mid-sentence |
| Cursor-adjacent hover effects disabled | the mouse stops being a distraction |

### 7.2 Never show an empty or broken canvas

| Situation | Behaviour |
|---|---|
| Cold load, no run yet | the **designed** graph renders immediately, grey. Never a spinner, never a blank canvas. |
| Slack unreachable | fall back to seeded events with `inferred` grounding; a single honest banner, not an error |
| Model budget exhausted | computed statistics, as `/api/ask` already does |
| SSE drops | reconnect with journal replay; the graph must not reset |
| Any fetch fails | last good state stays on screen. **Nothing ever unmounts the graph.** |

### 7.3 Timeline and jump points

The demo script (spec 06-era §2 beats) is **data, not a piece of paper**:

```ts
export const beats = [
  { at: 0,  id: "open",      label: "The documented process" },
  { at: 12, id: "run",       label: "Six people, one incident" },
  { at: 34, id: "assemble",  label: "The graph builds itself" },
  { at: 58, id: "pause",     label: "Ariadne interrupts" },
  { at: 78, id: "overlay",   label: "Documented vs actual" },
  { at: 96, id: "human",     label: "You type a message" },
];
```

Rendered as a thin strip under the canvas in presenter mode. `→` / `←` jump between beats;
`1`–`6` jump directly. If a beat breaks live, skip it in one keystroke instead of narrating a
failure.

### 7.4 Keyboard

`Space` pause/resume · `R` run · `⇧R` reset · `D` presenter · `F` focus ·
`1`–`6` jump to beat · `⌘Z` undo · `Esc` clear selection.

Every one of these must work without the mouse. A demo where the presenter hunts for a button is a
demo that loses thirty seconds it does not have.

### 7.5 Rehearsal check

`GET /api/sim/scenarios?validate=true` returns a preflight the presenter reads once before going
live:

```
✓ Slack reachable            #ops-war-room · bot in channel
✓ Transcripts cached         helios v1 v2 v3 · atlas v1 v2
✓ Baseline seeded            2 prior sessions, graph non-empty
✓ Designed plane loaded      wf_p1_incident · 11 activities · 3 policies
✓ Agendas resolve            5 expected deviations, all traceable to an agenda
⚠ Model budget               62 of 100 calls remaining today
```

Any ✗ is a red banner in presenter mode with the fix next to it. **The presenter should never
discover a broken dependency while a judge is watching.**

---

## 8. Definition of done

- [ ] `assumeRole` is the only place a persona prompt is built, and it carries the Slack identity
- [ ] Every `expected_deviation` traces to exactly one persona agenda; generation fails loudly if not
- [ ] Same `(scenario, variant, seed)` reproduces the same run
- [ ] A second `POST /api/sim/run` on a busy channel returns `409`, not a tangled channel
- [ ] Pause never lands mid-beat; resume continues at the right beat after an eviction
- [ ] `/api/sim/reset` returns to a known state in one action and never clears the baseline seed
- [ ] The cast panel shows agendas, and marks who will bypass process before they do
- [ ] Cold load shows the grey designed graph, never a spinner or an empty canvas
- [ ] No failure path unmounts the graph
- [ ] Every demo action has a keyboard shortcut
- [ ] The preflight reports all six checks and shows the fix for any failure
