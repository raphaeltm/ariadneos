# Product ideas

Status: brainstorm, not committed roadmap. Reviewed 2026-09-12.
Capability evidence is in [capabilities.md](capabilities.md).

## 1. Talk to the process map

Prompt: “Show me where vendor onboarding slows down.”

Use CopilotKit to highlight a transition, filter relevant cases, compare
variants, and open the events behind the explanation. AriadneOS supplies the
computed statistics and evidence. Exa is optional when the user asks for
external approaches to a problem.

Why it fits: makes existing process context useful inside the UI. This is the
smallest first integration. Duration differences can locate a slow handoff;
they do not establish its cause.

## 2. Prepare the next Slack handoff

Prompt: “Help me move this vendor request through security review.”

AriadneOS identifies the observed next review step and supporting cases. Exa
retrieves public vendor security and integration documentation. CopilotKit
renders a packet with sources, unanswered questions, and an editable Slack
handoff draft. The draft remains reviewable before any future sending action.

Why it fits: research serves a specific step in a discovered process. Recommended
combined demo; see [the proposal](demo-proposal.md). Public claims are not proof
of certification or a completed security review.

## 3. Process improvement workbench

Prompt: “What could reduce this repeated approval loop?”

Use Exa to retrieve published approaches and CopilotKit to compare proposed
changes visually. Extend the simulator to express scenario assumptions before
showing a before/after process model.

Why it fits: connects discovery to experimentation. Larger scope: the current
simulator does not support arbitrary intervention scenarios. A simulated gain
must be labeled as conditional on assumptions, not a causal production result.

## 4. External change impact

Prompt: “This vendor is retiring an API. Which workflows might be affected?”

Retrieve relevant public vendor announcements, compare them with prior source
snapshots, and map changes to explicit workflow dependencies. Let the user
inspect affected steps and draft a Slack follow-up through CopilotKit.

Why it fits: gives the process map continuing operational value. Requires a
dependency model, scheduled retrieval, change detection, and freshness handling;
web search alone does not provide these application behaviors.

## 5. Guided workflow rehearsal

Prompt: “Walk me through handling my first refund request in Slack.”

Use the observed path to guide a sandbox walkthrough. CopilotKit highlights
steps and presents choices; Exa supplies external documentation only where it
helps. Record rehearsal events separately from real operational observations.

Why it fits: demonstrates process context as practical guidance for new staff
and agents. A commonly observed path can contain mistakes; preserve exceptions
and apply explicit policy before allowing execution.

## Suggested order

1. Graph navigation and evidence tools.
2. Sourced vendor packet for a synthetic Slack request.
3. Sandbox rehearsal with recorded outcomes.
4. Scenario comparison and change-impact monitoring after their data models exist.

Longer term, record assistant-assisted workflow events to investigate whether
packets reduce repeated questions or review loops. Compare outcomes with
appropriate controls; observation alone cannot attribute changes to assistance.
