"""Small transactional SQLite store. SQL identifiers are always internal constants."""
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone

DATA = Path(os.environ.get("CAMPUS_DATA_DIR", Path(__file__).resolve().parent.parent / "data")).resolve()


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect():
    DATA.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DATA / "campus.sqlite3", timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init():
    (DATA / "audio").mkdir(parents=True, exist_ok=True)
    (DATA / "models").mkdir(exist_ok=True)
    with connect() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript('''
        CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS semesters (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS focus (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS lectures (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS segments (
            id TEXT PRIMARY KEY, lecture_id TEXT NOT NULL,
            seq INTEGER NOT NULL, payload TEXT NOT NULL,
            UNIQUE(lecture_id, seq)
        );
        CREATE TABLE IF NOT EXISTS chunks (
            lecture_id TEXT NOT NULL, seq INTEGER NOT NULL, samples INTEGER NOT NULL,
            PRIMARY KEY(lecture_id, seq)
        );
        PRAGMA user_version=1;
        ''')


TABLES = {"settings", "semesters", "courses", "todos", "focus", "lectures"}


def get(table, ident):
    assert table in TABLES
    with connect() as c:
        r = c.execute(f"SELECT payload FROM {table} WHERE id=?", (ident,)).fetchone()
    return json.loads(r[0]) if r else None


def all_rows(table):
    assert table in TABLES
    with connect() as c:
        return [json.loads(r[0]) for r in c.execute(f"SELECT payload FROM {table} ORDER BY rowid DESC")]


def put(table, obj, ident=None):
    assert table in TABLES
    ident = ident or obj.get("id") or uuid4().hex
    obj = {**obj, "id": ident}
    with connect() as c:
        c.execute(f"INSERT INTO {table}(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", (ident, json.dumps(obj, ensure_ascii=False)))
    return obj


def patch(table, ident, changes):
    # Read/modify/write under one write lock, including background transcription updates.
    assert table in TABLES
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute(f"SELECT payload FROM {table} WHERE id=?", (ident,)).fetchone()
        if not row:
            raise KeyError(ident)
        obj = {**json.loads(row[0]), **changes, "id": ident}
        c.execute(f"UPDATE {table} SET payload=? WHERE id=?", (json.dumps(obj, ensure_ascii=False), ident))
    return obj


def delete(table, ident):
    assert table in TABLES
    with connect() as c:
        c.execute(f"DELETE FROM {table} WHERE id=?", (ident,))


def segments(lecture_id):
    with connect() as c:
        return [json.loads(r[0]) for r in c.execute("SELECT payload FROM segments WHERE lecture_id=? ORDER BY seq", (lecture_id,))]


def put_segment(obj):
    with connect() as c:
        c.execute("INSERT INTO segments(id,lecture_id,seq,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", (obj["id"], obj["lecture_id"], obj["seq"], json.dumps(obj, ensure_ascii=False)))
    return obj
