#!/usr/bin/env python3
"""Validate durable work context using only the Python standard library."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

DIRECTORY = 'docs/work-items/'
SECTIONS = ('Intent', 'Acceptance criteria', 'Decisions and rationale', 'Changes',
            'Validation', 'Risks and rollback', 'Next steps')
STATUSES = {'planned', 'in-progress', 'in-review', 'blocked', 'done', 'superseded'}


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def is_record(name):
    return (name.startswith(DIRECTORY) and name.endswith('.md')
            and name not in {DIRECTORY + 'README.md', DIRECTORY + 'TEMPLATE.md'})


def validate(path):
    errors = []
    if path.is_symlink() or not path.is_file():
        return [f'{path}: must be a regular Markdown file']
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md', path.name):
        errors.append(f'{path}: use YYYY-MM-DD-short-topic.md')
    text = path.read_text(encoding='utf-8')
    if not re.search(r'^# \S.+', text, re.M):
        errors.append(f'{path}: missing title')
    for key in ('Status', 'Owner', 'Source', 'Branch'):
        values = re.findall(rf'^{key}:[ \t]*([^\n]+)$', text, re.M)
        if len(values) != 1 or not values[0].strip():
            errors.append(f'{path}: provide exactly one {key}')
        elif key == 'Status' and values[0].strip() not in STATUSES:
            errors.append(f'{path}: invalid Status')
    for section in SECTIONS:
        matches = re.findall(rf'^## {re.escape(section)}\n(.*?)(?=^## |\Z)', text, re.M | re.S)
        if len(matches) != 1 or not re.sub(r'[\s\-\[\]*]', '', matches[0]):
            errors.append(f'{path}: missing or empty section: {section}')
    if re.search(r'<[^>\n]+>|\b(?:TODO|TBD|FIXME)\b', text):
        errors.append(f'{path}: replace template placeholders with concrete context')
    return errors


def check(base=None, event=None, all_records=False):
    errors = []
    if all_records:
        records = [str(p) for p in Path(DIRECTORY).glob('*.md') if is_record(str(p))]
    else:
        merge_base = git('merge-base', base, 'HEAD')
        # Includes staged and unstaged edits locally; CI has a clean checkout.
        changed = git('diff', '--name-only', '--diff-filter=AM', '-z', merge_base).split('\0')
        records = [name for name in changed if is_record(name)]
        deleted = git('diff', '--name-only', '--diff-filter=D', '--no-renames', '-z', merge_base).split('\0')
        if any(is_record(name) for name in deleted):
            errors.append('Keep historical work items; add a superseding record instead of deleting or renaming.')
        if not records:
            errors.append('Add or update a dated docs/work-items/*.md record (stage new files locally).')
    for name in records:
        errors.extend(validate(Path(name)))
    if event:
        pr = json.loads(Path(event).read_text()).get('pull_request')
        if pr is not None:
            body = pr.get('body') or ''
            # Accept repository-relative and full GitHub Markdown links.
            targets = re.findall(r'\[[^\]]+\]\(([^\s)]+)\)', body)
            if not any(target == name or target == './' + name or
                       target.endswith('/' + name) for name in records for target in targets):
                errors.append('PR body must contain a Markdown link to an added/updated work item.')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--base', help='Base ref or SHA; compared from merge base')
    group.add_argument('--all', action='store_true', help='Validate all existing records')
    parser.add_argument('--event', help='GitHub event JSON, to validate the PR link')
    args = parser.parse_args()
    try:
        errors = check(args.base, args.event, args.all)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        errors = [str(exc)]
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print('Work item context passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
