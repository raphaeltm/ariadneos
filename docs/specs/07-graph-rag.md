# Spec 07 — Graph-RAG

> How `@Ariadne` answers a question no document can answer, and proves every sentence with a Slack
> permalink. The graph is the index. There are no embeddings.

**Owner:** RAG issue #27 · **Priority:** P1 · **Module:** `server/rag.ts` · **Entry:** `POST /api/ask`

Read [the Cloudflare contract](00-cloudflare-architecture.md) for runtime, authorization and budgets.

---

## 1. Why graph retrieval, not vector retrieval

The naive move is to embed every Slack message and do similarity search. For this product it is
actively wrong:

| | Vector RAG over messages | Graph-RAG over the mined process |
|---|---|---|
| *"What happens after triage?"* | returns messages **about** triage — chatter, not sequence | walks `FOLLOWS` edges, returns the actual ordering with frequencies |
| *"Who handles P1s?"* | returns messages mentioning P1 | aggregates `PERFORMED_BY` across every step in every case |
| *"Do we skip security review?"* | returns the one message that says so, if you're lucky | returns `support=0`, `missing_in 3 of 4 cases`, **and** the quote |
| *"Has this happened before?"* | no notion of "before" | counts sessions containing the activity |

The questions people ask about process are **relational and quantitative**. Similarity search answers
neither. Our corpus is also small (~2k messages) and already structured — the expensive work of
turning text into structure happened during mining, and throwing that away at query time to do
approximate string matching would be absurd.

**No embeddings, no vector store, no chunking.** If the corpus ever outgrows this, §8 has the escape
hatch.

---

## 2. The pipeline

```
 question
    │
    ├─ 0  classify intent        6 intents, decides the traversal        heuristic + LLM fallback
    ├─ 1  anchor                 question → entity ids via lexicon       deterministic
    ├─ 2  expand                 typed, budgeted traversal from anchors  deterministic
    ├─ 3  attach evidence        top-k messages per activity             deterministic
    ├─ 4  serialise              subgraph → line-oriented text           deterministic
    └─ 5  answer                 one LLM call, citations mandatory       LLM
                                 → uncited sentences are stripped
```

One LLM call in the common path. Coalesce intent/entity fallback into at most one additional
model call per question; never allow a fallback chain to exceed the model budget. Target p50
end-to-end **<2.5s**, measured on staging rather than promised.

---

## 3. Stage 0 — query intent

Different questions need different traversals. Guessing one traversal for all of them is the main
reason generic graph-RAG underperforms.

| Intent | Example | Traversal | Edge whitelist |
|---|---|---|---|
| `process_shape` | *"what happens after a P1 is triaged?"* | forward `FOLLOWS` from anchor, weight-desc | `FOLLOWS`, `CONTAINS` |
| `actor` | *"who actually handles incidents?"* | steps of anchored activities → aggregate by role | `INSTANCE_OF`, `PERFORMED_BY`, `WORKS_ON` |
| `deviation` | *"where do we break our own process?"* | conformance findings directly, no traversal | — |
| `policy` | *"what are the rules before a deploy?"* | `GOVERNS` in-edges on anchor | `GOVERNS`, `FOLLOWS` |
| `provenance` | *"why do you think we skip security review?"* | `EVIDENCED_BY` on the relevant steps | `INSTANCE_OF`, `EVIDENCED_BY` |
| `history` | *"has this happened before?"* | sessions containing anchor, ordered by time | `IN_SESSION` |

Classification: keyword heuristics first (`who` → `actor`, `after`/`next`/`then` → `process_shape`,
`why`/`how do you know` → `provenance`, `rule`/`policy`/`allowed` → `policy`,
`before`/`last time`/`ever` → `history`, `skip`/`drift`/`break`/`wrong` → `deviation`). No match →
one cheap LLM classification call. Still no match → `process_shape`, which is the most useful default.

---

## 4. Stage 1 — anchoring

A scoped **lexicon** is built from bundled KB plus D1 activity revisions and cached per isolate
when available; cache loss is harmless and a KB/graph revision change invalidates it. Every retrievable entity contributes its
surface forms:

```text
LEXICON: dict[str, tuple[NodeType, str]]     # normalised surface → (type, id)

Person     "priya raman", "priya"                      → per_priya
Project    "helios payments", "helios"                 → proj_helios
Artifact   "inc-4412", "inc 4412", "4412"              → art_inc_4412
Activity   "security_review", "security review",
           "pre-deploy checklist", "the checklist"     → act_security_review   # synonyms authored in KB
Policy     "pol_sec_review", "the security policy"     → pol_sec_review
Workflow   "p1 incident response", "incident process"  → wf_p1_incident
```

Matching, in order — first non-empty result wins:

1. **Exact** on normalised surface (lowercase, strip punctuation, collapse whitespace).
2. **Token containment** — every token of a lexicon key appears in the question.
3. **Fuzzy** — a bounded TypeScript edit-distance matcher over lexicon keys.
4. **LLM extraction** — one call: *"which of these entities does the question refer to?"* with the
   candidate list. Only reached when 1–3 all miss.

**Activity synonyms are authored in the KB**, not inferred. `security_review` carries
`synonyms: ["security review", "pre-deploy checklist", "the checklist"]` because that is how people
actually refer to it in the channel, and no amount of string distance gets you from "the checklist"
to `security_review`.

No anchor found → answer is *"I haven't observed anything about that."* We do not guess.

---

## 5. Stage 2 — budgeted expansion

Where naive graph-RAG dies is unbounded traversal: two hops on a dense graph is the whole graph, and
the prompt becomes noise. Hard budget:

```text
MAX_HOPS       = 2
MAX_NODES      = 40
MAX_EVIDENCE   = 3      # messages per activity
TOKEN_BUDGET   = 3500   # serialised subgraph
```

Rules:

- Traverse **only** the intent's edge whitelist (§3).
- Order the frontier by `support` descending, so a truncated subgraph keeps the dominant path.
- **Always include an anchor activity's counterpart in the other plane.** If the anchor is discovered,
  pull its designed neighbours and vice versa — otherwise the answer can't say *"documented, but it
  doesn't happen"*, which is the most valuable thing we know.
- Always include conformance findings touching any node in the subgraph.
- Truncation is **reported, not silent**: the serialisation ends with
  `TRUNCATED 12 further activities below support=2`, and the answer may reference it.

---

## 6. Stage 4 — serialisation

Use a compact line-oriented context with explicit IDs. Measure tokens on fixtures; no fixed
40% saving or model reliability improvement is assumed. Escape untrusted Slack text so it cannot
forge structural context/citation records.

```
QUESTION_INTENT process_shape
ANCHOR act_security_review

ACTIVITY security_review "Security review" plane=designed support=0/4 role_expected=eng
  GOVERNED_BY pol_sec_review "A security review must complete before any production deploy."
  MISSING_IN ses_002 ses_003 ses_005
ACTIVITY root_cause_analysis "Root cause analysis" plane=both support=3/4 roles_observed=eng
  FOLLOWS→ deploy_fix weight=3 kind=sequence VIOLATES pol_sec_review
  FOLLOWS→ security_review weight=0 kind=sequence PLANE=designed_only
ACTIVITY deploy_fix "Deploy the fix" plane=both support=4/4 roles_observed=eng
ACTIVITY improvise_hotfix "Ship mitigation before root cause" plane=discovered support=2/4
  ROLE_DEVIATION none

CONFORMANCE wf_p1_incident fitness=0.78 precision=0.70
  MISSING security_review write_postmortem
  EXTRA escalate_to_ceo improvise_hotfix hold_customer_call
  VIOLATION pol_sec_review in ses_002 ses_003 ses_005

EVIDENCE 1757671251.000300 per_tom "Tom Becker" 09:41 ses_002
  "skipping the security checklist to save time, we can review after"
  https://ariadneos.slack.com/archives/C09.../p1757671251000300
EVIDENCE 1757671001.000100 per_dana "Dana Okafor" 09:16 ses_002
  "ship it. we'll do the review after the customer is unblocked"
  https://ariadneos.slack.com/archives/C09.../p1757671001000100

TRUNCATED 6 further activities below support=2
```

---

## 7. Stage 5 — the answer contract

System prompt, in priority order:

1. **Answer only from the subgraph above.** You have no knowledge of incident management, software
   process, or this company beyond what is printed here.
2. **Every factual sentence carries a citation** — a verified permalink from an `EVIDENCE` line, or a typed reference
   to a retrieved `ACTIVITY` / `CONFORMANCE` record for a numerical/authored claim. Do not invent
   a Slack quote for authored-only policy; label the source type and return its KB reference.
3. Prefer the observed over the documented, and **say which is which**. *"In practice…"* vs
   *"The documentation says…"* is the distinction the whole product exists to draw.
4. If the subgraph does not contain the answer, say so. Do not reason around the gap.
5. Two to four sentences. This is a Slack reply, not a report.

**Post-processing, in code:** split into sentences; any sentence making a factual claim with no
resolvable citation is dropped. If everything drops, reply *"I don't have evidence for that yet."*
An uncited answer never reaches the channel.

A resolvable citation alone does not prove that it supports a claim. Validate quoted text and
counts against retrieved data; reject unsupported claims. This reduces unsupported answers but
does not make a model incapable of hallucination. With no evidence return the no-evidence response.

---

## 8. Stack

TypeScript in the existing Hono Worker, scoped D1 queries and a bounded in-memory traversal.
Use the shared model adapter from #19 with native fetch/OpenRouter, configured MODEL_SIM for
classification/anchoring fallback and MODEL_RAG for answers. No Python SDK, KV cache or new service.
D1 uses the additive pm_ schema from spec 05; all retrieval enforces authorized workspace/channel.
Reuse existing local npm/Wrangler commands and environment-specific secrets.

Vectorize is deferred. If later measured recall failures justify embeddings, use them to rank
anchors while retaining deterministic traversal and evidence checks. No indexing work in P1.

---

## 9. Worked examples

**Q — "what do we actually do after a P1 is triaged?"**
→ intent `process_shape` · anchor `act_triage_incident` · 9 activities, 2 hops

> In practice, not what the runbook says. In all 4 cases someone escalated to Dana directly before an
> owner was assigned ([Priya 09:16](#), [Dana 09:16](#)), and in 2 of 4 a mitigation shipped before
> root cause was known ([Tom 09:38](#)). The documented next step is `assign_owner` by the PM, which
> happened in 3 of 4 — but the CEO performed it, not the PM.

**Q — "why do you think we skip security review?"**
→ intent `provenance` · anchor `act_security_review` · steps + `EVIDENCED_BY`

> Because it was said out loud. Tom: *"skipping the security checklist to save time, we can review
> after"* ([09:41](#)), and Dana confirmed: *"ship it, we'll do the review after"* ([09:42](#)).
> `security_review` has support 0 of 4 cases while `deploy_fix` has 4 of 4.

**Q — "what's the capital of France?"**
→ no anchor

> I haven't observed anything about that.

---

## 10. Definition of done

- [ ] `answer()` returns prose with ≥2 resolvable permalinks for fixture questions with sufficient live evidence; otherwise an explicit no-evidence answer
- [ ] An out-of-scope question returns the no-anchor response, not a guess
- [ ] Every sentence surviving post-processing carries a citation
- [ ] A `deviation` question returns conformance findings without traversing
- [ ] p50 latency < 2.5 s end-to-end, one LLM call in the common path
- [ ] The three worked examples in §9 reproduce — they are the regression test
