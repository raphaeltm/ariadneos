# Workflow canvas controls

Status: in-progress
Owner: Codex agent for SAM task 01M2AWE2JFEP7GTMYSP4DCG09B
Source: GitHub issue #24, "Render designed/discovered workflow canvas and support controls." Build the canvas component subtree for designed/discovered process graphs, support counts, conformance indicators, selection, zoom, pan, support controls, and the typed client-state contract from issue #23.
Branch: sam/implement-github-issue-24-dcg09b

## Intent
Render the workflow canvas for overlay, discovered, designed, and instance process views using the frozen graph contracts from issue #14 and the client state from issue #23. The canvas should make designed ghosts, discovered reality, conformant nodes, violations, support counts, role/grounding indicators, and edge evidence selection understandable without backend or route changes.

## Acceptance criteria
- Canvas helpers filter overlay/discovered/designed/instance views without dangling edges, while preserving designed ghost nodes in overlay when the support threshold rises.
- Nodes and edges expose plane, support, grounding, role-deviation, proposed, violation, and back-edge states with stable React Flow ids for selection.
- Layout excludes back-edges from dagre, caches existing node positions across new topology, and keeps repeated instance-step ids distinct.
- Component controls support mode selection, support threshold changes, node/edge selection, zoom/pan through React Flow controls, and an explicit conformance strip.
- Repository checks and focused regression tests run locally; staging verification is skipped per the time-critical user instruction.

## Decisions and rationale
- Build in a new `src/components/process-canvas/` subtree so issue #24 stays within its owned component boundary and downstream app-shell work can adopt it without shared-contract churn.
- Consume `GraphView`, `GraphNode`, `GraphEdge`, and `AppSelection` from the #14/#23 contracts instead of translating from the older demo `ProcessModel`.
- Keep layout/filter logic in pure modules so regression tests can validate support filtering, back-edge layout exclusion, and position stability without a browser renderer.

## Changes
- Added `src/components/process-canvas/graph.ts` with pure graph filtering, support limits, client-state selection payloads, and dagre layout that excludes back-edges while preserving cached positions for existing nodes.
- Added `src/components/process-canvas/workflow-canvas.tsx` and `process-canvas.css` with React Flow rendering, overlay/discovered/documented/instance mode controls, support threshold control, zoom/pan controls, legend, conformance strip, support/role/grounding/violation node states, and styled designed/discovered/both/rework edges.
- Added `src/components/process-canvas/types.ts` for component-facing graph, layout, and selection contracts.
- Added `tests/process-canvas.test.ts` for support filtering, dangling-edge prevention, back-edge layout exclusion, position stability, selection payloads, and support range calculation.

## Validation
- `npm ci`: passed.
- `npm run fix`: passed after applying Biome/Ultracite formatting and semantic accessibility fixes.
- `npm run test -- tests/process-canvas.test.ts`: passed, 6 tests.
- `npm run typecheck`: passed.
- `npm run check`: passed lint, typecheck, fixture validation, coverage tests, guardrail probes, migration smoke, and production build.
- Initial `npm run check:repo`: failed because `ruff` was not installed in the container.
- Downloaded Ruff 0.16.7 to `/tmp/ariadneos-ruff` from the official release archive.
- Second `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: failed only because Playwright Chromium was not installed.
- `npm exec --no -- playwright install --with-deps chromium`: passed and installed Chromium plus required system dependencies.
- Final `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: passed work-item tests, Ruff checks, full app checks, dependency audit, isolated Worker/D1/API smoke, and 5 Chromium browser tests.
- After rebasing onto updated `origin/main` (`4b1fd80`), `npm run check`, `python3 scripts/check_work_items.py --base origin/main`, and `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo` passed again.

## Risks and rollback
- The existing `/app` route still uses the older demo graph surface; this PR provides the owned canvas subtree against the typed snapshot/client-state contracts and can be rolled back by removing the new subtree, tests, and this work item.

## Next steps
- Open a PR with `Closes #24`, monitor CI, and merge after checks are green. Staging verification is intentionally skipped per the time-critical user instruction.
