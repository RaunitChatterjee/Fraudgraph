"""Tiny DB-API adapter: PostgreSQL (psycopg 3) in production, SQLite for zero-setup dev/tests.

SQL is written with ``?`` placeholders and translated for PostgreSQL.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema.sql"
TS_FMT = "%Y-%m-%dT%H:%M:%S"


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_dt(v):
    """Accept datetime | ISO string | None."""
    if v is None or isinstance(v, datetime):
        return v
    return datetime.fromisoformat(str(v).replace(" ", "T"))


def iso(v):
    d = to_dt(v)
    return d.strftime(TS_FMT) if d else None


def new_id() -> str:
    return uuid.uuid4().hex[:12]


class Database:
    def __init__(self, url: str):
        self.url = url
        self.is_pg = url.startswith(("postgres://", "postgresql://"))
        self.lock = threading.RLock()
        if self.is_pg:
            import psycopg
            from psycopg.rows import dict_row

            self.conn = psycopg.connect(url, row_factory=dict_row)
        else:
            path = url.replace("sqlite:///", "", 1)
            self.conn = sqlite3.connect(path, check_same_thread=False)
            self.conn.row_factory = sqlite3.Row
        self.init_schema()

    # -- helpers ---------------------------------------------------------
    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s") if self.is_pg else sql

    def init_schema(self):
        script = SCHEMA_PATH.read_text()
        with self.lock:
            for stmt in [s.strip() for s in script.split(";") if s.strip()]:
                self.conn.execute(stmt) if not self.is_pg else self.conn.cursor().execute(stmt)
            self.conn.commit()

    def execute(self, sql: str, params=()):
        with self.lock:
            cur = self.conn.cursor()
            cur.execute(self._sql(sql), params)
            self.conn.commit()
            return cur

    def executemany(self, sql: str, rows):
        with self.lock:
            cur = self.conn.cursor()
            cur.executemany(self._sql(sql), rows)
            self.conn.commit()

    def query(self, sql: str, params=()) -> list[dict]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute(self._sql(sql), params)
            rows = cur.fetchall()
            self.conn.commit()
        return [dict(r) for r in rows]

    def one(self, sql: str, params=()):
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def clear_all(self):
        for t in ("case_events", "case_accounts", "cases", "complaints",
                  "ground_truth", "transactions", "accounts", "meta"):
            self.execute(f"DELETE FROM {t}")

    # -- meta ------------------------------------------------------------
    def set_meta(self, key: str, value):
        self.execute("DELETE FROM meta WHERE key = ?", (key,))
        self.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (key, json.dumps(value)))

    def get_meta(self, key: str, default=None):
        r = self.one("SELECT value FROM meta WHERE key = ?", (key,))
        return json.loads(r["value"]) if r else default
