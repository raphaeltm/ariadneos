# Spec 03 — Simulation & Slack

> Generates a believable organisation doing believable work, inside a real Slack channel.
> The observer cannot tell simulated traffic from human traffic — it reads the same API.

**Owner:** Track A · **Time budget:** 60 min · **Modules:** `backend/app/slack.py`, `backend/app/sim.py`

---

## 1. Slack setup (human task — do this FIRST, it has external latency)

Runs in a **dedicated `ariadneos` workspace**, not anyone's company workspace. Two reasons: the demo
video records the Slack window, and a real workspace puts private channels and colleagues in the
sidebar; and a clean workspace means the channel history *is* the dataset, with no unrelated traffic
for the observer to wade through.

1. Workspace: **`ariadneos`** (already created).
2. `api.slack.com/apps` → **Create New App** → From scratch → name `Ariadne` → pick the `ariadneos` workspace.
3. **OAuth & Permissions → Bot Token Scopes:**

   | Scope | Why |
   |---|---|
   | `chat:write` | post as Ariadne |
   | `chat:write.customize` | post as personas (`username` + `icon_emoji` override) |
   | `channels:history` | read the channel |
   | `channels:read` | resolve channel id |
   | `users:read` | resolve human authors |
   | `reactions:read` | ✅/❌ curation (P1) |
   | `reactions:write` | Ariadne reacts 🧵 when a message becomes evidence |

4. **Install to Workspace** → copy `xoxb-…` → `.env` as `SLACK_BOT_TOKEN`.
5. Create `#ops-war-room`, `/invite @Ariadne`, copy the channel id (`C…`) → `SLACK_CHANNEL_ID`.
6. Set `SLACK_WORKSPACE=<subdomain>` (for permalink construction).

**No Socket Mode. No Events API. No public URL. No tunnel.** We poll.

---

## 2. Slack client — `slack.py` (≈90 lines, raw `httpx`)

```python
post(text, *, username, icon_emoji, session_id, thread_ts=None) -> ts
    # chat.postMessage with metadata={"event_type":"ariadne_sim",
    #                                 "event_payload":{"session_id":..., "person_id":...}}
    # also writes ts -> (session_id, person_id) into our own DB (belt and braces:
    # metadata can be dropped by Slack for some surfaces, our table never is)

poll(oldest_ts) -> list[Message]
    # conversations.history(channel, oldest=cursor, inclusive=false, limit=200)
    # returns ascending; caller advances the cursor

permalink(ts) -> str
    # constructed locally, no API call:
    # https://{workspace}.slack.com/archives/{channel}/p{ts.replace('.','')}

react(ts, emoji)            # reactions.add
reactions_on(msg) -> dict   # read from the history payload — free, no extra call
```

Rate discipline: **≥1.1 s between posts**, poll every **2 s**. One channel only.

### 2.1 Persona identity — six people out of one token

Every simulated message must visibly come from a **different person**: distinct display name, distinct
avatar, distinct colour. This is not cosmetic — if all six personas render as one author, the channel
reads as a monologue, handoff edges become meaningless, and the whole premise ("multi-party
conversation is the data source") collapses on camera.

The mechanism is the `chat:write.customize` scope, which lets a single bot token override the author
**per message**:

```python
post(text, username="Priya Raman", icon_url=PERSONA_AVATAR["per_priya"], ...)
# chat.postMessage(channel=..., text=..., username=..., icon_url=...,
#                  metadata={"event_type":"ariadne_sim",
#                            "event_payload":{"session_id":…, "person_id":…}})
```

Avatars come from the KB `Person`. Use a stable generated set so all six are distinct and consistent
across runs — `https://api.dicebear.com/9.x/notionists/png?seed={person_id}` (Slack fetches the URL
server-side; it must be publicly reachable). Fall back to `icon_emoji` from `Person.emoji` if image
fetching is flaky.

**Alternatives considered and rejected:**

| Approach | Identity quality | Cost | Verdict |
|---|---|---|---|
| **One bot + `chat:write.customize`** | distinct name + avatar per message, small `APP` badge | 10 min, one token | ✅ **chosen** |
| Six separate Slack apps, one per persona | same visual result, six real bot profiles | ~30 min of clicking, six tokens in `.env` | ❌ same outcome, 3× the setup |
| Six real user accounts + user tokens (`xoxp-`) | genuine humans, no `APP` badge | six invites, six OAuth installs | ❌ nowhere near affordable in the window |
| Incoming webhooks per persona | name + avatar override, no scopes | one webhook URL per persona | ❌ no `metadata`, no threading, no reactions |
| **Slack MCP (`mcp.slack.com`)** | **all messages post as the authenticating human** | zero | ❌ **cannot do personas at all** — see §2.1.1 |

#### 2.1.1 Why not MCP

The Slack MCP server is the right tool for *operating* a workspace conversationally and it is useful
for setup and inspection. It is the wrong tool for this simulation, on three counts:

1. **No identity override.** It posts as the authenticated user. Six personas become one author.
2. **Not reachable from the product.** The backend is a container a judge runs with
   `docker compose up`; it cannot complete an interactive OAuth flow against a remote MCP. The bot
   token is a string in `.env` and works everywhere, including CI.
3. **Wrong grain.** We need `conversations.history` polling with cursors, message `metadata`, and
   reaction payloads — a narrow, high-frequency machine interface, not a conversational one.

Use MCP for *setup and verification* (create the channel, eyeball that messages landed). Use the bot
token for everything the product does.

### 2.2 Author resolution

| Message shape | Resolution |
|---|---|
| has our metadata `person_id` | → that Person (simulated) |
| `bot_id` + `username` matches a KB person name | → that Person (metadata fallback) |
| `user: U…` | `users.info` (cached) → `author_label`, `author_person_id = null` → **human** |
| Ariadne's own posts | `is_agent = true` → **excluded from mining** (never mine your own output) |

---

## 3. Personas

A persona system prompt is assembled from the KB Person + Project (spec 02):

```
You are {name}, {role} at a company building {project.name}.
{project.summary}

Your goals: {goals}
Your biases: {biases}
How you write: {comms_style}

You are in the Slack channel #ops-war-room with: {other people + roles}.
Write ONE Slack message. 1–3 sentences. Lowercase-casual is fine. No greetings, no sign-offs,
no emoji spam. Reference real names, ticket ids and artifacts from the context.
Never narrate what you are doing — just say the thing a person would type.

Current situation:
{last 8 messages}

Your intent for this message: {beat.intent}
```

Hard rules baked into the prompt: no message over 320 characters, never mention being an AI, never
summarise the conversation, never write more than one message.

---

## 4. Scenarios, beats and planted variants

A **scenario** is `(project, designed_workflow, variant)`. A **beat sheet** is an ordered list of
`{actor, intent, deviation?}` — the actor and intent are scripted, **the words are generated.**
This gives us determinism where we need it (the process shape) and realism where we want it (the
language).

```yaml
# sim/scenarios/helios_p1.yaml
id: helios_p1
project_id: proj_helios
workflow_id: wf_p1_incident
trigger: "Vertex Logistics reports checkout 500s at 09:14. Renewal is in November."
variants:
  v1_by_the_book:
    label: "Textbook run"
    beats:
      - {actor: per_priya, intent: "report that Vertex is seeing checkout 500s, give volume and start time"}
      - {actor: per_priya, intent: "call it a P1 and say why (SLA clock, revenue impact)"}
      - {actor: per_priya, intent: "say you opened INC-4412"}
      - {actor: per_marc,  intent: "assign Tom as incident owner and state the 4h mitigation target"}
      - {actor: per_tom,   intent: "confirm you reproduced it on the staging replica"}
      - {actor: per_tom,   intent: "give the root cause: a null merchant_id in the 3DS callback"}
      - {actor: per_tom,   intent: "say the security checklist passed, link the checklist"}
      - {actor: per_tom,   intent: "say the fix is deployed to prod"}
      - {actor: per_priya, intent: "confirm error rate is back to baseline"}
      - {actor: per_marc,  intent: "say you've emailed Vertex with the timeline"}
      - {actor: per_lea,   intent: "ask who is writing the postmortem"}

  v2_skip_review:                       # ← the money variant
    label: "Pressure run — review skipped, CEO pulled in"
    beats:
      - {actor: per_priya, intent: "report checkout 500s at Vertex, volume climbing"}
      - {actor: per_priya, intent: "call it a P1, note the renewal is in November"}
      - {actor: per_dana,  intent: "react as CEO: this is our biggest logo, ask for a fix now, ping Tom directly",
         deviation: escalate_to_ceo}
      - {actor: per_tom,   intent: "say you'll push a mitigation before you know the root cause",
         deviation: improvise_hotfix}
      - {actor: per_tom,   intent: "say you're skipping the security checklist to save time",
         deviation: skip_security_review}
      - {actor: per_lea,   intent: "object that the checklist is mandatory"}
      - {actor: per_dana,  intent: "overrule: ship it, we'll review after"}
      - {actor: per_tom,   intent: "say the fix is deployed"}
      - {actor: per_marc,  intent: "say you're calling Vertex now, before verification",
         deviation: hold_customer_call}
      - {actor: per_priya, intent: "confirm errors dropped"}

  v3_rework:
    label: "Rework run — first fix fails"
    # ... deploy_fix → verify_resolution FAILS → back to root_cause_analysis → deploy_fix
```

**Why variants are non-negotiable:** without planted deviation, three runs produce three identical
graphs, `support` is uniform, conformance is 100%, and there is nothing to see. The variants are what
make the gold nodes, the dashed ghosts and the drift alerts appear.

Second scenario: `sim/scenarios/atlas_feature.yaml` on `wf_feature_intake`, variants
`v1_by_the_book` and `v2_roadmap_bypass` (Dana promises Vertex SSO to the customer before roadmap
review — `negotiate_scope_offline` becomes a gold node).

**Demo set:** helios v1, helios v2, helios v3, atlas v1, atlas v2 → 5 sessions, 2 process families.

---

## 5. Two modes — this is the demo safety net

```
generate:  beats + personas + KB → LLM → transcript JSON → fixtures/transcripts/{scenario}.{variant}.json
perform:   transcript JSON → Slack, one message every 1.2–2.0 s, with session metadata
```

- `generate` runs **before the demo** (and is re-runnable). ~14 LLM calls per variant, ~25 s.
- `perform` is what the judge watches. It is deterministic, fast, and cannot fail on an API hiccup.
- **Mining always runs live against Slack.** The chatter is pre-written; the intelligence is not.

Transcript format:

```jsonc
{ "scenario_id":"helios_p1", "variant":"v2_skip_review", "project_id":"proj_helios",
  "expected_deviations":["escalate_to_ceo","skip_security_review","hold_customer_call"],
  "messages":[ {"person_id":"per_priya","text":"vertex checkout throwing 500s since 09:14…","delay":1.4}, … ] }
```

`expected_deviations` is **ground truth for our own evaluation** — after mining we can assert the
observer actually found them. Print it in the terminal during rehearsal; it is also the honest
answer to "how do you know the mining is right?"

---

## 6. Session lifecycle (the case boundary — decision D2)

A session is created **explicitly by the simulator** and stamped into every message's metadata.
For human traffic, the observer falls back, in order: `metadata.session_id` → `thread_ts` →
open session on the channel → **idle gap ≥ 90 s opens a new one**.

```
POST /api/sim/run {scenario_id, variant}
   → creates session (status=open, source=simulation)
   → SSE: session_started
   → performs the transcript
   → after the last beat, waits 20 s of silence → status=closed
   → SSE: session_closed → triggers playbook post + conformance roll-up
```

---

## 7. Pause & resume (decision D7)

The simulator checks a flag **between beats**, so a pause is always clean:

```python
class Runner:
    paused: asyncio.Event
    async def next_beat(self):
        await self.paused.wait()      # blocks while paused
```

Pause can be raised by:

| Source | Trigger |
|---|---|
| **The observer** | it recognises the opening of a known process and posts a suggested playbook (spec 04 §7.1) |
| **The UI** | pause button in the header |
| **Slack** | a ✋ reaction on any Ariadne message |

Resume: UI button, or ✅ reaction on Ariadne's suggestion. The pause is the moment the demo stops
being a dashboard and becomes an agent — the simulated team literally waits for a human decision.

---

## 8. Definition of done

- [ ] `python -m app.sim generate --all` writes 5 transcripts to `fixtures/transcripts/`
- [ ] `POST /api/sim/run` makes six distinct named personas talk in the real `#ops-war-room`
- [ ] Every simulated message carries a resolvable `session_id`
- [ ] A message typed by a human into the channel is picked up, attributed, and mined identically
- [ ] Pause from the UI stops the next beat within 2 s; ✅ in Slack resumes it
