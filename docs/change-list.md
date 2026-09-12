# Change list — 14:42, 108 minutes to submission

Ordered by what makes the claim true, not by what is easy. **Cut from the bottom.**

The claim is: *conversation goes in, structure comes out, the graph is built from the structure.*
Today `mine()` consumes events that are born already labelled, so nothing in the repo demonstrates
it. Items 1–4 fix exactly that and nothing else.

**Use `env.AI` (Workers AI), already bound in every environment and already used by `/api/ask`.**
Do not block on the OpenRouter key. Put the call behind one function so the provider swaps later.

---

## P0 — makes the claim true · ~75 min

### 1. A transcript · `fixtures/transcripts/access-v2.json` · 15 min

~14 messages of people talking, for **one** case of `access`. Hand-written is fine and faster than
generating. Shape — and nothing else:

```json
{ "variant": "v2_skip_review", "workflow": "access",
  "messages": [
    {"person_id": "maya",   "text": "need prod db access for the migration tomorrow, raising a request now", "delay": 1.2},
    {"person_id": "sofia",  "text": "approved from my side, she's on the migration rota", "delay": 1.4},
    {"person_id": "oliver", "text": "this needs a security review before anything is granted", "delay": 1.1},
    {"person_id": "sofia",  "text": "migration is tomorrow, we don't have time. grant it, we'll review after", "delay": 1.3},
    {"person_id": "noah",   "text": "access granted, added to the prod group", "delay": 1.5}
  ] }
```

**No `action`, no `role`, no slug.** A transcript containing a domain field is invalid
(spec 13 §4.1) — if a persona could label its own step, the graph would be the script redrawn.

### 2. The extractor · `shared/extract.ts` · 25 min · **the one that matters**

```ts
extract(messages: MessageRef[], ctx: ExtractContext): Promise<ActivityEvent[]>
```

One model call, strict JSON schema, per spec 00 §3 and spec 04 §3. Returns per work act:
`activity`, `actor`, `modality`, `evidence[]` (message ids), `confidence`.

- `modality` decides everything: `reported` → step; `committed`/`requested` → step, open;
  `negated` → step recorded as skipped, **excluded from the graph**; `discussed` → nothing.
- **A step with no evidence id is discarded in code**, not by the prompt.
- Malformed JSON → one retry at `temperature: 0` → give up on the window. Never throw.
- `ctx` carries the known people and the designed activity slugs, so the model reaches for the
  documented vocabulary before inventing.

### 3. Wire it · `server/index.ts` · 15 min

```
POST /api/extract {workflow, variant}
  → load transcript → store messages → extract → insert events (session-scoped)
  → return { events, messages, model: mine(all) }
```

Reuse the existing `quota()`, the session cookie, and the same-origin middleware. New route, no
existing route changes.

### 4. Show the evidence · `src/app.tsx` · 20 min

A message rail beside the graph, and node click → the messages that produced it. The existing
`Inspector` and `selectionEvidence` already resolve event ids; they now resolve to text.

**This is the demo.** Point at a node, show the sentence a person typed that caused it.

---

## P1 — makes it visible · ~25 min

### 5. Assemble instead of jump · 20 min
`POST /api/simulate` returns the events it inserted (2 lines). Client replays a growing prefix —
`mine()` is pure and already imported, so no streaming backend:

```ts
const model = useMemo(() => mine(events.slice(0, cursor)), [events, cursor]);
```

Cache dagre positions by node id so existing nodes don't jump. Spec 08 UJ1.

### 6. Let the graph start small · 5 min
`eventsFor()` always unions the baseline, so a run can never be seen being born. Add
`?scope=session`. Measured earlier: adding 6 cases to 24 changes **no nodes and no variants** — only
percentages. Without this, "Run" is invisible.

---

## P2 — only if P0 and P1 are green

7. `shared/designed.ts` + conformance in `mine(events, designed?)` — **designed edges in a separate
   array**, `model.edges` stays discovered-only or `tests/process.test.ts` breaks. ~25 min.
8. Ghost / gold node styling + the conformance number. ~20 min.

---

## Slack — a decision, not a task

The bot token for `ariadneos` is still not created. It is ~10 min of clicking, and it buys the
rubric criterion we currently score worst on: *is the environment essential, or a wrapper?*

If the token lands: post the transcript to `#ops-war-room` as six personas
(`chat:write.customize`), then read the same messages back with `conversations.history` and extract
from what Slack returns. **~25 min, and it makes grounding real** — permalinks that resolve.

If it does not land: steps render as `inferred`, not `grounded`, and we say so. Never claim a
permalink that doesn't exist.

---

## Cut — specced, not reachable today

Mastra, live agent-to-agent generation, the workspace install API, graph editing verbs, agent
interventions and pause, the L0 hierarchy, cross-workflow links. All specced in 09–13. None of them
is the claim; all of them are production value around it.

**If only one thing ships, ship item 2 over cached transcripts.** Text in, structure out, graph from
the structure. Only the authoring of the text is cached, and that is an honest sentence to say.
