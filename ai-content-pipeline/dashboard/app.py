"""Bonus — a lightweight Flask dashboard to view history and trigger runs.

Run:  python dashboard/app.py   then open http://127.0.0.1:5000

It reuses the exact same pipeline modules as the CLI, so the dashboard is a
thin view layer, not a parallel implementation.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Make the project root importable when run as `python dashboard/app.py`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flask import Flask, redirect, render_template, request, url_for  # noqa: E402

import config  # noqa: E402
from pipeline import (  # noqa: E402
    analytics,
    content_generation,
    distribution,
    optimization,
    storage,
)
from pipeline.crm import HubSpotClient  # noqa: E402
from pipeline.llm import LLM  # noqa: E402
from pipeline.personas import PERSONA_BY_ID, PERSONAS  # noqa: E402

app = Flask(__name__)


def _latest_report() -> dict | None:
    runs = sorted(config.RUNS_DIR.glob("cmp_*/report.json"))
    if not runs:
        return None
    return json.loads(runs[-1].read_text())


def _run_pipeline(topic: str):
    campaign_id = "cmp_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    run_dir = config.RUNS_DIR / campaign_id
    run_dir.mkdir(parents=True, exist_ok=True)
    llm, crm = LLM(), HubSpotClient()

    content = content_generation.generate_content(topic, llm)
    content_generation.save(content, run_dir)
    manifest = distribution.distribute(content, campaign_id, crm)
    rows = analytics.simulate_performance(manifest)
    analytics.persist(manifest["campaign"], rows)
    summary = analytics.summarize(manifest["campaign"], rows, llm)
    opt = optimization.suggest_next(llm)

    report = {
        "campaign": manifest["campaign"], "metrics": rows, "analysis": summary,
        "optimization": opt, "content": content,
        "modes": {"llm_live": llm.live, "crm_live": crm.live},
        "crm_request_count": manifest["crm_request_count"],
    }
    (run_dir / "report.json").write_text(json.dumps(report, indent=2))


@app.route("/")
def index():
    report = _latest_report()
    return render_template(
        "index.html",
        mode=config.mode_banner(),
        report=report,
        personas=PERSONAS,
        persona_names={p["id"]: p["name"] for p in PERSONAS},
        campaigns=storage.all_campaigns(),
        averages=[a for a in storage.averages_by_persona() if a["persona_id"] in PERSONA_BY_ID],
    )


@app.route("/run", methods=["POST"])
def run():
    topic = (request.form.get("topic") or "AI in creative automation").strip()
    _run_pipeline(topic)
    return redirect(url_for("index"))


if __name__ == "__main__":
    app.run(debug=True, port=5000)
