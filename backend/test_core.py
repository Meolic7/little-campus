from datetime import date

import pytest

from backend import db, learning
from backend.schemas import CourseDraft, Period, Semester
from backend.speech import trim_overlap


def test_semester_requires_monday_and_rejects_overlap():
    with pytest.raises(ValueError):
        Semester(name="x", start_date=date(2026, 9, 15), periods=[])
    with pytest.raises(ValueError):
        Semester(name="x", start_date=date(2026, 9, 14), periods=[Period(number=1, start="08:00", end="09:00"), Period(number=2, start="08:30", end="09:30")])


def test_trim_overlap_only_boundary():
    assert trim_overlap("lecture starts here", "here and continues") == "and continues"
    assert trim_overlap("abc", "xyz abc") == "xyz abc"


def test_review_marks_missing_and_conflicts(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA", tmp_path)
    db.init()
    semester = db.put("semesters", {"id": "s", "name": "x", "start_date": "2026-09-14", "weeks": 20, "periods": [{"number": 1, "start": "08:00", "end": "08:45"}]}, "s")
    draft = CourseDraft(name="", weekday=1, start_period=1, end_period=1, weeks=[1])
    review = learning.review_courses([draft], semester)
    assert "缺少课程名称" in review[0]["errors"]
