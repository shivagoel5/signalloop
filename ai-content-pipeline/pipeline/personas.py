"""Company profiles — the heart of the pipeline's reusability.

The same engine runs for any company by swapping the profile below. Each profile
carries the company context (steers the LLM), a seed blog, and the audience
personas — including each persona's content angle and a newsletter template.

Two profiles ship as examples, and they deliberately segment differently:

  zip      Enterprise procurement software → segments by ORGANIZATIONAL ROLE,
           because a large company has many distinct stakeholders.
  shopify  Commerce platform for SMB owners → segments by BUSINESS STAGE,
           because a small-business owner wears every hat, so "what stage is
           their business at" matters more than their job title.

That contrast is the point: the segmentation LOGIC adapts to the market, not
just the persona names. To run one: `use_company("zip")`.
"""

COMPANIES = {
    # ====================================================================
    "zip": {
        "name": "Zip",
        "context": (
            "Zip is an AI procurement-orchestration platform (intake-to-pay). It lets "
            "any employee make a purchase request easily while procurement, finance, IT, "
            "and legal keep control and visibility. You write sharp, credible B2B copy for "
            "enterprise buyers. Never invent product features or customer metrics."
        ),
        "segmentation_logic": "by organizational role (an enterprise has many distinct stakeholders)",
        "blog": {
            "title": "How to scale procurement without scaling headcount",
            "outline": [
                "The hidden tax: procurement becomes the bottleneck as a company grows",
                "Why throwing more headcount at it doesn't scale",
                "Orchestration over tickets: one front door for every request",
                "Where AI removes the manual touchpoints (intake, vendor checks, follow-ups)",
                "Keeping control while moving faster: policy adoption, not policing",
                "A 90-day path from spreadsheets to a self-service process",
            ],
            "draft": (
                "Every growing company hits the same wall. Headcount climbs, purchasing "
                "requests multiply, and procurement quietly becomes the team everyone waits "
                "on. The instinct is to hire more buyers, but that only scales the bottleneck.\n\n"
                "The companies that break the pattern do something different: they orchestrate. "
                "Instead of routing requests through scattered tickets, spreadsheets, and email "
                "threads, they give the business one front door. A request comes in once, and the "
                "right approvals, security reviews, and finance checks happen in the background.\n\n"
                "This is where AI earns its place. The repetitive work that eats a procurement "
                "team's week, duplicate-vendor checks, chasing approvers for context, re-reviewing "
                "the same suppliers, can be handled automatically, with a human on the decisions "
                "that actually need judgment.\n\n"
                "The payoff isn't just speed. When procurement stops being the office that slows "
                "things down, it becomes a strategic partner: faster cycle times, higher policy "
                "adoption because the compliant path is the easy path, and a team freed to focus on "
                "sourcing strategy instead of paperwork. You don't need a bigger team. You need a "
                "process that scales without one."
            ),
        },
        "personas": [
            {
                "id": "procurement_leader", "name": "Procurement Leader (CPO / VP)",
                "segment": "persona_procurement_leader",
                "angle": "Champion. Lead with going from gatekeeper to strategic enabler — scale the function without adding headcount, cut cycle times.",
                "engagement": {"open": 0.47, "click": 0.18, "unsub": 0.004}, "audience_size": 280,
                "newsletter": {
                    "subject": "Scale procurement without scaling your team",
                    "preview": "Stop being the bottleneck.",
                    "body": (
                        "Hi {first_name},\n\nAs the business grows, every new hire means more "
                        "requests landing on your team — and procurement becomes the function "
                        "everyone waits on. This week's piece breaks down how leading teams "
                        "orchestrate intake-to-pay so volume can double without the headcount "
                        "doubling, and procurement shifts from gatekeeper to strategic partner.\n\n"
                        "→ Read the post"
                    ),
                },
            },
            {
                "id": "finance_leader", "name": "Finance Leader (CFO / Finance Ops)",
                "segment": "persona_finance_leader",
                "angle": "Economic buyer. Lead with spend visibility before approval, savings, ROI, and keeping control during growth.",
                "engagement": {"open": 0.44, "click": 0.15, "unsub": 0.006}, "audience_size": 220,
                "newsletter": {
                    "subject": "See every dollar before it's committed",
                    "preview": "Control without slowing the business.",
                    "body": (
                        "Hi {first_name},\n\nThe spend that hurts is the spend you find out about "
                        "after it's committed. Our new post shows how finance teams get visibility "
                        "into every request before approval — catching duplicate tools and off-policy "
                        "spend early, while still letting the business move fast.\n\n→ Read the post"
                    ),
                },
            },
            {
                "id": "requester", "name": "Business Requester (any employee)",
                "segment": "persona_requester",
                "angle": "End user. Lead with one frictionless front door, transparent status, self-serve — no chasing procurement.",
                "engagement": {"open": 0.40, "click": 0.11, "unsub": 0.009}, "audience_size": 900,
                "newsletter": {
                    "subject": "Buy what you need, without the back-and-forth",
                    "preview": "One front door for every request.",
                    "body": (
                        "Hi {first_name},\n\nNeed a new tool or vendor and not sure where to even "
                        "start? This week we show how a single intake front door takes the guesswork "
                        "out of buying — submit once, see exactly where your request stands, and skip "
                        "the email chains and 'who do I ask?' detours.\n\n→ Read the post"
                    ),
                },
            },
        ],
        "optimization": {
            "next_topics": [
                "From cost center to strategic partner: redefining the procurement mandate",
                "The intake front door: why request experience drives policy adoption",
                "AI agents in procurement: where to start and what to automate first",
                "Measuring cycle time: the metric that proves procurement is scaling",
            ],
            "headline_variants": [
                "Scale Procurement Without Scaling Headcount",
                "The Self-Service Procurement Playbook for High-Growth Teams",
                "Stop Being the Bottleneck: Orchestration Over Tickets",
            ],
            "rationale": (
                "Click-through is strongest with the procurement-leader segment on ROI-and-scale "
                "framing, so the next slate leans into 'scale without headcount' and the request "
                "experience rather than generic procurement trends."
            ),
        },
    },
    # ====================================================================
    "shopify": {
        "name": "Shopify",
        "context": (
            "Shopify is a commerce platform that helps anyone start, run, and grow a business by "
            "selling online and in person. Its users are merchants and small-business owners, from "
            "first-time founders to growing brands. You write encouraging, practical copy for "
            "owner-operators. Never invent product features or customer metrics."
        ),
        "segmentation_logic": "by business stage (an SMB owner wears every hat, so maturity matters more than job title)",
        "blog": {
            "title": "What separates stores that scale from stores that stall",
            "outline": [
                "The myth: more traffic is the answer to every growth problem",
                "Stage 1 — getting to your first 100 orders without burning out",
                "Stage 2 — turning steady sales into a repeatable growth engine",
                "Stage 3 — unifying in-person and online so growth doesn't add chaos",
                "The through-line: systems beat hustle at every stage",
                "Picking the one thing to fix for the stage you're in now",
            ],
            "draft": (
                "Most advice for online stores assumes everyone has the same problem. They don't. "
                "What grows a brand-new store is almost the opposite of what grows an established one, "
                "and treating them the same is why a lot of good products stall.\n\n"
                "If you're just starting, your real enemy isn't competition — it's overwhelm. The win "
                "is getting to your first hundred orders without drowning in tools you don't need yet. "
                "Pick a simple storefront, one sales channel, and ship.\n\n"
                "Once sales are steady, the game changes. Now it's about turning one-time buyers into "
                "repeat ones: email flows, a reason to come back, and knowing your numbers well enough "
                "to spend on what actually works. This is where a real growth engine gets built.\n\n"
                "And if you're running a physical store too, the challenge is keeping online and in-person "
                "from becoming two separate businesses. One inventory, one view of the customer, one back "
                "office — so growth adds revenue, not chaos.\n\n"
                "The through-line at every stage is the same: systems beat hustle. The owners who scale "
                "aren't working harder than the ones who stall. They've just matched their effort to the "
                "stage they're actually in."
            ),
        },
        "personas": [
            {
                "id": "new_founder", "name": "First-time Founder (just starting)",
                "segment": "persona_new_founder",
                "angle": "Earliest stage. Lead with zero-to-first-sale, no tech overwhelm, you can start today. Encouraging, low-pressure.",
                "engagement": {"open": 0.42, "click": 0.14, "unsub": 0.010}, "audience_size": 1200,
                "newsletter": {
                    "subject": "Your first sale is closer than you think",
                    "preview": "Start simple. Ship today.",
                    "body": (
                        "Hi {first_name},\n\nStarting a store can feel like there are a hundred things "
                        "to set up before you can sell anything. There aren't. This week's post shows "
                        "the shortest path to your first 100 orders — one storefront, one channel, no "
                        "tool overload — so you can start before you feel 'ready'.\n\n→ Read the post"
                    ),
                },
            },
            {
                "id": "growing_brand", "name": "Growing DTC Brand Owner (scaling up)",
                "segment": "persona_growing_brand",
                "angle": "Mid stage. Lead with turning steady sales into a repeatable growth engine — repeat customers, email flows, knowing your numbers.",
                "engagement": {"open": 0.47, "click": 0.19, "unsub": 0.005}, "audience_size": 600,
                "newsletter": {
                    "subject": "From steady sales to a real growth engine",
                    "preview": "Turn buyers into repeat buyers.",
                    "body": (
                        "Hi {first_name},\n\nYou've got sales coming in — now the question is how to make "
                        "them compound. Our new post breaks down how growing brands turn one-time buyers "
                        "into repeat ones with email flows, a reason to return, and spending only on what "
                        "the numbers prove works.\n\n→ Read the post"
                    ),
                },
            },
            {
                "id": "omnichannel_retailer", "name": "Established Retailer (online + in person)",
                "segment": "persona_omnichannel_retailer",
                "angle": "Most mature. Lead with unifying in-person and online — one inventory, one back office, manage growth without chaos.",
                "engagement": {"open": 0.43, "click": 0.13, "unsub": 0.006}, "audience_size": 300,
                "newsletter": {
                    "subject": "One back office for your store and your website",
                    "preview": "Stop running two businesses.",
                    "body": (
                        "Hi {first_name},\n\nWhen your shop and your website run on separate systems, growth "
                        "just means double the work. This week we show how established retailers unify "
                        "in-person and online — one inventory, one view of the customer — so adding a "
                        "channel adds revenue, not chaos.\n\n→ Read the post"
                    ),
                },
            },
        ],
        "optimization": {
            "next_topics": [
                "The first-100-orders playbook: launching without tool overload",
                "Email flows that turn one-time buyers into repeat customers",
                "Knowing your numbers: the 4 metrics every growing store should watch",
                "Going omnichannel without doubling your workload",
            ],
            "headline_variants": [
                "What Separates Stores That Scale From Stores That Stall",
                "Systems Beat Hustle: Growth Advice for Every Stage",
                "The Repeat-Customer Engine Most Stores Never Build",
            ],
            "rationale": (
                "The growing-brand segment drove the highest click-through, so the next slate leans "
                "into repeatable-growth and retention topics rather than pure beginner content."
            ),
        },
    },
}

# --- Active-company state (mutated in place so existing imports stay valid) ---
_ACTIVE = "zip"
PERSONAS: list = []
PERSONA_BY_ID: dict = {}


def use_company(name: str):
    """Switch the active company profile. Mutates PERSONAS / PERSONA_BY_ID in place."""
    global _ACTIVE
    key = name.lower()
    if key not in COMPANIES:
        raise ValueError(f"Unknown company '{name}'. Options: {list(COMPANIES)}")
    _ACTIVE = key
    PERSONAS.clear()
    PERSONAS.extend(COMPANIES[key]["personas"])
    PERSONA_BY_ID.clear()
    PERSONA_BY_ID.update({p["id"]: p for p in PERSONAS})


def active_company() -> dict:
    return COMPANIES[_ACTIVE]


def use_profile(profile: dict):
    """Activate an arbitrary company profile (same shape as a COMPANIES entry).

    This is what makes the pipeline work for ANY company, not just the built-in
    examples: the skill derives/structures personas with Claude, Shiva confirms
    them, and the confirmed profile is loaded here.
    """
    required = {"name", "personas", "blog"}
    missing = required - set(profile)
    if missing:
        raise ValueError(f"Profile missing required keys: {missing}")
    profile.setdefault("context", "")
    profile.setdefault("segmentation_logic", "")
    profile.setdefault("optimization", {"next_topics": [], "headline_variants": [], "rationale": ""})
    for p in profile["personas"]:
        p.setdefault("engagement", {"open": 0.42, "click": 0.13, "unsub": 0.007})
        p.setdefault("audience_size", 400)
        p.setdefault("segment", "persona_" + p["id"])
    key = profile["name"].lower().replace(" ", "_")
    COMPANIES[key] = profile
    use_company(key)


def load_profile(path: str):
    """Load and activate a company profile from a JSON file."""
    import json
    from pathlib import Path
    use_profile(json.loads(Path(path).read_text()))


use_company(_ACTIVE)  # initialize default
