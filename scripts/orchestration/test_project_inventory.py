import importlib.util
import pathlib
import unittest

PATH = pathlib.Path(__file__).with_name("project_inventory.py")
spec = importlib.util.spec_from_file_location("project_inventory", PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class InventoryTests(unittest.TestCase):
    def test_priority(self):
        self.assertEqual(mod.urgency({"labels": [{"name": "P0"}]}), "P0")
        self.assertEqual(mod.urgency({"labels": [{"name": "bug"}]}), "P1")
        self.assertEqual(mod.urgency({"labels": []}), "P2")

    def test_dynamic_not_fixed_ten(self):
        cases = [{"repo": "r1", "number": 1, "priority": "P0"},
                 {"repo": "r2", "number": 2, "priority": "P1"}]
        connectors = {"codex": {"authenticated": True, "executable": True, "verified_by_runtime": True, "heartbeat_ok": True},
                      "claude": {"authenticated": True, "executable": True},
                      "gemini": {"authenticated": False, "executable": True}}
        self.assertEqual(mod.plan(cases, connectors, 10)["proposed_parallel_workers"], 2)
        self.assertEqual(mod.plan(cases, connectors, 1)["proposed_parallel_workers"], 1)
        self.assertEqual(mod.plan(cases, {}, 10)["proposed_parallel_workers"], 0)

    def test_unverified_connectors_never_allocate(self):
        cases = [{"repo": "r1", "number": 1, "priority": "P0"}]
        claimed = {"codex": {"authenticated": True, "executable": True}}
        self.assertEqual(mod.plan(cases, claimed, 4)["proposed_parallel_workers"], 0)

    def test_pagination_never_silently_truncates(self):
        from unittest.mock import patch
        batch = [{"number": i} for i in range(100)]
        with patch.object(mod, "fetch", return_value=batch):
            with self.assertRaises(RuntimeError):
                mod.pages("repos/example/issues", "dummy", limit=2)

    def test_no_fake_running_agents(self):
        self.assertEqual(mod.plan([], {}, 5)["workers_actually_running"], "not_verified")


if __name__ == "__main__":
    unittest.main()
