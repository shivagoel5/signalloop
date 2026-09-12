"""Generates a polished, self-contained HTML report for a single pipeline run.

The report is the pipeline's real output — not a mockup. Open the resulting
report.html in any browser (or host it) to see exactly what the system produced.
CSS is intentionally conservative (tables + basic styling) so it renders
identically in modern browsers and simple screenshot tools.
"""

import html
from pathlib import Path

from .personas import PERSONA_BY_ID

CSS = """
body{margin:0;background:#EFEEE9;font-family:'Helvetica Neue',Arial,sans-serif;color:#1A1A1A}
.page{max-width:980px;margin:0 auto;padding:28px 18px 48px}
.card{background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E4E3DE}
.hd{background:#0F766E;color:#fff;padding:16px 28px;font-size:15px;font-weight:bold}
.hd .co{float:right;font-weight:normal;opacity:.85}
.body{padding:26px 28px 32px}
.meta{color:#8a8d92;font-size:12.5px;margin-bottom:22px}
h2{font-size:16px;margin:30px 0 12px;padding-top:18px;border-top:1px solid #EDEDEA}
h2:first-of-type{border-top:none;padding-top:0}
.step{color:#0F766E;font-weight:bold;font-size:11px;letter-spacing:1px}
.blog{background:#FBFAF7;border:1px solid #E5E5E0;border-radius:10px;padding:16px 18px}
.tag{background:#1A1A1A;color:#fff;font-size:10px;font-weight:bold;padding:3px 9px;border-radius:9px;margin-right:8px}
.blog .t{font-size:15px;font-weight:bold}
.blog .sub{color:#8a8d92;font-size:12px;margin-top:8px}
.blog .snip{color:#9a9a9a;font-size:11.5px;margin-top:4px;font-style:italic}
table{width:100%;border-collapse:collapse}
.nl{table-layout:fixed;margin-top:6px}
.nl td{vertical-align:top;width:33.33%;padding:0 6px}
.nlcard{border:1px solid #E0E6E4;border-top:4px solid #0F766E;border-radius:9px;padding:14px}
.nlcard .p{color:#0F766E;font-size:10.5px;font-weight:bold;letter-spacing:.5px}
.nlcard .s{font-size:13px;font-weight:bold;margin:6px 0}
.nlcard .pv{color:#9a9a9a;font-size:11px;font-style:italic}
.nlcard .b{color:#555;font-size:11px;margin-top:10px;line-height:1.5;white-space:pre-line}
.nlcard .cta{color:#0F766E;font-size:11px;font-weight:bold;margin-top:10px}
.dist td{padding:9px 6px;border-bottom:1px solid #F0F0EE;font-size:13px}
.seg{background:#E8F3F1;color:#0F766E;font-size:10.5px;font-weight:bold;padding:2px 9px;border-radius:9px}
.sent{background:#0F766E;color:#fff;font-size:10.5px;font-weight:bold;padding:4px 11px;border-radius:12px}
.perf th{text-align:left;color:#9a9a9a;font-size:10.5px;letter-spacing:.5px;padding:8px 6px;border-bottom:1px solid #E5E5E0}
.perf td{padding:11px 6px;border-bottom:1px solid #F2F2F0;font-size:13px}
.perf .num{text-align:right;font-family:'Courier New',monospace}
.perf tr.top td{background:#E8F3F1}
.perf .top .name{color:#0F766E;font-weight:bold}
.topbadge{background:#0F766E;color:#fff;font-size:9px;font-weight:bold;padding:2px 7px;border-radius:8px;margin-left:8px}
.ai{background:#FBFAF7;border:1px solid #E5E5E0;border-left:4px solid #0F766E;border-radius:10px;padding:16px 18px;margin-top:14px}
.ai .h{color:#0F766E;font-size:11px;font-weight:bold;letter-spacing:1px}
.ai p{font-size:13.5px;margin:10px 0}
.ai .rh{color:#9a9a9a;font-size:10.5px;font-weight:bold;letter-spacing:.5px;margin-top:6px}
.rec{font-size:13px;color:#444;margin:7px 0}
.topic{font-size:13.5px;color:#333;margin:9px 0}
.hl{display:inline-block;background:#E8F3F1;color:#0F766E;font-size:12.5px;font-weight:bold;padding:7px 12px;border-radius:8px;margin:4px 6px 4px 0}
.loop{color:#9a9a9a;font-size:11px;margin-top:18px}
"""


def _esc(s):
    return html.escape(str(s))


def write_report(run_dir, company, content, manifest, rows, summary, opt) -> str:
    blog = content["blog"]
    topic = content["meta"]["topic"]
    mode = "live (Claude + HubSpot)" if content["meta"]["model"] == "claude" else "mock data (no API keys)"
    words = len(blog["draft"].split())

    # Newsletter cards (one <td> each)
    cells = []
    for p in content["newsletters"]:
        v = content["newsletters"][p]
        name = PERSONA_BY_ID.get(p, {}).get("name", p)
        body = v["body"].split("\n\n")[0] + "…"
        cells.append(
            f'<td><div class="nlcard"><div class="p">{_esc(name).upper()}</div>'
            f'<div class="s">{_esc(v["subject"])}</div>'
            f'<div class="pv">{_esc(v.get("preview",""))}</div>'
            f'<div class="b">{_esc(body)}</div>'
            f'<div class="cta">→ Read the post</div></div></td>'
        )
    nl_table = '<table class="nl"><tr>' + "".join(cells) + "</tr></table>"

    # Distribution rows
    dist_rows = ""
    for r in rows:
        dist_rows += (
            f'<tr><td><b>{_esc(PERSONA_BY_ID[r["persona_id"]]["name"])}</b> &nbsp;<span class="seg">'
            f'{r["sent"]} in segment</span><br><span style="color:#8a8d92;font-style:italic">'
            f'"{_esc(r["subject"])}"</span></td>'
            f'<td style="text-align:right"><span class="sent">&#10003; SENT</span></td></tr>'
        )

    # Performance rows (highlight top click)
    top_id = max(rows, key=lambda r: r["click_rate"])["persona_id"]
    perf_rows = ""
    for r in rows:
        is_top = r["persona_id"] == top_id
        badge = '<span class="topbadge">TOP</span>' if is_top else ""
        perf_rows += (
            f'<tr class="{"top" if is_top else ""}">'
            f'<td class="name">{_esc(PERSONA_BY_ID[r["persona_id"]]["name"])}{badge}</td>'
            f'<td class="num">{r["sent"]}</td>'
            f'<td class="num">{r["open_rate"]*100:.1f}%</td>'
            f'<td class="num"><b>{r["click_rate"]*100:.1f}%</b></td>'
            f'<td class="num" style="color:#9a9a9a">{r["unsub_rate"]*100:.2f}%</td></tr>'
        )

    recs = "".join(f'<div class="rec">→ {_esc(x)}</div>' for x in summary.get("recommendations", []))
    topics = "".join(f'<div class="topic">→ {_esc(t)}</div>' for t in opt.get("next_topics", []))
    headlines = "".join(f'<span class="hl">{_esc(h)}</span>' for h in opt.get("headline_variants", []))

    doc = f"""<!doctype html><html><head><meta charset="utf-8">
<title>SignalLoop Report — {_esc(company)}</title><style>{CSS}</style></head><body>
<div class="page"><div class="card">
<div class="hd">SignalLoop — run report<span class="co">{_esc(company)}</span></div>
<div class="body">
<div class="meta">Campaign: &ldquo;{_esc(topic)}&rdquo; &nbsp;·&nbsp; {mode} &nbsp;·&nbsp; engagement simulated</div>

<h2><span class="step">STAGE 1 · GENERATE</span><br>One topic in → a blog + three tailored newsletters</h2>
<div class="blog"><span class="tag">BLOG</span><span class="t">{_esc(blog["title"])}</span>
<div class="sub">{len(blog["outline"])}-point outline · {words}-word draft · saved as JSON + Markdown</div>
<div class="snip">&ldquo;{_esc(blog["draft"][:130])}…&rdquo;</div></div>
{nl_table}

<h2><span class="step">STAGE 2 · DISTRIBUTE</span><br>The right version to the right people</h2>
<table class="dist">{dist_rows}</table>
<div style="color:#9a9a9a;font-size:11px;margin-top:8px">✓ Campaign logged · Real HubSpot v3 calls: Contacts · Lists · Single-send Email · Campaign object</div>

<h2><span class="step">STAGE 3 · MEASURE</span><br>Segment performance</h2>
<table class="perf"><tr><th>Persona</th><th class="num">Audience</th><th class="num">Open</th><th class="num">Click</th><th class="num">Unsub</th></tr>{perf_rows}</table>
<div class="ai"><div class="h">✦ AI PERFORMANCE SUMMARY</div><p>{_esc(summary.get("summary",""))}</p>
<div class="rh">RECOMMENDATIONS</div>{recs}</div>

<h2><span class="step">STAGE 4 · OPTIMIZE</span><br>What to publish next</h2>
{topics}
<div style="margin-top:14px"><div class="rh" style="color:#9a9a9a;font-size:10.5px;font-weight:bold;letter-spacing:.5px">A/B HEADLINE OPTIONS</div>{headlines}</div>
<div style="color:#9a9a9a;font-size:12px;margin-top:12px">Why: {_esc(opt.get("rationale",""))}</div>
<div class="loop">↻ These suggestions feed back into Stage 1 as the next run's input — the loop that makes each round sharper.</div>
</div></div></div></body></html>"""

    path = Path(run_dir) / "report.html"
    path.write_text(doc)
    return str(path)
