# Visual How it works page

Status: in-review
Owner: Codex for SAM task 01M2B1X4QYZTFB2KQB69EVQQKT, requested by repository owner
Source: User requested a beautiful, approachable explanation with diagrams, linked from the homepage. Parent session 12304ca6-01db-4aa6-ba82-f70f7d486fc0 coordinated the spec wave and requested a separate final UI integration task.
Branch: sam/use-sam-mcp-tools-evqqkt

## Intent
Explain how Slack conversations become evidence-backed process maps for technically curious visitors, without a deep implementation breakdown.

## Acceptance criteria
- Public /how-it-works page linked from homepage navigation and hero.
- Original responsive diagrams explain conversation, extraction, aggregation, and comparison with expected work.
- Examples are explicitly illustrative; observations and inferences remain distinct and no unverified live integration claims are introduced.
- Keyboard navigation, direct entry, refresh, mobile layout, app CTA, and absence of application API calls are checked.
- Repository checks pass and a PR links this record.

## Decisions and rationale
- Reuse the homepage's sage/cream visual language with native HTML/CSS/SVG diagrams for sharp, accessible visuals and no added dependencies.
- Use a single vendor-review example and plain language. Ground claims in merged extraction, mining, and conformance modules and their work items.
- SAM get_session_messages was called first in parent project context (the tool accepts sessionId only). Default history returns a limited streaming tail with hasMore and no pagination parameter; a user-only read returned all 18 messages, supplemented by session-scoped search. Historical progress is a report, not deployment evidence.
- Initial working tree clean; task branch at 22564d5 matched origin/main. Open app/agent PRs #69 and #76–81 remain separate work.

## Changes
- Added public `/how-it-works` (including trailing slash), a page-specific title, and homepage navigation/hero links.
- Added a four-stage overview, evidence extraction illustration, thread aggregation illustration, and keyboard-operable observed/expected process comparison. Diagrams use semantic HTML and decorative SVG, with accessible text descriptions.
- Reused marketing styling with scoped responsive CSS, no new dependencies, and app loading/authentication preserved.
- Added five browser regressions for route navigation, refresh, skip-link focus, Enter/Space diagram controls, app CTA, no public-page API requests, and viewport widths 320/390/768/1440.

## Validation
- Read CONTRIBUTING.md, docs/code-quality.md and related homepage/extraction/mining/conformance work records; inspected branch, remote commits and open PRs.
- Node v22.23.2; `npm ci` passed (zero vulnerabilities). Installed Ruff 0.16.7 under `/tmp/ariadneos-how-tools` and Playwright Chromium/system dependencies.
- `npm run fix` initially reported CSS specificity, semantic fieldset, decorative SVG accessibility, and nested conditional diagnostics; corrected them without suppressions. Final run passed; reviewed formatted diff.
- `npm run check` passed: Biome, strict TypeScript, fixture validation, 167 tests, coverage gates, guardrail probes, fresh/existing D1 migration checks, and production build.
- First `npm run check:repo` overlapped the earlier coverage run and failed on Vitest's shared coverage-directory lock. No code failure; the sequential rerun passed.
- `python3 scripts/check_work_items.py --base origin/main` and `git diff --cached --check` passed.
- Visually inspected full-page Chromium screenshots at 1440px and 390px plus the comparison diagram at 320px. Clean layout, readable labels, wrapping controls, and no clipped diagram content. Local artifacts: `/tmp/how-it-works-1440.png`, `/tmp/how-it-works-390.png`, `/tmp/how-it-works-compare-320.png` (ephemeral; visual evidence described here for handoff).

- `PATH="/tmp/ariadneos-how-tools/ruff-x86_64-unknown-linux-gnu:$PATH" npm run check:repo` (runs `python3 scripts/check_quality.py`) passed: Python gates, Ruff, app checks, dependency audit (zero vulnerabilities), isolated API/D1 checks, and all 11 Chromium tests.

## Risks and rollback
- App integration is evolving concurrently; this explanatory page does not establish deployment readiness. Revert this PR to remove the page and links; no database changes.

## Next steps
- Open PR and inspect remote CI. Human reviewer: assess the explanation and visual design, then decide whether to merge. Merge/production deployment are not authorized by this page request. No deployment was performed or verified by this task.
