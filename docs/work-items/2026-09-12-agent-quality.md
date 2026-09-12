# Agent-driven application quality

Status: in-progress
Owner: Workflow agent for raphaeltm
Source: User requested Ultracite, Biome, and comprehensive guardrails for agent-written code in PR 2.
Branch: sam/use-sam-mcp-tools-z2229j

## Intent
Enforce consistent formatting, linting, type safety, tests, and secure contribution practices against the actual React/Cloudflare demo.

## Acceptance criteria
- Ultracite/Biome passes on the app with fixes rather than blanket suppression.
- Local hooks and CI run reproducible checks with pinned dependencies.
- Tests, type checks, and production build pass; dependency and security checks are configured.
- Agent instructions explain the repair/verify/handoff loop and prohibit weakening gates to pass.

## Decisions and rationale
- Stack PR 2 on demo PR 3 so app checks are exercised against real code without duplicating application development. Merge PR 3 first and retarget PR 2 to main.
- Use Ultracite's Biome core/React presets as the primary JS/TS/CSS/JSON formatter and linter; keep TypeScript and behavior tests as independent checks.

## Changes
- Implementation in progress; this record establishes scope before edits.

## Validation
- Not run yet; baseline and final results will be recorded during implementation.

## Risks and rollback
- Formatting will touch existing app files. Review behavior fixes separately from mechanical changes.
- No deployment is requested or performed. Revert tooling/fixes to restore the previous development setup.

## Next steps
- Workflow agent: integrate the demo branch, configure tools, resolve diagnostics, validate, and update PR 2.
