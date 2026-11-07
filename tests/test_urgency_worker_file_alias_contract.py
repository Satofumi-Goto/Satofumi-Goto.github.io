"""Regression contracts: per-file CLAIMs must resolve equivalent workspace paths.

QA-only tests for the existing worker runtime PR.  They intentionally expose
currently missing path canonicalization; production implementation belongs to
the existing PR #93 lead.  No external APIs, billing, or process execution.
"""
import os
import tempfile
import unittest
from pathlib import Path

from scripts.urgency_worker_runtime import _claim


class WorkerFileAliasContractTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.workspace = Path(self._tmp.name)
        self.state = self.workspace / "claims-state.json"

    def _config(self, first, second=None, reserved=None):
        tasks = [{"id": "first", "priority": 10, "files": [first],
                  "kind": "python-test"}]
        if second is not None:
            tasks.append({"id": "second", "priority": 5, "files": [second],
                          "kind": "python-test"})
        return {"workspace": str(self.workspace), "tasks": tasks,
                "reserved_files": reserved or []}

    def _take(self, config, worker_id):
        return _claim(config, self.state, {"id": worker_id}, max_attempts=1)

    def test_equivalent_relative_paths_cannot_get_parallel_claims(self):
        config = self._config("a.py", "./a.py")
        first = self._take(config, "worker-A")
        self.assertIsNotNone(first)
        self.assertEqual(first["task"]["id"], "first")
        self.assertIsNone(
            self._take(config, "worker-B"),
            "a.py and ./a.py are the same workspace file; second CLAIM must HOLD",
        )

    def test_reserved_relative_alias_blocks_claim(self):
        config = self._config("./a.py", reserved=["a.py"])
        self.assertIsNone(
            self._take(config, "worker-A"),
            "reserved a.py must block the equivalent ./a.py path",
        )

    @unittest.skipUnless(os.name == "posix", "symlink aliases require POSIX")
    def test_symlink_alias_cannot_bypass_file_claim(self):
        (self.workspace / "canonical.py").write_text("# fixture\n", encoding="utf-8")
        (self.workspace / "alias.py").symlink_to(self.workspace / "canonical.py")
        config = self._config("canonical.py", "alias.py")
        self.assertIsNotNone(self._take(config, "worker-A"))
        self.assertIsNone(
            self._take(config, "worker-B"),
            "symlink alias resolves to the same underlying file and must HOLD",
        )

    def test_distinct_files_remain_eligible_for_parallel_claims(self):
        config = self._config("a.py", "b.py")
        first = self._take(config, "worker-A")
        second = self._take(config, "worker-B")
        self.assertEqual(first["task"]["id"], "first")
        self.assertEqual(second["task"]["id"], "second")


if __name__ == "__main__":
    unittest.main()
