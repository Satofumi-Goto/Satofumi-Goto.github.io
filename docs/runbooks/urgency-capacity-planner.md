# Urgency-based capacity planner

This is a **planning-only** Python 3 standard-library component, not a worker launcher.

```bash
python3 scripts/urgency_capacity_planner.py /path/to/input.json
python3 -m unittest discover -s tests -p 'test_urgency_capacity_planner.py'
```

Example input:

```json
{
  "urgency": 90,
  "max_parallel": 3,
  "approved_paid_budget": 0,
  "paid_spent": 0,
  "paid_execution_approved": false,
  "reserved_files": ["src/Map.jsx"],
  "agents": [
    {"id":"python-local-1","model":"python","connected":true,"authenticated":true},
    {"id":"claude-1","model":"claude","connected":false,"authenticated":false,"estimated_cost":1}
  ],
  "tasks": [
    {"id":"map-review","priority":100,"files":["src/Map.jsx"]},
    {"id":"calendar-test","priority":80,"files":["tests/calendar.test.js"]}
  ]
}
```

The planner will assign only `calendar-test` to the verified Python worker. An externally reserved file is never assigned. No paid model is invoked without approval and remaining budget. The program never claims a worker has actually started; output includes `launch_performed: false`.

**Input UI:** open `progress-board/urgency-capacity.html` in a browser. The slider generates a downloadable JSON input for this script. It does not start work or call an AI provider.\n\n**Not yet integrated:** authenticated worker adapters, durable distributed file/CLAIM locks, budget telemetry, task completion/retry queue, and live execution. These require separate integration and real-browser/CI validation before any production-ready claim. Existing hourly orchestrator remains the only scheduled coordinator; do not create duplicate recurring jobs.

## Bounded Python execution

The optional `scripts/urgency_worker_runtime.py` now **executes** allowlisted local `python3 -m unittest discover` jobs, records outcomes atomically, and assigns the next uncompleted non-conflicting task in the next cycle. It does not execute arbitrary task commands or invoke Gemini, ChatGPT, or Claude. Example:

```bash
python3 scripts/urgency_worker_runtime.py urgency-plan-input.json --state /tmp/urgency-worker-state.json --cycles 3 --interval 1
python3 -m unittest discover -s tests -p 'test_urgency_worker_runtime.py'
```

Input must include an explicit `workspace` directory, verified `agents`, and tasks with `kind: "python-test"`. A `connected: true` field is **caller-supplied**, not proof of a real agent connection. Do not use untrusted input as an authorization source. The state file is local only, not a distributed lease. This bounded runner is not an always-on service, and it cannot keep ten independently authenticated AI agents working. Before production use, add verified credential adapters, durable distributed leases, per-worker budget enforcement, task-specific safe executors, and a supervised runtime.
