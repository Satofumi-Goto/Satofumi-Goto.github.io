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

**Not yet integrated:** the UI urgency slider, authenticated worker adapters, durable distributed file/CLAIM locks, budget telemetry, task completion/retry queue, and live execution. These require separate integration and real-browser/CI validation before any production-ready claim. Existing hourly orchestrator remains the only scheduled coordinator; do not create duplicate recurring jobs.
