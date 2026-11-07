import tempfile
import unittest
import multiprocessing
import time
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace
from scripts.urgency_worker_runtime import cycle
# Execute the independent alias/symlink regression class in this existing test job.
from test_urgency_worker_file_alias_contract import WorkerFileAliasContractTests

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


def independent_worker(workspace, state_path, agent_id):
    from scripts.urgency_worker_runtime import cycle
    from types import SimpleNamespace
    import time
    def slow_runner(*args, **kwargs):
        time.sleep(0.4)
        return SimpleNamespace(returncode=0, stdout="ok", stderr="")
    config = {"workspace": workspace,
              "agents": [{"id": agent_id, "model": "python",
                           "connected": True, "authenticated": True, "runtime_verified": True}],
              "tasks": [{"id": "a", "priority": 2, "files": ["a.py"], "kind": "python-test"},
                        {"id": "b", "priority": 1, "files": ["b.py"], "kind": "python-test"}]}
    cycle(config, state_path, slow_runner)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.email", "qa@localhost"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.name", "Isolated QA"], cwd=root, check=True)
        (root / "source.txt").write_text("initial", encoding="utf-8")
        subprocess.run(["git", "add", "source.txt"], cwd=root, check=True)
        subprocess.run(["git", "commit", "-qm", "source fixture"], cwd=root, check=True)
        self.state = root / ".git" / "state.json"
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
        marker = str(Path(self.tmp.name) / ".git" / "runs.log")
        ctx = multiprocessing.get_context("fork")
        processes = [ctx.Process(target=concurrent_worker, args=(self.tmp.name, str(self.state), marker))
                     for _ in range(3)]
        for process in processes: process.start()
        for process in processes:
            process.join(timeout=10)
            self.assertEqual(process.exitcode, 0)
        self.assertEqual(Path(marker).read_text(encoding="utf-8").splitlines(), ["run"])
    def test_parallel_unrelated_files(self):
        ctx = multiprocessing.get_context("fork")
        procs = [ctx.Process(target=independent_worker,
                 args=(self.tmp.name, str(self.state), "worker-" + str(n)))
                 for n in range(2)]
        for proc in procs: proc.start()
        for proc in procs:
            proc.join(timeout=10)
            self.assertEqual(proc.exitcode, 0)
        state = json.loads(self.state.read_text(encoding="utf-8"))
        events = [e for e in state["events"] if e.get("success")]
        self.assertEqual(set(state["completed"]), {"a", "b"})
        self.assertEqual(state["inflight"], {})
        self.assertEqual(len(events), 2)
        self.assertLess(max(e["started_at"] for e in events),
                        min(e["finished_at"] for e in events))

    def test_clean_git_sha_is_verified(self):
        result = cycle(self.config, self.state, self.runner)
        self.assertRegex(result["events"][0]["repo_sha"], r"^[0-9a-f]{40}$")
        self.assertTrue(result["events"][0]["repo_sha_verified"])
        self.assertEqual(result["events"][0]["pid_kind"], "controller")

    def test_dirty_git_checkout_never_attests_clean_sha(self):
        root = Path(self.tmp.name)
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.email", "qa@localhost"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.name", "Isolated QA"], cwd=root, check=True)
        tracked = root / "tracked.txt"
        tracked.write_text("clean", encoding="utf-8")
        subprocess.run(["git", "add", "tracked.txt"], cwd=root, check=True)
        subprocess.run(["git", "commit", "-qm", "fixture"], cwd=root, check=True)
        self.state = root / ".git" / "worker-state.json"
        tracked.write_text("dirty", encoding="utf-8")
        result = cycle(self.config, self.state, self.runner)
        self.assertEqual(result["completed"], [])
        self.assertEqual(result["events"], [])
        self.assertEqual(self.calls, [])

    def test_checkout_drift_during_execution_blocks_completion(self):
        root = Path(self.tmp.name)
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.email", "qa@localhost"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.name", "Isolated QA"], cwd=root, check=True)
        tracked = root / "tracked.txt"
        tracked.write_text("clean", encoding="utf-8")
        subprocess.run(["git", "add", "tracked.txt"], cwd=root, check=True)
        subprocess.run(["git", "commit", "-qm", "fixture"], cwd=root, check=True)
        self.state = root / ".git" / "worker-state.json"
        def mutate_during_run(*args, **kwargs):
            tracked.write_text("changed", encoding="utf-8")
            return SimpleNamespace(returncode=0, stdout="passed", stderr="")
        result = cycle(self.config, self.state, mutate_during_run)
        self.assertEqual(result["completed"], [])
        self.assertIn("a", result["failed"])
        self.assertEqual(result["events"][0]["detail"], "workspace-SHA-or-cleanliness-drift")

    def test_git_worktree_state_path_is_rejected(self):
        root = Path(self.tmp.name)
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.email", "qa@localhost"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.name", "Isolated QA"], cwd=root, check=True)
        (root / "tracked.txt").write_text("clean", encoding="utf-8")
        subprocess.run(["git", "add", "tracked.txt"], cwd=root, check=True)
        subprocess.run(["git", "commit", "-qm", "fixture"], cwd=root, check=True)
        self.state = root / "worker-state.json"
        with self.assertRaisesRegex(ValueError, "worker-state-must-be-outside"):
            cycle(self.config, self.state, self.runner)

    def test_non_git_workspace_cannot_execute_or_claim_success(self):
        import shutil
        shutil.rmtree(Path(self.tmp.name) / ".git")
        result = cycle(self.config, self.state, self.runner)
        self.assertEqual(result["completed"], [])
        self.assertEqual(result["events"], [])
        self.assertEqual(self.calls, [])

    def test_source_commit_change_rechecks_tasks_not_old_success(self):
        root = Path(self.tmp.name)
        first = cycle(self.config, self.state, self.runner)
        old_sha = first["events"][0]["repo_sha"]
        (root / "source.txt").write_text("next generation", encoding="utf-8")
        subprocess.run(["git", "add", "source.txt"], cwd=root, check=True)
        subprocess.run(["git", "commit", "-qm", "new generation"], cwd=root, check=True)
        second = cycle(self.config, self.state, self.runner)
        self.assertEqual(second["completed"], ["a"])
        self.assertEqual(len(second["events"]), 2)
        self.assertNotEqual(second["events"][1]["repo_sha"], old_sha)
        self.assertEqual(len(self.calls), 2)

    def test_dirty_checkout_masks_historic_completed_without_running(self):
        first = cycle(self.config, self.state, self.runner)
        self.assertEqual(first["completed"], ["a"])
        (Path(self.tmp.name) / "source.txt").write_text("dirty", encoding="utf-8")
        second = cycle(self.config, self.state, self.runner)
        self.assertEqual(second["completed"], [])
        self.assertFalse(second["workspace_verified"])
        self.assertEqual(len(self.calls), 1)
        # The receipt remains on disk for audit, not a claim of current success.
        saved = json.loads(self.state.read_text(encoding="utf-8"))
        self.assertEqual(saved["completed"], ["a"])

    def test_new_commit_with_no_agents_masks_prior_generation(self):
        first = cycle(self.config, self.state, self.runner)
        self.assertEqual(first["completed"], ["a"])
        root = Path(self.tmp.name)
        (root / "source.txt").write_text("new SHA", encoding="utf-8")
        subprocess.run(["git", "add", "source.txt"], cwd=root, check=True)
        subprocess.run(["git", "commit", "-qm", "new generation"], cwd=root, check=True)
        self.config["agents"] = []
        second = cycle(self.config, self.state, self.runner)
        self.assertEqual(second["completed"], [])
        self.assertFalse(second["source_generation_verified"])
        self.assertEqual(len(self.calls), 1)

    def test_zero_parallel_limit_holds_all_tasks(self):
        self.config["max_parallel"] = 0
        self.assertEqual(cycle(self.config, self.state, self.runner)["completed"], [])
        self.assertEqual(self.calls, [])

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
