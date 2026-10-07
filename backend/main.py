import asyncio
import json
import mimetypes
import os
import tempfile
from datetime import date
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import db
from . import focus
from . import learning
from . import speech
from .providers import ServiceError, public_settings, save_settings, settings_raw, test_provider, chat
from .schemas import *

app = FastAPI(title="拾光校园 API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"], allow_methods=["*"], allow_headers=["*"], allow_credentials=False)


@app.on_event("startup")
async def startup():
    db.init()
    await speech.startup()


@app.on_event("shutdown")
async def shutdown():
    await speech.shutdown()


def fail(exc):
    if isinstance(exc, HTTPException):
        raise exc
    if isinstance(exc, ServiceError):
        raise HTTPException(400, str(exc))
    raise HTTPException(500, "服务暂时不可用，请稍后重试") from exc


@app.get("/api/health")
def health(): return {"ok": True, "version": app.version}


@app.get("/api/settings")
def settings(): return public_settings()


@app.put("/api/settings")
def update_settings(value: Settings):
    try: return save_settings(value)
    except Exception as exc: fail(exc)


@app.post("/api/settings/test/{kind}")
async def settings_test(kind: str):
    try: return await test_provider(kind)
    except Exception as exc: fail(exc)


@app.get("/api/semesters")
def semesters(): return db.all_rows("semesters")


@app.post("/api/semesters")
def create_semester(value: Semester): return db.put("semesters", value.model_dump(mode="json"))


@app.put("/api/semesters/{ident}")
def edit_semester(ident: str, value: Semester):
    if not db.get("semesters", ident): raise HTTPException(404, "学期不存在")
    value = value.model_dump(mode="json"); value["id"] = ident
    return db.put("semesters", value, ident)


@app.get("/api/courses")
def courses(semester_id: str | None = None):
    return [c for c in db.all_rows("courses") if not semester_id or c["semester_id"] == semester_id]


@app.post("/api/courses")
def create_course(value: Course): return db.put("courses", value.model_dump(mode="json"))


@app.put("/api/courses/{ident}")
def edit_course(ident: str, value: CourseDraft):
    old = db.get("courses", ident)
    if not old: raise HTTPException(404, "课程不存在")
    return db.put("courses", {**old, **value.model_dump(mode="json")}, ident)


@app.delete("/api/courses/{ident}")
def remove_course(ident: str): db.delete("courses", ident); return {"ok": True}


@app.post("/api/timetable/parse")
async def parse_timetable(file: UploadFile | None = File(default=None), pasted: str = Form(default=""), semester_id: str = Form(...)):
    semester = db.get("semesters", semester_id)
    if not semester: raise HTTPException(404, "学期不存在")
    try:
        if file:
            if not file.filename or len(file.filename) > 160: raise ServiceError("文件名无效")
            raw = await file.read()
            if len(raw) > 15 * 1024 * 1024: raise ServiceError("课表文件不能超过 15 MB")
            parts = learning.material(raw, Path(file.filename).name)
        elif pasted.strip(): parts = [{"type": "text", "text": learning.html_text(pasted)}]
        else: raise ServiceError("请上传课表文件或粘贴课表内容")
        return await learning.parse_timetable(parts, semester)
    except Exception as exc: fail(exc)


@app.post("/api/timetable/confirm")
def confirm_timetable(value: ImportConfirm):
    semester = db.get("semesters", value.semester_id)
    if not semester: raise HTTPException(404, "学期不存在")
    review = learning.review_courses(value.courses, semester)
    errors = [r for r in review if r["errors"]]
    warnings = [r for r in review if r["warnings"]]
    if errors or (warnings and not value.accept_conflicts):
        raise HTTPException(409, {"message": "请先修正缺失字段或确认冲突课程", "review": review})
    saved = [db.put("courses", {**r["course"], "semester_id": value.semester_id}) for r in review]
    return {"courses": saved, "count": len(saved)}


@app.get("/api/todos")
def todos(): return db.all_rows("todos")


@app.post("/api/todos")
def create_todo(value: Todo): return db.put("todos", value.model_dump(mode="json"))


@app.put("/api/todos/{ident}")
def edit_todo(ident: str, value: Todo):
    if not db.get("todos", ident): raise HTTPException(404, "任务不存在")
    return db.put("todos", {**value.model_dump(mode="json"), "id": ident}, ident)


@app.patch("/api/todos/{ident}/complete")
def complete_todo(ident: str, completed: bool = True): return db.patch("todos", ident, {"completed": completed})


@app.delete("/api/todos/{ident}")
def remove_todo(ident: str): db.delete("todos", ident); return {"ok": True}


@app.post("/api/todos/suggest")
async def suggest(value: GoalRequest):
    try: return await learning.suggest_tasks(value.goal)
    except Exception as exc: fail(exc)


@app.post("/api/focus/start")
def start_focus(value: FocusRequest):
    try: return focus.start(value)
    except Exception as exc: fail(exc)


@app.get("/api/focus/state")
def focus_state(): return focus.state()


@app.post("/api/focus/{action}")
def focus_action(action: str):
    try: return focus.action(action)
    except Exception as exc: fail(exc)


@app.get("/api/focus/records")
def focus_records(): return db.all_rows("focus")


@app.get("/api/lectures")
def lectures(): return db.all_rows("lectures")


@app.post("/api/lectures")
def create_lecture(value: LectureCreate):
    settings = settings_raw()
    lecture = {**value.model_dump(), "status": "recording", "asr_mode": settings["asr_mode"], "duration": 0, "last_seq": -1, "edited_text": "", "summary": None, "created_at": db.now()}
    return db.put("lectures", lecture)


@app.get("/api/lectures/{ident}")
def lecture(ident: str):
    item = db.get("lectures", ident)
    if not item: raise HTTPException(404, "课堂记录不存在")
    return {**item, "segments": speech.transcript_segments(ident)}


@app.put("/api/lectures/{ident}")
def edit_lecture(ident: str, value: LectureEdit):
    if not db.get("lectures", ident): raise HTTPException(404, "课堂记录不存在")
    return db.patch("lectures", ident, value.model_dump())


@app.post("/api/lectures/{ident}/finish")
async def finish_lecture(ident: str):
    try: await speech.finish(ident); return {"ok": True}
    except Exception as exc: fail(exc)


@app.post("/api/lectures/{ident}/retry/{segment_id}")
async def retry_segment(ident: str, segment_id: str):
    try: await speech.retry(ident, segment_id); return {"ok": True}
    except Exception as exc: fail(exc)


@app.post("/api/lectures/{ident}/summary")
async def lecture_summary(ident: str):
    lecture = db.get("lectures", ident)
    if not lecture: raise HTTPException(404, "课堂记录不存在")
    try:
        db.patch("lectures", ident, {"summary_status": "running", "summary_error": None})
        result = await learning.summarize(db.get("lectures", ident))
        db.patch("lectures", ident, {"summary": result, "summary_status": "done", "summary_progress": None})
        return result
    except Exception as exc:
        db.patch("lectures", ident, {"summary_status": "error", "summary_error": str(exc)})
        fail(exc)


@app.get("/api/lectures/{ident}/audio")
def lecture_audio(ident: str):
    try: return FileResponse(speech.playback(ident), media_type="audio/wav", filename="lecture.wav")
    except Exception as exc: fail(exc)


@app.delete("/api/lectures/{ident}/audio")
def delete_audio(ident: str):
    import shutil
    path = speech.audio_dir(ident)
    for item in path.iterdir(): item.unlink(missing_ok=True)
    return {"ok": True}


@app.delete("/api/lectures/{ident}")
def remove_lecture(ident: str):
    import shutil
    db.delete("lectures", ident)
    shutil.rmtree(speech.audio_dir(ident), ignore_errors=True)
    with db.connect() as c: c.execute("DELETE FROM segments WHERE lecture_id=?", (ident,)); c.execute("DELETE FROM chunks WHERE lecture_id=?", (ident,))
    return {"ok": True}


@app.post("/api/lectures/{ident}/upload")
async def upload_audio(ident: str, file: UploadFile = File(...)):
    lecture = db.get("lectures", ident)
    if not lecture: raise HTTPException(404, "课堂记录不存在")
    if not file.filename or Path(file.filename).suffix.lower() not in (".wav", ".mp3", ".m4a", ".webm", ".ogg", ".flac"): raise HTTPException(400, "仅支持 WAV、MP3、M4A、WebM、OGG、FLAC")
    path = speech.audio_dir(ident) / f"upload-{uuid4().hex}{Path(file.filename).suffix.lower()}"
    total = 0
    with path.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            total += len(chunk)
            if total > 512 * 1024 * 1024:
                path.unlink(missing_ok=True); raise HTTPException(413, "音频文件不能超过 512 MB")
            out.write(chunk)
    db.patch("lectures", ident, {"status": "uploading", "asr_mode": settings_raw()["asr_mode"]})
    asyncio.create_task(speech.process_upload(ident, path))
    return {"ok": True, "status": "uploading"}


@app.websocket("/ws/lectures/{ident}")
async def lecture_socket(ws: WebSocket, ident: str):
    await ws.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    LISTENER = speech.LISTENERS.setdefault(ident, set())
    LISTENER.add(q)
    try:
        await ws.send_json({"type": "hello", "lecture_id": ident})
        while True:
            message = await ws.receive()
            if message.get("type") == "websocket.disconnect": break
            if message.get("bytes") is not None:
                # First 4 bytes are little-endian sequence number; browser sends PCM16 after it.
                raw = message["bytes"]
                if len(raw) < 6: raise ServiceError("音频包过短")
                seq = int.from_bytes(raw[:4], "little")
                await speech.ingest(ident, seq, raw[4:])
                await ws.send_json({"type": "ack", "seq": seq})
            elif message.get("text"):
                command = json.loads(message["text"])
                if command.get("type") == "finish": await speech.finish(ident)
                elif command.get("type") == "interrupt": await speech.finish(ident, True)
            while not q.empty(): await ws.send_json(q.get_nowait())
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try: await ws.send_json({"type": "error", "message": str(exc) if isinstance(exc, ServiceError) else "录音连接异常"})
        except Exception: pass
    finally:
        LISTENER.discard(q)
        if not LISTENER: speech.LISTENERS.pop(ident, None)


@app.get("/api/extension-status")
def extension_status(): return {"knowledge_base": {"status": "planned", "available": False}, "research_assistant": {"status": "planned", "available": False}}

