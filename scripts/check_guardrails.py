#!/usr/bin/env python3
"""Prove lint and type gates reject unsafe changes, without leaving probe files."""

import subprocess
import tempfile
from pathlib import Path


def main():
    with tempfile.TemporaryDirectory(prefix="guardrail-probe-", dir="tests") as directory:
        path = Path(directory) / "unsafe.ts"
        path.write_text("export const unsafeValue: any = 1;\ndebugger;\n")
        result = subprocess.run(
            ["node_modules/.bin/biome", "check", str(path)],
            text=True,
            capture_output=True,
            check=False,
        )
        output = result.stdout + result.stderr
        if result.returncode == 0 or "noExplicitAny" not in output or "noDebugger" not in output:
            raise SystemExit("Lint gate failed to reject explicit any and debugger probes")
        path.write_text('export const unchecked: string = ["one"][4];\n')
        result = subprocess.run(
            ["npm", "run", "typecheck"], text=True, capture_output=True, check=False
        )
        if result.returncode == 0 or "TS2322" not in result.stdout + result.stderr:
            raise SystemExit("Type gate failed to reject unchecked indexed access")
    print("Guardrail probes passed: unsafe lint/type changes were rejected.")


if __name__ == "__main__":
    main()
