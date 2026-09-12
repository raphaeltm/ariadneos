# Capabilities, evidence, and boundaries

Status: researched capabilities and repository observations, not an integration
validation. Sources checked 2026-09-12.

## Verified vendor capabilities

| Component | Documented capability | Possible AriadneOS use | Source |
| --- | --- | --- | --- |
| Exa Search | Web search with domain/date filtering and content options | Retrieve relevant public vendor documentation | [Search API](https://exa.ai/docs/reference/search) |
| Exa Contents | Retrieve content for supplied URLs | Read selected sources for a review packet | [Contents API](https://exa.ai/docs/reference/get-contents) |
| CopilotKit | Agent UI with shared state and human-in-the-loop interactions | Keep assistant context aligned with the selected workflow | [Introduction](https://docs.copilotkit.ai/) |
| CopilotKit frontend tools | Agent-invoked browser functions, including React state updates | Select nodes, filter cases, open event evidence | [Frontend tools](https://docs.copilotkit.ai/frontend-tools) |
| CopilotKit component rendering | Register React components as tool renderers | Show evidence, research, and editable handoff cards | [useComponent](https://docs.copilotkit.ai/reference/hooks/useComponent) |

These capabilities support the proposals; they do not establish integration
compatibility, retrieval accuracy, latency, or cost for AriadneOS.

## Repository foundation

Inspected revision `70ff0186535072dc3ebe2e02369854509d3c7b30` on
2026-09-12; the implementation described here is
also documented in [docs/demo.md](../../docs/demo.md). Check current main before
implementation because other feature work may land independently.

- [src/App.tsx](../../src/App.tsx) and
  [src/ProcessGraph.tsx](../../src/ProcessGraph.tsx) provide graph selection,
  variants, evidence inspection, and an existing question interface.
- [server/index.ts](../../server/index.ts) exposes /api/model, /api/context,
  /api/ask, and /api/simulate. The context endpoint returns JSON; the ask endpoint
  provides read-only explanations rather than an AG-UI event stream.
- [shared/process.ts](../../shared/process.ts) computes the process model.
  Keep event counts, probabilities, and durations computed in code.
- [shared/simulation.ts](../../shared/simulation.ts) supplies synthetic traces.
  Its existing simulation is not a general counterfactual process optimizer.
- The inspected stack uses React/Vite, Hono on Cloudflare Workers, D1, and
  Workers AI. Neither Exa nor CopilotKit is integrated in this revision.

The Slack-only direction is current project scope, not evidence that live Slack
observation or Slack execution is already implemented in this branch.

## Integration questions to validate

- Which CopilotKit runtime/AG-UI adapter works with the selected backend and
  Cloudflare deployment? Do not assume the current JSON API is sufficient.
- Can the existing inference provider support the chosen tool-calling and
  streaming path? Validate this in a small spike before changing providers.
- How are workspace access and case permissions enforced for every backend
  tool? Graph visibility must not become blanket execution permission.
- What retrieval limits, caching, source freshness, and inference budgets are
  appropriate? No pricing or performance benchmark was performed here.
- How much of the Slack workflow can actually be observed? Preserve unknown
  and missing events; do not silently fill gaps with inferred activity.

External page text is evidence to evaluate, not instructions for the agent.
Keep Exa keys server-side and construct public queries without forwarding raw
Slack conversations. Store source URLs and retrieval timestamps with results.
