"""Company profiles — the heart of the pipeline's reusability.

The same engine runs for any company by swapping the profile below. Each profile
carries the company context (steers the LLM), a seed blog, and the audience
personas — including each persona's content angle and a newsletter template.

Two profiles ship as examples, and they deliberately segment differently:

  ramp     Finance automation for companies (cards, expenses, bills, procurement)
           → segments by ORGANIZATIONAL ROLE, because spend touches finance
           leadership, accounting, and every employee who buys.
  square   Commerce and payments for sellers → segments by BUSINESS STAGE,
           because an owner-operator wears every hat, so "what stage is their
           business at" matters more than their job title.

That contrast is the point: the segmentation LOGIC adapts to the market, not
just the persona names. To run one: `use_company("ramp")`.
"""

COMPANIES = {
    # ====================================================================
    "ramp": {
        "name": "Ramp",
        "context": (
            "Ramp is a finance automation platform that combines corporate cards, expense "
            "management, bill payments, procurement, and accounting automation. It helps finance "
            "teams control spend and close the books faster while employees buy what they need "
            "within policy. You write sharp, credible B2B copy for finance and operations buyers. "
            "Never invent product features or customer metrics."
        ),
        "segmentation_logic": "by organizational role (spend touches finance leadership, accounting, and every employee who buys)",
        "blog": {
            "title": "How finance teams control spend without slowing the business",
            "outline": [
                "The real cost of finding out about spend after it happens",
                "Why stricter approval chains backfire as a company grows",
                "Policy at the point of purchase: controls built into cards and requests",
                "Where automation removes the manual work (receipts, coding, reconciliation)",
                "A faster close as a byproduct of cleaner spend data",
                "A 90-day path from expense reports to real-time visibility",
            ],
            "draft": (
                "Most finance teams find out about spend the same way: after it has already "
                "happened. A card statement arrives, receipts go missing, and month-end becomes a "
                "hunt for context. The usual fix is more approvals, but every extra approval step "
                "slows down the people trying to do their jobs.\n\n"
                "The teams that get ahead of this move control earlier. Instead of reviewing spend "
                "after the fact, they build policy into the purchase itself: cards with limits set by "
                "role or vendor, requests that route to the right approver automatically, and clear "
                "rules employees can see before they buy.\n\n"
                "This is where automation earns its place. Collecting receipts, coding transactions, "
                "matching bills, and reconciling accounts are the tasks that eat a finance team's week. "
                "When those happen in the background, people spend their time on decisions that need "
                "judgment, not paperwork.\n\n"
                "The payoff goes beyond a faster close. With spend data that is clean as it happens, "
                "finance leaders see where money is going in real time, catch duplicate tools and "
                "off-policy purchases early, and plan with numbers they trust. Control stops being the "
                "thing that slows the business down and becomes the thing that lets it grow with confidence."
            ),
        },
        "personas": [
            {
                "id": "finance_leader", "name": "Finance Leader (CFO / VP Finance)",
                "segment": "persona_finance_leader",
                "angle": "Economic buyer. Lead with real-time spend visibility, savings, and control that scales with growth.",
                "engagement": {"open": 0.46, "click": 0.17, "unsub": 0.004}, "audience_size": 260,
                "newsletter": {
                    "subject": "See spend as it happens, not at month-end",
                    "preview": "Control that scales with the company.",
                    "body": (
                        "Hi {first_name},\n\nThe spend that hurts is the spend you only see after the "
                        "statement closes. This week's post shows how finance leaders move control to the "
                        "point of purchase, with limits, approvals, and policy built in, so they see every "
                        "dollar in real time and catch off-policy spend before it adds up.\n\n→ Read the post"
                    ),
                },
            },
            {
                "id": "controller", "name": "Controller / Accounting Lead",
                "segment": "persona_controller",
                "angle": "Operator. Lead with a faster close: automatic receipt capture, coding, and reconciliation, with fewer people to chase.",
                "engagement": {"open": 0.44, "click": 0.15, "unsub": 0.005}, "audience_size": 240,
                "newsletter": {
                    "subject": "Close the books without chasing receipts",
                    "preview": "Less reconciliation, more analysis.",
                    "body": (
                        "Hi {first_name},\n\nIf month-end still means chasing receipts and recoding "
                        "transactions by hand, this one is for you. Our new post breaks down how accounting "
                        "teams automate receipt capture, coding, and reconciliation, so the close gets faster "
                        "and your team spends its time on analysis instead of cleanup.\n\n→ Read the post"
                    ),
                },
            },
            {
                "id": "employee_spender", "name": "Employee Spender (any team)",
                "segment": "persona_employee_spender",
                "angle": "End user. Lead with buying what you need in minutes, clear policy up front, and no expense reports.",
                "engagement": {"open": 0.39, "click": 0.10, "unsub": 0.009}, "audience_size": 900,
                "newsletter": {
                    "subject": "Buy what you need, without the expense report",
                    "preview": "Clear rules, fast approvals.",
                    "body": (
                        "Hi {first_name},\n\nNeed software, travel, or supplies for your team and not sure "
                        "what's allowed? This week we show how clear spending rules, built right into your "
                        "card and requests, take the guesswork out of buying. Get what you need in minutes, "
                        "snap the receipt, and skip the expense report.\n\n→ Read the post"
                    ),
                },
            },
        ],
        "optimization": {
            "next_topics": [
                "From expense reports to real-time spend visibility: a finance leader's playbook",
                "Month-end close in days, not weeks: what to automate first",
                "Card policies that employees actually follow",
                "Catching duplicate software spend before renewal",
            ],
            "headline_variants": [
                "Control Spend Without Slowing the Business",
                "The Real-Time Spend Playbook for Growing Finance Teams",
                "Stop Finding Out About Spend at Month-End",
            ],
            "rationale": (
                "Click-through is strongest with the finance-leader segment on visibility-and-control "
                "framing, so the next slate leans into real-time spend and a faster close rather than "
                "generic expense tips."
            ),
        },
    },
    # ====================================================================
    "square": {
        "name": "Square",
        "context": (
            "Square is a commerce and payments platform that helps sellers take payments, sell in "
            "person and online, and run their business with tools for inventory, invoices, and staff. "
            "Its users range from first-time sellers to multi-location businesses. You write "
            "encouraging, practical copy for owner-operators. Never invent product features or "
            "customer metrics."
        ),
        "segmentation_logic": "by business stage (an owner-operator wears every hat, so maturity matters more than job title)",
        "blog": {
            "title": "What changes as your business grows from first sale to multiple locations",
            "outline": [
                "The myth: every growth problem is a sales problem",
                "Stage 1 — taking your first payments without a complicated setup",
                "Stage 2 — selling in person and online without running two businesses",
                "Stage 3 — keeping inventory, staff, and reporting in sync across locations",
                "The through-line: the right system for the stage you're in",
                "Choosing the one thing to fix this quarter",
            ],
            "draft": (
                "Most small-business advice assumes every owner has the same problem. They don't. "
                "What helps a seller take their first payment is very different from what helps a "
                "business running three locations, and treating them the same is why good businesses "
                "get stuck.\n\n"
                "If you're just starting, your biggest risk isn't competition, it's complexity. The win "
                "is taking payments quickly with a setup simple enough that you can focus on customers "
                "instead of software. Start with what you need today and add the rest later.\n\n"
                "Once sales are steady, the challenge shifts. Customers want to buy from you in person, "
                "online, and everywhere in between, and running each channel separately doubles the work. "
                "One catalog, one view of what's selling, and one place to see your numbers turns steady "
                "sales into real growth.\n\n"
                "When you open a second or third location, the hard part becomes consistency. Inventory, "
                "staff schedules, and reporting all need to stay in sync, or every new site adds chaos "
                "along with revenue.\n\n"
                "The through-line at every stage is the same: the right system for the stage you're in. "
                "The owners who grow aren't working harder than the ones who stall. They've matched their "
                "tools to where their business actually is."
            ),
        },
        "personas": [
            {
                "id": "new_seller", "name": "New Seller (just starting)",
                "segment": "persona_new_seller",
                "angle": "Earliest stage. Lead with taking the first payment today: simple setup, no tech overwhelm. Encouraging, low-pressure.",
                "engagement": {"open": 0.42, "click": 0.14, "unsub": 0.010}, "audience_size": 1200,
                "newsletter": {
                    "subject": "Your first sale can happen today",
                    "preview": "Simple setup. Start selling.",
                    "body": (
                        "Hi {first_name},\n\nGetting set up to take payments can feel like a project of "
                        "its own. It doesn't have to be. This week's post shows the simplest path to your "
                        "first sales, with a setup you can finish in an afternoon, so you can focus on "
                        "customers instead of software.\n\n→ Read the post"
                    ),
                },
            },
            {
                "id": "growing_business", "name": "Growing Business (in person + online)",
                "segment": "persona_growing_business",
                "angle": "Mid stage. Lead with selling everywhere from one place: in person and online, one catalog, knowing what sells.",
                "engagement": {"open": 0.47, "click": 0.19, "unsub": 0.005}, "audience_size": 600,
                "newsletter": {
                    "subject": "Sell in person and online without doubling the work",
                    "preview": "One catalog. One view of your sales.",
                    "body": (
                        "Hi {first_name},\n\nYour customers want to buy from you at the counter, on your "
                        "website, and everywhere in between. Our new post breaks down how growing businesses "
                        "run every channel from one place, with one catalog and one view of what's selling, "
                        "so more channels mean more revenue, not more admin.\n\n→ Read the post"
                    ),
                },
            },
            {
                "id": "multi_location", "name": "Multi-Location Operator (several sites)",
                "segment": "persona_multi_location",
                "angle": "Most mature. Lead with running several sites as one business: shared inventory, staff management, and reporting across locations.",
                "engagement": {"open": 0.43, "click": 0.13, "unsub": 0.006}, "audience_size": 300,
                "newsletter": {
                    "subject": "Run every location like one business",
                    "preview": "Inventory, staff, and reports in sync.",
                    "body": (
                        "Hi {first_name},\n\nEvery new location should add revenue, not chaos. This week we "
                        "show how multi-location operators keep inventory, staff schedules, and reporting in "
                        "sync across sites, so you can see the whole business at a glance and fix problems "
                        "before they spread.\n\n→ Read the post"
                    ),
                },
            },
        ],
        "optimization": {
            "next_topics": [
                "Taking your first payments: a no-overwhelm setup guide",
                "Selling in person and online from one catalog",
                "The weekly numbers every growing seller should check",
                "Opening a second location without losing control",
            ],
            "headline_variants": [
                "What Changes as Your Business Grows",
                "The Right System for the Stage You're In",
                "Sell Everywhere Without Doubling the Work",
            ],
            "rationale": (
                "The growing-business segment drove the highest click-through, so the next slate leans "
                "into selling across channels and knowing your numbers rather than pure beginner content."
            ),
        },
    },
}

# --- Active-company state (mutated in place so existing imports stay valid) ---
_ACTIVE = "ramp"
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
