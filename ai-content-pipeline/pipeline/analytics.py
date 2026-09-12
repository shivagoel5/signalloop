"""Stage 3 — performance logging & analysis.

Since we are not really sending mail, we simulate engagement using each
persona's baseline rates plus run-to-run noise. Results are written to SQLite
(for historical comparison) and an LLM produces a short performance summary
with recommendations.
"""

import random

import config
from . import storage
from .llm import LLM
from .personas import PERSONAS, PERSONA_BY_ID

SYSTEM = (
    "You are a growth analyst. You read email campaign metrics and produce a tight, "
    "executive-ready readout: what happened and what to do next. No fluff."
)


def simulate_performance(manifest: dict) -> list[dict]:
    """Produce per-persona engagement rows from the send manifest."""
    rng = random.Random(config.SIM_SEED)
    rows = []
    for p in PERSONAS:
        audience = manifest["audience_by_persona"][p["id"]]
        sample_sends = manifest["sample_sends_by_persona"][p["id"]]
        if audience == 0:
            continue
        base = PERSONA_BY_ID[p["id"]]["engagement"]
        # Apply +/- noise around each baseline rate.
        open_rate = _jitter(rng, base["open"], 0.06)
        click_rate = min(_jitter(rng, base["click"], 0.04), open_rate)  # can't exceed opens
        unsub_rate = _jitter(rng, base["unsub"], 0.003, floor=0.0)

        delivered = max(int(round(audience * _jitter(rng, 0.98, 0.01))), 0)
        opens = int(round(delivered * open_rate))
        clicks = int(round(delivered * click_rate))
        unsubs = int(round(delivered * unsub_rate))

        rows.append({
            "persona_id": p["id"],
            "newsletter_id": manifest["newsletter_ids"][p["id"]],
            "subject": manifest["subjects"][p["id"]],
            "sample_sends": sample_sends,
            "sent": audience,
            "delivered": delivered,
            "opens": opens,
            "clicks": clicks,
            "unsubscribes": unsubs,
            "open_rate": round(opens / delivered, 4) if delivered else 0.0,
            "click_rate": round(clicks / delivered, 4) if delivered else 0.0,
            "unsub_rate": round(unsubs / delivered, 4) if delivered else 0.0,
        })
    return rows


def _jitter(rng, mean, spread, floor=0.0, ceil=1.0):
    return max(floor, min(ceil, mean + rng.uniform(-spread, spread)))


def persist(campaign: dict, rows: list[dict]):
    storage.save_campaign(campaign)
    storage.save_metrics(campaign["id"], rows)


def summarize(campaign: dict, rows: list[dict], llm: LLM | None = None) -> dict:
    """Ask the LLM for a performance summary + recommendations.

    Includes lifetime per-persona averages so the summary reflects *historical*
    context, not just this one send.
    """
    llm = llm or LLM()
    history = storage.averages_by_persona()
    hist_map = {h["persona_id"]: h for h in history}

    # Compact, machine-parseable metrics block (also read by the mock engine).
    metric_lines = []
    for r in rows:
        metric_lines.append(
            f"{r['persona_id']}|open={r['open_rate']}|click={r['click_rate']}"
            f"|unsub={r['unsub_rate']}  (lifetime avg click "
            f"{hist_map.get(r['persona_id'], {}).get('avg_click', 0):.3f})"
        )

    prompt = f"""[[TASK:SUMMARY]]
Campaign: {campaign['blog_title']}  (topic: {campaign['topic']})
Per-persona results this send (rates 0-1):
{chr(10).join(metric_lines)}

Return JSON:
{{"summary": "2-4 sentence readout naming the best/worst segment with numbers",
  "recommendations": ["actionable next step", "..."]}}"""

    result = llm.complete_json(SYSTEM, prompt)
    result.setdefault("summary", "")
    result.setdefault("recommendations", [])
    return result
