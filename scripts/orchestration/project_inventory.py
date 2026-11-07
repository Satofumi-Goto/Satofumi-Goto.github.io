#!/usr/bin/env python3
"""Read-only Seneschal project inventory and dynamic capacity planner.

Requires Python 3.10+ and GITHUB_TOKEN with read access to selected repos.
Does not start agents, write CLAIMs, merge, deploy, or expose token values.
"""
import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_REPOS = (
    "Satofumi-Goto/seneschal",
    "Satofumi-Goto/federation-portal",
    "Satofumi-Goto/mobility-business-lab",
    "Satofumi-Goto/activity-console",
    "Satofumi-Goto/fleet-operations-console",
    "Satofumi-Goto/service-hub-console",
    "Satofumi-Goto/urban-operation-console",
    "Satofumi-Goto/Satofumi-Goto.github.io",
)
PRIORITY = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
AI_TYPES = ("python", "gemini", "chat", "codex", "claude")


def fetch(path, token):
    req = urllib.request.Request(
        "https://api.github.com/" + path.lstrip("/"),
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + token,
            "User-Agent": "seneschal-readonly-orchestrator",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)


def pages(path, token, limit=4):
    result = []
    for page in range(1, limit + 1):
        separator = "&" if "?" in path else "?"
        batch = fetch(path + separator + "per_page=100&page=" + str(page), token)
        if not isinstance(batch, list):
            raise ValueError("Expected list from GitHub")
        result.extend(batch)
        if len(batch) < 100:
            break
    return result


def urgency(item):
    labels = [x["name"].lower() for x in item.get("labels", [])]
    for p in PRIORITY:
        if p.lower() in labels or any(x.startswith(p.lower() + ":") for x in labels):
            return p
    if any(x in labels for x in ("blocker", "critical", "security")):
        return "P0"
    if any(x in labels for x in ("bug", "release", "publish")):
        return "P1"
    return "P2"


def inventory(repos, token):
    records = []
    for repo in repos:
        branch = fetch("repos/" + repo + "/branches/main", token)
        head = branch["commit"]["sha"]
        issues = pages("repos/" + repo + "/issues?state=open", token)
        for item in issues:
            is_pr = "pull_request" in item
            records.append({
                "repo": repo, "number": item["number"],
                "kind": "pr" if is_pr else "issue",
                "title": item["title"], "url": item["html_url"],
                "priority": urgency(item), "main_sha": head,
                "assignee": (item.get("assignee") or {}).get("login"),
                "labels": [x["name"] for x in item.get("labels", [])],
                "state": "open",
                "claim_verified": False,
                "ci_verified": False,
                "review_verified": False,
                "publish_ready": False,
            })
    return records


def plan(records, connectors, budget):
    """Suggest capacity only. Never count unverified connectors as running."""
    pending = sorted(records, key=lambda r: (PRIORITY[r["priority"]], r["repo"], r["number"]))
    active = [k for k, v in connectors.items() if v.get("authenticated") and v.get("executable")]
    # Conservative: one proposed worker per distinct repository, bounded by authenticated
    # connectors and explicit budget; no fixed ten-person target.
    eligible = {r["repo"] for r in pending if r["priority"] in ("P0", "P1")}
    slots = min(len(eligible), len(active), max(0, budget))
    return {
        "proposed_parallel_workers": slots,
        "available_verified_connector_types": active,
        "workers_actually_running": "not_verified",
        "reason": "Capacity suggestion only; CLAIM/file ownership and dependencies must be checked before dispatch",
        "next_cases": pending[:20],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repos", nargs="+", default=list(DEFAULT_REPOS))
    ap.add_argument("--connectors", help="Local JSON file of verified connector capabilities")
    ap.add_argument("--max-workers", type=int, default=4)
    ap.add_argument("--output", default="-")
    args = ap.parse_args()
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        ap.error("GITHUB_TOKEN is required (read-only scope)")
    connectors = {}
    if args.connectors:
        with open(args.connectors, encoding="utf-8") as stream:
            connectors = json.load(stream)
        if not isinstance(connectors, dict) or any(k not in AI_TYPES for k in connectors):
            ap.error("Invalid connector capabilities")
    report = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": "live_github_readonly",
        "repos": args.repos,
    }
    try:
        report["cases"] = inventory(args.repos, token)
    except (urllib.error.URLError, KeyError, ValueError) as exc:
        print("GitHub inventory failed: " + type(exc).__name__, file=sys.stderr)
        return 2
    report["plan"] = plan(report["cases"], connectors, args.max_workers)
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output == "-":
        print(output)
    else:
        with open(args.output, "w", encoding="utf-8") as stream:
            stream.write(output + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
