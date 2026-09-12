"""Stage 2 (orchestration) — distribution.

Loads the mock contact book, upserts every contact into HubSpot tagged with its
persona, ensures a segment list per persona, then sends each persona the matching
newsletter variant. Returns a send manifest used by the analytics stage.
"""

import json
from datetime import date

import config
from .crm import HubSpotClient
from .personas import PERSONAS, PERSONA_BY_ID


def load_contacts() -> list[dict]:
    return json.loads(config.CONTACTS_PATH.read_text())


def distribute(content: dict, campaign_id: str, crm: HubSpotClient | None = None) -> dict:
    crm = crm or HubSpotClient()
    contacts = load_contacts()
    blog_title = content["blog"]["title"]

    # 1) Upsert + tag every contact by persona.
    for c in contacts:
        crm.upsert_contact(c)

    # 2) Ensure one dynamic segment list per persona.
    for p in PERSONAS:
        crm.create_segment_list(p["id"], p["segment"])

    # 3) Send the right variant to each persona's contacts.
    sends_by_persona: dict[str, int] = {p["id"]: 0 for p in PERSONAS}
    newsletter_ids: dict[str, str] = {}

    for p in PERSONAS:
        variant = dict(content["newsletters"][p["id"]])
        nid = f"{campaign_id}_{p['id']}"
        variant["newsletter_id"] = nid
        newsletter_ids[p["id"]] = nid
        recipients = [c for c in contacts if c["persona"] == p["segment"]]
        for c in recipients:
            crm.send_marketing_email(c, variant, blog_title)
            sends_by_persona[p["id"]] += 1

    # 4) Log the campaign object in the CRM.
    campaign = {
        "id": campaign_id,
        "blog_title": blog_title,
        "topic": content["meta"]["topic"],
        "send_date": date.today().isoformat(),
        "newsletter_ids": list(newsletter_ids.values()),
        "segments": [p["segment"] for p in PERSONAS],
    }
    crm.log_campaign(campaign)

    return {
        "campaign": campaign,
        "sample_sends_by_persona": sends_by_persona,            # real CRM sends (demo sample)
        "audience_by_persona": {p["id"]: p["audience_size"] for p in PERSONAS},  # full segment
        "newsletter_ids": newsletter_ids,
        "subjects": {p["id"]: content["newsletters"][p["id"]]["subject"] for p in PERSONAS},
        "crm_request_count": len(crm.request_log),
        "crm_request_log": crm.request_log,
    }
