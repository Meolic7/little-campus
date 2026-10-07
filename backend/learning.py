import base64
import io
import json
from datetime import date, time

from bs4 import BeautifulSoup
from PIL import Image, UnidentifiedImageError

from . import db
from .providers import ServiceError, chat
from .schemas import CourseResult, CourseDraft, TaskSuggestions, LectureSummary


def html_text(raw):
    soup = BeautifulSoup(raw, "html.parser")
    for tag in soup(["script", "style", "iframe", "object", "nav", "header", "footer"]):
        tag.decompose()
    for br in soup.find_all("br"):
        br.replace_with(" / ")
    # Preserve merged cells as attributes so the model can reconstruct timetable columns.
    tables = "\n".join(str(t) for t in soup.find_all("table"))
    for tag in soup.find_all("table"):
        tag.decompose()
    return tables + "\n" + soup.get_text(" ", strip=True)


def image_part(raw):
    try:
        with Image.open(io.BytesIO(raw)) as im:
            if im.width * im.height > 40_000_000:
                raise ServiceError("图片分辨率过大，请缩小后上传")
            im = im.convert("RGB")
            im.thumbnail((2200, 2200))
            out = io.BytesIO()
            im.save(out, format="JPEG", quality=88)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ServiceError("无法读取此图片") from None
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()}}


def material(raw: bytes, filename: str):
    ext = filename.lower().rsplit(".", 1)[-1]
    if ext in ("html", "htm", "txt"):
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("gb18030", errors="replace")
        return [{"type": "text", "text": html_text(text) if ext != "txt" else text}]
    if ext in ("png", "jpg", "jpeg"):
        return [image_part(raw)]
    if ext == "pdf":
        import fitz
        try:
            doc = fitz.open(stream=raw, filetype="pdf")
            with doc:
                if doc.needs_pass:
                    raise ServiceError("请先移除 PDF 密码再上传")
                if len(doc) > 20:
                    raise ServiceError("课表 PDF 最多 20 页，请提取课表相关页面")
                parts = []
                for i, page in enumerate(doc):
                    text = page.get_text(sort=True).strip()
                    parts.append({"type": "text", "text": f"第 {i + 1} 页：\n" + text})
                    if len(text) < 30 or page.get_images():
                        scale = min(2, 2200 / max(page.rect.width, page.rect.height))
                        parts.append(image_part(page.get_pixmap(matrix=fitz.Matrix(scale, scale)).tobytes("png")))
                return parts
        except ServiceError:
            raise
        except Exception:
            raise ServiceError("无法读取 PDF，请检查文件是否损坏") from None
    raise ServiceError("仅支持 HTML、TXT、PNG、JPEG 和 PDF")


def normalize_course(item: CourseDraft, semester):
    c = item.model_dump()
    periods = {p["number"]: p for p in semester["periods"]}
    if not c["start_time"] and c["start_period"] in periods:
        c["start_time"] = periods[c["start_period"]]["start"]
    if not c["end_time"] and c["end_period"] in periods:
        c["end_time"] = periods[c["end_period"]]["end"]
    return c


def effective_weeks(c):
    return {w for w in c["weeks"] if c["parity"] == "all" or (w % 2 == (1 if c["parity"] == "odd" else 0))}


def review_courses(courses, semester, ignore_id=None):
    existing = [c for c in db.all_rows("courses") if c["semester_id"] == semester["id"] and c["id"] != ignore_id]
    result = []
    for index, draft in enumerate(courses):
        c = normalize_course(draft, semester)
        errors, warnings = [], []
        if not c["name"].strip(): errors.append("缺少课程名称")
        if not c["weekday"]: errors.append("缺少星期")
        if not c["start_time"] or not c["end_time"]:
            errors.append("缺少起止时间，请补充节次设置或直接填写时间")
        elif time.fromisoformat(c["start_time"]) >= time.fromisoformat(c["end_time"]):
            errors.append("结束时间必须晚于开始时间")
        if c["start_period"] and c["end_period"] and c["start_period"] > c["end_period"]:
            errors.append("结束节次不能早于开始节次")
        if not c["weeks"]: errors.append("缺少教学周次")
        if any(w > semester["weeks"] for w in c["weeks"]): errors.append("周次超过学期范围")
        if c["weeks"] and not effective_weeks(c): errors.append("单双周设置下没有有效周次")
        if not c["teacher"]: warnings.append("教师待补充")
        if not c["location"]: warnings.append("地点待补充")
        for other in existing + [r["course"] for r in result]:
            if c["weekday"] != other["weekday"] or not effective_weeks(c).intersection(effective_weeks(other)):
                continue
            if c["start_time"] and c["end_time"] and other["start_time"] and other["end_time"] and c["start_time"] < other["end_time"] and c["end_time"] > other["start_time"]:
                warnings.append(f"疑似重复或时间冲突：{other['name']}")
        result.append({"index": index, "course": c, "errors": errors, "warnings": list(dict.fromkeys(warnings))})
    return result


async def parse_timetable(parts, semester):
    if sum(len(p.get("text", "")) for p in parts) > 100000:
        raise ServiceError("课表文字过长，请仅保留课表相关内容（最多 10 万字符）")
    prompt = "从以下课表材料提取课程，每个独立的上课安排生成一条。仅依据材料，不猜测缺失的教师、地点、星期、时间或周次；缺失用 null、空字符串或空列表。只有材料明确覆盖整个学期时才展开全部周次。weeks 为明确周次的整数列表，parity 为 all/odd/even。节次已知时填写 start_period/end_period。学期信息：" + json.dumps(semester, ensure_ascii=False)
    result = await chat([{"role": "user", "content": [{"type": "text", "text": prompt}] + parts}], "vision" if any(p["type"] == "image_url" for p in parts) else "text", CourseResult)
    return {"items": review_courses(result.courses, semester)}


async def suggest_tasks(goal):
    result = await chat([{"role": "user", "content": f"今天是 {date.today().isoformat()}。将学习目标拆为少量可执行任务。不要凭空编造截止日期，未明确则 due=null。不要生成 course_id。目标：\n{goal}"}], schema=TaskSuggestions)
    return result.model_dump(mode="json")


async def summarize(lecture):
    segments = db.segments(lecture["id"])
    complete = [s for s in segments if s["status"] == "done" and s["text"]]
    if lecture.get("edited_text"):
        # Edited text cannot safely inherit exact original timestamps.
        text = "用户编辑稿（没有精确时间对齐，timestamps 请留空）：\n" + lecture["edited_text"]
    else:
        text = "\n".join(f"[{s['start']:.1f}s–{s['end']:.1f}s] {s['text']}" for s in complete)
    if not text.strip():
        raise ServiceError("暂无可总结的文字，请先转录或保存编辑稿")
    chunks = [text[i:i + 14000] for i in range(0, len(text), 14000)]
    partials = []
    for chunk in chunks:
        result = await chat([{"role": "user", "content": "根据课堂内容生成摘要、知识点、复习提纲和明确作业/复习任务。只能引用材料中出现的时间戳，不确定的内容请说明。作业日期不明确时 due=null，不生成 course_id。课堂内容：\n" + chunk}], schema=LectureSummary)
        partials.append(result.model_dump(mode="json"))
        db.patch("lectures", lecture["id"], {"summary_progress": f"已整理 {len(partials)}/{len(chunks)} 段", "summary_parts": partials})
    # Reduce in bounded batches, so even very long lectures do not create an oversized final prompt.
    level = partials
    while len(level) > 1:
        next_level = []
        for i in range(0, len(level), 4):
            result = await chat([{"role": "user", "content": "合并以下课堂分段总结，去除重复，保留来源时间戳。不要添加原文未支持的信息。\n" + json.dumps(level[i:i + 4], ensure_ascii=False)}], schema=LectureSummary)
            next_level.append(result.model_dump(mode="json"))
        level = next_level
    return level[0]
