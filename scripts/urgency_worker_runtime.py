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

def _read_state(path):
    p = Path(path)
    if not p.exists():
        return {"completed": [], "failed": [], "events": [], "attempts": {}, "inflight": {}}
    state = json.loads(p.read_text(encoding="utf-8"))
    for key, initial in (("completed", []), ("failed", []), ("events", []),
                         ("attempts", {}), ("inflight", {})):
        state.setdefault(key, initial)
    return state


def _locked_update(state_path, mutate):
    """Lock only a claim/commit transaction, never the expensive subprocess."""
    path = Path(state_path)
    lock_path = Path(str(path) + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            state = _read_state(path)
            result = mutate(state)
            save(path, state)
            return result
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _alive(pid):
    if type(pid) is not int or pid <= 0:
        return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _claim(config, state_path, agent, max_attempts):
    def mutate(state):
        now = time.time()
        # Abandoned leases are recovered only if the same host proves the
        # originating controller PID has exited; otherwise remain HOLD.
        for task_id, old in list(state["inflight"].items()):
            if (old.get("host") == os.uname().nodename
                and now - old.get("started_at", now) > 300
                and not _alive(old.get("controller_pid"))):
                state["events"].append({"task": task_id, "success": False,
                    "reason": "abandoned-lease-recovered", "at": now})
                del state["inflight"][task_id]
        occupied = set(config.get("reserved_files", []))
        for old in state["inflight"].values():
            occupied.update(old["files"])
        if any(old["agent"] == agent["id"] for old in state["inflight"].values()):
            return None
        for task in sorted(config["tasks"], key=lambda t: (-t.get("priority", 0), t["id"])):
            files = task.get("files", [])
            if not isinstance(files, list) or not files or any(
                    not isinstance(x, str) or not x or x.startswith("/")
                    or ".." in Path(x).parts for x in files):
                continue
            task_id = task["id"]
            if (task_id in state["completed"] or task_id in state["inflight"]
                or state["attempts"].get(task_id, 0) >= max_attempts
                or set(files) & occupied or task.get("blocked")
                or task.get("claimed_by") not in (None, agent["id"])
                or task.get("kind") not in COMMANDS):
                continue
            token = f"{os.getpid()}:{time.time_ns()}:{task_id}"
            state["inflight"][task_id] = {"token": token, "agent": agent["id"],
                "files": sorted(set(files)), "controller_pid": os.getpid(),
                "host": os.uname().nodename, "started_at": now}
            state["attempts"][task_id] = state["attempts"].get(task_id, 0) + 1
            return {"task": task, "token": token,
                    "attempt": state["attempts"][task_id], "started_at": now}
        return None
    return _locked_update(state_path, mutate)


def _commit(state_path, agent, claim, result):
    def mutate(state):
        task = claim["task"]
        task_id = task["id"]
        holder = state["inflight"].get(task_id)
        if not holder or holder["token"] != claim["token"]:
            state["events"].append({"task": task_id, "success": False,
                "reason": "claim-token-changed-no-commit", "at": time.time()})
            return
        state["inflight"].pop(task_id)
        ok, detail, exit_code = result
        if ok:
            if task_id not in state["completed"]:
                state["completed"].append(task_id)
            if task_id in state["failed"]:
                state["failed"].remove(task_id)
        elif task_id not in state["failed"]:
            state["failed"].append(task_id)
        command = COMMANDS[task["kind"]]
        workspace = str(Path(holder.get("workspace", ".")).resolve())
        state["events"].append({"agent": agent["id"], "task": task_id,
            "success": ok, "detail": detail, "pid": os.getpid(),
            "pid_kind": "controller", "started_at": claim["started_at"],
            "finished_at": time.time(), "exit_code": exit_code,
            "attempt": claim["attempt"], "workspace": workspace,
            "command_sha256": hashlib.sha256(repr(command).encode()).hexdigest(),
            "claim_token": claim["token"]})
    _locked_update(state_path, mutate)


def cycle(config, state_path, runner=subprocess.run):
    """One bounded task per eligible local Python executor, in true parallel across processes."""
    if not isinstance(config.get("agents"), list) or not isinstance(config.get("tasks"), list):
        raise ValueError("agents/tasks must be lists")
    limit = config.get("max_attempts", 1)
    if type(limit) is not int or not 1 <= limit <= 5:
        raise ValueError("max_attempts must be 1..5")
    if not isinstance(config.get("workspace"), str):
        raise ValueError("workspace path required")
    if not isinstance(config.get("reserved_files", []), list):
        raise ValueError("reserved_files must be a list")
    for agent in config["agents"]:
        if (agent.get("model") != "python" or not agent.get("connected")
            or not agent.get("authenticated") or agent.get("busy")
            or not agent.get("runtime_verified", False)):
            continue
        claim = _claim(config, state_path, agent, limit)
        if not claim:
            continue
        task = claim["task"]
        try:
            completed = runner(COMMANDS[task["kind"]], cwd=config["workspace"],
                               timeout=120, capture_output=True, text=True, check=False)
            exit_code = completed.returncode
            ok = exit_code == 0
            detail = (str(completed.stdout or "") + str(completed.stderr or ""))[-3000:]
        except (OSError, subprocess.TimeoutExpired) as exc:
            ok, detail, exit_code = False, str(exc), None
        _commit(state_path, agent, claim, (ok, detail, exit_code))
    return _read_state(state_path)


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
