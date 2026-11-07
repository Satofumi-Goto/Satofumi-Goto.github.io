import tempfile
import unittest
import multiprocessing
import time
from pathlib import Path
from types import SimpleNamespace
from scripts.urgency_worker_runtime import cycle

def concurrent_worker(workspace, state_path, marker):
    from scripts.urgency_worker_runtime import cycle
    from types import SimpleNamespace
    from pathlib import Path
    def slow_runner(*args, **kwargs):
        with open(marker, "a", encoding="utf-8") as out:
            out.write("run\n")
        time.sleep(0.15)
        return SimpleNamespace(returncode=0, stdout="ok", stderr="")
    config = {"workspace": workspace, "agents": [{"id": "python", "model": "python",
              "connected": True, "authenticated": True, "runtime_verified": True}],
              "tasks": [{"id": "one", "files": ["same.py"], "kind": "python-test"}]}
    cycle(config, state_path, slow_runner)

class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name) / "state.json"
        self.calls = []
        self.config = {"workspace": self.tmp.name, "agents": [
            {"id": "python", "model": "python", "connected": True, "authenticated": True, "runtime_verified": True},
            {"id": "claude", "model": "claude", "connected": True, "authenticated": True},
            {"id": "offline", "model": "python", "connected": False, "authenticated": True}],
            "tasks": [{"id": "a", "priority": 10, "files": ["a.py"], "kind": "python-test"},
                      {"id": "b", "priority": 5, "files": ["b.py"], "kind": "python-test"}]}
    def runner(self, cmd, **kwargs):
        self.calls.append(cmd)
        return SimpleNamespace(returncode=0, stdout="ok", stderr="")
    def test_concurrent_processes_execute_single_claim(self):
        marker = str(Path(self.tmp.name) / "runs.log")
        ctx = multiprocessing.get_context("fork")
        processes = [ctx.Process(target=concurrent_worker, args=(self.tmp.name, str(self.state), marker))
                     for _ in range(3)]
        for process in processes: process.start()
        for process in processes:
            process.join(timeout=10)
            self.assertEqual(process.exitcode, 0)
        self.assertEqual(Path(marker).read_text(encoding="utf-8").splitlines(), ["run"])
    def test_unverified_worker_cannot_run(self):
        self.config["agents"][0]["runtime_verified"] = False
        self.assertEqual(cycle(self.config, self.state, self.runner)["completed"], [])
        self.assertEqual(self.calls, [])
    def test_retry_is_bounded_and_audited(self):
        self.config["max_attempts"] = 2
        def fail(*args, **kwargs):
            return SimpleNamespace(returncode=1, stdout="", stderr="temporary")
        cycle(self.config, self.state, fail)
        state = cycle(self.config, self.state, self.runner)
        self.assertEqual(state["attempts"]["a"], 2)
        self.assertEqual(state["completed"], ["a"])
        self.assertIn("pid", state["events"][0])
        self.assertIn("exit_code", state["events"][0])
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
