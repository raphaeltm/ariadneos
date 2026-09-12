# Proposed demo: prepare a vendor review from Slack process context

Status: proposed, not implemented. Reviewed 2026-09-12.

## User experience

1. Open a synthetic vendor request represented as Slack workflow activity.
2. Ask what typically happens next. Highlight the observed review step and show
   the cases/events supporting it.
3. Request a review packet. Retrieve public vendor documentation through Exa.
4. Render a packet with linked sources, retrieval dates, missing information,
   suggested review questions, and an editable Slack handoff draft.
5. Let the user rehearse the next handoff in the sandbox and inspect its events.

This demo can use synthetic Slack-shaped observations while live ingestion is
being built. Label them clearly. A real Slack send is a separate implementation
step requiring an authorized connector action, permissions, and explicit user
intent; it is not needed to demonstrate the research packet.

## Proposed component responsibilities

| Component | Responsibility |
| --- | --- |
| AriadneOS miner/context API | Supply the observed workflow, statistics, case evidence, and limitations |
| Agent backend/runtime | Select tools and compose a response grounded in returned evidence |
| Server-side Exa tool | Search scoped public sources and return excerpts with provenance |
| CopilotKit in the React app | Share selected workflow context, invoke UI tools, and render review cards |
| Existing graph and evidence panels | Display the concrete events behind the explanation |

Reuse /api/context rather than creating a second process model. Candidate tools
are selectNode, showEvidence, compareVariants, researchVendor, and draftHandoff.
These names describe proposals, not existing API functions. Validate node/case
IDs and workspace authorization server-side for data reads; frontend tools only
control the permitted view. The runtime/Cloudflare compatibility spike remains
an explicit prerequisite.

## Packet and evidence boundaries

A packet should contain the selected case and proposed step, internal evidence
IDs, external source URLs and retrieval times, supported findings, unknowns,
and draft handoff text. Label those categories separately in the UI.

Do not turn a missing search result into an assertion that a vendor lacks a
control. Do not let external page content direct tool execution. Keep queries
limited to public vendor names/domains and research questions; do not send raw
Slack text or internal case records to web search.

## Build sequence

1. Validate runtime compatibility and graph/context access with one tool.
2. Add graph selection and evidence navigation through CopilotKit.
3. Add server-side Exa search/content retrieval with bounded requests.
4. Add sourced packet and editable draft components.
5. Extend the sandbox only as needed to rehearse the handoff and preserve a
   separate synthetic event trail.

## Acceptance criteria for a future implementation

- Selecting a different case updates assistant context without cross-workspace
  leakage. Invalid and inaccessible evidence IDs are rejected.
- A process explanation links to actual evidence IDs and uses computed values.
- Each externally supported finding links to the returned source; unsupported
  claims appear as unknowns or questions.
- Search failure or no useful results leaves process inspection usable and
  clearly marks the packet incomplete.
- The handoff is editable and no message is sent implicitly.
- Synthetic events remain identifiable; running the rehearsal does not silently
  contaminate production process measurements.
- The selected deployment passes existing repository gates plus focused tests
  for tool authorization, retrieval failure, and the complete browser flow.

## Open decisions

Which vendor/source set makes the clearest demonstration? Which runtime fits
Workers and the inference provider? What Slack observations are available on
current main? What packet retention and source-refresh policy is needed?

No credentials, vendor purchase, runtime migration, or live Slack action is
required to review this proposal.
