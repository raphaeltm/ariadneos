# AriadneOS

**AriadneOS is a process-observability and process-mining layer for organizations.** It watches how work actually happens across an organization’s software stack, reconstructs the workflows hidden inside that activity, and turns them into usable context for both humans and AI agents.

Most organizations have a large gap between their documented processes and their real ones. The actual business logic lives implicitly across Notion pages, Slack conversations, files, tickets, status changes, human hand-offs, and repeated sequences of actions. That makes it difficult to answer basic questions like *“How does this process actually work?”* — and even harder for an agent to operate safely inside the organization.

AriadneOS observes **actors, actions, artifacts, and interactions**, then applies process-mining techniques to infer a living model of the organization's workflows. The result is effectively a map of the paths through the business: what normally happens, what happens next, where people branch from the normal path, and how different systems and people interact.

The longer-term idea is **process mining as context engineering for agents**. Rather than giving an agent a giant static prompt describing the company, AriadneOS can provide the relevant slice of organizational context for the task at hand — and eventually allow an agent to execute or reproduce workflows that it has observed.

## Working preview

**[Homepage](https://ariadneos.com) · [Open the live demo](https://ariadneos.com/app)**

A basic implementation is now included: interactive process maps, variants, event evidence, persistent simulations, JSON agent context, and Workers AI explanations. The homepage at `/` markets the Slack-focused product; the interactive application lives at `/app`. The demo uses a synthetic organization; live Slack ingestion is not connected yet.

See [complete Slack and GitHub setup](docs/slack-setup.md), [demo setup and verification](docs/demo.md), and [automatic staging/production deployment](docs/deployment.md).

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

Use Slack as the only integration environment for the hackathon and create a small simulated organization with employees or agents working through a few realistic workflows. There should be enough repeated activity to make process discovery meaningful.

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

This is likely one of the genuinely difficult pieces once AriadneOS moves beyond a controlled demo.

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

### 6. Simulation harness

Create a synthetic mini-organization and have humans or agents perform known workflows. Because the canonical workflow is known, AriadneOS can be evaluated against a simple question:

> Did it rediscover the process correctly?

That creates a clean evaluation mechanism for the hackathon.

### 7. Agent-facing context

Expose the discovered process model to an AI agent and allow it to answer questions such as:

- What normally happens after a customer requests a refund?
- Who typically approves this?
- What is the expected next step?
- Which path is unusual compared with previous cases?

A more ambitious demo would ask the agent to **reproduce an observed workflow** inside the simulation.

## Closed loop

The broader AriadneOS model is:

```text
observe → infer → explain → execute → observe again
```

That is what makes AriadneOS potentially more useful than a traditional process-mining dashboard: it can become a runtime representation of **how an organization operates**, continuously reconstructed from behaviour and usable as machine-readable context by agents.

## One-day demo target

A realistic hackathon demo would be:

1. Simulate one organization with 2–3 workflows.
2. Collect normalized activity events.
3. Reconstruct the workflows from those events.
4. Visualize the inferred process graph.
5. Give an agent access to the discovered model.
6. Have the agent explain or reproduce one workflow.

## Development workflow

Read [CONTRIBUTING.md](CONTRIBUTING.md) for PR checks, review gates, and deployment evidence. Humans and agents keep decisions, validation, and handoffs in [work items](docs/work-items/README.md); agents start with [AGENTS.md](AGENTS.md).
See the [proposed Cloudflare stack](docs/cloudflare-stack.md) for researched technology choices, connector constraints, and a one-day implementation plan.

## Research

See the [research index](research/README.md) for integration explorations,
including [Exa and CopilotKit](research/exa-copilotkit/README.md).
