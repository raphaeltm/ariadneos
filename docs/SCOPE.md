# ARIADNE — Slack process-mining scope

Adapted 2026-09-12 by explicit user direction: keep the deployed TypeScript/Cloudflare architecture
and prioritize quick, inexpensive delivery. Read [the implementation contract](specs/00-cloudflare-architecture.md)
and [the assignment plan](implementation-plan.md) before taking an issue.

## Product

Ariadne observes work in Slack, extracts atomic steps with message citations, and compares the
process people actually follow with the designed workflow. Org, Process and Execution planes
connect authored policies to observed behavior. LLMs extract structured events; deterministic
code computes the graph, support, rework and conformance. Every observed activity has real evidence.

## P0 — complete this path first

1. Knowledge base: six personas, Helios and Atlas, artifacts/policies and designed workflows.
2. Real Slack observation, including human messages, through the existing signed webhook integration.
3. Cached Helios transcripts performed through one bot with distinct names/avatars: textbook,
   skipped review and rework. Observe actual Slack delivery; no direct transcript-to-miner shortcut.
4. Live extraction/canonicalization with provenance validation and deterministic instance/global graphs.
5. Designed/discovered overlay: green conformant nodes, gold undocumented work, grey missing work;
   support counts, rework arcs, evidence inspector, instance toggle and frequency slider.
6. Three-pane app at `/app`, initial snapshots plus replayable SSE, run/pause/resume controls.
7. Authenticated and workspace-authorized access, existing automated checks, and verified staging deploy.

## P1 — only after Helios P0 is green

- Process recognition, playbook suggestion and close summary posted to Slack.
- Drift alerts that name policies and link to supporting Slack messages.
- Graph-RAG in `/api/ask` and threaded `@Ariadne` answers with verified permalinks.
- Slack reaction curation and pause/resume, with live UI confirmation/rejection controls.
- Live Atlas feature-intake scenario (two variants); complete the five-session rehearsal.

Human-typed message ingestion is P0; the live audience demonstration is part of rehearsal.
Atlas authored content/fixtures land early to expose accidental project mixing.

## P2 / deferred

CopilotKit, Exa enrichment, Vectorize/embeddings, replay timeline UI, additional connectors,
graph editing, BPMN export and multi-workspace onboarding are outside this implementation wave.
Keep existing Better Auth Slack login; do not add Auth0 or a new authentication system.

## Runtime and delivery

One existing Hono Worker serves APIs and Vite assets. D1 holds domain data. One channel Durable
Object coordinates timed jobs and SSE. Signed Slack events are the primary input; Web API history
is bounded reconciliation. OpenRouter calls use a small typed adapter. No Python backend,
Docker hosting, tunnel, second frontend, or always-on poller. Existing Workers AI demo is preserved.

Fixtures and typed contracts unblock separate backend and UI agents. Each issue is one scoped PR
with explicit dependencies and ownership. Agents create PRs, watch checks and staging deploy,
verify acceptance against the deployed revision, repair failures and merge only when green.
GitHub Actions then deploys main to production. Keep staging resources separate.

Follow the repository's quality gates, including Ultracite/Biome when PR #2 lands; the original
smoke-only restriction is superseded. Keep a shared work-item log for every change.

## Demo gate

- Grey designed DAG exists before the first run; three Helios runs produce support differences,
  at least two undocumented activities in the skip-review run and a visible rework arc.
- Click an observed node to open its actual Slack quotes/permalinks. Human messages use the same path.
- Pause survives reload; replay after disconnect neither loses nor duplicates graph changes.
- Report measured active-flow and sparse-message latency separately; no hard four-second guarantee.
- Models/secrets missing means a visible unavailable state, not fabricated live observations.
- P1 rehearsal shows a cited drift warning, reaction removal and cited Q&A; then runs Atlas twice.
- Record a two-minute video and submission text after the working staging rehearsal. Publishing,
  workspace administration and competition submission remain human tasks.

The original wall-clock hackathon schedule is historical; use dependency gates, not expired times.
