import unittest
from scripts.urgency_capacity_planner import plan

class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.data = {
            "urgency": 90, "max_parallel": 3,
            "paid_execution_approved": True, "approved_paid_budget": 2,
            "agents": [
                {"id": "p", "model": "python", "connected": True, "authenticated": True},
                {"id": "g", "model": "gemini", "connected": True, "authenticated": True, "estimated_cost": 1},
                {"id": "c", "model": "claude", "connected": False, "authenticated": True, "estimated_cost": 1}
            ],
            "tasks": [
                {"id": "a", "priority": 3, "files": ["map.js"]},
                {"id": "b", "priority": 2, "files": ["map.js"]},
                {"id": "c", "priority": 1, "files": ["calendar.js"]}
            ]
        }

    def test_no_file_conflict(self):
        result = plan(self.data)
        self.assertEqual(result["active_count"], 2)
        self.assertEqual(result["unassigned_tasks"], ["b"])
        self.assertFalse(result["launch_performed"])

    def test_low_urgency_free_only(self):
        self.data["urgency"] = 10
        self.assertEqual(plan(self.data)["active_count"], 1)

    def test_paid_requires_approval(self):
        self.data["paid_execution_approved"] = False
        self.assertEqual(plan(self.data)["active_count"], 1)

    def test_budget_cap(self):
        self.data["approved_paid_budget"] = 0
        self.assertEqual(plan(self.data)["active_count"], 1)

    def test_claim_lock(self):
        self.data["tasks"][0]["claimed_by"] = "another-worker"
        self.assertNotIn("a", [x["task"] for x in plan(self.data)["assignments"]])

    def test_invalid_urgency(self):
        self.data["urgency"] = 101
        with self.assertRaises(ValueError):
            plan(self.data)

if __name__ == "__main__":
    unittest.main()
