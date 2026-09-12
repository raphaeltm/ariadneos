# Exa and CopilotKit integration exploration

Status: documentation prepared for PR; implementation not selected
Branch: sam/integrate-exaai-copilotkitai-somehow-ht5kc8

## Request and findings

Explore integration ideas for AriadneOS. Reviewed README, demo documentation,
frontend graph selection, and server context/ask/simulation routes. The existing
synthetic demo supports process evidence and explanations; real connectors and
workflow execution remain future work.

CopilotKit can connect agent interactions to React state, graph navigation,
rendered evidence cards, and human review. Exa can retrieve external material
relevant to an observed workflow step. These are proposals, not approved
architecture decisions.

## Suggested directions

1. Graph-aware process investigator: highlight handoffs, compare variants, and
   open supporting events from conversational requests (CopilotKit first).
2. Vendor onboarding assistant: use observed process context to identify the
   next review, retrieve vendor documentation with Exa, and render a sourced
   review packet through CopilotKit. Recommended combined demo.
3. Process improvement workbench: retrieve published approaches, propose a
   change, and compare explicit simulation scenarios. Requires extending the
   simulator; simulated improvement is not a real-world causal estimate.
4. External change impact: periodically retrieve relevant vendor/API material,
   detect changes, and map them to affected process steps. Requires dependency
   mapping and monitoring logic.
5. Workflow rehearsal: walk a user or agent through a discovered workflow in
   the sandbox, presenting research and review at the relevant steps.

## Validation and limits

Checked official documentation on 2026-09-12:
- https://exa.ai/docs/reference/search
- https://exa.ai/docs/reference/get-contents
- https://docs.copilotkit.ai/
- https://docs.copilotkit.ai/frontend-tools
- https://docs.copilotkit.ai/reference/hooks/useComponent

No runtime integration or compatibility test was performed; no application
code changed. Exa calls should run server-side with deliberately scoped public
queries. Keep observed events, external sources, and proposed actions distinct.
Observed behavior does not establish execution permission. CopilotKit needs an
agent runtime/adapter; the current JSON ask endpoint is not an AG-UI stream.

## Next step

Select a concept. For the vendor demo, reuse the process context endpoint,
expose graph navigation tools, add server-side Exa retrieval, and show a sourced
review packet plus a proposed next handoff. Start with synthetic cases and
public vendor documentation.

## Research folder follow-up

User requested Markdown research, Claude/Codex housekeeping guidance, and a PR
merged when green. Created research/README.md, shared research/AGENTS.md guidance,
a research/CLAUDE.md entry point, and four topic documents covering overview,
capability evidence, ideas, and the demo proposal. Linked the index from the
repository README. The reusable research now lives in research/exa-copilotkit;
this file preserves task history.

Updated the proposal to reflect the latest SAM project scope: the hackathon
focuses entirely on Slack. The vendor demo is a synthetic Slack request and
review handoff; live ingestion and message execution are not claimed as built.

Validation: relative Markdown file links in the new research and the work log
were checked for existing targets; git diff --check passed. After installing locked dependencies with npm ci, npm test passed all four
tests and npm run build passed type checking and the production build. GitHub
PR gates must pass before merging. No runtime/configuration changes.
Next step: merge this documentation PR once all applicable checks pass; runtime
integration remains a separate product decision.
