import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from scripts.urgency_worker_runtime import cycle

class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name) / "state.json"
        self.calls = []
        self.config = {"workspace": self.tmp.name, "agents": [
            {"id": "python", "model": "python", "connected": True, "authenticated": True},
            {"id": "claude", "model": "claude", "connected": True, "authenticated": True},
            {"id": "offline", "model": "python", "connected": False, "authenticated": True}],
            "tasks": [{"id": "a", "priority": 10, "files": ["a.py"], "kind": "python-test"},
                      {"id": "b", "priority": 5, "files": ["b.py"], "kind": "python-test"}]}
    def runner(self, cmd, **kwargs):
        self.calls.append(cmd)
        return SimpleNamespace(returncode=0, stdout="ok", stderr="")
    def test_auto_handoff_and_no_repeat(self):
        self.assertEqual(cycle(self.config, self.state, self.runner)["completed"], ["a"])
        self.assertEqual(cycle(self.config, self.state, self.runner)["completed"], ["a", "b"])
        cycle(self.config, self.state, self.runner)
        self.assertEqual(len(self.calls), 2)
    def test_reserved_file(self):
        self.config["reserved_files"] = ["a.py"]
        self.assertEqual(cycle(self.config, self.state, self.runner)["completed"], ["b"])
    def test_paid_agent_never_invoked(self):
        self.config["agents"] = [self.config["agents"][1]]
        self.assertEqual(cycle(self.config, self.state, self.runner)["completed"], [])
    def test_arbitrary_command_blocked(self):
        self.config["tasks"][0]["kind"] = "shell"
        self.assertEqual(cycle(self.config, self.state, self.runner)["completed"], ["b"])
    def test_failure_persisted(self):
        def fail(*args, **kwargs):
            return SimpleNamespace(returncode=1, stdout="", stderr="failed")
        self.assertEqual(cycle(self.config, self.state, fail)["failed"], ["a"])
        self.assertEqual(cycle(self.config, self.state, self.runner)["completed"], ["b"])

if __name__ == "__main__":
    unittest.main()
