#!/bin/bash
set -e
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
echo "Building shiva-content-engine ..."
mkdir -p "shiva-content-engine"
cat > "shiva-content-engine/README.md" <<'CE_EOF_8842'
# shiva-content-engine

An **AI-native content operating system**, packaged as a Claude Code skill.

It's not "AI at every step." It's a pipeline where each stage is assigned to
whoever — model or human — is better at it, with explicit gates so nothing
load-bearing ships unverified.

```
0. BRIEF GATE   → fix goal, audience, key message, format(s), 1 success metric
1. RESEARCH     → AI breadth; every claim logged with a source
2. SYNTHESIS    → AI outlines; human picks the angle/POV
3. DRAFT        → AI drafts from approved outline + voice profile
4. EDIT         → Pass A: accuracy/technical | Pass B: human voice
5. REPURPOSE    → 1 source → N channel-native derivatives
6. EVAL GATE    → pre-publish checklist on every output
        ↑ performance loop feeds learnings back into stage 0
```

## How it maps to "AI-native" requirements

| Requirement | Where it lives |
|---|---|
| Repeatable research → synthesis → writing → editing → iteration workflow | `SKILL.md` (stages 0–4) |
| Lightweight automation: prompt libraries, templates, eval checklists, repurposing pipeline | `references/prompt-library.md`, `assets/brief-template.md`, `assets/eval-checklist.md`, `references/repurposing-map.md` |
| Use AI to instrument & analyze performance | `SKILL.md` performance loop + prompt #7 |
| Judgment about when AI helps vs. human craft / validation required | `SKILL.md` AI-vs-human table; accuracy hard gate |

## Repo structure

```
shiva-content-engine/
├── SKILL.md                      # the operating system (stages 0–6)
├── references/
│   ├── prompt-library.md         # versioned prompt functions (v1.0)
│   ├── repurposing-map.md        # per-format transform specs
│   └── voice-profile.md          # voice rules + AI tells to cut
└── assets/
    ├── brief-template.md         # stage-0 input contract
    └── eval-checklist.md         # stage-6 pre-publish gate
```

## Use it

In Claude Code with this skill installed:

> "Research [topic], draft a LinkedIn post + thread, run the eval gate."
> "Repurpose this blog post into a newsletter blurb and a short-video script."
> "Is this draft ready to publish?"

The skill runs the brief gate, sources its research, keeps the thesis human-owned,
drafts in voice, edits in two passes, repurposes natively, and checks every output
against the pre-publish gate before calling it done.

## Design principle

AI for the high-volume / low-stakes-per-unit 80%; human for the low-volume /
high-stakes 20%. **AI is never the final gate on a load-bearing claim.**
CE_EOF_8842
mkdir -p "shiva-content-engine"
cat > "shiva-content-engine/SKILL.md" <<'CE_EOF_8842'
---
name: shiva-content-engine
description: >
  Shiva's AI-native content operating system. Runs a repeatable pipeline —
  brief gate → AI-assisted research → synthesis → drafting → two-pass edit →
  repurposing into N channel-native derivatives → pre-publish eval gate — while
  keeping factual accuracy and Shiva's voice locked. Use this whenever Shiva
  wants to research, draft, edit, or repurpose a piece of content (blog post,
  LinkedIn post, thread, newsletter, short-video script, carousel), turn one
  source asset into multiple formats, run a content brief, or check a draft
  against a publish checklist. Trigger even when they just say "repurpose this,"
  "turn my post into a thread + newsletter," "draft me a LinkedIn post about X,"
  "research X for a piece," or "is this ready to publish?" — any
  research → synthesis → write → edit → distribute content task is this skill.
---

# Shiva's Content Engine

An AI-native content operating system. The point is not "use AI at each step" —
it's that each stage is assigned to whoever (AI or human) is better at it, with
explicit gates so nothing load-bearing ships unverified.

**Core principle:** AI leads on breadth, first drafts, format transforms, and
summarization. The human (Shiva) owns the thesis, anything factually or
technically load-bearing, and final brand voice. AI is never the final gate on a
load-bearing claim.

---

## The pipeline (run in order)

```
0. BRIEF GATE   → fix goal, audience, key message, format(s), 1 success metric
1. RESEARCH     → AI breadth; every factual claim logged with a source
2. SYNTHESIS    → AI clusters/outlines; HUMAN picks the angle/POV
3. DRAFT        → AI drafts from approved outline + voice profile
4. EDIT         → Pass A: accuracy/technical  |  Pass B: human voice
5. REPURPOSE    → 1 source asset → N channel-native derivatives
6. EVAL GATE    → run the pre-publish checklist on every output
```

Do not skip stage 0 or stage 6. They are what make this repeatable rather than a
vibe, and they're the artifacts that prove the system works.

---

## Stage 0 — Brief gate (the input contract)

Never draft from a vibe. Before any research or writing, fill the brief in
`assets/brief-template.md`. If Shiva gives a one-line request, draft the brief
yourself from it and show it back for a quick confirm — do not silently invent a
goal or audience.

Minimum fields: **goal · audience · single key message · format(s) · primary
distribution channel · one success metric.** If the success metric is missing,
ask for it — it's what closes the loop in stage 6 and the next brief.

---

## Stage 1 — Research

Use AI for breadth and speed, but treat every AI-stated fact as a *hypothesis to
verify*, never as ground truth. Maintain a running source log: claim → source →
checked? Anything you can't source gets cut or flagged, never smoothed over.

This is Shiva's zero-fabrication rule applied to content: no invented stats, no
fabricated quotes, no confident claims without a source behind them.

When current facts matter (news, releases, figures, who-holds-what), use
`web_search` — do not answer from memory.

---

## Stage 2 — Synthesis

AI clusters the research and proposes an outline + 2–3 candidate angles. **The
human picks the angle.** The thesis/POV is the single thing AI is worst at and
the thing that carries the piece — surface options, let Shiva choose, then lock
it before drafting.

Output of this stage: an approved outline with one explicit thesis sentence at
the top.

---

## Stage 3 — Draft

Draft from the *approved outline only*, with the voice profile in
`references/voice-profile.md` loaded into context so voice is enforced, not
hoped for. Use the relevant prompt from `references/prompt-library.md` for the
format being drafted.

Draft against the brief's key message — one piece, one message. If the draft
starts carrying two messages, that's two pieces.

---

## Stage 4 — Edit (two separate passes)

Run these as **two distinct passes**, not one blended read:

- **Pass A — accuracy & technical.** Re-verify every factual/technical claim
  against the source log. For anything load-bearing (code, architecture claims,
  product specifics, metrics), this pass is human-owned or done by a fresh model
  with no investment in the draft. Being wrong here is expensive.
- **Pass B — voice & craft.** Read for Shiva's voice, rhythm, and the CTA.
  Cut AI tells (hedging, throat-clearing, "in today's landscape," symmetrical
  triads, over-hedged claims). See `references/voice-profile.md`.

---

## Stage 5 — Repurpose

This is the highest-leverage stage: one approved source asset → many
channel-native derivatives. Do **not** copy-paste the same text into each
channel — each format has its own native shape, length, and opening move. Use
the transform specs in `references/repurposing-map.md` and the matching prompt
in `references/prompt-library.md`.

Default derivative set from a long-form source: LinkedIn post · X/thread ·
newsletter blurb · short-video script · carousel outline. Generate only the
formats named in the brief.

Each derivative must stand alone (no "as I wrote in my post above") and carry
the brief's single key message in its own native voice.

---

## Stage 6 — Eval gate (pre-publish)

Run `assets/eval-checklist.md` on **every** output before it's "done." Same
discipline as Shiva's CV ATS/orphan checks: a piece isn't finished because it
reads well, it's finished because it passes the gate. Report pass/fail per item;
fix fails before presenting as ready.

---

## AI-vs-human judgment (the line that makes this "native")

| AI leads | Human owns |
|---|---|
| Breadth research, first drafts | The thesis / POV |
| Format transforms, summarization | Load-bearing facts, code, product specifics |
| Pattern-finding across volume | Brand-voice nuance, relationships |
| Divergent ideation | Anything where being wrong erodes trust |

Operating rule: AI for the high-volume / low-stakes-per-unit 80%; human for the
low-volume / high-stakes 20%. **AI is never the final gate on a load-bearing
claim.** Being able to name where you deliberately *don't* use AI is what
separates sounding AI-native from being it.

---

## Performance loop (closes back into stage 0)

After a piece ships, when Shiva has signals (engagement, sentiment, recurring
questions, conversions), use AI for the qualitative→quantitative bridge: read
the comment volume and surface the 3–5 themes, the emerging questions worth a
next piece, and what's resonating. Then feed learnings back into the brief
template defaults ("formats that convert," "topics that overperform"). If
instrumentation doesn't change a future brief, it's just reporting — push it
into stage 0.

---

## Reference files

- `references/prompt-library.md` — versioned prompt functions per stage/format.
  Read when drafting or repurposing.
- `references/repurposing-map.md` — per-format transform specs (shape, length,
  opening move). Read at stage 5.
- `references/voice-profile.md` — Shiva's voice rules + AI tells to cut. Read
  at stages 3 and 4B.
- `assets/brief-template.md` — the stage-0 input contract. Fill at stage 0.
- `assets/eval-checklist.md` — the stage-6 pre-publish gate. Run at stage 6.
CE_EOF_8842
mkdir -p "shiva-content-engine/assets"
cat > "shiva-content-engine/assets/brief-template.md" <<'CE_EOF_8842'
# Content Brief — [working title]

> The input contract. No drafting until this is filled. If only a one-line
> request exists, draft this from it and confirm before moving on.

| Field | Value |
|---|---|
| **Goal** (what should this *do*?) | |
| **Audience** (who specifically?) | |
| **Single key message** (one sentence) | |
| **Format(s)** | e.g. long-form + LinkedIn + thread |
| **Primary distribution channel** | |
| **Success metric** (the one number) | |
| **Thesis / POV** (filled at stage 2) | |
| **Source log link** (stage 1) | |

## Notes / constraints
-

## Learnings carried forward (from past performance loops)
> Defaults that overperformed in prior pieces — formats that convert, topics
> that land, hooks that worked. Update this after each performance loop.
-
CE_EOF_8842
mkdir -p "shiva-content-engine/assets"
cat > "shiva-content-engine/assets/eval-checklist.md" <<'CE_EOF_8842'
# Pre-Publish Eval Checklist

Run on **every** output before it's "done." Report pass/fail per item. Fix fails
before presenting as ready. A piece passes the gate, not the vibe check.

## Accuracy (hard gate — any fail blocks publish)
- [ ] Every factual/statistical claim traces to a source in the log
- [ ] No fabricated stats, quotes, names, dates, or metrics
- [ ] Load-bearing technical/product claims human-verified
- [ ] No claim stated with more confidence than the source supports

## Message & structure
- [ ] Carries the brief's single key message (one piece, one message)
- [ ] Matches the locked thesis/POV from the brief
- [ ] Opening earns the next line (no throat-clearing intro)
- [ ] Clear CTA / next step present

## Voice (see references/voice-profile.md)
- [ ] Reads as Shiva, not as generic AI
- [ ] AI tells cut (hedging, "in today's landscape," symmetrical triads, em-dash overload)
- [ ] Length fits the channel, not padded to fill

## Channel fit (per derivative)
- [ ] Native shape for its channel (not a copy-paste of the source)
- [ ] Stands alone (no "as above" / "in my post")
- [ ] Discoverability handled (hook, tags, first-line/SEO where relevant)

## Distribution-ready
- [ ] All formats named in the brief are produced
- [ ] Each derivative carries the key message in its own voice
- [ ] Success metric is actually measurable for this piece
CE_EOF_8842
mkdir -p "shiva-content-engine/references"
cat > "shiva-content-engine/references/prompt-library.md" <<'CE_EOF_8842'
# Prompt Library (v1.0)

Versioned prompt *functions* — each has a purpose, named inputs, and a worked
example. Treat these like code: when you change one, bump its version and note
why. Do not paste raw — fill the `{{variables}}`.

**Contents**
1. Research scan
2. Synthesis & angle options
3. Draft (long-form)
4. Edit Pass A (accuracy)
5. Edit Pass B (voice)
6. Repurpose (per-format)
7. Performance synthesis

---

## 1. Research scan — v1.0
**Purpose:** breadth-first research with mandatory sourcing.
**Inputs:** `{{topic}}`, `{{audience}}`, `{{angle_hint}}`
```
Research {{topic}} for a piece aimed at {{audience}}. Angle leaning: {{angle_hint}}.
Return: (a) 8–12 distinct, non-obvious points; (b) for EACH point a source URL or
"UNSOURCED — needs verification"; (c) 3 counterpoints or risks; (d) 5 questions
the audience is actually asking. Do not state any statistic without a source.
Mark anything you're inferring vs. sourcing.
```

## 2. Synthesis & angle options — v1.0
**Purpose:** cluster research, propose angles, let the human choose.
**Inputs:** `{{research_dump}}`, `{{key_message}}`
```
Here is research: {{research_dump}}. Intended key message: {{key_message}}.
1. Cluster into 3–5 themes.
2. Propose 3 distinct angles/theses (one sentence each) — different POVs, not
   rewordings. For each, name who it's for and what it trades off.
3. Recommend one and say why in 2 sentences.
Do NOT write the piece. Stop at the outline + thesis options.
```

## 3. Draft long-form — v1.0
**Purpose:** draft from an approved outline, in voice.
**Inputs:** `{{approved_outline}}`, `{{thesis}}`, `{{voice_profile}}`, `{{length}}`
```
Draft a ~{{length}}-word piece from this approved outline ONLY: {{approved_outline}}.
Locked thesis (do not drift): {{thesis}}. Write in this voice: {{voice_profile}}.
One piece, one message. Open on a line that earns the next. End with a clear CTA.
Flag any spot where you'd want a fact you don't have rather than inventing one.
```

## 4. Edit Pass A — accuracy — v1.0
**Purpose:** adversarial fact/technical check.
**Inputs:** `{{draft}}`, `{{source_log}}`
```
Fact-check this draft adversarially against the source log. Draft: {{draft}}.
Sources: {{source_log}}. List every factual/technical/numeric claim. For each:
SUPPORTED / UNSUPPORTED / OVERSTATED, with the source or the gap. Flag any claim
more confident than its source. Do not fix voice — accuracy only.
```

## 5. Edit Pass B — voice — v1.0
**Purpose:** strip AI tells, restore Shiva's voice.
**Inputs:** `{{draft}}`, `{{voice_profile}}`
```
Edit for voice only (facts are locked). Voice target: {{voice_profile}}.
Cut: hedging, throat-clearing, "in today's landscape," symmetrical triads,
em-dash overload, padding. Keep it tight and human. Return the edited piece +
a 3-bullet list of the AI tells you removed.
```

## 6. Repurpose per-format — v1.0
**Purpose:** turn one approved source into a channel-native derivative.
**Inputs:** `{{source_asset}}`, `{{key_message}}`, `{{format}}`, `{{format_spec}}`
```
Turn this source into a {{format}} derivative: {{source_asset}}.
Key message to carry: {{key_message}}. Format spec: {{format_spec}}.
Make it native to the channel — its own opening move, length, and shape, NOT a
trimmed copy. It must stand alone (no "as above"). Return only the derivative.
```

## 7. Performance synthesis — v1.0
**Purpose:** qualitative→quantitative bridge after a piece ships.
**Inputs:** `{{comments_or_signals}}`, `{{piece_goal}}`
```
Here are engagement signals/comments for a piece whose goal was {{piece_goal}}:
{{comments_or_signals}}. Surface: (a) top 3–5 themes; (b) emerging questions
worth a next piece; (c) what resonated vs. fell flat; (d) one concrete change to
the brief template defaults for next time. Be specific, not flattering.
```
CE_EOF_8842
mkdir -p "shiva-content-engine/references"
cat > "shiva-content-engine/references/repurposing-map.md" <<'CE_EOF_8842'
# Repurposing Map

Per-format transform specs for stage 5. Each format has its own native shape —
never copy-paste the source across channels. Use these specs in prompt #6.

| Format | Length | Opening move | Shape | Native rules |
|---|---|---|---|---|
| **LinkedIn post** | 120–250 words | One-line hook on its own line | Hook → 2–3 short grafs → CTA | First 2 lines must work before "…see more"; whitespace between grafs; 0–3 tags |
| **X / thread** | 5–9 posts | Tweet 1 = the whole payoff in one line | One idea per post; numbered or flowing | Each post quotable alone; last post = CTA/loop-back; no "1/" if flowing |
| **Newsletter blurb** | 80–150 words | Subject-line-worthy first sentence | Context → insight → link out | Warmer/personal voice; one link, one ask |
| **Short-video script** | 30–60 sec | First 3 sec = the hook (no intro) | Hook → 2–3 beats → payoff | Spoken cadence; on-screen text cues in [brackets]; no "hey guys welcome" |
| **Carousel outline** | 6–10 slides | Slide 1 = hook + promise | 1 idea/slide; slide N = CTA | Each slide one sentence + visual note; designed to swipe |

## Defaults
- From a long-form source, default derivative set = LinkedIn + thread +
  newsletter blurb. Add video script / carousel only when the brief asks.
- Every derivative carries the brief's single key message in its own voice and
  must stand alone.

## Anti-patterns (auto-fail at eval gate)
- Same paragraph pasted into 3 channels
- "As I wrote above / link in my last post" inside a standalone derivative
- A thread that's just the blog post chopped at sentence boundaries
- A video script that opens with a greeting instead of the hook
CE_EOF_8842
mkdir -p "shiva-content-engine/references"
cat > "shiva-content-engine/references/voice-profile.md" <<'CE_EOF_8842'
# Voice Profile

Read at stage 3 (draft) and stage 4B (voice edit). This is a starting profile —
refine it as Shiva reacts to drafts.

## Voice target
- Clear, direct, senior-PMM register. Confident without hype.
- Leads with the point, then supports it. No long wind-ups.
- Concrete over abstract: a number, an example, or a named mechanism beats an
  adjective.
- Comfortable being opinionated — a real POV, not "it depends" mush.
- Plain English over jargon; when jargon earns its place, it's precise.

## AI tells to cut (stage 4B)
- Throat-clearing intros: "In today's fast-paced landscape…", "As we all know…"
- Hedging stacks: "it's worth noting that it could potentially…"
- Symmetrical triads everywhere ("X, Y, and Z" on repeat)
- Em-dash overload and the "It's not just X — it's Y" cadence on loop
- Empty connectors: "Moreover," "Furthermore," "In conclusion"
- Flattery and filler: "Great question," "Absolutely," padding to length
- Confident claims with no source behind them (also an accuracy fail)

## Quick test
Read it aloud. If it sounds like a press release or a model trying to sound
smart, cut. If it sounds like Shiva explaining something they actually know to
a smart colleague, keep.
CE_EOF_8842
cat > README.md <<'CE_EOF_8842'
# AI PMM Workflows

**Product-marketing judgment, turned into systems that run.** A series of AI-powered workflows
by **Shiva Goel** — each one takes a piece of PMM thinking (who to target, what to say,
what to do next) and turns it into a repeatable, runnable workflow. The throughline: *the
judgment drives the automation, not the other way around.*

### 👉 [**View the case study**](https://signalloop-shiva.netlify.app) &nbsp;·&nbsp; a walkthrough with diagrams and real output

![Content pipeline — write, send, measure, improve](./assets/preview-flow.png)

---

## What's inside

Each workflow is a self-contained folder that works **two ways** — as a **Claude skill**
(`SKILL.md`, invoked in chat) and as a **runnable program** (`python main.py`), sharing the
same code.

| Workflow | What it does | Status |
|---|---|---|
| [**ai-content-pipeline**](./ai-content-pipeline) | Give it a company or an ICP → it proposes buyer personas (*you confirm them*) → generates a blog + a newsletter tailored to each persona → simulates engagement → recommends what to publish next. Demonstrated on Ramp & Square. | ✅ Live |
| [**shiva-content-engine**](./shiva-content-engine) | The operating system behind the pipeline: brief gate → AI research (every claim sourced) → human-owned thesis → draft in voice → two-pass edit (accuracy, then voice) → repurpose into N channel-native formats → pre-publish eval gate, with a performance loop that feeds learnings back into the next brief. Ships a versioned prompt library, repurposing map, and checklists. | ✅ Live (Claude skill) |

*New workflows are added here only once they run end-to-end and produce real output.*

## The idea in one line

A blog and three newsletters from one topic isn't the interesting part — **the segmentation is.**
A CFO and a first-time founder need different messages, so the workflow makes the audience model
explicit and puts a human checkpoint on it: **AI proposes the personas, the PMM confirms, then the
system executes.** That checkpoint is the whole point.

## Run it (no API keys needed)

```bash
cd ai-content-pipeline
pip install -r requirements.txt
python main.py run --company ramp         # built-in example
python main.py run --profile examples/square.json    # or any company profile
```

Each run writes a self-contained `report.html` (generate → distribute → measure → optimize).
See [`ai-content-pipeline/`](./ai-content-pipeline) for the skill workflow and full docs.

---

<sub>Independent portfolio project. Company names and any company figures are used illustratively
and belong to their owners; all engagement metrics shown are simulated for demonstration.</sub>
CE_EOF_8842
echo ""
echo "Done. Changes:"
git status --short
