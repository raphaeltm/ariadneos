# Spec 09 — Graph Interaction & Editing

> The canvas is not a picture of the process. It is where the process model gets **repaired**.
> Companion to spec 08 — that one defines the data contract, this one defines the craft and the verbs.

---

## 1. The principle

Mining produces a claim. A human decides whether the claim is true. **The graph is where that
decision is made**, because the graph is where the evidence already is.

That gives the product its loop, and the loop is the demo:

```
   mine reality  ──►  see it diverge from the documentation  ──►  repair the documentation
        ▲                                                                    │
        └────────────  the next run is measured against the repair  ◄────────┘
```

Every edit moves the conformance number **on screen, immediately**. That feedback is the whole
feeling of the product: you are watching documentation and reality converge under your hands.

---

## 2. Node anatomy

200 × 80, matching the dagre sizing already in `process-graph.tsx`.

```
┌──────────────────────────────────────┐
│  COMPLIANCE      🔗 9/9        ×4    │  ← role chip · grounding badge · support
│                                      │
│  Security review                     │  ← label, 15px, 600
│                                      │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░ │  ← grounding fill bar
└──────────────────────────────────────┘
```

| Element | Encodes | Rule |
|---|---|---|
| border style | `plane` | solid = `both` · 2px gold = `discovered` · **dashed** = `designed` (ghost, 55% opacity) |
| outer ring | violation | 2px warn ring when a governing policy is broken here |
| role chip | who performs it | tinted per role; **warn-tinted when `roleExpected` ≠ observed** |
| 🔗 badge | grounding | shown only when `grounded > 0`; reads `grounded/count` |
| fill bar | grounding ratio | hidden at 100% — an always-full bar is noise |
| opacity | `proposed` | 60% + slow pulse until confirmed or rejected |
| count `×n` | support | distinct cases, `tabular-nums` |

**No emoji as status.** Status is carried by border, ring and opacity, so the graph stays legible
when zoomed out and in a screen recording.

---

## 3. Edge rendering

| Property | Rule |
|---|---|
| width | `1 + 2 × probability`, capped at 6 |
| style | discovered = solid · designed-only = dashed grey · violating = warn + a `⚠` glyph at midpoint |
| back-edge (rework) | curved arc routed **above** the rank, dashed, muted warn |
| label | **hover or selected only** — today's always-on `count · %` labels clutter the canvas badly |
| first appearance | 400 ms stroke-dash draw, so a new edge is noticed |

Selecting an edge shows its transition evidence: the case ids, the median duration, and the
messages on both ends.

---

## 4. The verb set

Eight actions. Each is one gesture, one API call, one visible consequence.

| Verb | Gesture | Precondition | Effect | Conformance |
|---|---|---|---|---|
| **Confirm** | `C` / ✓ on toolbar | node or edge is `proposed` | `status: confirmed`, enters aggregates, confidence pinned to 1 | may rise |
| **Reject** | `X` / ✕ | any mined node/edge | removed from the graph, retained in the mining log | recomputes |
| **Promote** | `P` / ↑ | node is `discovered` (gold) | **added to the documented process** — new row/col in the matrix, `plane → both` | **rises** |
| **Retire** | `R` / ⌫ | node is `designed` (ghost) | removed from the documented process | **rises** |
| **Merge** | drag node onto node | both are activities | one canonical activity, evidence unioned, edges rewired | recomputes |
| **Rename** | double-click label | any activity | relabels; slug unchanged, old label kept as a synonym for graph-RAG | unchanged |
| **Require** | drag from node A to node B, hold `⇧` | both documented | creates an `ordering` policy "A must precede B" | may **fall** — and that's correct |
| **Undo** | `⌘Z` | any edit exists | reverses the last edit | reverts |

**Promote and Retire are the pair that makes the point.** A gold node means *this happens
constantly and nobody wrote it down*. Promoting it is the product's thesis executed in one click:
**the documentation is repaired from evidence.** Retire is the inverse — a documented step nobody
has ever performed, deleted.

**Require deliberately makes the score worse.** Adding a rule reveals violations that were always
happening. A tool that only ever improves its own number is lying, and saying this out loud in the
demo is worth more than the point it costs.

### 4.1 Every edit is echoed to Slack

The loop has to close in the environment, not just in the dashboard:

> 🧵 **Léa Moreau promoted `escalate_to_ceo` into the documented process.**
> It occurred in 4 of 4 cases and appeared in no document. Conformance **78% → 91%**.
> `⌘Z` in the app, or ❌ here, to undo.

---

## 5. Interaction mechanics

**Contextual toolbar, not a buried panel.** Selecting a node floats a compact toolbar directly above
it with only the verbs legal for its current state — a ghost node offers Retire, never Promote.
Illegal verbs are absent, not disabled-and-greyed.

```
            ┌─────────────────────────┐
            │  ✓   ✕   ↑   ⌫   ⋯      │   ← only legal verbs
            └─────────────────────────┘
              ┌──────────────────────┐
              │  Security review     │
              └──────────────────────┘
```

| Input | Result |
|---|---|
| click node/edge | select; toolbar appears; Inspector opens; evidencing messages light in the rail |
| click message in rail | its node pulses and centres |
| `⇧`-click | add to selection; toolbar shows verbs legal for **all** selected |
| drag node → node | merge, with a confirm step naming both sides |
| `⇧` + drag A → B | create an ordering policy |
| double-click label | inline rename |
| `F` | focus mode — dim everything not connected to the selection to 25% |
| `Esc` | clear selection |
| `⌘Z` / `⌘⇧Z` | undo / redo |

Nodes are draggable **only** as the merge gesture: a drag that doesn't land on another node springs
back. Position is never persisted — layout stays dagre's job, so the graph can't be left in a mess.

**Dim, never hide.** A node disappearing reads as a bug; a node dimming reads as focus.

---

## 6. Reconcile — the bulk move

One button in the conformance strip: **Reconcile documentation**. It opens a diff, not a dialog:

```
  PROMOTE  ↑  escalate_to_ceo        4/4 cases · in no document
  PROMOTE  ↑  improvise_hotfix       2/4 cases · in no document
  RETIRE   ⌫  write_postmortem       0/4 cases · documented, never observed
  RETIRE   ⌫  security_review        0/4 cases · documented, never observed
                                     ⚠ governed by pol_sec_review — retiring drops the policy

                          conformance  78%  ─────────►  100%
                          [ Apply 4 changes ]   [ Cancel ]
```

Applying is **one undoable edit**, not four. And the warning on `security_review` is not decoration:
retiring a governed activity silently deletes a safety rule, so that row requires its own tick.

This is the strongest 10 seconds available on camera — the graph reorganising itself and the number
climbing — and it is also the honest, useful thing a process owner would actually want to do.

---

## 7. Motion

Restrained. Motion here is feedback, not decoration.

| Event | Motion |
|---|---|
| node appears | 180 ms fade + scale 0.96 → 1 |
| edge appears | 400 ms stroke-dash draw |
| node promoted | 500 ms gold → green cross-fade, one ring pulse |
| node retired | 300 ms fade + scale to 0.94, then removed |
| merge | the dragged node travels into the target, target pulses |
| conformance changes | number **counts** to its new value over 600 ms, `tabular-nums` so it can't jitter |
| layout change | 250 ms debounce, then animated transition, **positions cached by node id** |

Respect `prefers-reduced-motion`: keep the cross-fades, drop the travel and the count-up.

---

## 8. Edits are a log, not a mutation

The authored designed model stays **immutable**. The effective model is the base plus an ordered
edit log:

```ts
effectiveDesigned(base: DesignedModel, edits: Edit[]): DesignedModel
```

Undo is dropping the last edit and recomputing. That buys, for near-zero cost: trivial undo/redo, a
full audit trail of who changed the process model and when, a diff view against the original, and
reproducible demos — reset by clearing the log.

```ts
export interface Edit {
  action: "confirm" | "merge" | "promote" | "reject" | "rename" | "require" | "retire";
  actor: string;
  createdAt: string;
  id: string;
  payload: Record<string, string>;   // target ids, new label, policy params
  undone?: boolean;
  workflow: WorkflowId;
}
```

New D1 table, migration `0003_edits.sql`:

```sql
CREATE TABLE edits (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, workflow TEXT NOT NULL,
  action TEXT NOT NULL, payload TEXT NOT NULL, actor TEXT NOT NULL,
  created_at INTEGER NOT NULL, undone INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX edits_session_workflow ON edits(session_id, workflow, created_at);
```

Scoped to `session_id` exactly as `events` already are, so one visitor's edits never touch another's
and the existing 24-hour cleanup sweeps them too.

---

## 9. API

| Endpoint | Body / returns |
|---|---|
| `POST /api/model/edit` | `{ action, payload, workflow }` → `{ conformance, designed, edit }` |
| `POST /api/model/edit/undo` | `{ workflow }` → `{ conformance, designed }` |
| `POST /api/model/reconcile` | `{ accept: string[], workflow }` → one `Edit` covering all of them |
| `GET /api/model/edits?workflow=` | `Edit[]` — the audit trail |

Every response returns the **recomputed conformance**, so the UI never has to guess what an edit
did. Validation is server-side: promoting a node that isn't `discovered`, or retiring one that isn't
`designed`, is a `400` — the client must not be the only thing enforcing legality.

---

## 10. Definition of done

- [ ] Selecting a node floats a toolbar showing only the verbs legal for its state
- [ ] Promoting a gold node turns it green and the conformance number counts up
- [ ] Retiring a governed ghost node warns that the policy will be dropped
- [ ] Dragging one node onto another merges them, with evidence unioned and edges rewired
- [ ] `⌘Z` reverses any edit, including a bulk reconcile, as a single step
- [ ] Reconcile shows a diff with a projected score before anything is applied
- [ ] Every edit posts to Slack and can be undone with ❌ there
- [ ] Edge labels appear on hover only; the resting canvas is legible at 0.5 zoom
- [ ] The server rejects illegal edits with a 400, independently of the UI
