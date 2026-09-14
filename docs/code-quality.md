# Code quality for humans and agents

The default loop is edit, fix, inspect, verify, hand off. Linters provide fast feedback; compiler checks and behavior tests catch different classes of failure. The tools below are installed in the lockfile and executed locally and in CI.

## Commands

Use Node 22 (22.12 or newer), Python 3.11+, and Ruff 0.16.7. Install Ruff using its [official installation instructions](https://docs.astral.sh/ruff/installation/) with that exact version. Run `npm ci` to install JS tooling and activate Husky hooks. Install the browser once with `npm exec --no -- playwright install --with-deps chromium` (system dependencies may require admin access).

| Command | Purpose |
| --- | --- |
| `npm run fix` | Ultracite safe formatting and autofixes; inspect the result. |
| `npm run lint` | Biome lint, format, import organization, and accessibility checks; warnings fail. |
| `npm run typecheck` | Strict TypeScript, checked indexed access, unused code, return paths, and switch fallthrough. |
| `npm run test:coverage` | Vitest mining and API-boundary tests with coverage reports. |
| `npm run test:guardrails` | Negative probes proving explicit any, debugger, and unchecked access are rejected. |
| `npm run check` | Lint, types, coverage tests, rejection probes, production build. |
| `npm run test:integration` | API smoke tests against an isolated local Worker and fresh migrated D1. |
| `npm run test:e2e` | Same isolated API checks plus Chromium UI tests. |
| `npm run check:repo` | Python lint/format and gate tests, all app checks, dependency audit, API and browser tests. |

Husky runs read-only lint-staged checks before commits and `npm run check` before pushes. It does not silently re-stage unrelated or partially staged edits. CI runs the full repository check even if local hooks were not installed. VS Code has Biome format-on-save and import fixes; `AGENTS.md` is the common agent contract.

## Linting choices and explicit exceptions

[Ultracite](https://www.ultracite.ai/docs/provider/biome) supplies Biome core, React, Vitest, and project-graph presets. Biome replaces Prettier for supported source/config formats. Ruff handles Python scripts; Biome does not lint Python, YAML, or Markdown.

`biome.jsonc` contains these deliberate exceptions:

- `noUnresolvedImports`: the installed Biome resolver reported valid Hono, Vite, Dagre, and React package exports as unresolved. TypeScript and the production bundler validate imports instead. Other project-graph rules remain enabled.
- `noUnnecessaryConditions`: its partial type inference reported optional React state as always defined. Keep the defensive conditions; TypeScript remains authoritative for nullability. Re-evaluate both resolver exceptions when updating Biome.
- `noJsxPropsBind`: globally memoizing every event callback adds complexity without measured benefit. React hook correctness remains enabled; optimize identity-sensitive props when profiling warrants it.
- `noDescendingSpecificity`, only in the existing stylesheet: selectors target different component subtrees and responsive overrides intentionally come later. Reordering the cascade solely to satisfy the heuristic can change visuals.
- `noMisplacedAssertion` and `noAwaitInLoops`, only in the standalone smoke and deployment-readiness scripts: Node assertions intentionally run outside Vitest, and sequential requests verify session persistence and quota exhaustion.
- Inline exceptions are narrow and carry their reason in the suppression comment: sequential awaits where ordering is load-bearing (session segmentation, Slack rate limits, journal cursor monotonicity) and one bitwise exception for stable request hashing.

Build output, coverage, browser artifacts, and the generated npm lockfile are excluded from Biome. Application code is included; there is no baseline file that hides existing lint failures. New suppressions need a specific reason and work-item evidence.

## Behavioral gates and limits

Shared mining code has thresholds of 90% statements/lines, 100% functions, and 80% branches. These cover the pure core, not the entire app. Server coverage is reported separately; API integration tests execute the real Worker against the real migrations on in-memory SQLite. Browser tests verify the marketing pages and that the app refuses anonymous access. Focused tests and empty test runs fail. Tests have no automatic retry allowance.

The integration harness parses Wrangler JSONC, uses a temporary local database, and removes named remote environments, the remote AI binding, and Cloudflare credential environment variables. It never deploys or migrates remote state. Live AI success is not covered; invalid requests and the existing computed fallback need to remain distinct from verified remote model output. Browser screenshots/traces are retained locally on failure in `test-results/`.

`npm audit --audit-level=high` blocks high/critical advisories, including development dependencies. Dependabot proposes weekly npm and action updates; an agent or maintainer adds the work record and reviews compatibility. The `Secret scan` checks history with Gitleaks. CodeQL runs security-extended JS/TS and Python queries on PRs, main, and weekly; a successful analysis job means analysis ran, not that all findings have been resolved. Review Code Scanning alerts and enable GitHub's code-scanning merge protection if desired.

Quality/security workflows use pinned action SHAs, read-only checkout credentials, and no Cloudflare secrets. The separate deployment pipeline uses environment-scoped Cloudflare secrets after its full quality job passes; eligible PRs automatically deploy staging, and only main can deploy production. CodeQL alone receives `security-events: write` for reporting. Changes to workflows and their scripts need independent review: a PR can otherwise modify its own checks. Branch rules are an admin setting, documented in `CONTRIBUTING.md`; this branch does not claim those settings are active.
