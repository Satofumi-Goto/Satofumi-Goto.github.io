"""Bounded local Python executor: verified workers, persistent results, no paid API."""
import json, os, subprocess, tempfile, time, hashlib, sys, fcntl
from pathlib import Path

COMMANDS = {"python-test": [sys.executable, "-m", "unittest", "discover"]}

def save(path, state):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, encoding="utf-8", delete=False) as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
        tmp = f.name
    os.replace(tmp, path)

def cycle(config, state_path, runner=subprocess.run):
    # Fail closed on non-POSIX hosts. The lock spans execution and state commit.
    lock_path = Path(str(state_path) + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            return _cycle_locked(config, state_path, runner)
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

def _cycle_locked(config, state_path, runner=subprocess.run):
    if not isinstance(config.get("agents"), list) or not isinstance(config.get("tasks"), list):
        raise ValueError("agents/tasks must be lists")
    path = Path(state_path)
    state = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"completed": [], "failed": [], "events": [], "attempts": {}}
    state.setdefault("attempts", {})
    max_attempts = config.get("max_attempts", 1)
    if type(max_attempts) is not int or not 1 <= max_attempts <= 5:
        raise ValueError("max_attempts must be 1..5")
    occupied = set(config.get("reserved_files", []))
    selected = set()
    for agent in config["agents"]:
        if agent.get("model") != "python" or not agent.get("connected") or not agent.get("authenticated") or agent.get("busy") or not agent.get("runtime_verified", False):
            continue
        for task in sorted(config["tasks"], key=lambda t: (-t.get("priority", 0), t["id"])):
            files = set(task.get("files", []))
            if (task["id"] in state["completed"] or task["id"] in state["failed"] or task["id"] in selected
                or state["attempts"].get(task["id"], 0) >= max_attempts
                or not files or files & occupied or task.get("blocked")
                or task.get("claimed_by") not in (None, agent["id"]) or task.get("kind") not in COMMANDS):
                continue
            selected.add(task["id"])
            occupied |= files
            started_at = time.time()
            try:
                result = runner(COMMANDS[task["kind"]], cwd=config["workspace"], timeout=120,
                                capture_output=True, text=True, check=False)
                ok = result.returncode == 0
                exit_code = result.returncode
                detail = (result.stdout + result.stderr)[-3000:]
            except (OSError, subprocess.TimeoutExpired) as exc:
                ok, detail, exit_code = False, str(exc), None
            state["attempts"][task["id"]] = state["attempts"].get(task["id"], 0) + 1
            if ok:
                state["completed"].append(task["id"])
                if task["id"] in state["failed"]: state["failed"].remove(task["id"])
            elif task["id"] not in state["failed"]:
                state["failed"].append(task["id"])
            state["events"].append({"agent": agent["id"], "task": task["id"], "success": ok, "detail": detail,
                "pid": os.getpid(), "started_at": started_at, "finished_at": time.time(),
                "exit_code": exit_code, "attempt": state["attempts"][task["id"]],
                "workspace": str(Path(config["workspace"]).resolve()),
                "command_sha256": hashlib.sha256(repr(COMMANDS[task["kind"]]).encode()).hexdigest()})
            save(path, state)
            break
    return state

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("config")
    parser.add_argument("--state", required=True)
    parser.add_argument("--cycles", type=int, default=1)
    parser.add_argument("--interval", type=float, default=1)
    args = parser.parse_args()
    if not 1 <= args.cycles <= 100 or not 0 <= args.interval <= 3600:
        parser.error("invalid bounded cycles or interval")
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    for n in range(args.cycles):
        print(json.dumps(cycle(config, args.state), ensure_ascii=False))
        if n + 1 < args.cycles:
            time.sleep(args.interval)
