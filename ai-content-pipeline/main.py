"""SignalLoop — CLI orchestrator.

Runs the full loop end-to-end:
    generate content -> distribute via CRM -> log & analyze performance ->
    suggest next content.

Usage:
    python main.py run --topic "AI in creative automation"
    python main.py history          # show stored campaigns + lifetime averages
    python main.py optimize         # next-topic suggestions from history only

Everything works with no API keys (mock mode). Add keys in .env to go live.
"""

import argparse
import json
import sys
from datetime import datetime, timezone

from tabulate import tabulate

import config
from pipeline import (
    analytics,
    content_generation,
    distribution,
    optimization,
    report,
    storage,
)
from pipeline.crm import HubSpotClient
from pipeline.llm import LLM
from pipeline.personas import PERSONA_BY_ID, use_company, active_company


def _hr(title: str):
    print(f"\n{'='*70}\n{title}\n{'='*70}")


def cmd_run(args):
    if getattr(args, "profile", None):
        from pipeline.personas import load_profile
        load_profile(args.profile)
    else:
        use_company(args.company)
    topic = args.topic or active_company()["blog"]["title"]
    campaign_id = "cmp_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    run_dir = config.RUNS_DIR / campaign_id
    run_dir.mkdir(parents=True, exist_ok=True)

    print(f"SignalLoop | company={active_company()['name']} | {config.mode_banner()}")
    print(f"Campaign: {campaign_id}  ·  topic: {topic!r}")

    llm = LLM()
    crm = HubSpotClient()

    # --- Stage 1: content ------------------------------------------------
    _hr("STAGE 1 · AI CONTENT GENERATION")
    content = content_generation.generate_content(topic, llm)
    paths = content_generation.save(content, run_dir)
    print(f"Blog title : {content['blog']['title']}")
    print(f"Draft words: {len(content['blog']['draft'].split())}")
    print(f"Newsletters: {', '.join(content['newsletters'].keys())}")
    print(f"Saved      : {paths['markdown']}")

    # --- Stage 2: distribution ------------------------------------------
    _hr("STAGE 2 · CRM + NEWSLETTER DISTRIBUTION")
    manifest = distribution.distribute(content, campaign_id, crm)
    for pid, n in manifest["sample_sends_by_persona"].items():
        print(f"  {PERSONA_BY_ID[pid]['name']:<32} -> {n} sample sends "
              f"/ {manifest['audience_by_persona'][pid]} in segment "
              f"(subject: {manifest['subjects'][pid][:42]})")
    print(f"HubSpot API calls made: {manifest['crm_request_count']} "
          f"({'LIVE' if crm.live else 'mock'})")
    (run_dir / "crm_requests.json").write_text(
        json.dumps(manifest["crm_request_log"], indent=2))

    # --- Stage 3: performance -------------------------------------------
    _hr("STAGE 3 · PERFORMANCE LOGGING & ANALYSIS")
    rows = analytics.simulate_performance(manifest)
    analytics.persist(manifest["campaign"], rows)
    table = [[
        PERSONA_BY_ID[r["persona_id"]]["name"], r["sent"], r["delivered"],
        f"{r['open_rate']*100:.1f}%", f"{r['click_rate']*100:.1f}%",
        f"{r['unsub_rate']*100:.2f}%",
    ] for r in rows]
    print(tabulate(table, headers=["Persona", "Audience", "Deliv.", "Open", "Click", "Unsub"]))

    summary = analytics.summarize(manifest["campaign"], rows, llm)
    print(f"\nAI summary:\n  {summary['summary']}")
    print("Recommendations:")
    for rec in summary["recommendations"]:
        print(f"  • {rec}")

    # --- Stage 4 (bonus): optimization ----------------------------------
    _hr("STAGE 4 · AI CONTENT OPTIMIZATION (bonus)")
    opt = optimization.suggest_next(llm)
    print("Next topics:")
    for t in opt["next_topics"]:
        print(f"  • {t}")
    print("Headline A/B options:")
    for h in opt["headline_variants"]:
        print(f"  • {h}")
    print(f"Rationale: {opt['rationale']}")

    # --- Persist the full run report ------------------------------------
    report_data = {
        "company": active_company()["name"],
        "campaign": manifest["campaign"],
        "metrics": rows,
        "analysis": summary,
        "optimization": opt,
        "modes": {"llm_live": llm.live, "crm_live": crm.live},
    }
    (run_dir / "report.json").write_text(json.dumps(report_data, indent=2))
    report_path = report.write_report(
        run_dir, active_company()["name"], content, manifest, rows, summary, opt)
    _hr("DONE")
    print(f"Full run artifacts in: {run_dir}")
    print(f"Open the report:       {report_path}")


def cmd_history(args):
    campaigns = storage.all_campaigns()
    if not campaigns:
        print("No campaigns stored yet. Run: python main.py run --topic '...'")
        return
    print(tabulate(
        [[c["send_date"], c["id"], c["topic"], c["blog_title"][:50]] for c in campaigns],
        headers=["Send date", "Campaign", "Topic", "Blog title"]))
    _hr("LIFETIME AVERAGES BY PERSONA")
    avgs = storage.averages_by_persona()
    print(tabulate(
        [[PERSONA_BY_ID[a["persona_id"]]["name"], a["campaigns"],
          f"{a['avg_open']*100:.1f}%", f"{a['avg_click']*100:.1f}%",
          f"{a['avg_unsub']*100:.2f}%"] for a in avgs if a["persona_id"] in PERSONA_BY_ID],
        headers=["Persona", "Campaigns", "Avg open", "Avg click", "Avg unsub"]))


def cmd_optimize(args):
    opt = optimization.suggest_next(LLM())
    print(json.dumps(opt, indent=2))


def build_parser():
    p = argparse.ArgumentParser(description="SignalLoop: write, send, measure, improve")
    sub = p.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="run the full pipeline for a topic")
    run.add_argument("--company", default="zip", choices=["zip", "shopify"],
                     help="built-in example company profile")
    run.add_argument("--profile", default=None,
                     help="path to a custom company profile JSON (overrides --company)")
    run.add_argument("--topic", default=None,
                     help="content topic (defaults to the company's seed blog)")
    run.set_defaults(func=cmd_run)

    hist = sub.add_parser("history", help="show stored campaigns & averages")
    hist.set_defaults(func=cmd_history)

    opt = sub.add_parser("optimize", help="suggest next content from history")
    opt.set_defaults(func=cmd_optimize)
    return p


if __name__ == "__main__":
    args = build_parser().parse_args()
    try:
        args.func(args)
    except KeyboardInterrupt:
        sys.exit(130)
