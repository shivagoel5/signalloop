# Company profiles

A **company profile** is the single file that makes this pipeline work for any company.
Swap the profile and the engine changes who it targets, what it says, and how it segments —
nothing else in the code changes.

- **`zip.json`** — enterprise procurement software. Segments by *organizational role*
  (procurement leader / finance leader / business requester).
- **`shopify.json`** — SMB commerce platform. Segments by *business stage*
  (first-time founder / growing brand / established retailer).
- **`datadog.json`** — AI observability & security platform. Segments by *accountability in production*
  (platform leader / SRE / security / finance).
- **`_template.json`** — the schema, with each field annotated. Fill this in for a new company.

Run any profile:

```bash
python main.py run --profile examples/zip.json
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
