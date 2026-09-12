"""Thin LLM wrapper.

Uses the Anthropic Claude API when ANTHROPIC_API_KEY is set, otherwise falls
back to a deterministic template engine so the pipeline always runs. The rest
of the codebase only depends on `LLM.complete()` / `LLM.complete_json()` and
never touches the SDK directly — making the model provider swappable.
"""

import json
import re

import config


class LLM:
    def __init__(self):
        self.live = config.LLM_LIVE
        self._client = None
        if self.live:
            try:
                import anthropic
                self._client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
            except Exception as exc:  # noqa: BLE001
                print(f"  [llm] Could not init Anthropic client ({exc}); using MOCK.")
                self.live = False

    # ------------------------------------------------------------------ #
    def complete(self, system: str, prompt: str, max_tokens: int = 1500) -> str:
        """Return a plain-text completion."""
        if self.live:
            msg = self._client.messages.create(
                model=config.ANTHROPIC_MODEL,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": prompt}],
            )
            return "".join(b.text for b in msg.content if b.type == "text").strip()
        return _mock_text(system, prompt)

    def complete_json(self, system: str, prompt: str, max_tokens: int = 2000) -> dict:
        """Return a parsed JSON object. Robust to stray prose / code fences."""
        system = system + "\n\nReturn ONLY valid JSON. No prose, no code fences."
        raw = self.complete(system, prompt, max_tokens)
        return _extract_json(raw)


# --------------------------- JSON extraction ----------------------------- #
def _extract_json(raw: str) -> dict:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Grab the outermost {...} block as a fallback.
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise


# ----------------------------- Mock engine ------------------------------- #
# The mock engine inspects a routing tag we embed in each prompt so that the
# same wrapper can serve very different requests (content vs. summary vs.
# optimization) without any model. This keeps demos fully runnable offline.
def _mock_text(system: str, prompt: str) -> str:
    if "[[TASK:CONTENT]]" in prompt:
        return json.dumps(_mock_content(prompt))
    if "[[TASK:SUMMARY]]" in prompt:
        return json.dumps(_mock_summary(prompt))
    if "[[TASK:OPTIMIZE]]" in prompt:
        return json.dumps(_mock_optimize(prompt))
    return "MOCK_RESPONSE"


def _field(prompt: str, key: str, default: str = "") -> str:
    m = re.search(rf"{key}:\s*(.+)", prompt)
    return m.group(1).strip() if m else default


def _mock_content(prompt: str) -> dict:
    """Assemble blog + newsletters from the active company's profile templates."""
    from . import personas
    c = personas.active_company()
    return {
        "blog": c["blog"],
        "newsletters": {p["id"]: p["newsletter"] for p in c["personas"]},
    }


def _mock_summary(prompt: str) -> dict:
    # The orchestrator embeds a compact metrics table in the prompt; the mock
    # parses the best/worst click performers from it.
    rows = re.findall(r"([a-z_]+)\|open=([\d.]+)\|click=([\d.]+)\|unsub=([\d.]+)", prompt)
    if not rows:
        return {"summary": "No metrics available.", "recommendations": []}
    parsed = [(r[0], float(r[1]), float(r[2]), float(r[3])) for r in rows]
    best = max(parsed, key=lambda r: r[2])
    worst = min(parsed, key=lambda r: r[2])
    lift = round((best[2] - worst[2]) * 100, 1)
    return {
        "summary": (
            f"The '{best[0]}' segment led on engagement with a {best[2]*100:.1f}% click "
            f"rate — about {lift} points higher than '{worst[0]}'. Open rates were healthy "
            f"across segments, so the gap is driven by message-to-offer fit rather than "
            f"subject lines."
        ),
        "recommendations": [
            f"Double down on the angle that worked for '{best[0]}' — lead with the "
            f"concrete ROI/time-saved hook in future sends.",
            f"Rework the '{worst[0]}' variant: swap the abstract framing for a specific, "
            f"visual case study or before/after example.",
            "Add a single, unmissable primary CTA per email to lift click-through.",
        ],
    }


def _mock_optimize(prompt: str) -> dict:
    from . import personas
    return dict(personas.active_company()["optimization"])
