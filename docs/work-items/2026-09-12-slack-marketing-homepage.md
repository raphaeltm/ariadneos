# Slack marketing homepage and /app

Status: ready for review
Branch: sam/ok-were-entirely-focused-w39wtj

## Request and result
The hackathon is focused entirely on Slack integration. Make `/` a marketing homepage and move the interactive product to `/app`.

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

## Next steps and limits
Review and merge through the existing PR quality/deployment workflow. Live Slack authentication/ingestion is separate work; this change delivers marketing and application routing. No production deployment was performed in this task.
