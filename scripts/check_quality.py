#!/usr/bin/env python3
"""Run repository, application, dependency, and isolated end-to-end checks."""

import subprocess
from pathlib import Path


def run(*args):
    print("+ " + " ".join(args), flush=True)
    subprocess.run(args, check=True)


def main():
    run("python3", "-m", "unittest", "discover", "-s", "scripts/tests", "-v")
    run("python3", "scripts/check_work_items.py", "--all")
    # Check tracked files, including newly staged files, without relying on PR history.
    names = subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0")
    errors = []
    for name in filter(None, names):
        path = Path(name)
        if not path.is_file() or path.is_symlink():
            continue
        data = path.read_bytes()
        if b"\0" in data:
            continue
        try:
            lines = data.decode("utf-8").splitlines()
        except UnicodeDecodeError:
            continue
        for number, line in enumerate(lines, 1):
            if line.rstrip(" \t") != line:
                errors.append(f"{name}:{number}: trailing whitespace")
    if errors:
        raise SystemExit("\n".join(errors))
    run("ruff", "check", "scripts")
    run("ruff", "format", "--check", "scripts")
    run("npm", "run", "check")
    run("npm", "run", "audit:dependencies")
    run("npm", "run", "test:e2e")
    print("Quality passed.")


if __name__ == "__main__":
    main()
