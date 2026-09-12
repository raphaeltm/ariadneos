# Spec 06 — Frontend

> Three panes, one canvas, zero explanation needed. A judge should understand what they are looking
> at in eight seconds, without narration.

**Owner:** Track B (starts at minute 0, against fixtures) · **Time budget:** 150 min
**Stack:** Vite + React + TS · React Flow + dagre · Tailwind v4 (`@tailwindcss/vite`) · native `EventSource`

---

## 1. Layout

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  ARIADNE   #ops-war-room ● live    [Helios Payments ▾]   ⏸ pause   ▶ Run simulation ▾    │
├───────────────────┬──────────────────────────────────────────────┬───────────────────────┤
│  SLACK RAIL       │   CANVAS                                     │   INSPECTOR           │
│  320 px           │   flex-1                                     │   360 px (on select)  │
│                   │                                              │                       │
│ ▣ Priya  09:14    │   ┌─ overlay legend ───────────────────┐     │  Security review      │
│   vertex checkout │   │ ── documented  ══ discovered       │     │  ───────────────────  │
│   500s since…     │   │ ▨ both  ▨ undocumented  ▧ missing  │     │  plane   documented   │
│   🧵 evidence     │   └────────────────────────────────────┘     │          never observed│
│                   │                                              │  policy  pol_sec_review│
│ ▣ Dana   09:16    │      [detect]══►[triage]══►[open ticket]      │  missing in 3/4 runs  │
│   this is our     │            ║                    ║            │                       │
│   biggest logo…   │            ▼                    ▼            │  EVIDENCE             │
│                   │      ⟨escalate to CEO⟩     [assign owner]    │  (none — this step    │
│ ◆ ARIADNE 09:17   │       undocumented ·4/4          ║           │   never happened)     │
│   🧵 This looks   │                                  ▼           │                       │
│   like Enterprise │                           [reproduce]        │  WHAT HAPPENED INSTEAD│
│   P1 response…    │                                  ║           │  root cause ──► deploy│
│   ✅ ❌ ✋        │                                  ▼           │  "skipping the check- │
│                   │                        [root cause]          │   list to save time"  │
│ ▣ Tom    09:41    │                    ┌┈┈┈┈┈┈┈┈┈┈┐  ║           │   — Tom, 09:41        │
│   skipping the    │                    ┆ security ┆◄─╫─ missing  │   open in Slack ↗     │
│   checklist to…   │                    ┆ review   ┆  ║           │                       │
│   ⚠ drift         │                    └┈┈┈┈┈┈┈┈┈┈┘  ▼           │                       │
│                   │                           [deploy fix]       │                       │
├───────────────────┴──────────────────────────────────────────────┴───────────────────────┤
│ conformance 78% │ 5 cases │ 14 activities │ 2 undocumented │ 1 skipped │ 3 handoffs  ●live│
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Visual language

| Token | Value | Meaning |
|---|---|---|
| `--bg` | `#0A0A0B` | canvas |
| `--panel` | `#111113` | rails |
| `--line` | `#232328` | 1px borders, everywhere |
| `--thread` | `#E8B84B` | **Ariadne gold** — the thread, undocumented reality |
| `--ok` | `#4ADE80` | conformant (documented ∧ observed) |
| `--ghost` | `#52525B` | documented, never observed |
| `--warn` | `#F87171` | violation / drift |
| `--handoff` | `#38BDF8` | handoff edges |
| type | Inter (UI) · `ui-monospace` (ids, ts, metrics) | |

**Node states** — this is the signature (decision D9):

| State | Border | Fill | Label |
|---|---|---|---|
| `both` | solid `--ok` | `#0F1A12` | green — documented and real |
| `discovered` | solid `--thread` 2px | `#1A1608` | **gold — nobody wrote this down** |
| `designed` (missing) | **dashed** `--ghost` | transparent | grey ghost, 55% opacity |
| `proposed` | solid, 50% opacity, subtle pulse | | not yet confirmed |
| violating | `--warn` outer ring | | policy broken here |

Each node shows: label, a role chip, and a mono `support ×3` badge. Edge **stroke width =
`1 + weight`**, capped at 6. Back-edges (rework) render as dashed curved arcs in `--warn`.

**Motion rules** (restrained — this must not look like a screensaver):
- new node: 180 ms fade + scale 0.96→1
- new edge: 400 ms stroke-dash draw
- layout change: 250 ms debounce, then animated position transition
- a node whose evidence just arrived: one 600 ms gold pulse — and the corresponding messages in the
  Slack rail glow simultaneously (**the provenance beam**)

---

## 3. Components

```
src/
├── App.tsx                    layout shell, SSE connection, keyboard shortcuts
├── store.ts                   zustand: graph, messages, sessions, selection, mode, minSupport
├── sse.ts                     EventSource → store.apply(event)
├── api.ts                     typed fetch wrappers
├── components/
│   ├── Header.tsx             project switcher, run menu, pause, live pill
│   ├── SlackRail.tsx          message list, persona avatars, Ariadne cards, evidence glow
│   ├── AriadneCard.tsx        playbook / drift / answer, with ✅ ❌ ✋ affordances
│   ├── Canvas.tsx             ReactFlow + dagre layout + legend + overlay controls
│   ├── ActivityNode.tsx       custom node (states from §2)
│   ├── Inspector.tsx          node detail: plane, policy, support, evidence, "what happened instead"
│   ├── ConformanceBar.tsx     bottom strip metrics
│   └── SupportSlider.tsx      min-support filter (the spaghetti→happy-path move)
└── layout.ts                  dagre wrapper: rankdir LR, nodesep 40, ranksep 90, back-edges excluded
```

**Canvas modes** (segmented control, top-left of canvas):

| Mode | Shows |
|---|---|
| **Overlay** (default) | designed ∪ discovered, colour-coded by `plane` — the money view |
| **This case** | the instance DAG of the selected/open session |
| **Discovered only** | mined graph alone, for the frequency-slider moment |

---

## 4. Data flow

```
GET /api/graph/overlay ──► store.graph        (once, on mount + on project switch)
GET /api/messages      ──► store.messages
EventSource /api/stream ─► store.apply(evt)   (everything after that)
```

`store.apply` is a switch on `kind` (spec 05 §3). **Never refetch on an SSE event** — apply the
delta. The one exception: `conformance` replaces wholesale (it is small).

Layout is recomputed only when the node **set** changes, debounced 250 ms. Node position is cached
by id so existing nodes do not jump when a new one arrives.

---

## 5. Interactions

| Action | Result |
|---|---|
| click node | Inspector opens; evidencing messages highlight in the rail; incident edges brighten |
| click message | its step's node pulses and centres |
| hover edge | tooltip: `weight · kind · cases` |
| drag support slider | filter nodes/edges by `support`, re-layout |
| `✅`/`❌` on a proposed step card | `POST /api/steps/{id}/status` → node confirms or vanishes |
| ⏸ pause | `POST /api/sim/pause`; canvas gains a subtle veil + "paused by you" |
| Run simulation ▾ | pick scenario + variant → `POST /api/sim/run` |
| `?` | shortcut overlay (nice-to-have) |

---

## 6. Build order (Track B, unblocked from minute 0)

| Minutes | Deliverable | Depends on |
|---|---|---|
| 0–25 | Vite + Tailwind + shell layout + tokens | nothing |
| 25–60 | Canvas renders `fixtures/graph.overlay.json` with all node states + dagre | fixtures only |
| 60–85 | SlackRail from `fixtures/messages.json`, persona avatars, Ariadne cards | fixtures only |
| 85–110 | Inspector + evidence list + provenance beam | fixtures only |
| 110–130 | SSE wiring against the live API | API ready ~14:00 |
| 130–150 | Support slider, conformance bar, motion polish, dark-room check | |

**Track B never waits.** Fixtures are frozen and committed by 12:45; the API is a swap of the data
source at minute 110.

---

## 7. Definition of done

- [ ] All five node states visibly distinct on one screen, readable from 2 m away
- [ ] A new node appears and its edge draws without the existing layout jumping
- [ ] Clicking a gold node shows real Slack quotes and a working permalink
- [ ] The conformance number changes on screen when a new session closes
- [ ] Nothing in the UI requires the presenter to explain what a colour means — the legend does it
