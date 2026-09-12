"""Stage 1 — AI content generation.

Given a topic, produce:
  * a blog post (title, outline, 400-600 word draft)
  * one newsletter variant per persona (subject, preview, body)

Returned as a single structured dict and persisted as JSON + Markdown.
"""

import json
from datetime import datetime, timezone

from .llm import LLM
from .personas import PERSONAS, active_company


def generate_content(topic: str, llm: LLM | None = None) -> dict:
    llm = llm or LLM()
    company = active_company()
    system = (
        f"You are the senior content marketer for {company['name']}. {company['context']} "
        f"You segment the audience {company['segmentation_logic']}."
    )

    persona_brief = "\n".join(
        f"- {p['id']} ({p['name']}): {p['angle']}" for p in PERSONAS
    )
    newsletter_shape = ",\n".join(
        f'    "{p["id"]}": {{"subject": "...", "preview": "...", "body": "..."}}'
        for p in PERSONAS
    )

    prompt = f"""[[TASK:CONTENT]]
TOPIC: {topic}

Write one weekly blog post for {company['name']} and then derive {len(PERSONAS)} newsletter
variants, one per persona below. Personas:
{persona_brief}

Output a JSON object with this exact shape:
{{
  "blog": {{
    "title": "string",
    "outline": ["string", ...],          // 5-7 bullets
    "draft": "string"                      // 400-600 words, plain text, \\n between paragraphs
  }},
  "newsletters": {{
{newsletter_shape}
  }}
}}
Each newsletter body must be 70-120 words, address the reader as "Hi {{first_name}},",
match its persona's angle, and end with a single clear CTA to read the post."""

    content = llm.complete_json(system, prompt)
    content = _validate(content, topic)

    content["meta"] = {
        "topic": topic,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": "claude" if llm.live else "mock-template",
        "personas": [p["id"] for p in PERSONAS],
    }
    return content


def _validate(content: dict, topic: str) -> dict:
    """Guard against a model omitting a persona or field."""
    content.setdefault("blog", {})
    content["blog"].setdefault("title", f"Automation trends: {topic}")
    content["blog"].setdefault("outline", [])
    content["blog"].setdefault("draft", "")
    nl = content.setdefault("newsletters", {})
    for p in PERSONAS:
        v = nl.setdefault(p["id"], {})
        v.setdefault("subject", f"{topic} for {p['name']}")
        v.setdefault("preview", "")
        v.setdefault("body", f"Hi {{first_name}},\n\nNew this week: {topic}.\n\n→ Read the post")
    return content


def to_markdown(content: dict) -> str:
    """Render the package as human-readable Markdown for the CMS / review."""
    b = content["blog"]
    lines = [
        f"# {b['title']}",
        "",
        f"*Topic: {content['meta']['topic']} · generated {content['meta']['generated_at']} "
        f"via {content['meta']['model']}*",
        "",
        "## Outline",
        "",
    ]
    lines += [f"{i+1}. {o}" for i, o in enumerate(b["outline"])]
    lines += ["", "## Draft", "", b["draft"], "", "---", "", "## Newsletter variants", ""]
    for pid, v in content["newsletters"].items():
        lines += [
            f"### `{pid}`",
            f"**Subject:** {v['subject']}  ",
            f"**Preview:** {v.get('preview','')}",
            "",
            v["body"],
            "",
        ]
    return "\n".join(lines)


def save(content: dict, run_dir) -> dict:
    """Persist JSON + Markdown. Returns paths."""
    json_path = run_dir / "content.json"
    md_path = run_dir / "content.md"
    json_path.write_text(json.dumps(content, indent=2))
    md_path.write_text(to_markdown(content))
    return {"json": str(json_path), "markdown": str(md_path)}
