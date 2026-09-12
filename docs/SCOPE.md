# ARIADNE — Frozen Scope

> **The thread through the labyrinth.** An agent that lives in your Slack channel,
> watches how work actually gets done, and mines the real process into a living,
> evidence-linked workflow graph that nobody ever wrote down.

**Status:** FROZEN at 12:40 CEST, Sat 12 Sep 2026. Changes to P0 require both builders to agree.
**Submission deadline:** 16:30 CEST. **Feature freeze:** 15:15. **Video:** 15:15–15:50. **Submit:** by 16:10.

---

## 1. The pitch (60 seconds)

Every company runs two processes: the one in the wiki, and the one that actually happens in Slack.
The second one is the real one, and it is invisible — scattered across thousands of messages,
never written down, lost when people leave.

**Ariadne** is an agent that sits in the channel where the work already happens. It watches
conversations, extracts the *atomic steps* of work as they occur, links each one back to the exact
message that evidenced it, and consolidates repeated occurrences into a **global process graph** —
a DAG of how your organisation truly operates, with support counts, variants, rework loops and
citations.

Then it uses that knowledge, in the channel:

- when a workflow completes → it posts the mined playbook
- when a new conversation **deviates** from the mined process → it warns, in-thread, before the mistake lands
- when someone `@Ariadne`s it → it answers from process knowledge nobody authored, with Slack permalinks

**Why the environment is essential:** the evidence only exists in the channel. This value cannot be
reproduced in a chat box — it comes from *passive, longitudinal observation of multi-party
conversation*. A standalone chatbot has nothing to mine.

---

## 2. What we build (P0 — must ship)

| # | Capability | Proof in the demo |
|---|---|---|
| 1 | **Real Slack integration** — bot in a real channel, reads via `conversations.history`, writes via `chat.postMessage` | The judge sees an actual Slack window |
| 2 | **Team simulator** — 5 role agents (CEO, CPO, PM, Engineer, Support) with private agendas, posting as distinct Slack personas | A business scenario plays out live in the channel in ~60s |
| 3 | **Live mining** — unstructured chat → structured *event log* of atomic steps, each with `evidence[]` Slack message refs | Step cards stream into the UI as messages land |
| 4 | **Per-run workflow DAG** — directly-follows graph over the mined steps | Center canvas draws the instance workflow |
| 5 | **Global ontology** — canonicalisation across runs into one consolidated process graph with `support`, variants, rework | Run 3 merges into the existing graph, support counters tick up |
| 6 | **Evidence citations** — every node opens to the real Slack quotes + "Open in Slack ↗" | Click a node, read the messages that prove it |
| 7 | **Live UI** — dark, modern, SSE-driven; instance ↔ global toggle; frequency slider | The spaghetti collapses to the happy path as you drag |

## 3. What makes it win (P1 — build if P0 is green by 14:20)

| # | Capability | Rubric line it targets |
|---|---|---|
| 8 | **Drift alert in Slack** — "⚠️ this run skipped *security review*, present in 3 of 4 prior runs" | Usefulness 5: "unlocks substantial value… using context intelligently" |
| 9 | **`@Ariadne` Q&A** — answers process questions from the mined graph with permalinks | Agentic experience, native to the environment |
| 10 | **✅/❌ curation via Slack reactions** — humans confirm or reject a mined step from inside Slack; the graph updates live | Usefulness 3–5: "meaningful actions with reasonable user control" |
| 11 | **Human-typed message proof** — a judge/you types a real message, the graph reacts | Kills the "it's just a canned simulation" objection |

## 4. Stretch (P2 — only after 15:00, only if nothing is broken)

- CopilotKit sidebar over the graph → second prize track (purple AirPods Max)
- Second scenario family (pricing change) so the global graph holds two processes
- Cloudflare deploy (Pages + Tunnel) for a live URL in the submission
- Auth0 login

## 5. Explicit NON-goals — say no to all of these

- ❌ Socket Mode / webhooks / public URL — **polling only**, no tunnel dependency
- ❌ Slack OAuth distribution flow, multi-workspace, Teams, Discord
- ❌ Auth, users, roles, multi-tenancy
- ❌ Postgres, Neo4j, vector DB, embeddings — **SQLite + JSON**
- ❌ Graph editing, drag-to-rearrange persistence, undo
- ❌ Real BPMN/XES export, conformance-checking algorithms beyond directly-follows
- ❌ Tests beyond a smoke script. Fixtures are the test.
- ❌ Refactoring. Ship the spike.

---

## 6. Architecture

```
  ┌───────────────────┐   chat.postMessage (persona username + icon)
  │  Simulator        │──────────────────────────────┐
  │  5 role agents    │                              │
  │  + beat sheet     │                              ▼
  └───────────────────┘                    ╔══════════════════════╗
                                           ║  REAL SLACK CHANNEL  ║
  ┌───────────────────┐                    ║   #ops-war-room      ║
  │  A human (you)    │───types a message──║                      ║
  └───────────────────┘                    ╚══════════╤═══════════╝
                                                      │ conversations.history
                                                      │ poll every 2s (cursor = last ts)
                                                      ▼
                                  ┌──────────────────────────────────┐
                                  │  OBSERVER AGENT                  │
                                  │  1. buffer → window              │
                                  │  2. extract atomic steps (LLM,   │
                                  │     structured output)           │
                                  │  3. directly-follows graph       │
                                  │  4. canonicalise → global graph  │
                                  │  5. detect drift                 │
                                  │  6. ACT: post playbook / alert / │
                                  │     answer @mentions             │
                                  └────────┬────────────────┬────────┘
                                           │                │ chat.postMessage
                                           ▼                └──► back into Slack
                                     SQLite (runs, messages,
                                     steps, canon, edges)
                                           │
                                    FastAPI  /api/* + /api/stream (SSE)
                                           │
                                           ▼
                                  Vite + React + React Flow UI
```

**One Python process** (FastAPI + background poll loop + background sim task), **one SQLite file**,
**one Vite app**. Two containers in `docker-compose.yml`. Nothing else.

---

## 7. The intellectual core: who does what

The division of labour is the technical story judges should hear:

> **The LLM does the part only an LLM can do** — turning unstructured, interleaved, multi-party
> human conversation into a structured event log.
> **Classical process mining does the part that must be reliable** — the directly-follows graph,
> frequency weighting, variant and rework detection are deterministic code over that event log.

That means the graph is never hallucinated: it is arithmetic over extracted events, and every event
carries a message-ID citation you can click through to Slack.

---

## 8. Stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Models | **OpenRouter** (sponsor), OpenAI-compatible client | One key, one SDK, cheap fast model for the 20-turn sim, stronger model for extraction |
| Backend | Python 3.11, FastAPI, `httpx`, `uvicorn`, stdlib `sqlite3` | No ORM, no migrations |
| Slack | Raw Web API over `httpx` (no `slack_sdk` needed) | 3 endpoints total |
| Frontend | Vite + React + TS, **React Flow** + **dagre**, Tailwind v4 (`@tailwindcss/vite`) | Fastest path to a graph that looks expensive |
| Transport | SSE (`text/event-stream`) | Simpler than WebSocket in FastAPI |
| Packaging | `docker-compose.yml`, 2 services | Judge can `docker compose up` |

---

## 9. Team split (2 builders)

| Track | Owner | Scope | Spec |
|---|---|---|---|
| **A — Pipe & Mine** | Builder 1 | Slack client, simulator, extractor, graph engine, consolidation, API, SSE, observer actions | `specs/02`, `03`, `04` |
| **B — Surface** | Builder 2 | Vite app, graph canvas, live stream panel, inspector, slider, visual polish, demo rehearsal | `specs/05` |

**Unblocking rule:** `fixtures/` is committed in the first 20 minutes. Track B builds entirely
against fixtures and only switches to the live API at ~14:00. Neither track ever waits on the other.

**Human-only tasks (do these first, they have external latency):**
1. Create a **fresh free Slack workspace** + app + bot token + invite bot to `#ops-war-room` → `specs/02 §1`
2. Get the **OpenRouter** key into `.env`
3. Make the GitHub repo **public**
4. 15:15 — record the 2-minute video; 15:40 — social post tagging @OpenAI @CopilotKit @OpenRouter @Exa @Auth0 @TriggerDotDev @Mozilla_ai

---

## 10. Timeline

| Time | Track A | Track B | Gate |
|---|---|---|---|
| 12:20–12:45 | Slack app live, `.env`, skeleton, fixtures committed | Vite app up, renders fixture graph | **Fixtures frozen** |
| 12:45–13:30 | `slack.py` post+poll, simulator generates & performs a run | Graph canvas + node styling + layout | **Messages visible in real Slack** |
| 13:30–14:20 | Extractor → steps → DFG → global consolidation, API + SSE | SSE wiring, live message rail, inspector w/ evidence | **Graph builds from live Slack** |
| 14:20–15:00 | Observer acts: playbook post, drift alert, @mention Q&A, reactions | Instance↔global toggle, support slider, animations, polish | **P1 done** |
| 15:00–15:15 | Seed runs 1 & 2, rehearse end-to-end twice | Rehearse, fix visual nits | **FEATURE FREEZE** |
| 15:15–15:50 | Video recording (both) | | |
| 15:50–16:10 | README, description, social post, submit | | **SUBMITTED** |

---

## 11. Risk register + mitigations

| Risk | Mitigation (build this, don't hope) |
|---|---|
| Live LLM is slow/flaky during the demo | Simulator has two modes: `generate` (LLM writes transcript → cached JSON) and `perform` (posts cached transcript to Slack on a timer). **Demo always performs a cached transcript.** Mining still runs live on it. |
| Extraction returns garbage | Strict JSON schema + `response_format`, a 2-shot prompt, `confidence` field, and a hard fallback to the fixture step set if a run yields 0 steps |
| Slack rate limits | ≥1.1s between posts, one channel, poll every 2s |
| Global graph is boring (3 identical runs) | **Planted variants**: run 2 injects a rework loop, run 3 skips a step. Specified in `specs/02 §4` — this is what makes support counts and drift detection visible |
| We run out of time | Priority ladder is P0 → P1 → P2. Cut from the bottom, never from the middle. |
| "It's just a simulation" | Demo beat #6: the judge types a message in Slack themselves and the graph moves. Same code path, no special casing. |

---

## 12. Judging rubric → where we score

| Criterion | Our answer |
|---|---|
| **Core requirements & functionality** | A real bot in a real Slack channel, end-to-end: messages → event log → graph → agent posts back. Runs with `docker compose up`. |
| **Innovation & theme alignment** | Not an assistant *in* Slack — an **observer** that turns the channel itself into a data source. The output (a mined organisational process graph) literally cannot exist without the environment. |
| **Technical execution** | LLM for extraction + deterministic process mining for the graph; evidence-linked provenance on every node; SSE live consolidation; explicit failure fallbacks. |
| **Usefulness & agentic experience** | Drift alerts prevent real mistakes; `@Ariadne` answers process questions no wiki holds; ✅/❌ reactions keep the human in control of the ontology. |

---

## 13. Submission artefacts (part of the scope — budget 40 min)

- [ ] Title: **Ariadne — the agent that mines your team's real process from Slack**
- [ ] Written description (see `specs/06 §3`)
- [ ] Public GitHub repo, all commits from today
- [ ] 2-minute video (script in `specs/06 §2`)
- [ ] Social post tagging sponsors
