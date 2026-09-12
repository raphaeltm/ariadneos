# Spec 08 — UX, Journeys & the Frontend/Backend Interface

> **Supersedes spec 06** for the shipped stack. Spec 06 assumed Python/FastAPI/SQLite; the app is
> Cloudflare Workers + Hono + D1 + Vite/React + `@xyflow/react` + dagre. This spec is written
> against the code that actually exists in `shared/process.ts`, `server/index.ts`, `src/app.tsx`.

**Domain:** Sam's three workflows stay — `vendor`, `refund`, `access`. They are already seeded, and
`access` already contains the drift story (Security review present in one path, absent in another,
reordered in a third).

---

## 0. The prime directive: additive only

`tests/process.test.ts` asserts three invariants that must keep passing:

1. `edge.count === edge.evidence.length` for every edge
2. outgoing `probability` from any non-terminal node sums to `1`
3. `mine()` is invariant to duplicate and out-of-order delivery

Therefore: **`model.edges` stays discovered-only.** Designed-plane transitions go in a *separate*
array, `model.designedEdges`. The overlay is merged in the UI, never in `model.edges`. Every new
field on an existing interface is optional. Nothing is renamed.

Object keys stay alphabetically sorted (Biome `useSortedKeys`), imports keep `.ts` extensions.

---

## 1. The five locked journeys

### UJ1 · Watch the process assemble itself

**Today:** `/api/simulate` inserts 6 cases, the client refetches `/api/model`, the graph *jumps*.
A jump reads as a canned result.

**Target:** the graph assembles node by node while a conversation streams beside it.

**The cheap mechanism — use this, not SSE.** `mine()` is a pure function already imported by the
client. So the client replays a **growing prefix**:

```ts
// src/use-replay.ts
const [cursor, setCursor] = useState(events.length);        // full model by default
const model = useMemo(() => mine(events.slice(0, cursor)), [events, cursor]);
// on run: setCursor(baselineCount), then advance on a timer to events.length
```

No streaming backend, no Worker change, no cursor protocol. `/api/simulate` simply returns the
`events` it inserted (§5.3) and the client animates them in. Layout must be **position-stable**:
cache dagre positions by node id so existing nodes do not jump when a new one appears.

Pace: one event every 320 ms, with a 900 ms pause whenever a *new* activity first appears — the
pause is what makes the viewer notice the graph growing.

### UJ2 · Provenance — why does this node exist?

Click any node or edge → the Inspector shows the **messages that evidenced it**, not event ids.

`ProcessEdge.evidence` already carries `{caseId, from, to}` event ids. The upgrade is that events
carry their source utterance (§5.1 `ActivityEvent.messages`), so the Inspector resolves ids →
quoted Slack messages with author, time, and a permalink.

Inspector for a node shows, in this order: label · role · **grounding ratio** (`8/9 grounded`) ·
plane · governing policy if any · case list · then the quotes.

**Provenance beam:** selecting a node highlights its evidencing messages in the conversation rail,
and selecting a message centres and pulses its node. Bidirectional, both cheap.

### UJ3 · Documented vs actual

One canvas, two planes over one id-space. This is the signature visual.

| Node `plane` | Means | Renders |
|---|---|---|
| `both` | documented and observed | solid, conformant colour |
| `designed` | documented, never observed | **dashed ghost**, ~55% opacity |
| `discovered` | observed, in no document | **gold**, 2px border |

Edges the same, plus a violation state: an edge whose transition skips a mandatory activity gets a
warning stroke and carries `violates: string[]`.

Header strip shows the hard number: **conformance 78% · 1 skipped · 2 undocumented · 3 role
deviations**. Each is a filter — clicking `1 skipped` selects the ghost node.

Mode switch: `Overlay` (default) · `Discovered only` · `Documented only`.

### UJ4 · Ariadne interrupts, and you decide

The app is read-only today, which caps the agency criterion. Add three interventions, each arriving
as an `AgentEvent` (§5.4) and rendered as a card in the rail plus a canvas veil when it pauses:

| Kind | Trigger | Card |
|---|---|---|
| `playbook` | a case opens and matches a known workflow ≥0.5 | the mined path, with the step usually skipped highlighted |
| `drift` | an observed transition skips a mandatory activity, or a `negated` step maps to a designed one | the policy, the quote, the permalink, the count (`3rd time in 4 cases`) |
| `answer` | `@Ariadne` in channel, or the ask box | prose + citations that highlight nodes on hover |

`playbook` **pauses the replay**. The user resolves it with `approve` / `reject` / `hold` — in the
UI, or with ✅/❌/✋ in Slack. Resolution posts to `/api/agent/decision` and resumes.

Do this on camera: the simulated team stops and waits for a human. That is the difference between a
dashboard and an agent.

### UJ5 · Extraction on the fly — make the invisible visible

The question "how does it build the graph?" needs an on-screen answer. A **mining log** strip under
the canvas, one line per pipeline event, newest first:

```
14:22:07  message   Oliver Park · "skipping the security review, finance is waiting"
14:22:08  extract   → security_review · modality=negated · conf 0.88
14:22:08  ground    → 1 message ref  🔗
14:22:09  canon     → matched designed activity security_review
14:22:09  graph     ✗ excluded from graph (negated) · policy pol_sec_review violated
14:22:09  agent     ⚠ drift alert posted to #ops-war-room
```

Each line is clickable and selects what it produced. Collapsible, default open during a run, and it
is the single most convincing thing on screen for a technical judge.

---

## 2. Hierarchy — workspace → workflow → case

Three view levels, one breadcrumb: `acme · Access requests · ACC-1042`.

| Level | Graph shows | Nodes | Edges |
|---|---|---|---|
| **L0 Workspace** | how processes connect | one per **workflow**, sized by case count | `workflow_link` — cases sharing an artifact (§3) |
| **L1 Workflow** | the activity DAG (today's view) | activities, planes per UJ3 | directly-follows + designed |
| **L2 Case** | one case end to end | that case's steps in order | its actual transitions |

- A **workspace** scopes a set of workflows and one Slack channel. `ActivityEvent.workspace`
  defaults to `"demo"`, so existing seed data keeps working unchanged.
- L0 → L1 by clicking a workflow node. L1 → L2 by clicking a case in the trace list.
- **Back navigation must preserve selection** — returning from L2 re-selects the case's path in L1.

L0 is worth building only after UJ1–UJ4 are solid. It is the "this scales beyond one process"
argument, not the core demo.

---

## 3. Sub-graph relationships & highlighting

Two workflows are **linked** when a case in each shares an `artifact`, or when one case's artifact
id appears in the other's message text. Both signals already exist in the data — no new extraction.

```ts
export interface WorkflowLink {
  artifact: string;
  cases: { source: string; target: string }[];   // caseId pairs
  count: number;
  source: WorkflowId;
  target: WorkflowId;
}
```

**Highlighting rules** — one consistent idiom at every level, because inconsistent highlighting is
what makes graph UIs feel arbitrary:

| Selection | Highlighted | Dimmed |
|---|---|---|
| workflow node (L0) | that workflow + everything it links to | the rest, 25% opacity |
| activity node (L1) | its in/out edges, and every case path through it | unrelated nodes, 25% |
| variant (L1) | that variant's full path | all other edges |
| case (L2) | its path, its messages, its agent events | — |

Dim, never hide. A node vanishing reads as a bug; a node dimming reads as focus.

---

## 4. Grounding — the trust states

A step is **grounded** when it carries at least one real Slack message reference. This is a
first-class, visible state, because it is the difference between a claim and a citation.

| State | Condition | Renders |
|---|---|---|
| `grounded` | ≥1 `MessageRef` with a permalink | solid border + 🔗 badge |
| `inferred` | extracted, no message ref (reconciled or implied) | dashed border, no badge |
| `proposed` | `confidence < 0.4` | dimmed 60%, excluded from aggregates until confirmed |
| `confirmed` | human ✅ (UI or Slack reaction) | solid + ✓, confidence pinned to 1 |
| `rejected` | human ❌ | removed from the graph, kept in the log |

Node-level: `grounded / count` ratio in the Inspector and as a thin fill bar on the node itself.
**Workspace-level: a single "grounded 87%" figure in the header** — it is the honest headline metric
for a product whose claim is provenance.

---

## 5. Backend interface

All additive. Existing responses keep every field they have today.

### 5.1 `shared/process.ts` — type deltas

```ts
export interface MessageRef {
  author: string;        // "Oliver Park"
  authorId: string;      // stable person id
  channel: string;       // "C0C1DFQL72N"
  permalink: string;     // https://<ws>.slack.com/archives/<ch>/p<ts>
  text: string;
  ts: string;            // Slack ts — the message primary key
}

export interface ActivityEvent {
  // ── existing, unchanged ──
  action: string; actor: string; artifact: string; caseId: string;
  id: string; role: string; sequence: number; source: "simulation" | "slack";
  timestamp: string; workflow: WorkflowId;
  // ── new, all optional ──
  confidence?: number;                 // 0..1, default 1 for seeded events
  messages?: MessageRef[];             // grounding. absent/empty ⇒ `inferred`
  modality?: "committed" | "negated" | "reported" | "requested";
  state?: "abandoned" | "committed" | "done" | "requested" | "skipped";
  status?: "confirmed" | "proposed" | "rejected";
  workspace?: string;                  // default "demo"
}

export interface Policy {
  after?: string; before?: string;
  id: string;
  kind: "approval" | "mandatory" | "ordering" | "threshold";
  roles?: string[];
  text: string;
  workflow: WorkflowId;
}

export interface DesignedModel {
  activities: { label: string; role: string; slug: string; synonyms?: string[] }[];
  entry: string;
  matrix: number[][];                  // N×N, index order === activities order
  policies: Policy[];
  workflow: WorkflowId;
}

export interface Conformance {
  extra: { count: number; slug: string }[];
  fitness: number;                     // |D ∩ O| / |D|
  grounded: number;                    // grounded events / total events
  missing: { of: number; seenIn: number; slug: string }[];
  orderBreaks: { expectedBetween: string; from: string; to: string }[];
  precision: number;                   // |D ∩ O| / |O|
  roleDeviations: { expected: string; observed: string[]; slug: string }[];
  violations: { caseIds: string[]; evidence: MessageRef[]; policyId: string; quote?: string }[];
}
```

`ProcessNode` gains `grounded: number`, `plane: "both" | "designed" | "discovered"`,
`roleExpected?: string`. `ProcessEdge` gains `plane`, `violates?: string[]`, `isBackEdge?: boolean`.

### 5.2 `mine()` signature

```ts
export function mine(input: ActivityEvent[], designed?: DesignedModel)
// returns { ...everything it returns today,
//           conformance?: Conformance,      // only when `designed` is supplied
//           designedEdges?: ProcessEdge[] } // designed-only transitions. NEVER in `edges`.
```

Rules that protect the tests: `edges` contains **only** observed transitions; `probability` is
computed over `edges` alone; events with `status === "rejected"` or `confidence < 0.4` are excluded
from `nodes`/`edges` but still counted in `stats.proposed`.

### 5.3 Endpoint deltas

| Endpoint | Change |
|---|---|
| `GET /api/model` | add `conformance`, `designed`, `designedEdges`, `links`, `workspace` |
| `GET /api/designed?workflow=` | **new** — the documented plane alone, renderable before any run |
| `POST /api/simulate` | **return the inserted `events[]`** — this is what makes UJ1 free |
| `GET /api/workspaces` | **new** — `[{ channel, id, name, workflows: WorkflowId[] }]` |
| `GET /api/links?workspace=` | **new** — `WorkflowLink[]` for the L0 graph |
| `POST /api/agent/decision` | **new** — `{ caseId, decision: "approve"\|"hold"\|"reject", eventId }` |
| `POST /api/steps/:id/status` | **new** — `{ status: "confirmed"\|"rejected" }` → curation |
| `GET /api/agent/events?workflow=` | **new** — `AgentEvent[]`, see §5.4 |
| `POST /api/ask` | add `citations: MessageRef[]` and `nodes: string[]` to the response so answers can highlight the graph |

### 5.4 `AgentEvent`

```ts
export interface AgentEvent {
  caseId?: string;
  citations: MessageRef[];
  createdAt: string;
  id: string;
  kind: "answer" | "drift" | "playbook";
  nodes: string[];                     // activity ids to highlight
  pauses: boolean;                     // playbook ⇒ true
  policyId?: string;
  resolution?: "approve" | "hold" | "reject";
  text: string;
  workflow: WorkflowId;
}
```

### 5.5 Slack

Real workspace `ariadneos`, channel `#ops-war-room`. Persona posting uses one bot token with
`chat:write.customize` — per-message `username` + `icon_url`, six identities from one token
(spec 03 §2.1). Ingestion is `conversations.history` polling; each mined event carries `MessageRef`s
with real permalinks, which is what turns `grounded` from a label into a fact.

Degradation, in order: real Slack → seeded events with synthetic `MessageRef`s (no permalink,
state `inferred`) → today's behaviour. **The UI must render all three**, and must never imply a
message is grounded when it is not.

---

## 6. Build order

| # | Item | Journey | Est | Why this order |
|---|---|---|---|---|
| 1 | `designed` models + policies for the 3 workflows; `conformance` in `mine()` | UJ3 | 25 min | pure `shared/` work, no UI, unblocks everything visual |
| 2 | Node planes + ghost/gold styling + conformance strip | UJ3 | 20 min | the signature visual |
| 3 | `POST /api/simulate` returns events; client prefix replay + stable layout | UJ1 | 20 min | biggest perceived change per minute |
| 4 | `MessageRef` on events; Inspector quotes; provenance beam | UJ2 | 25 min | the trust anchor |
| 5 | `AgentEvent` + cards + pause/approve/reject | UJ4 | 25 min | the agency beat |
| 6 | Mining log strip | UJ5 | 15 min | convinces technical judges |
| 6b | **Graph editing: confirm / reject / promote / retire + undo** (spec 09) | UJ3/UJ4 | 30 min | turns the canvas from a picture into a tool — highest value after 1-3 |
| 7 | Real Slack ingestion + persona posting | UJ2/UJ4 | 45 min | upgrades grounding from synthetic to real |
| 8 | Workspace L0 graph + `WorkflowLink` highlighting | §2/§3 | 40 min | scales the story past one process |

Interaction craft and the editing verb set are specified separately in **spec 09** — node
anatomy, edge rendering, the eight verbs, the reconcile diff, and the edit-log model that makes
undo trivial.

**Items 1–3 are the ones that change the demo.** If the clock runs out, 1–3 shipped and polished
beats 1–8 half-wired.

---

## 7. Definition of done

- [ ] `npm run check` passes — lint, typecheck, tests, coverage, guardrails, build
- [ ] The three existing test invariants still hold (`edges` discovered-only)
- [ ] `/api/designed?workflow=access` renders a grey documented DAG with no events present
- [ ] Running a simulation assembles the graph progressively, and existing nodes do not move
- [ ] Every node reports a grounding ratio; nothing claims a permalink it does not have
- [ ] A `playbook` event pauses the replay until a human approves, rejects or holds
- [ ] Selecting a node highlights its evidencing messages, and vice versa
- [ ] `access` shows Security review as a ghost node with a policy violation on the edge that skips it
