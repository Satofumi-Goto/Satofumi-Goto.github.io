"""Fail-closed regression contracts for the bounded Python worker.

This independent QA file targets the latest #93 fail-closed implementation.
It does not change the worker or its existing tests. All repositories are
temporary fixtures; no network, secrets, or paid model calls are required.
"""
import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

MODULE = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "urgency_worker_runtime.py"
SPEC = importlib.util.spec_from_file_location("urgency_worker_runtime_failclosed", MODULE)
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def git(root, *args):
    return subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True, text=True, check=True,
        env={"GIT_CONFIG_NOSYSTEM": "1", "GIT_AUTHOR_NAME": "QA",
             "GIT_AUTHOR_EMAIL": "qa@example.invalid",
             "GIT_COMMITTER_NAME": "QA",
             "GIT_COMMITTER_EMAIL": "qa@example.invalid"},
    )


def config(root):
    return {
        "workspace": str(root),
        "max_attempts": 1,
        "agents": [{"id": "local-python", "model": "python",
                    "connected": True, "authenticated": True,
                    "runtime_verified": True, "busy": False}],
        "tasks": [{"id": "test-1", "kind": "python-test",
                   "priority": 100, "files": ["src/a.py"]}],
    }


class FailClosedContracts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.workspace = self.root / "work"
        self.workspace.mkdir()
        self.state = self.root / "worker-state.json"
        self.calls = []

    def runner(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return SimpleNamespace(returncode=0, stdout="ok", stderr="")

    def assert_no_unverified_execution(self):
        result = worker.cycle(config(self.workspace), self.state, runner=self.runner)
        self.assertEqual(self.calls, [], "Unverified source must not run a command")
        self.assertEqual(result["completed"], [], "Unverified source must not be completed")

    def make_clean_git(self):
        git(self.workspace, "init", "-q")
        (self.workspace / "src").mkdir()
        (self.workspace / "src" / "a.py").write_text("print('ok')\n", encoding="utf-8")
        git(self.workspace, "add", ".")
        git(self.workspace, "commit", "-qm", "fixture")

    def test_non_git_workspace_is_not_executed(self):
        self.assert_no_unverified_execution()

    def test_dirty_git_workspace_is_not_executed(self):
        self.make_clean_git()
        (self.workspace / "src" / "a.py").write_text("print('changed')\n", encoding="utf-8")
        self.assert_no_unverified_execution()

    def test_git_read_failure_is_not_executed(self):
        self.make_clean_git()
        with patch.object(worker, "_repo_sha", return_value=None):
            self.assert_no_unverified_execution()

    def test_state_inside_dirty_workspace_is_rejected(self):
        self.make_clean_git()
        (self.workspace / "src" / "a.py").write_text("print('changed')\n", encoding="utf-8")
        inside = self.workspace / "state.json"
        with self.assertRaisesRegex(ValueError, "worker-state-must-be-outside"):
            worker.cycle(config(self.workspace), inside, runner=self.runner)
        self.assertEqual(self.calls, [])

    def test_clean_git_workspace_still_executes(self):
        self.make_clean_git()
        result = worker.cycle(config(self.workspace), self.state, runner=self.runner)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(result["completed"], ["test-1"])
        self.assertTrue(result["events"][-1]["repo_sha_verified"])


if __name__ == "__main__":
    unittest.main()
