"""Exercise the gate against real temporary git histories and PR payloads."""

import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "gate", Path(__file__).parents[1] / "check_work_items.py"
)
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)
RECORD = "docs/work-items/2026-09-12-example.md"
VALID = (
    "# Example work\n\nStatus: in-review\nOwner: Agent for maintainer\nSource: Request to add gates\nBranch: task/example\n\n"
    + "\n".join(
        f"## {section}\nConcrete context and evidence for this section.\n"
        for section in gate.SECTIONS
    )
)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = Path.cwd()
        os.chdir(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "Test")
        Path("README.md").write_text("Overview\n")
        self.git("add", ".")
        self.git("commit", "-qm", "base")
        self.base = self.git("rev-parse", "HEAD").strip()

    def tearDown(self):
        os.chdir(self.previous)
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", *args], text=True)

    def record(self, text=VALID):
        Path(RECORD).parent.mkdir(parents=True, exist_ok=True)
        Path(RECORD).write_text(text)
        self.git("add", ".")

    def test_valid_record_and_link(self):
        self.record()
        Path("event.json").write_text(
            json.dumps({"pull_request": {"body": f"[Work item]({RECORD})"}})
        )
        self.assertEqual(gate.check(self.base, "event.json"), [])

    def test_missing_record_and_template_only_fail(self):
        self.assertTrue(gate.check(self.base))
        Path("docs/work-items").mkdir(parents=True)
        Path("docs/work-items/TEMPLATE.md").write_text(VALID)
        self.git("add", ".")
        self.assertTrue(gate.check(self.base))

    def test_incomplete_and_placeholder_records_fail(self):
        for text in (
            VALID.replace("Status: in-review", "Status: whatever"),
            VALID.replace("Owner: Agent for maintainer", "Owner: <name>"),
            VALID.replace(
                "## Validation\nConcrete context and evidence for this section.", "## Validation\n"
            ),
            VALID.replace("Owner: Agent for maintainer", "Owner:"),
        ):
            with self.subTest(text=text):
                self.record(text)
                self.assertTrue(gate.check(self.base))

    def test_pr_must_link_changed_record(self):
        self.record()
        for body in (None, RECORD, "[Unrelated](docs/work-items/2026-09-11-old.md)"):
            Path("event.json").write_text(json.dumps({"pull_request": {"body": body}}))
            self.assertTrue(gate.check(self.base, "event.json"))

    def test_deleting_history_fails_even_with_new_record(self):
        self.record()
        self.git("commit", "-qm", "record")
        base = self.git("rev-parse", "HEAD").strip()
        Path(RECORD).unlink()
        Path("docs/work-items/2026-09-12-new.md").write_text(VALID)
        self.git("add", ".")
        self.assertTrue(gate.check(base))

    def test_existing_record_update_and_push_without_pr(self):
        self.record()
        self.git("commit", "-qm", "record")
        base = self.git("rev-parse", "HEAD").strip()
        Path(RECORD).write_text(VALID + "\nAdditional handoff evidence.\n")
        Path("event.json").write_text("{}")
        self.assertEqual(gate.check(base, "event.json"), [])

    def test_symlink_is_not_a_work_record(self):
        Path("docs/work-items").mkdir(parents=True)
        Path("payload.md").write_text(VALID)
        Path(RECORD).symlink_to("../../payload.md")
        self.git("add", ".")
        self.assertTrue(gate.check(self.base))

    def test_all_validates_historical_records(self):
        self.record()
        self.assertEqual(gate.check(all_records=True), [])
        Path(RECORD).write_text("# Incomplete\n")
        self.assertTrue(gate.check(all_records=True))


if __name__ == "__main__":
    unittest.main()
