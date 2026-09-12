---
name: ai-content-pipeline
description: >-
  Generates a complete segmented content package for a target company — one blog plus a
  tailored newsletter for each buyer persona — followed by a simulated performance report
  and next-content recommendations, using a persona-gated workflow. Use whenever Shiva
  wants to create segmented marketing or newsletter content for a specific company or
  audience. Two entry points: they give a COMPANY NAME (the skill researches it and proposes
  personas) or a description of USER PAIN POINTS / ICP (the skill structures them into
  personas). The skill ALWAYS proposes the personas first and waits for Shiva's confirmation
  or edits before generating any content. Trigger on phrasings like "run the content pipeline
  for [company]", "make segmented newsletters for [company]", "generate persona-tailored
  content for [audience]", "turn these pain points into targeted content", or when they paste
  ICP notes / interview snippets and wants targeted content produced from them.
---

# SignalLoop

A performance-driven content engine: one topic in → a blog + a newsletter tailored to each
buyer persona → a simulated performance report → recommendations for what to publish next.
The defining principle is **the judgment drives the automation, not the other way around** —
Claude proposes the audience segmentation, but Shiva confirms it before anything is written.

This skill is both a **Claude workflow** (invoked in chat, below) and a **runnable program**
(`python main.py`, for the GitHub/portfolio version). Both share the same `pipeline/` code.

## When to use

Shiva wants segmented content for a company or audience and provides ONE of:
- a **company name** (e.g. "Ramp", "Square") → research it, propose personas, or
- **user pain points / an ICP description / interview notes** → structure them into personas.

## Workflow (follow in order)

### 1. Get the input
Ask which entry point applies if it isn't clear:
- Company name → understand what the company sells and to whom (use known facts or web
  research; ground in real customer evidence where possible, e.g. a customer-stories page).
- Pain points / ICP → read the material they pasted.
Also ask for an optional **topic**; if none, derive a sensible weekly-blog topic.

### 2. Propose the personas — then STOP
Derive **2–4 personas**. For each, give: a short id, a display **name** (role *or* business
stage), and the **angle** the content should lead with. State the **segmentation logic** and
*why* it fits this market (e.g. enterprise → segment by organizational role; SMB → segment by
business stage, because one owner wears every hat).

**Then present the personas to Shiva and explicitly ask them to confirm, edit, add, or remove
them. Do NOT generate any blog or newsletter content until they respond.** This gate is the
point of the skill: AI proposes, the PMM decides, then the system executes.

Be honest about method: persona segmentation derived from a website or a model is a strong
*proposal*, not validated truth — note that real segmentation would be confirmed with customer
interviews and CRM data. Never invent metrics or fabricate customer quotes.

### 3. After Shiva confirms — generate
Once they approve (with any edits applied), write a **company profile JSON** matching the schema
in `examples/_template.json` (`examples/ramp.json` and `examples/square.json` are filled
reference examples). Fill in:
- `blog` — title, 5–7 point outline, a 400–600 word draft.
- one `newsletter` per confirmed persona — subject, preview, and a 70–120 word body in that
  persona's angle, addressed "Hi {first_name},", ending in one clear CTA.
- sensible `engagement` priors and `audience_size` per persona (more-engaged buyers open/click
  a little more; this is a prior for the simulation, not a claim).

Save it (e.g. `data/profiles/<company>.json`) and run the pipeline:

```bash
python main.py run --profile data/profiles/<company>.json
```

This produces, in `data/runs/<campaign>/`:
- `content.md` / `content.json` — the blog + all newsletters,
- `report.html` — a self-contained report (generate → distribute → measure → optimize),
- `report.json`, `crm_requests.json` — structured artifacts.

Open `report.html` to show Shiva the result, and summarize the top segment + recommendations
in chat.

### 4. (Optional) iterate
If Shiva wants to try a different segmentation or topic, edit the profile and re-run.
History accumulates in `data/pipeline.db` (`python main.py history`).

## Notes
- **No API keys required.** The pipeline runs in mock mode by default; the profile JSON already
  contains the content Claude wrote, so the run uses it directly. Setting `ANTHROPIC_API_KEY`
  and `HUBSPOT_MODE=live` switches the standalone program to live generation/sending.
- **Engagement is simulated** and labelled as such in every output.
- **Built-in examples** (`--company ramp` / `--company square`) exist for the portfolio demo;
  the `--profile` path is what makes the skill work for any company.
- Keep the segmentation logic explicit in the profile's `segmentation_logic` field — it's the
  clearest signal of PMM judgment in the whole artifact.
