# Continuous development handoff contract

Issue: https://github.com/Satofumi-Goto/Satofumi-Goto.github.io/issues/89

## Goal
Prevent a single execution ending from being mistaken for completion of an unfinished case. The existing hourly development orchestrator is the only periodic coordinator; do not create duplicate scheduled jobs.

## On every run
1. Read the current orchestrator policy and obey release freeze, quota, permission and spending gates.
2. Read cross-repository CLAIM index Issue #74, original case Issues, and the previous checkpoint.
3. Verify actual agent identity and current workspace availability. Slots and comments are not proof of a running agent.
4. Choose an actionable case without an existing conflicting owner or file edit.
5. Perform a concrete permitted operation; if blocked, switch to a different safe case.
6. Before ending, persist the checkpoint below in the original Issue and link it from the cross-repository index.
7. On the next run, resume from the last verified checkpoint. Never mark a case complete merely because a PR was opened or a run finished.

## Checkpoint schema
```json
{
  "case_id": "repository#issue",
  "repo": "owner/name",
  "issue": 0,
  "pr": null,
  "agent_id": null,
  "verified_agent_run_id": null,
  "base_sha": null,
  "head_sha": null,
  "status": "blocked",
  "changed_files": [],
  "action_evidence": [],
  "blocker": null,
  "next_action": null,
  "handoff_to": null,
  "updated_at": null
}
```

## Recovery and acceptance
- Mark an agent stalled only after its expected execution cadence has elapsed and its last real execution log is inspected.
- If an authenticated execution API is available, resume the agent with its checkpoint; otherwise record `resume_api_unavailable` and offer the case to an independently verified active agent.
- Never impersonate an agent, fabricate CLAIMs, override branch protection, rerun quota-blocked CI, or force production deployment.
- Validate at least two consecutive scheduled coordinator runs that retrieve an unfinished checkpoint and either advance the case or perform an evidenced safe handoff.
- Independently verify that the receiving agent actually executed. Issue comments alone are not proof of execution.
- Keep Issue #89 open until stop detection, real resume/handoff, and the two-run acceptance test are demonstrated.

## Known limitation
A GitHub issue or an automation prompt cannot by itself restart a separate Codex thread. The authenticated thread/execution API and environment identity must be connected and tested before claiming automatic restart is implemented.
