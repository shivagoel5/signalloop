"""Persistent storage for campaigns and engagement metrics.

Uses SQLite so performance data accumulates across runs and can be compared
historically (a hard requirement of the assignment). Two tables:

  campaigns      one row per blog/newsletter send
  metrics        one row per (campaign, persona) with engagement numbers
"""

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS campaigns (
    id            TEXT PRIMARY KEY,
    blog_title    TEXT NOT NULL,
    topic         TEXT NOT NULL,
    send_date     TEXT NOT NULL,
    created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metrics (
    campaign_id   TEXT NOT NULL,
    persona_id    TEXT NOT NULL,
    newsletter_id TEXT NOT NULL,
    subject       TEXT NOT NULL,
    sample_sends  INTEGER NOT NULL,
    sent          INTEGER NOT NULL,
    delivered     INTEGER NOT NULL,
    opens         INTEGER NOT NULL,
    clicks        INTEGER NOT NULL,
    unsubscribes  INTEGER NOT NULL,
    open_rate     REAL NOT NULL,
    click_rate    REAL NOT NULL,
    unsub_rate    REAL NOT NULL,
    PRIMARY KEY (campaign_id, persona_id),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);
"""


@contextmanager
def _conn():
    con = sqlite3.connect(config.DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db():
    with _conn() as con:
        con.executescript(SCHEMA)


def save_campaign(campaign: dict):
    init_db()
    with _conn() as con:
        con.execute(
            "INSERT OR REPLACE INTO campaigns (id, blog_title, topic, send_date, created_at) "
            "VALUES (?,?,?,?,?)",
            (
                campaign["id"],
                campaign["blog_title"],
                campaign["topic"],
                campaign["send_date"],
                datetime.now(timezone.utc).isoformat(),
            ),
        )


def save_metrics(campaign_id: str, rows: list[dict]):
    init_db()
    with _conn() as con:
        for r in rows:
            con.execute(
                "INSERT OR REPLACE INTO metrics (campaign_id, persona_id, newsletter_id, "
                "subject, sample_sends, sent, delivered, opens, clicks, unsubscribes, "
                "open_rate, click_rate, unsub_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    campaign_id, r["persona_id"], r["newsletter_id"], r["subject"],
                    r["sample_sends"], r["sent"], r["delivered"], r["opens"], r["clicks"],
                    r["unsubscribes"], r["open_rate"], r["click_rate"], r["unsub_rate"],
                ),
            )


def metrics_for_campaign(campaign_id: str) -> list[dict]:
    init_db()
    with _conn() as con:
        cur = con.execute("SELECT * FROM metrics WHERE campaign_id=?", (campaign_id,))
        return [dict(r) for r in cur.fetchall()]


def all_campaigns() -> list[dict]:
    init_db()
    with _conn() as con:
        cur = con.execute("SELECT * FROM campaigns ORDER BY send_date DESC")
        return [dict(r) for r in cur.fetchall()]


def persona_history(persona_id: str) -> list[dict]:
    """Engagement over time for one persona, oldest first — drives trend analysis."""
    init_db()
    with _conn() as con:
        cur = con.execute(
            "SELECT c.send_date, c.topic, m.open_rate, m.click_rate, m.unsub_rate "
            "FROM metrics m JOIN campaigns c ON c.id = m.campaign_id "
            "WHERE m.persona_id=? ORDER BY c.send_date ASC",
            (persona_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def averages_by_persona() -> list[dict]:
    """Lifetime average engagement per persona across all campaigns."""
    init_db()
    with _conn() as con:
        cur = con.execute(
            "SELECT persona_id, COUNT(*) AS campaigns, "
            "AVG(open_rate) AS avg_open, AVG(click_rate) AS avg_click, "
            "AVG(unsub_rate) AS avg_unsub FROM metrics GROUP BY persona_id"
        )
        return [dict(r) for r in cur.fetchall()]
