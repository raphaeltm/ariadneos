#!/usr/bin/env python3
"""Repository checks, plus the application contract when the app is present."""
import json
from pathlib import Path
import subprocess


def run(*args):
    print('+ ' + ' '.join(args), flush=True)
    subprocess.run(args, check=True)


def main():
    run('python3', '-m', 'unittest', 'discover', '-s', 'scripts/tests', '-v')
    run('python3', 'scripts/check_work_items.py', '--all')
    # Check tracked files, including newly staged files, without relying on PR history.
    names = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
    errors = []
    for name in filter(None, names):
        path = Path(name)
        if not path.is_file() or path.is_symlink():
            continue
        data = path.read_bytes()
        if b'\0' in data:
            continue
        try:
            lines = data.decode('utf-8').splitlines()
        except UnicodeDecodeError:
            continue
        for number, line in enumerate(lines, 1):
            if line.rstrip(' \t') != line:
                errors.append(f'{name}:{number}: trailing whitespace')
    if errors:
        raise SystemExit('\n'.join(errors))
    if Path('package.json').exists():
        package = json.loads(Path('package.json').read_text())
        missing = {'test', 'typecheck', 'build'} - package.get('scripts', {}).keys()
        if missing or not Path('package-lock.json').is_file():
            raise SystemExit('App gate requires package-lock.json and test/typecheck/build scripts; '
                             'adapt this runner with equivalent checks if the app uses another layout.')
        run('npm', 'ci')
        run('npm', 'test')
        run('npm', 'run', 'typecheck')
        run('npm', 'run', 'build')
    else:
        print('No root package.json: repository checks only; application integration is pending.')
    print('Quality passed.')


if __name__ == '__main__':
    main()
