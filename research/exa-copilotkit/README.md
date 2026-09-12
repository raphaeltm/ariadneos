# Exa and CopilotKit for AriadneOS

Status: proposal, not an approved integration architecture.
Last reviewed: 2026-09-12.

AriadneOS reconstructs how work happens and makes that process context usable
by humans and agents. Exa could provide external research at relevant workflow
steps. CopilotKit could let an agent navigate the process UI and present useful
interactive results.

## Read in order

1. [Capabilities and sources](capabilities.md): verified vendor capabilities,
   current repository foundation, and compatibility questions.
2. [Product ideas](ideas.md): five possible experiences and their tradeoffs.
3. [Recommended demo](demo-proposal.md): a bounded Slack-centered workflow,
   integration sketch, acceptance criteria, and open questions.

## Recommendation

Start with a graph-aware process assistant, then add a vendor research packet
for a synthetic Slack onboarding request. This combines an immediate UI benefit
with a concrete reason to retrieve external information.

The current project instructions focus the hackathon entirely on Slack. Earlier
brainstorming used vendor onboarding as a generic workflow; here it is framed as
a request and review handoff in Slack. Notion/CRM connectors and autonomous
cross-system execution are outside this proposed first demo.

Related context: [project overview](../../README.md),
[existing demo](../../docs/demo.md), and
[work log](../../docs/work-items/2026-09-12-exa-copilotkit-ideas.md).
