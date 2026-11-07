# Seneschal project Python orchestration — phase 1

This module inventories **all open Issues and PRs** from the configured Seneschal project repositories, including current GitHub main SHAs. It assigns provisional urgency from labels and suggests variable concurrency based on **operator-declared (unverified)** connector capabilities, distinct urgent repositories, and an explicit worker budget.

It does **not** claim that ten agents exist or are running. It does not start Gemini, Chat, Codex, or Claude; no authenticated execution adapters are connected yet. It never writes GitHub CLAIMs, merges PRs, invokes Actions, or publishes Base44. Before any dispatch, reconcile each case with [the canonical CLAIM index](https://github.com/Satofumi-Goto/Satofumi-Goto.github.io/issues/74) and file ownership.

## Run

```bash
export GITHUB_TOKEN="..."  # read-only GitHub access; do not commit this token
python3 scripts/orchestration/project_inventory.py --output project-inventory.json
python3 -m unittest discover -s scripts/orchestration -p 'test_*.py'
```

To specify more product repositories, use `--repos owner/repo ...`. A connector file may contain `{"codex":{"authenticated":true,"executable":true,"verified_by_runtime":true,"heartbeat_ok":true}}`, but this is still an **operator assertion, not a live verification**. Do not mark these fields true without independently captured connector/session and heartbeat evidence. Without the four true flags, proposed workers are zero. `--max-workers` is a resource budget, **not** a fixed headcount.

## Shared GitHub coordination (read-only)

The output includes `coordination`: every accessible comment from [request intake #92](https://github.com/Satofumi-Goto/Satofumi-Goto.github.io/issues/92) and the number of comments inspected in the canonical [CLAIM index #74](https://github.com/Satofumi-Goto/Satofumi-Goto.github.io/issues/74). Only a 120-character first line is included for each request; the comment ID and GitHub URL preserve traceability without copying full private instructions. Intake comments are always `unreviewed` and `execution_authorized=false`. A CLAIM comment count is **not** a lock or verified file owner. Dispatch requires a separately authenticated CLAIM reconciler. If pagination fails, the command exits without presenting a partial inventory as complete.

## Required phase 2 before unattended execution

1. Verify actual app inventory (10 apps may be served from fewer repositories), Base44/independent runtime identities, and all live CLAIMs.
2. Connect real authenticated Python dispatch adapters for Gemini/Chat/Codex/Claude, with heartbeat, receipts, rate and spend limits.
3. Implement dependency and file-level collision graph, review and required-check gates, checkpoint handoff and failure handling.
4. Publish readiness must be evaluated separately for each app. Owner-only Publish/Deploy remains protected.

**Release state: HOLD** until independent review, CI and real end-to-end tests.

Pagination is fail-closed: a full final page at the 100-page safety cap raises an error rather than silently omitting cases. The inventory is a read-only snapshot, not a lock or exhaustive proof of active workers.
