# Research guidance for agents

Applies to this directory and its descendants. Follow applicable repository
instructions and the user's current task instructions as well.

## Structure and maintenance

- Keep each topic in a descriptive kebab-case directory with a README.md entry
  point. Link it from the research index. Use relative links within the repo.
- Keep reusable findings here and execution history in docs/work-items. Link
  between them instead of duplicating the research in the work log.
- Update existing topic files before creating overlapping documents. Split
  files by purpose, not by agent name or conversation session.
- Keep this file the canonical research guidance for both Codex and Claude.
  CLAUDE.md points here; do not maintain a second, divergent ruleset.

## Evidence and scope

- Label statements as verified capabilities, repository observations, proposals,
  assumptions, or open questions. Research is not implementation authorization.
- Record source URLs and the date checked beside capability findings. Prefer
  official documentation; recheck changing APIs before implementation.
- Cite concrete repository paths for implementation claims and identify the
  revision inspected when practical. Reconcile docs with code before declaring
  a feature implemented. Preserve historical findings with explicit dates.
- Keep observed internal events, external research, and suggested actions
  distinct. A frequent workflow is not proof of causality or permission.
- Respect the current product scope. The 2026-09-12 task context specifies a
  Slack-only hackathon; check current project instructions before expanding it.
- Do not include credentials, private Slack messages, customer records, or raw
  sensitive tool output. Use synthetic examples and deliberately scoped public
  queries when describing external research.
- State limitations and untested compatibility explicitly. Do not present a
  vendor's marketing claim as a measured AriadneOS result.

## Review and handoff

- Review Markdown readability, relative links, dates, sources, and consistency
  with the current scope. Run git diff --check and applicable repository gates.
- Update the work-item log with changes, rationale, validation, and next steps.
- Keep documentation-only changes free of incidental runtime/config edits.
- Follow the user's PR and merge authorization for the current task. This file
  does not grant standing permission to merge or deploy future work.
