#!/usr/bin/env python3
"""Run smoke checks against an isolated local Worker and temporary D1 database."""

import argparse
import base64
import hashlib
import hmac
import json
import os
import secrets
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", action="store_true")
    args = parser.parse_args()
    # Do not pass Cloudflare credentials to the local test process.
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("CLOUDFLARE_", "CF_", "SLACK_", "BETTER_AUTH_", "ARIADNE_TEST_"))
    }
    env["WRANGLER_SEND_METRICS"] = "false"
    with tempfile.TemporaryDirectory(prefix="ariadneos-smoke-") as directory:
        config = json.loads(subprocess.check_output(["node", "scripts/read-wrangler-config.mjs"]))
        config.pop("routes", None)
        config.pop("env", None)
        config.pop(
            "ai", None
        )  # AI success requires remote credentials; unit tests cover boundaries.
        config["main"] = str(Path("server/index.ts").resolve())
        config["assets"]["directory"] = str(Path("dist").resolve())
        config["d1_databases"][0]["migrations_dir"] = str(Path("migrations").resolve())
        auth_secret = secrets.token_urlsafe(48)
        config["vars"].update(
            {
                "BETTER_AUTH_SECRET": auth_secret,
                "SLACK_CLIENT_ID": "local-test-client",
                "SLACK_CLIENT_SECRET": "local-test-secret",
                "SLACK_SIGNING_SECRET": secrets.token_urlsafe(32),
            }
        )
        config_path = Path(directory) / "wrangler.json"
        config_path.write_text(json.dumps(config))
        common = ["node_modules/.bin/wrangler", "--config", str(config_path)]
        subprocess.run(
            [
                *common,
                "d1",
                "migrations",
                "apply",
                "ariadneos-demo",
                "--local",
                "--persist-to",
                directory,
            ],
            env=env,
            check=True,
            stdin=subprocess.DEVNULL,
        )
        database_path = None
        for candidate in Path(directory).rglob("*.sqlite"):
            with sqlite3.connect(candidate) as connection:
                if connection.execute(
                    "SELECT name FROM sqlite_master WHERE name = 'auth_user'"
                ).fetchone():
                    database_path = candidate
                    break
        if database_path is None:
            raise RuntimeError("Migrated auth database was not found")
        cookies = []
        with sqlite3.connect(database_path) as database:
            now = int(time.time() * 1000)
            for index in range(8):
                identity = f"local-test-user-{index}"
                token = secrets.token_urlsafe(32)
                database.execute(
                    "INSERT INTO auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)",
                    (identity, "Test User", f"test-{index}@example.test", 1, now, now),
                )
                database.execute(
                    "INSERT INTO auth_session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES (?,?,?,?,?,?)",
                    (f"session-{index}", now + 3600000, token, now, now, identity),
                )
                signature = base64.b64encode(
                    hmac.new(auth_secret.encode(), token.encode(), hashlib.sha256).digest()
                ).decode()
                cookies.append(
                    "better-auth.session_token="
                    + urllib.parse.quote(f"{token}.{signature}", safe="")
                )
        env["ARIADNE_TEST_COOKIE"] = cookies[0]
        env["ARIADNE_BROWSER_COOKIES"] = json.dumps(cookies[1:])
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        config["dev"] = {"host": f"127.0.0.1:{port}"}
        config["vars"]["BETTER_AUTH_URL"] = f"http://127.0.0.1:{port}"
        config_path.write_text(json.dumps(config))
        with (Path(directory) / "worker.log").open("w+") as log:
            process = subprocess.Popen(
                [
                    *common,
                    "dev",
                    "--local",
                    "--ip",
                    "127.0.0.1",
                    "--port",
                    str(port),
                    "--persist-to",
                    directory,
                ],
                env=env,
                stdout=log,
                stderr=log,
                start_new_session=True,
            )
            try:
                base = f"http://127.0.0.1:{port}"
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError("Local Worker exited before readiness")
                    try:
                        with urllib.request.urlopen(base + "/api/health", timeout=1) as response:
                            if json.load(response).get("ok"):
                                break
                    except (urllib.error.URLError, TimeoutError):
                        time.sleep(0.5)
                else:
                    raise RuntimeError("Local Worker did not become ready in 60 seconds")
                subprocess.run(["node", "scripts/smoke.mjs", base], env=env, check=True, timeout=60)
                if args.browser:
                    subprocess.run(
                        ["npm", "run", "test:browser"],
                        env={**env, "ARIADNE_TEST_URL": base},
                        check=True,
                        timeout=120,
                    )
            except Exception:
                log.seek(0)
                print(log.read())
                raise
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()


if __name__ == "__main__":
    main()
