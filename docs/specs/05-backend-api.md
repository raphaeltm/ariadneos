# Spec 05 — Backend, Storage & API

> One FastAPI process. One SQLite file. SSE for live. No ORM, no migrations, no message broker.

**Owner:** Track A · **Time budget:** 40 min · **Module:** `backend/app/`

---

## 1. Storage — `ariadne.db`

```sql
-- ORG PLANE (authored, spec 02)
CREATE TABLE person   (id TEXT PRIMARY KEY, name TEXT, role TEXT, seniority TEXT, emoji TEXT,
                       color TEXT, goals TEXT, biases TEXT, comms_style TEXT, projects TEXT);
CREATE TABLE project  (id TEXT PRIMARY KEY, name TEXT, summary TEXT, spec_md TEXT,
                       constraints TEXT, workflow_id TEXT);
CREATE TABLE artifact (id TEXT PRIMARY KEY, type TEXT, name TEXT, uri TEXT, project_id TEXT);
CREATE TABLE policy   (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, activity_slug TEXT,
                       text TEXT, params TEXT);

-- PROCESS PLANE
CREATE TABLE workflow (id TEXT PRIMARY KEY, name TEXT, project_id TEXT, plane TEXT,
                       entry_activity TEXT, exit_activities TEXT, activity_slugs TEXT, matrix TEXT);
CREATE TABLE activity (id TEXT PRIMARY KEY, slug TEXT UNIQUE, label TEXT, description TEXT,
                       project_id TEXT, plane TEXT, role_expected TEXT, first_seen_ts TEXT);
CREATE TABLE follows  (from_activity TEXT, to_activity TEXT, plane TEXT, kind TEXT,
                       weight REAL, cases TEXT, is_back_edge INT,
                       PRIMARY KEY (from_activity, to_activity, plane));

-- EXECUTION PLANE
CREATE TABLE session  (id TEXT PRIMARY KEY, channel TEXT, project_id TEXT, workflow_id TEXT,
                       started_ts TEXT, ended_ts TEXT, status TEXT, source TEXT,
                       scenario_id TEXT, variant TEXT, suggested INT DEFAULT 0, conformance TEXT);
CREATE TABLE message  (ts TEXT PRIMARY KEY, channel TEXT, session_id TEXT, author_person_id TEXT,
                       author_label TEXT, text TEXT, permalink TEXT, thread_ts TEXT,
                       is_agent INT DEFAULT 0, reactions TEXT);
CREATE TABLE step     (id TEXT PRIMARY KEY, session_id TEXT, seq INT, activity_id TEXT,
                       actor_person_id TEXT, artifact_id TEXT, intent TEXT, type TEXT,
                       handoff_to_person_id TEXT, ts_start TEXT, ts_end TEXT, confidence REAL,
                       evidence TEXT, status TEXT DEFAULT 'proposed', negated INT DEFAULT 0);

-- JOURNAL (SSE replay + time travel)
CREATE TABLE event    (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, kind TEXT, payload TEXT);

CREATE INDEX idx_step_session ON step(session_id, seq);
CREATE INDEX idx_msg_session  ON message(session_id, ts);
```

**`step` is the single source of truth.** Every aggregate (`activity.support`, `follows.weight`,
conformance) is recomputed from it. Nothing is incrementally mutated, so nothing can drift.

---

## 2. HTTP API

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/health` | `{ok, kb_loaded, slack_connected, sessions, steps}` |
| `GET` | `/api/kb` | Org plane: people, projects, artifacts, policies |
| `GET` | `/api/graph/designed?workflow_id=` | grey documented DAG (available before any run) |
| `GET` | `/api/graph/discovered?project_id=&min_support=1` | mined DAG |
| `GET` | `/api/graph/overlay?workflow_id=&min_support=1` | **the money endpoint** — merged nodes/edges with `plane` on each, plus `conformance` |
| `GET` | `/api/sessions` | list with status, project, fitness, step count |
| `GET` | `/api/sessions/{id}` | session + ordered steps + conformance |
| `GET` | `/api/sessions/{id}/graph` | instance DAG for one case |
| `GET` | `/api/messages?session_id=&limit=` | Slack mirror for the left rail |
| `GET` | `/api/steps/{id}/evidence` | `[{ts, author, text, permalink}]` |
| `POST` | `/api/steps/{id}/status` | `{status: confirmed\|rejected}` → `graph_delta` |
| `POST` | `/api/sim/run` | `{scenario_id, variant}` → starts a session (background task) |
| `POST` | `/api/sim/pause` · `/api/sim/resume` | toggle the beat gate |
| `POST` | `/api/ask` | `{question}` → `{answer, citations[], subgraph}` (graph-RAG) |
| `POST` | `/api/graph/rebuild` | force full recompute (escape hatch) |
| `GET` | `/api/stream` | **SSE** |

### 2.1 `/api/graph/overlay` response

```jsonc
{
  "nodes": [
    {"id":"act_security_review","slug":"security_review","label":"Security review",
     "plane":"designed","role_expected":"eng","roles_observed":[],
     "support":0,"occurrences":0,"policy_ids":["pol_sec_review"],
     "missing_in_sessions":["ses_002","ses_003"]},
    {"id":"act_escalate_to_ceo","slug":"escalate_to_ceo","label":"Escalate to CEO",
     "plane":"discovered","roles_observed":["support","ceo"],"support":4,"occurrences":5}
  ],
  "edges": [
    {"from":"act_root_cause_analysis","to":"act_deploy_fix","plane":"discovered",
     "kind":"sequence","weight":3,"cases":["ses_002","ses_003","ses_005"],
     "is_back_edge":false,"violates":["pol_sec_review"]}
  ],
  "conformance": {"fitness":0.78,"precision":0.70,"sessions":5,
                  "missing":["security_review"],"extra":["escalate_to_ceo","improvise_hotfix"]},
  "happy_path": ["detect_incident","triage_incident", "..."]
}
```

---

## 3. SSE contract — `/api/stream`

Every event is `{kind, ts, payload}`. The frontend store applies them without refetching.

| kind | Payload | UI effect |
|---|---|---|
| `message` | Message row | new line in the Slack rail |
| `session_started` | `{session_id, scenario, variant, project}` | header chip, new case in the list |
| `step` | Step + activity label | step card streams in; node appears dimmed (`proposed`) |
| `graph_delta` | `{nodes_added, nodes_updated, edges_added, edges_updated}` | node settles, edge draws |
| `conformance` | conformance object | the fitness number re-scores, ghosts update |
| `agent_post` | `{kind: playbook\|drift\|answer, text, session_id}` | Ariadne card in the rail + toast |
| `paused` / `resumed` | `{by, reason}` | the whole canvas gets a pause veil |
| `session_closed` | `{session_id, conformance}` | case completes, roll-up animates |

Implementation: one `asyncio.Queue` per connected client, fan-out from a module-level broadcaster.
Every event is also appended to `event` so the UI can replay a session from scratch (time travel, P2).

---

## 4. Configuration — `.env`

```bash
SLACK_BOT_TOKEN=xoxb-…
SLACK_CHANNEL_ID=C09…
SLACK_WORKSPACE=ariadne-demo          # for permalink construction

OPENROUTER_API_KEY=sk-or-…
MODEL_SIM=openai/gpt-4.1-mini         # persona chatter — fast + cheap
MODEL_EXTRACT=openai/gpt-4.1          # event-log extraction — needs to be good
MODEL_RAG=openai/gpt-4.1              # graph-RAG answers

POLL_INTERVAL_S=2.0
WINDOW_SIZE=8
WINDOW_TRIGGER_MSGS=4
WINDOW_IDLE_S=6
SESSION_IDLE_GAP_S=90
POST_INTERVAL_S=1.2
DEMO_MODE=perform                     # perform | generate
```

All model calls go through one OpenAI-compatible client pointed at
`https://openrouter.ai/api/v1` with headers `HTTP-Referer` + `X-Title: Ariadne`.

---

## 5. Process layout

```python
# main.py
@asynccontextmanager
async def lifespan(app):
    init_db(); load_kb()
    app.state.poller = asyncio.create_task(poll_loop())    # steps 1–9 of spec 04 §1
    yield
    app.state.poller.cancel()
```

One background task, one broadcaster, one SQLite connection per request (`check_same_thread=False`,
WAL mode). The simulator runs as a `BackgroundTask` per `/api/sim/run`.

---

## 6. Docker

```yaml
services:
  api:
    build: ./backend
    env_file: .env
    ports: ["8000:8000"]
    volumes: ["./data:/data", "./kb:/app/kb", "./fixtures:/app/fixtures"]
  web:
    build: ./frontend
    ports: ["5173:80"]
    environment: [VITE_API_BASE=http://localhost:8000]
```

`docker compose up` must produce a working demo on a judge's laptop with only `.env` filled in.

---

## 7. Definition of done

- [ ] `GET /api/health` green with `kb_loaded: true` within 3 s of boot
- [ ] `GET /api/graph/overlay` renders a grey designed DAG before any simulation
- [ ] SSE survives a page reload and a 5-minute idle
- [ ] `POST /api/graph/rebuild` completes in <100 ms with 5 sessions loaded
- [ ] `docker compose up` works from a clean clone
