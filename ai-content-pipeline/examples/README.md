# Company profiles

A **company profile** is the single file that makes this pipeline work for any company.
Swap the profile and the engine changes who it targets, what it says, and how it segments —
nothing else in the code changes.

- **`ramp.json`** — finance automation (cards, expenses, bills, procurement). Segments by *organizational role*
  (finance leader / controller / employee spender).
- **`square.json`** — SMB commerce and payments. Segments by *business stage*
  (new seller / growing business / multi-location operator).
- **`datadog.json`** — AI observability & security platform. Segments by *accountability in production*
  (platform leader / SRE / security / finance).
- **`_template.json`** — the schema, with each field annotated. Fill this in for a new company.

Run any profile:

```bash
python main.py run --profile examples/ramp.json
```

When used as a Claude skill (see `../SKILL.md`), Claude proposes the personas, Shiva confirms
them, and the confirmed profile is written and run automatically.

## Schema (top level)

| Field | Purpose |
|---|---|
| `name` | Company name (display + run label) |
| `context` | 1–2 sentences on what the company sells and to whom — steers the LLM |
| `segmentation_logic` | How and *why* the audience is split this way (the clearest PMM signal) |
| `blog` | `title`, `outline[]`, `draft` (400–600 words) |
| `personas[]` | Each: `id`, `name`, `segment`, `angle`, `engagement`, `audience_size`, `newsletter` |
| `optimization` | `next_topics[]`, `headline_variants[]`, `rationale` (rationale is auto-set from the actual top segment) |
