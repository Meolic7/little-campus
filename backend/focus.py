import json
import time
from uuid import uuid4

from . import db
from .providers import ServiceError


def _save(c, state):
    c.execute("INSERT INTO settings(id,payload) VALUES('timer',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", (json.dumps(state),))


def _settle(c, state):
    if state and state["status"] == "running" and time.time() >= state["deadline"]:
        state.update(status="completed", remaining=0)
        if state["phase"] == "focus":
            record = {"id": state["session_id"], "todo_id": state["todo_id"], "seconds": state["focus_minutes"] * 60, "completed": True, "ended_at": state["deadline"], "plant": "sprout"}
            c.execute("INSERT OR IGNORE INTO focus(id,payload) VALUES(?,?)", (record["id"], json.dumps(record)))
        _save(c, state)
    return state


def state():
    with db.connect() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT payload FROM settings WHERE id='timer'").fetchone()
        s = _settle(c, json.loads(row[0]) if row else None)
    return {"timer": s, "server_time": time.time()}


def start(req):
    with db.connect() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT payload FROM settings WHERE id='timer'").fetchone()
        old = _settle(c, json.loads(row[0]) if row else None)
        if old and old["status"] in ("running", "paused"):
            raise ServiceError("已有计时正在进行，请先结束当前计时")
        s = {**req.model_dump(), "session_id": uuid4().hex, "phase": "focus", "status": "running", "remaining": req.focus_minutes * 60, "deadline": time.time() + req.focus_minutes * 60}
        _save(c, s)
    return state()


def action(action):
    with db.connect() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT payload FROM settings WHERE id='timer'").fetchone()
        s = _settle(c, json.loads(row[0]) if row else None)
        if not s:
            raise ServiceError("暂无进行中的计时")
        if action == "pause" and s["status"] == "running":
            s.update(remaining=max(0, s["deadline"] - time.time()), status="paused")
        elif action == "resume" and s["status"] == "paused":
            s.update(deadline=time.time() + s["remaining"], status="running")
        elif action == "stop":
            if s["phase"] == "focus" and s["status"] in ("running", "paused"):
                remaining = max(0, s["deadline"] - time.time()) if s["status"] == "running" else s["remaining"]
                record = {"id": s["session_id"], "todo_id": s["todo_id"], "seconds": round(s["focus_minutes"] * 60 - remaining), "completed": False, "ended_at": time.time(), "plant": None}
                c.execute("INSERT OR IGNORE INTO focus(id,payload) VALUES(?,?)", (record["id"], json.dumps(record)))
            s["status"] = "stopped"
        elif action == "next" and s["status"] == "completed":
            phase = "rest" if s["phase"] == "focus" else "focus"
            duration = s["rest_minutes" if phase == "rest" else "focus_minutes"] * 60
            s.update(phase=phase, status="running", remaining=duration, deadline=time.time() + duration, session_id=uuid4().hex)
        else:
            raise ServiceError("当前计时状态不支持此操作")
        _save(c, s)
    return state()
