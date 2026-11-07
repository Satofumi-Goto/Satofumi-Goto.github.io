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
        # Only Codex declares the four required capability flags; Claude is not verified.
        self.assertEqual(mod.plan(cases, connectors, 10)["proposed_parallel_workers"], 1)
        self.assertEqual(mod.plan(cases, connectors, 10)["operator_claimed_capability_types"], ["codex"])
        self.assertEqual(mod.plan(cases, connectors, 10)["connector_attestation"], "not_verified_by_this_inventory")
        self.assertEqual(mod.plan(cases, connectors, 10)["workers_actually_running"], "not_verified")
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

    def test_coordination_inbox_collects_pages_without_auto_dispatch(self):
        from unittest.mock import patch
        samples = {
            "issues/92/comments": [
                {"id": 42, "user": {"login": "Satofumi-Goto"},
                 "body": "<unsafe>" + "x" * 200, "created_at": "2026-11-07T00:00:00Z"},
                {"id": 43, "user": {"login": "unknown"},
                 "body": "Another request", "created_at": "2026-11-07T01:00:00Z"},
            ],
            "issues/74/comments": [{"id": 30}],
        }
        def fake_pages(path, token):
            return next(rows for marker, rows in samples.items() if marker in path)
        with patch.object(mod, "pages", side_effect=fake_pages) as mock:
            result = mod.coordination_inbox("dummy")
        self.assertEqual(mock.call_count, 2)
        self.assertEqual(result["intake_comments_seen"], 2)
        self.assertEqual(result["claim_comments_seen"], 1)
        self.assertFalse(result["claim_file_ownership_verified"])
        self.assertEqual(result["intake_requests"][0]["triage_state"], "unreviewed")
        self.assertFalse(result["intake_requests"][0]["execution_authorized"])
        self.assertEqual(len(result["intake_requests"][0]["summary"]), 120)
        self.assertEqual(result["intake_requests"][1]["author"], "unknown")

    def test_coordination_inbox_invalid_id_fails_closed(self):
        from unittest.mock import patch
        with patch.object(mod, "pages", side_effect=[
                [{"id": "not-an-int", "user": {}, "body": "hello"}], []]):
            with self.assertRaisesRegex(ValueError, "invalid-intake-id"):
                mod.coordination_inbox("dummy")

    def test_no_fake_running_agents(self):
        self.assertEqual(mod.plan([], {}, 5)["workers_actually_running"], "not_verified")


if __name__ == "__main__":
    unittest.main()
