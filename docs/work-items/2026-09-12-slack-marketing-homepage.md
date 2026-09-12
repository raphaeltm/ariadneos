# Slack marketing homepage and /app

Status: in-review
Owner: Codex, requested by the repository owner
Source: SAM task 01M2ANR7EWSG7ZAPMRRXW39WTJ; user requested Slack marketing at /, app at /app, then green CI, staging visual review, and merge.
Branch: sam/ok-were-entirely-focused-w39wtj

## Intent
The hackathon is focused entirely on Slack integration. Make `/` a marketing homepage and move the interactive product to `/app`.

## Acceptance criteria
- The root URL markets the Slack-focused product and links to the application at /app.
- Direct navigation and refresh work at /app and /app/.
- CI and staging pass, and the deployed design is visually reviewed before merging.

## Decisions and rationale
- Keep the demo lazy-loaded so marketing visitors do not initialize application data or graph dependencies.
- Preserve synthetic source labeling until a live connector is available.
- Integrate the newly merged main quality tooling and lowercase filenames; keep its native dialog accessibility fixes.

## Changes
- Added a responsive marketing page with Slack positioning, an illustrative conversation-to-process diagram, explanatory sections, and working demo links.
- Routed `/app` and its subpaths to the existing explorer through a lazy import. The homepage does not load the graph bundle or call application APIs.
- Kept synthetic demo labeling explicit; the page does not claim that live Slack ingestion is implemented.
- Replaced the obsolete Notion source reference in the demo and API context with the planned Slack integration.
- Updated page metadata, README/demo links and scope, and deployed-route readiness checks for `/app` and `/app/`.
- Used the existing React, Lucide, CSS, and Cloudflare SPA setup without adding dependencies.

## Validation
- `npm run build`: TypeScript and production Vite build passed.
- `npm test`: all four process tests passed.
- `npm run test:smoke -- http://localhost:8788`: passed the full local Worker/D1 suite, including workflow models, simulations, evidence, session isolation, and validation.
- Chromium/Playwright browser checks passed: homepage renders without API calls; demo CTA navigates to `/app`; direct load, reload, and `/app/` work; Slack source dialog and home navigation work; no JavaScript errors.
- Checked layout at 320, 390, 768, and 1440 pixels with no horizontal overflow; visually reviewed desktop and mobile full-page screenshots.
- Prettier on changed source files and `git diff --check` passed.
- Local Worker verification used `wrangler dev --port 8788 --local --host localhost --local-upstream localhost` to avoid the existing production-domain redirect during local testing.

## Risks and rollback
- Live Slack authentication/ingestion remains separate work. Revert this PR to undo marketing and routing; no schema migration is included.

## Next steps
Review and merge through the existing PR quality/deployment workflow. Live Slack authentication/ingestion is separate work; this change delivers marketing and application routing. No production deployment was performed in this task.

## Staging review and main integration
- Deployment run https://github.com/raphaeltm/ariadneos/actions/runs/34691561768 passed validation, staging deployment, revision readiness, and simulation smoke tests for staging revision ada4c505041a3c476d79aff8fc20a0b3b4d02c70.
- Agent-browser review confirmed desktop/mobile homepage appearance, loaded fonts, no horizontal overflow at 320/390px, working demo CTA and section anchor, /app reload and /app/ access, and no browser errors. Full-page screenshots of homepage and explorer were visually inspected.
- Main advanced with PR #2 during review, causing filename/entry-point conflicts. Resolved against its lowercase app component and Biome/Ultracite conventions; added browser regressions for marketing, keyboard skip navigation, app navigation/refresh, and mobile layout. Existing explorer tests now start at /app. Re-running all new repository gates and staging before merge.
- After conflict resolution, `PATH="/home/node/.local/bin:$PATH" npm run check:repo` passed: 8 Python gate tests, work-item validation, Ruff, Biome, strict TypeScript, 22 Vitest tests with thresholds, guardrail probes, build, dependency audit (zero vulnerabilities), isolated API smoke suite, and all 4 Chromium tests. `python3 scripts/check_work_items.py --base origin/main` passed. Ruff was installed at the required version and explicitly added to the command PATH after the first repository check could not find it.
