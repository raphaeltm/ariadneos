# AriadneOS

**AriadneOS is a process-observability and process-mining layer for organizations.** It watches how work actually happens across an organization’s software stack, reconstructs the workflows hidden inside that activity, and turns them into usable context for both humans and AI agents.

Most organizations have a large gap between their documented processes and their real ones. The actual business logic lives implicitly across Notion pages, Slack conversations, files, tickets, status changes, human hand-offs, and repeated sequences of actions. That makes it difficult to answer basic questions like *“How does this process actually work?”* — and even harder for an agent to operate safely inside the organization.

AriadneOS observes **actors, actions, artifacts, and interactions**, then applies process-mining techniques to infer a living model of the organization's workflows. The result is effectively a map of the paths through the business: what normally happens, what happens next, where people branch from the normal path, and how different systems and people interact.

The longer-term idea is **process mining as context engineering for agents**. Rather than giving an agent a giant static prompt describing the company, AriadneOS can provide the relevant slice of organizational context for the task at hand — and eventually allow an agent to execute or reproduce workflows that it has observed.

## Running application

**[Homepage](https://ariadneos.com) · [Open the app](https://ariadneos.com/app)**

The app observes real Slack channels. It has no demo mode and no simulated data:
every activity, transition and piece of evidence in a graph comes from a message
someone actually posted in a channel the workspace connected.

The loop is: install the Slack app into your workspace, enable one channel and
bind it to a project, name the steps that process is meant to follow, and Ariadne
maps what the team actually did against them — with each step linked to its source
message. The homepage at `/` markets the product; the application lives at `/app`.

See [operating the app](docs/operations.md) for the setup walkthrough and the
configuration it requires, [Slack and GitHub setup](docs/slack-setup.md), and
[automatic staging/production deployment](docs/deployment.md).

```sh
npm ci
npm run db:local
npm run dev
```

## Agent runtime smoke

The agent foundation runs inside the existing Hono Cloudflare Worker. Issue #38 validated the
embedded Mastra Agent path with OpenRouter; the committed runtime reports that path as
`mastra-embedded` and falls back explicitly to a spec-11 `typed-fetch` OpenRouter call if Mastra
throws at runtime. There is no public Mastra server, separate database, or non-Cloudflare host.

`POST /api/agent/smoke` uses a fixed prompt and the configured answer model to prove one live
OpenRouter call in staging. It is gated by `AGENT_ENABLED`, `OPENROUTER_API_KEY`, a D1-backed daily
budget, and a timeout. `GET /api/agent/status` reports the active executor, fallback, models,
budgets, attribution, and whether a key is present, but never returns the secret value.

Model routing is intentionally compatible with the older names from spec 05:

- `MODEL_ANSWER` controls agent answers and falls back to `MODEL_RAG` when only the previous RAG
  variable is configured.
- `MODEL_CLASSIFY` controls lightweight classification and falls back to `MODEL_SIM`.
- `MODEL_EXTRACT` controls extraction and falls back to `MODEL_SIM`.

`OPENROUTER_APP_TITLE` and `OPENROUTER_SITE_URL` provide OpenRouter attribution. Deployed
`OPENROUTER_API_KEY` values must be configured as secrets; they do not belong in assets, Wrangler
vars, logs, or work-item records.

## Conceptual flow

```text
Organization activity
Slack conversations → requests, decisions, and handoffs
                ↓
Observation layer
actor + action + artifact + timestamp + context
                ↓
Process mining
Discover recurring sequences, branching paths, hand-offs,
dependencies, exceptions
                ↓
Living process model
A graph of how work actually moves through the organization
                ↓
Applications
Process observability → workflow discovery → agent context
→ simulation → autonomous execution
```

A useful mental model is **OpenTelemetry for organizational processes**, with process mining sitting on top.

## Hackathon scope

The hackathon is focused entirely on Slack integration. The goal is to prove that AriadneOS can **observe messy human activity and recover something recognizably like a business process from it**.

### 1. Observable environment

Slack is the only integration environment. The app reads the channels a workspace
explicitly connects, so process discovery needs a channel where the work actually
gets discussed and enough repeated activity to be meaningful.

### 2. Normalized event model

Convert application-specific activity into a common event representation:

```text
Actor → Action → Artifact → Context → Time
```

For example:

```text
Alice → changes status → "Vendor Review" → Project X → 10:31
Bob   → comments        → "Vendor Review" → Project X → 10:46
```

This becomes the substrate for everything else.

### 3. Correlation / case detection

Process mining needs to understand which events belong to the same process instance. A single project, customer request, hiring candidate, incident, or similar unit becomes a **case**.

This is one of the genuinely difficult pieces, and it is unavoidable now that the
app reads real channels rather than a controlled scenario.

### 4. Process-mining engine

From those traces, infer things such as:

- the dominant workflow
- common variants
- hand-offs between actors
- repeated loops
- unusual paths
- transition frequencies or probabilities

### 5. Process graph / observability UI

Visualize the discovered workflow as a graph derived from actual observations rather than manually authored BPMN.

Clicking a node or path should ideally reveal the underlying events that caused AriadneOS to infer it.

### 6. Evaluating the discovery

Because the workspace authors the process it *intends* to follow, the app always
has a reference to score against:

> Does the observed process match the designed one, and where does it diverge?

That comparison is the conformance overlay: green where observed work matches the
designed workflow, gold for undocumented work nobody designed, grey for designed
steps nobody performed.

### 7. Agent-facing context

Expose the discovered process model to an AI agent and allow it to answer questions such as:

- What normally happens after this kind of request arrives?
- Who typically approves this?
- What is the expected next step?
- Which path is unusual compared with previous cases?

Answers are grounded in the workspace's own observed graph and cite the sessions
they came from; when the model is unavailable the app returns a labelled
statistical summary rather than a guess.

## Closed loop

The broader AriadneOS model is:

```text
observe → infer → explain → execute → observe again
```

That is what makes AriadneOS potentially more useful than a traditional process-mining dashboard: it can become a runtime representation of **how an organization operates**, continuously reconstructed from behaviour and usable as machine-readable context by agents.

## End-to-end path

1. Install the Slack app into a workspace and connect one channel to a project.
2. Name the steps that process is meant to follow.
3. Signed Slack events arrive; messages are segmented into cases and queued.
4. Extraction turns each case's messages into steps with message citations.
5. The graph overlays the observed process on the designed one.
6. The agent answers questions from that graph, citing its evidence.

## Development workflow

Read [CONTRIBUTING.md](CONTRIBUTING.md) for PR checks, review gates, and deployment evidence. Humans and agents keep decisions, validation, and handoffs in [work items](docs/work-items/README.md); agents start with [AGENTS.md](AGENTS.md).
See the [proposed Cloudflare stack](docs/cloudflare-stack.md) for researched technology choices, connector constraints, and a one-day implementation plan.

## Research

See the [research index](research/README.md) for integration explorations,
including [Exa and CopilotKit](research/exa-copilotkit/README.md).
