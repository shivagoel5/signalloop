"""Stage 4 (bonus) — AI-driven content optimization.

Reads accumulated engagement history and asks the LLM to recommend the next
blog topics and headline variants, biased toward what has actually performed.
"""

from . import storage
from .llm import LLM
from .personas import PERSONA_BY_ID, active_company


def suggest_next(llm: LLM | None = None) -> dict:
    llm = llm or LLM()
    system = (
        f"You are {active_company()['name']}'s content strategist. Using real engagement "
        "data, you decide what to publish next and how to title it to maximize click-through."
    )
    # History spans every company that has run; only rank the active company's personas.
    averages = [a for a in storage.averages_by_persona() if a["persona_id"] in PERSONA_BY_ID]
    campaigns = storage.all_campaigns()

    if averages:
        perf_lines = [
            f"- {PERSONA_BY_ID[a['persona_id']]['name']}: avg open "
            f"{a['avg_open']*100:.1f}%, avg click {a['avg_click']*100:.1f}% "
            f"over {a['campaigns']} sends"
            for a in averages
        ]
        recent_topics = ", ".join(c["topic"] for c in campaigns[:5]) or "none yet"
    else:
        perf_lines = ["- No engagement history yet."]
        recent_topics = "none yet"

    prompt = f"""[[TASK:OPTIMIZE]]
Engagement so far:
{chr(10).join(perf_lines)}
Recent topics already covered: {recent_topics}

Recommend the next content slate. Return JSON:
{{"next_topics": ["4 fresh blog topics that build on what's working"],
  "headline_variants": ["3 A/B headline options for the top topic"],
  "rationale": "1-2 sentences tying the picks to the data"}}"""

    result = llm.complete_json(system, prompt)
    result.setdefault("next_topics", [])
    result.setdefault("headline_variants", [])
    result.setdefault("rationale", "")

    # Ground the rationale in the actual top performer so it stays consistent
    # with the performance stage (no "Stage 3 says X won but Stage 4 says Y").
    if averages:
        top = max(averages, key=lambda a: a["avg_click"])
        top_name = PERSONA_BY_ID.get(top["persona_id"], {}).get("name", top["persona_id"])
        result["rationale"] = (
            f"{top_name} drove the strongest click-through ({top['avg_click']*100:.1f}%), "
            f"so the next slate leans into the angle that resonated with that segment."
        )
    return result
