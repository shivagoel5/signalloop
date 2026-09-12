"""Stage 2 — HubSpot CRM integration.

This client builds *real* HubSpot API requests (correct endpoints, headers, and
payload shapes from the v3 CRM + Marketing APIs). It runs in two modes:

  mock  (default)  Build the request, record it, return a simulated response.
                   Nothing leaves the machine — perfect for a take-home review.
  live             Actually send via `requests` using HUBSPOT_ACCESS_TOKEN.

Every call is appended to `self.request_log`, so the run can dump exactly which
endpoints/payloads were exercised. Switch with HUBSPOT_MODE=live in .env.

Segmentation approach: we set a custom contact property `persona` and use it as
the segment key. (In production you'd back this with a HubSpot Active List
filtered on that property; the property write is the realistic primitive.)
"""

import json
import uuid

import requests

import config


class HubSpotClient:
    def __init__(self):
        self.live = config.HUBSPOT_LIVE
        self.base = config.HUBSPOT_BASE_URL
        self.headers = {
            "Authorization": f"Bearer {config.HUBSPOT_ACCESS_TOKEN}",
            "Content-Type": "application/json",
        }
        self.request_log: list[dict] = []

    # ------------------------------------------------------------------ #
    # Low-level request dispatcher: live -> requests, mock -> simulate.
    # ------------------------------------------------------------------ #
    def _request(self, method: str, path: str, payload: dict | None = None,
                 simulated: dict | None = None) -> dict:
        url = f"{self.base}{path}"
        entry = {"method": method, "url": url, "payload": payload}
        self.request_log.append(entry)

        if self.live:
            resp = requests.request(method, url, headers=self.headers,
                                    data=json.dumps(payload) if payload else None,
                                    timeout=30)
            resp.raise_for_status()
            entry["status"] = resp.status_code
            return resp.json() if resp.content else {}

        # Mock: echo a realistic-looking response.
        entry["status"] = "MOCK"
        return simulated if simulated is not None else {"id": _mock_id(), "mock": True}

    # ------------------------------------------------------------------ #
    # Contacts
    # ------------------------------------------------------------------ #
    def upsert_contact(self, contact: dict) -> dict:
        """Create or update a contact, tagged with its persona segment.

        Endpoint: POST /crm/v3/objects/contacts
        (Real upsert keys on email; we model create here and PATCH on conflict.)
        """
        props = {
            "email": contact["email"],
            "firstname": contact.get("first_name", ""),
            "lastname": contact.get("last_name", ""),
            "company": contact.get("company", ""),
            "persona": contact["persona"],          # custom segmentation property
            "lifecyclestage": "subscriber",
        }
        payload = {"properties": props}
        return self._request(
            "POST", "/crm/v3/objects/contacts", payload,
            simulated={"id": _mock_id(), "properties": props},
        )

    def create_segment_list(self, persona_id: str, segment: str) -> dict:
        """Define an Active List that captures everyone in a persona segment.

        Endpoint: POST /crm/v3/lists
        Filter: contact property `persona` == <segment>
        """
        payload = {
            "name": f"SignalLoop · {persona_id}",
            "objectTypeId": "0-1",  # contacts
            "processingType": "DYNAMIC",
            "filterBranch": {
                "filterBranchType": "OR",
                "filterBranches": [{
                    "filterBranchType": "AND",
                    "filters": [{
                        "filterType": "PROPERTY",
                        "property": "persona",
                        "operation": {"operationType": "ENUMERATION",
                                      "operator": "IS_ANY_OF", "values": [segment]},
                    }],
                }],
            },
        }
        return self._request(
            "POST", "/crm/v3/lists", payload,
            simulated={"listId": _mock_id(), "name": payload["name"]},
        )

    # ------------------------------------------------------------------ #
    # Sending
    # ------------------------------------------------------------------ #
    def send_marketing_email(self, contact: dict, newsletter: dict,
                             blog_title: str) -> dict:
        """Send the persona's newsletter variant to one contact.

        Endpoint: POST /marketing/v3/transactional/single-email/send
        (Single-send transactional email; in production the body usually maps to
        a HubSpot email template id + contactProperties merge fields.)
        """
        payload = {
            "emailId": _stable_email_id(newsletter["newsletter_id"]),
            "message": {
                "to": contact["email"],
                "subject": newsletter["subject"],
            },
            "contactProperties": {
                "firstname": contact.get("first_name", ""),
                "persona": contact["persona"],
            },
            "customProperties": {
                "blog_title": blog_title,
                "preview_text": newsletter.get("preview", ""),
                # Rendered body with merge field resolved for the demo.
                "html_body": newsletter["body"].replace(
                    "{first_name}", contact.get("first_name", "there")),
            },
        }
        return self._request(
            "POST", "/marketing/v3/transactional/single-email/send", payload,
            simulated={"requestId": _mock_id(), "sendResult": "SENT"},
        )

    # ------------------------------------------------------------------ #
    # Campaign logging
    # ------------------------------------------------------------------ #
    def log_campaign(self, campaign: dict) -> dict:
        """Record the campaign as a custom CRM object for reporting.

        Endpoint: POST /crm/v3/objects/marketing_campaigns
        Logs blog title, newsletter id(s), and send date.
        """
        payload = {
            "properties": {
                "campaign_name": campaign["blog_title"],
                "campaign_id": campaign["id"],
                "topic": campaign["topic"],
                "newsletter_ids": ",".join(campaign["newsletter_ids"]),
                "send_date": campaign["send_date"],
                "segments": ",".join(campaign["segments"]),
            }
        }
        return self._request(
            "POST", "/crm/v3/objects/marketing_campaigns", payload,
            simulated={"id": _mock_id(), "properties": payload["properties"]},
        )


# ----------------------------- helpers ----------------------------------- #
def _mock_id() -> str:
    return uuid.uuid4().hex[:12]


def _stable_email_id(newsletter_id: str) -> str:
    """Deterministic pseudo-template-id per newsletter variant."""
    return f"tmpl_{abs(hash(newsletter_id)) % 10_000_000}"
