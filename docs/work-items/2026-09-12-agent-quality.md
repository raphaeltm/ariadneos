# Agent-driven application quality

Status: in-review
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
- Added locked Ultracite/Biome, strict TypeScript checks, Ruff, local hooks, editor settings, coverage gates, negative probes, isolated API/browser checks, Dependabot, Gitleaks, and CodeQL.
- Refactored UI panels to meet the default complexity limit; added explicit button types, stable path keys, font fallbacks, native dialog semantics, and checked array lookups.
- Documented narrowly scoped lint exceptions and the agent repair/verify/handoff loop in docs/code-quality.md and AGENTS.md.

## Validation
- `npm run check` passed with 22 unit/API-boundary tests. Core coverage: 94.79% lines, 95.09% statements, 100% functions, 82.08% branches.
- `npm run test:integration` passed against an isolated local Worker/D1 database.
- Browser rendered the app and graph with no page errors. Chromium initially required missing system libraries, which were installed. Both Playwright regressions pass: modal keyboard/Escape/focus restoration and persisted simulation refresh/evidence/workflow switching.
- `npm run test:guardrails` proved unsafe lint and indexed-access fixtures fail.
- Ruff checks and formatting pass. Dependency install reported zero advisories.

## Risks and rollback
- Formatting will touch existing app files. Review behavior fixes separately from mechanical changes.
- No deployment is requested or performed. Revert tooling/fixes to restore the previous development setup.

## Next steps
- Workflow agent: finish browser/full-suite verification and publish the expanded PR.
- Maintainer: merge demo PR 3 first, retarget PR 2 to main, review tooling and application fixes, then enable documented required checks.
