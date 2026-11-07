#!/usr/bin/env python3
"""Read-only Seneschal project inventory and dynamic capacity planner.

Requires Python 3.10+ and GITHUB_TOKEN with read access to selected repos.
Does not start agents, write CLAIMs, merge, deploy, or expose token values.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_REPOS = (
    "Satofumi-Goto/seneschal",
    "Satofumi-Goto/federation-portal",
    "Satofumi-Goto/mobility-business-lab",
    "Satofumi-Goto/life-transaction-console",
    "Satofumi-Goto/fleet-operations-console",
    "Satofumi-Goto/service-hub-console",
    "Satofumi-Goto/urban-operation-console",
    "Satofumi-Goto/Satofumi-Goto.github.io",
)
PRIORITY = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
AI_TYPES = ("python", "gemini", "chat", "codex", "claude")
COORDINATION_REPO = "Satofumi-Goto/Satofumi-Goto.github.io"
REPO_NAME = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


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


def pages(path, token, limit=100):
    result = []
    for page in range(1, limit + 1):
        separator = "&" if "?" in path else "?"
        batch = fetch(path + separator + "per_page=100&page=" + str(page), token)
        if not isinstance(batch, list):
            raise ValueError("Expected list from GitHub")
        result.extend(batch)
        if len(batch) < 100:
            break
    else:
        raise RuntimeError("Pagination limit reached; refusing incomplete inventory")
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


def coordination_inbox(token):
    """Read both shared issue threads; never turn a comment into an executable task.

    #92 is the request inbox. #74 is the CLAIM source, but a comment count is
    NOT a verified lock or proof of agent execution. Another authenticated
    component must reconcile live owners/files before dispatch.
    """
    intake = pages("repos/" + COORDINATION_REPO + "/issues/92/comments", token)
    claims = pages("repos/" + COORDINATION_REPO + "/issues/74/comments", token)
    requests = []
    for row in intake:
        if not isinstance(row, dict):
            raise ValueError("invalid-intake-comment")
        ident = row.get("id")
        if type(ident) is not int or ident < 1:
            raise ValueError("invalid-intake-id")
        author = row.get("user") or {}
        if not isinstance(author, dict):
            raise ValueError("invalid-intake-author")
        title = str(row.get("body") or "").splitlines()
        requests.append({
            "id": ident,
            "url": "https://github.com/" + COORDINATION_REPO +
                   "/issues/92#issuecomment-" + str(ident),
            "author": str(author.get("login") or "unknown")[:80],
            "summary": (title[0].strip() if title else "")[:120],
            "created_at": row.get("created_at"),
            "triage_state": "unreviewed",
            "execution_authorized": False,
        })
    return {
        "claim_source": "https://github.com/" + COORDINATION_REPO + "/issues/74",
        "claim_comments_seen": len(claims),
        "claim_file_ownership_verified": False,
        "intake_source": "https://github.com/" + COORDINATION_REPO + "/issues/92",
        "intake_comments_seen": len(intake),
        "intake_requests": requests,
    }


def plan(records, connectors, budget):
    """Suggest capacity only; connector file booleans are untrusted operator claims."""
    if not isinstance(connectors, dict) or any(k not in AI_TYPES or not isinstance(v, dict) for k, v in connectors.items()):
        raise ValueError("invalid-connector-capabilities")
    if type(budget) is not int or not 0 <= budget <= 100:
        raise ValueError("invalid-worker-budget")
    pending = sorted(records, key=lambda r: (PRIORITY[r["priority"]], r["repo"], r["number"]))
    # These booleans arrive from an operator-supplied JSON file, not a live heartbeat API.
    # They can guide a proposal but cannot certify an executing worker.
    active = [k for k, v in connectors.items() if v.get("authenticated") and v.get("executable") and v.get("verified_by_runtime") and v.get("heartbeat_ok")]
    # Conservative: one proposed worker per distinct repository, bounded by authenticated
    # connectors and explicit budget; no fixed ten-person target.
    eligible = {r["repo"] for r in pending if r["priority"] in ("P0", "P1")}
    slots = min(len(eligible), len(active), max(0, budget))
    return {
        "proposed_parallel_workers": slots,
        "operator_claimed_capability_types": active,
        "connector_attestation": "not_verified_by_this_inventory",
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
    if any(not REPO_NAME.fullmatch(repo) or ".." in repo for repo in args.repos):
        ap.error("Invalid repository name")
    if not 0 <= args.max_workers <= 100:
        ap.error("Invalid worker budget")
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        ap.error("GITHUB_TOKEN is required (read-only scope)")
    connectors = {}
    if args.connectors:
        with open(args.connectors, encoding="utf-8") as stream:
            connectors = json.load(stream)
        if not isinstance(connectors, dict) or any(k not in AI_TYPES or not isinstance(v, dict) for k, v in connectors.items()):
            ap.error("Invalid connector capabilities")
    report = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": "live_github_readonly",
        "repos": args.repos,
    }
    try:
        report["cases"] = inventory(args.repos, token)
        report["coordination"] = coordination_inbox(token)
    except (urllib.error.URLError, KeyError, ValueError, RuntimeError) as exc:
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
