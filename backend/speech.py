"""Durable PCM ingestion, bounded segmentation and serialized ASR worker."""
import asyncio
import base64
import io
import json
import math
import os
import shutil
import subprocess
import threading
import wave
from array import array
from pathlib import Path
from uuid import uuid4

from . import db
from .providers import ServiceError, cloud_transcribe, settings_raw

RATE = 16000
BYTES_SEC = RATE * 2
MAX_SECONDS = 4 * 60 * 60
QUEUE: asyncio.Queue | None = None
WORKER = None
LISTENERS: dict[str, set] = {}
BUFFERS: dict[str, "Segmenter"] = {}
ACTIVE_SOCKETS: set[str] = set()
MODEL = None
MODEL_KEY = None
MODEL_LOCK = threading.Lock()
MODEL_STATE = {"status": "idle", "error": None}


def audio_dir(ident):
    # IDs only originate from the database; also defend path construction independently.
    if len(ident) != 32 or any(ch not in "0123456789abcdef" for ch in ident):
        raise ServiceError("无效的课堂编号")
    path = db.DATA / "audio" / ident
    path.mkdir(parents=True, exist_ok=True)
    return path


def wav_bytes(pcm):
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm)
    return b.getvalue()


def quiet(pcm):
    samples = array("h", pcm)
    return not samples or math.sqrt(sum(float(x) ** 2 for x in samples) / len(samples)) < 230


def trim_overlap(previous, current):
    # Only strip a sufficiently long exact boundary overlap; do not remove repeated words elsewhere.
    for size in range(min(120, len(previous), len(current)), 3, -1):
        if previous[-size:].casefold() == current[:size].casefold():
            return current[size:].lstrip()
    return current


class Segmenter:
    def __init__(self, lecture_id, start=0, seq=0):
        self.lecture_id = lecture_id
        self.buffer = bytearray()
        self.start = start
        self.seq = seq
        self.fresh = 0

    async def feed(self, pcm, final=False):
        self.buffer.extend(pcm)
        self.fresh += len(pcm)
        duration = len(self.buffer) / BYTES_SEC
        cut = duration >= 12 or (duration >= 5 and pcm and quiet(pcm[-BYTES_SEC:])) or final
        if not cut or not self.fresh:
            return
        raw = bytes(self.buffer)
        end = self.start + duration
        ident = uuid4().hex
        path = audio_dir(self.lecture_id) / f"segment-{ident}.wav"
        path.write_bytes(wav_bytes(raw))
        segment = {"id": ident, "lecture_id": self.lecture_id, "seq": self.seq, "start": self.start, "end": end, "text": "", "raw_text": "", "status": "done" if quiet(raw) else "queued", "error": None, "file": path.name}
        db.put_segment(segment)
        if segment["status"] == "queued":
            await QUEUE.put(segment)
        await emit(self.lecture_id, {"type": "segment", **public_segment(segment)})
        self.seq += 1
        overlap = b"" if final else raw[-BYTES_SEC // 2:]
        self.start = end - len(overlap) / BYTES_SEC
        self.buffer = bytearray(overlap)
        self.fresh = 0


def public_segment(s):
    return {k: v for k, v in s.items() if k not in ("file", "raw_text")}


async def emit(ident, event):
    for q in list(LISTENERS.get(ident, set())):
        if not q.full():
            q.put_nowait(event)


def load_local():
    global MODEL, MODEL_KEY
    cfg = settings_raw()
    key = (cfg["local_model"], cfg["device"])
    with MODEL_LOCK:
        if MODEL is not None and MODEL_KEY == key:
            return MODEL
        MODEL_STATE.update(status="loading", error=None)
        try:
            from faster_whisper import WhisperModel
            MODEL = WhisperModel(key[0], device=key[1], compute_type="int8" if key[1] == "cpu" else "float16", download_root=str(db.DATA / "models"))
            MODEL_KEY = key
            MODEL_STATE.update(status="ready", error=None)
            return MODEL
        except ImportError:
            MODEL_STATE.update(status="error", error="尚未安装本地语音依赖，请运行 setup.ps1 -WithASR")
        except Exception:
            MODEL_STATE.update(status="error", error="模型加载失败，请检查下载网络、缓存和所选 CPU/GPU 环境")
        raise ServiceError(MODEL_STATE["error"])


def local_transcribe(path):
    model = load_local()
    try:
        chunks, _ = model.transcribe(str(path), beam_size=3, vad_filter=True, condition_on_previous_text=False)
        return "".join(c.text for c in chunks).strip()
    except Exception:
        raise ServiceError("本地识别失败，请检查模型状态和可用内存") from None


def refresh_status(ident):
    lecture = db.get("lectures", ident)
    if not lecture or lecture["status"] in ("recording", "uploading", "interrupted"):
        return
    segments = db.segments(ident)
    status = "processing" if any(s["status"] in ("queued", "processing") for s in segments) else "partial" if any(s["status"] == "error" for s in segments) else "done"
    db.patch("lectures", ident, {"status": status})


async def worker():
    while True:
        s = await QUEUE.get()
        try:
            lecture = db.get("lectures", s["lecture_id"])
            if not lecture:
                continue
            s.update(status="processing", error=None)
            db.put_segment(s)
            await emit(s["lecture_id"], {"type": "segment", **public_segment(s)})
            path = audio_dir(s["lecture_id"]) / s["file"]
            raw_text = await cloud_transcribe(path.read_bytes()) if lecture["asr_mode"] == "cloud" else await asyncio.to_thread(local_transcribe, path)
            s.update(status="done", text=raw_text, raw_text=raw_text)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            s.update(status="error", error=str(exc) if isinstance(exc, ServiceError) else "识别失败，录音已保留，可重试")
        finally:
            if db.get("lectures", s["lecture_id"]):
                db.put_segment(s)
                refresh_status(s["lecture_id"])
                await emit(s["lecture_id"], {"type": "segment", **public_segment(s)})
            QUEUE.task_done()


async def startup():
    global QUEUE, WORKER
    QUEUE = asyncio.Queue()
    BUFFERS.clear()
    ACTIVE_SOCKETS.clear()
    # Recover committed chunk files even if the process stopped before SQLite was updated.
    for lecture in db.all_rows("lectures"):
        ident = lecture["id"]
        if lecture.get("summary_status") == "running":
            db.patch("lectures", ident, {"summary_status": "error", "summary_error": "服务重启，可重新生成；分段结果已保留"})
        for s in db.segments(ident):
            if s["status"] in ("queued", "processing"):
                s["status"] = "queued"
                db.put_segment(s)
                await QUEUE.put(s)
        if lecture["status"] in ("recording", "uploading", "interrupted"):
            db.patch("lectures", ident, {"status": "interrupted"})
            await recover(ident)
        else:
            refresh_status(ident)
    WORKER = asyncio.create_task(worker())


async def shutdown():
    if WORKER:
        WORKER.cancel()
        try:
            await WORKER
        except asyncio.CancelledError:
            pass


def chunk_files(ident):
    return sorted(audio_dir(ident).glob("chunk-*.pcm"))


async def recover(ident):
    files = chunk_files(ident)
    total = 0
    for i, path in enumerate(files):
        if path.name != f"chunk-{i:07d}.pcm":
            raise ServiceError("录音块不连续，已有文件已保留")
        length = path.stat().st_size
        with db.connect() as c:
            c.execute("INSERT OR IGNORE INTO chunks VALUES(?,?,?)", (ident, i, length // 2))
        total += length
    existing = db.segments(ident)
    start = max((s["end"] for s in existing), default=0)
    segmenter = Segmenter(ident, start, max((s["seq"] for s in existing), default=-1) + 1)
    skip = round(start * BYTES_SEC)
    offset = 0
    for path in files:
        raw = path.read_bytes()
        if offset + len(raw) > skip:
            await segmenter.feed(raw[max(0, skip - offset):])
        offset += len(raw)
    BUFFERS[ident] = segmenter
    db.patch("lectures", ident, {"duration": total / BYTES_SEC, "last_seq": len(files) - 1})


async def ingest(ident, seq, pcm):
    if len(pcm) % 2 or len(pcm) > BYTES_SEC * 2 or not pcm:
        raise ServiceError("音频块必须为最多 2 秒的 16kHz 单声道 PCM16")
    lecture = db.get("lectures", ident)
    if not lecture:
        raise ServiceError("课堂记录不存在")
    if seq <= lecture.get("last_seq", -1):
        return
    if seq != lecture.get("last_seq", -1) + 1:
        raise ServiceError("录音序号不连续，请重新连接后重发未确认块")
    if lecture.get("duration", 0) + len(pcm) / BYTES_SEC > MAX_SECONDS:
        raise ServiceError("单次录音最多 4 小时，请结束后新建课堂")
    path = audio_dir(ident) / f"chunk-{seq:07d}.pcm"
    # Atomic rename is the durable source of truth; ACK occurs only after file + metadata commit.
    tmp = path.with_suffix(".tmp")
    with tmp.open("wb") as f:
        f.write(pcm); f.flush(); os.fsync(f.fileno())
    tmp.replace(path)
    with db.connect() as c:
        c.execute("INSERT INTO chunks VALUES(?,?,?)", (ident, seq, len(pcm) // 2))
    db.patch("lectures", ident, {"last_seq": seq, "duration": lecture.get("duration", 0) + len(pcm) / BYTES_SEC})
    if ident not in BUFFERS:
        await recover(ident)
    else:
        await BUFFERS[ident].feed(pcm)


async def finish(ident, interrupted=False):
    if ident not in BUFFERS:
        await recover(ident)
    await BUFFERS.pop(ident).feed(b"", final=True)
    db.patch("lectures", ident, {"status": "interrupted" if interrupted else "processing"})
    refresh_status(ident)


def playback(ident):
    files = chunk_files(ident)
    if not files:
        raise ServiceError("原始录音不存在或已删除")
    dest = audio_dir(ident) / "recording.wav"
    total = sum(p.stat().st_size for p in files)
    if not dest.exists() or dest.stat().st_size != total + 44:
        tmp = dest.with_suffix(".tmp")
        with wave.open(str(tmp), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
            for path in files:
                w.writeframesraw(path.read_bytes())
        tmp.replace(dest)
    return dest


def decode_upload(source: Path, output: Path):
    try:
        import imageio_ffmpeg
        ffmpeg = shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe()
        result = subprocess.run([ffmpeg, "-nostdin", "-y", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", str(source), "-t", str(MAX_SECONDS + 1), "-ac", "1", "-ar", str(RATE), "-acodec", "pcm_s16le", str(output)], capture_output=True, timeout=300, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if result.returncode:
            raise ServiceError("音频解码失败，请检查文件格式")
        with wave.open(str(output)) as w:
            if w.getnframes() / w.getframerate() > MAX_SECONDS:
                raise ServiceError("单个音频最多 4 小时，请先拆分文件")
    except (FileNotFoundError, RuntimeError):
        raise ServiceError("未找到 FFmpeg，请重新运行安装脚本") from None
    except subprocess.TimeoutExpired:
        raise ServiceError("音频解码超时，请缩短音频后重试") from None


async def process_upload(ident, source):
    output = audio_dir(ident) / "decoded.wav"
    try:
        await asyncio.to_thread(decode_upload, source, output)
        with wave.open(str(output)) as w:
            seq = 0
            while pcm := w.readframes(RATE):
                await ingest(ident, seq, pcm)
                seq += 1
                await asyncio.sleep(0)
        await finish(ident)
        source.unlink(missing_ok=True)
        output.unlink(missing_ok=True)
    except Exception as exc:
        db.patch("lectures", ident, {"status": "error", "error": str(exc) if isinstance(exc, ServiceError) else "上传处理失败，源文件已保留"})


async def retry(ident, segment_id):
    for s in db.segments(ident):
        if s["id"] == segment_id:
            if s["status"] != "error":
                raise ServiceError("只能重试失败片段")
            if not (audio_dir(ident) / s["file"]).exists():
                raise ServiceError("此片段音频已删除，无法重试")
            s.update(status="queued", error=None)
            db.put_segment(s)
            await QUEUE.put(s)
            if db.get("lectures", ident)["status"] != "interrupted":
                db.patch("lectures", ident, {"status": "processing"})
            return
    raise ServiceError("片段不存在")


def transcript_segments(ident):
    items = db.segments(ident)
    previous = None
    result = []
    for s in items:
        out = public_segment(s)
        if previous and previous["status"] == "done" and s["status"] == "done" and previous["end"] > s["start"]:
            out["text"] = trim_overlap(previous["text"], s["text"])
        result.append(out)
        previous = s
    return result
