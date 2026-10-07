from datetime import date, time, datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator, model_validator


class Provider(BaseModel):
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    timeout: int = Field(default=120, ge=5, le=600)
    clear_key: bool = False

    @field_validator("base_url")
    @classmethod
    def valid_url(cls, value):
        from urllib.parse import urlparse
        value = value.strip().rstrip("/")
        if value:
            u = urlparse(value)
            if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password or u.query or u.fragment:
                raise ValueError("请输入不含密钥、查询参数的 HTTP(S) 服务地址")
        return value


class Settings(BaseModel):
    text: Provider = Field(default_factory=Provider)
    vision: Provider = Field(default_factory=Provider)
    cloud: Provider = Field(default_factory=Provider)
    asr_mode: Literal["local", "cloud"] = "local"
    local_model: Literal["tiny", "base", "small", "medium"] = "small"
    device: Literal["cpu", "cuda"] = "cpu"
    cloud_max_mb: int = Field(default=20, ge=1, le=100)


class Period(BaseModel):
    number: int = Field(ge=1, le=30)
    start: str
    end: str

    @model_validator(mode="after")
    def times(self):
        if time.fromisoformat(self.start) >= time.fromisoformat(self.end):
            raise ValueError("节次结束时间须晚于开始时间")
        self.start = time.fromisoformat(self.start).strftime("%H:%M")
        self.end = time.fromisoformat(self.end).strftime("%H:%M")
        return self


class Semester(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    start_date: date
    weeks: int = Field(default=20, ge=1, le=60)
    periods: list[Period] = Field(default_factory=list)

    @model_validator(mode="after")
    def check(self):
        if self.start_date.weekday() != 0:
            raise ValueError("学期起始日必须是第 1 教学周的周一")
        if len({p.number for p in self.periods}) != len(self.periods):
            raise ValueError("节次编号不能重复")
        ordered = sorted(self.periods, key=lambda p: p.number)
        if any(a.end > b.start for a, b in zip(ordered, ordered[1:])):
            raise ValueError("节次时间不能重叠或逆序")
        return self


class CourseDraft(BaseModel):
    name: str = Field(default="", max_length=120)
    teacher: str = Field(default="", max_length=120)
    location: str = Field(default="", max_length=200)
    weekday: int | None = Field(default=None, ge=1, le=7)
    start_time: str | None = None
    end_time: str | None = None
    start_period: int | None = Field(default=None, ge=1, le=30)
    end_period: int | None = Field(default=None, ge=1, le=30)
    weeks: list[int] = Field(default_factory=list, max_length=60)
    parity: Literal["all", "odd", "even"] = "all"
    notes: str = Field(default="", max_length=2000)

    @field_validator("weeks")
    @classmethod
    def check_weeks(cls, value):
        if any(w < 1 or w > 60 for w in value):
            raise ValueError("周次范围为 1–60")
        return sorted(set(value))

    @field_validator("start_time", "end_time")
    @classmethod
    def check_time(cls, value):
        return time.fromisoformat(value).strftime("%H:%M") if value else None


class Course(CourseDraft):
    semester_id: str


class ImportConfirm(BaseModel):
    semester_id: str
    courses: list[CourseDraft] = Field(min_length=1, max_length=300)
    accept_conflicts: bool = False


class Todo(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    notes: str = Field(default="", max_length=10000)
    due: datetime | None = None
    priority: Literal["low", "medium", "high"] = "medium"
    course_id: str | None = None
    completed: bool = False

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value):
        if not value.strip():
            raise ValueError("标题不能为空")
        return value.strip()


class TaskSuggestions(BaseModel):
    tasks: list[Todo] = Field(max_length=40)


class GoalRequest(BaseModel):
    goal: str = Field(min_length=1, max_length=12000)


class FocusRequest(BaseModel):
    focus_minutes: int = Field(default=25, ge=1, le=180)
    rest_minutes: int = Field(default=5, ge=1, le=60)
    todo_id: str | None = None


class LectureCreate(BaseModel):
    title: str = Field(default="未命名课堂", min_length=1, max_length=200)
    course_id: str | None = None


class LectureEdit(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    course_id: str | None = None
    edited_text: str = Field(default="", max_length=1000000)


class KeyPoint(BaseModel):
    text: str
    timestamps: list[float] = Field(default_factory=list)


class LectureSummary(BaseModel):
    abstract: str
    key_points: list[KeyPoint]
    review: list[str]
    tasks: list[Todo] = Field(default_factory=list, max_length=40)


class CourseResult(BaseModel):
    courses: list[CourseDraft] = Field(max_length=300)


class SegmentEvent(BaseModel):
    type: Literal["segment"] = "segment"
    id: str
    seq: int
    start: float
    end: float
    text: str
    status: str
    error: str | None = None
