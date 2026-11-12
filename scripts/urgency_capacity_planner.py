#!/usr/bin/env python3
"""Stdlib-only, fail-closed capacity planner. Does not launch agents."""
import argparse
import json

def plan(data):
    urgency = data.get("urgency", 0)
    if type(urgency) is not int or not 0 <= urgency <= 100:
        raise ValueError("urgency must be 0..100")
    budget = data.get("approved_paid_budget", 0)
    spent = data.get("paid_spent", 0)
    if any(type(v) not in (int, float) or v < 0 for v in (budget, spent)):
        raise ValueError("invalid paid budget")
    agents = data.get("agents", [])
    tasks = data.get("tasks", [])
    if len({a["id"] for a in agents}) != len(agents) or len({t["id"] for t in tasks}) != len(tasks):
        raise ValueError("duplicate IDs")
    maximum = data.get("max_parallel", len(agents))
    if type(maximum) is not int or maximum < 0:
        raise ValueError("invalid max_parallel")
    paid_slots = 0 if urgency < 35 else (1 if urgency < 75 else maximum)
    remaining = max(0, budget - spent)
    assignments, occupied, selected = [], set(), set()
    # Existing CLAIMs are hard locks even when their owner is not in this cycle.
    reserved = set(data.get("reserved_files", []))
    if any(not isinstance(f, str) or not f for f in reserved):
        raise ValueError("invalid reserved_files")
    occupied |= reserved
    for agent in sorted(agents, key=lambda a: (a.get("estimated_cost", 0), a["id"])):
        if len(assignments) >= maximum:
            break
        if not agent.get("connected") or not agent.get("authenticated") or agent.get("busy"):
            continue
        model = agent.get("model")
        if model not in ("python", "gemini", "chatgpt", "claude"):
            continue
        cost = agent.get("estimated_cost", 0)
        if type(cost) not in (int, float) or cost < 0:
            continue
        if model != "python" and (not data.get("paid_execution_approved") or paid_slots == 0 or cost <= 0 or cost > remaining):
            continue
        for task in sorted(tasks, key=lambda t: (-t.get("priority", 0), t["id"])):
            if task.get("priority", 0) not in range(0, 101):
                raise ValueError("priority must be 0..100")
            files = set(task.get("files", []))
            if (task["id"] in selected or task.get("blocked") or not files or files & occupied
                or task.get("claimed_by") not in (None, agent["id"])
                or model not in task.get("allowed_models", ("python", "gemini", "chatgpt", "claude"))):
                continue
            assignments.append({"agent": agent["id"], "model": model, "task": task["id"], "files": sorted(files)})
            occupied |= files
            selected.add(task["id"])
            if model != "python":
                remaining -= cost
                paid_slots -= 1
            break
    return {"urgency": urgency, "assignments": assignments, "active_count": len(assignments),
            "unassigned_tasks": [t["id"] for t in tasks if t["id"] not in selected],
            "estimated_additional_paid_cost": round(max(0, budget - spent) - remaining, 6),
            "launch_performed": False}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    args = parser.parse_args()
    with open(args.input, encoding="utf-8") as f:
        print(json.dumps(plan(json.load(f)), ensure_ascii=False, indent=2))
