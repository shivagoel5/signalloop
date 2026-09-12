// HubSpot CRM client for the live demo, mirroring ai-content-pipeline/pipeline/crm.py.
//
//   mock (default)  Build the real request, record it, return a simulated response.
//   live            Send it with HUBSPOT_ACCESS_TOKEN (set HUBSPOT_MODE=live in Netlify).
//
// Every call is appended to `requestLog` so the demo can show exactly what was exercised.

const BASE_URL = "https://api.hubapi.com";

export class HubSpotClient {
  constructor({ token = "", mode = "mock", fetchImpl = globalThis.fetch } = {}) {
    this.live = mode === "live" && Boolean(token);
    this.token = token;
    this.fetch = fetchImpl;
    this.requestLog = [];
  }

  async request(method, path, payload, simulated) {
    const entry = { method, url: `${BASE_URL}${path}`, payload };
    this.requestLog.push(entry);

    if (this.live) {
      const resp = await this.fetch(entry.url, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      entry.status = resp.status;
      const text = await resp.text();
      if (!resp.ok) {
        throw new Error(`HubSpot ${method} ${path} failed with ${resp.status}: ${text.slice(0, 200)}`);
      }
      return text ? JSON.parse(text) : {};
    }

    entry.status = "MOCK";
    return simulated ?? { id: mockId(), mock: true };
  }

  // Contacts: one batch upsert keyed on email, so repeat runs update the same records.
  upsertContacts(contacts) {
    const inputs = contacts.map((c) => ({
      idProperty: "email",
      id: c.email,
      properties: {
        email: c.email,
        firstname: c.first_name ?? "",
        lastname: c.last_name ?? "",
        company: c.company ?? "",
        persona: c.persona, // custom segmentation property
        lifecyclestage: "subscriber",
      },
    }));
    return this.request("POST", "/crm/v3/objects/contacts/batch/upsert", { inputs }, {
      status: "COMPLETE",
      results: inputs.map((i) => ({ id: mockId(), properties: i.properties })),
    });
  }

  // A dynamic list that captures everyone in a persona segment.
  createSegmentList(personaId, segment) {
    const payload = {
      name: `SignalLoop · ${personaId}`,
      objectTypeId: "0-1", // contacts
      processingType: "DYNAMIC",
      filterBranch: {
        filterBranchType: "OR",
        filterBranches: [{
          filterBranchType: "AND",
          filters: [{
            filterType: "PROPERTY",
            property: "persona",
            operation: { operationType: "ENUMERATION", operator: "IS_ANY_OF", values: [segment] },
          }],
        }],
      },
    };
    return this.request("POST", "/crm/v3/lists", payload, { listId: mockId(), name: payload.name });
  }

  // Send the persona's newsletter variant to one contact.
  sendMarketingEmail(contact, newsletter, blogTitle) {
    const payload = {
      emailId: stableEmailId(newsletter.newsletter_id),
      message: { to: contact.email, subject: newsletter.subject },
      contactProperties: { firstname: contact.first_name ?? "", persona: contact.persona },
      customProperties: {
        blog_title: blogTitle,
        preview_text: newsletter.preview ?? "",
        html_body: newsletter.body.replace("{first_name}", contact.first_name || "there"),
      },
    };
    return this.request("POST", "/marketing/v3/transactional/single-email/send", payload, {
      requestId: mockId(),
      sendResult: "SENT",
    });
  }

  // Record the campaign as a CRM object for reporting.
  logCampaign(campaign) {
    const payload = {
      properties: {
        campaign_name: campaign.blog_title,
        campaign_id: campaign.id,
        topic: campaign.topic,
        newsletter_ids: campaign.newsletter_ids.join(","),
        send_date: campaign.send_date,
        segments: campaign.segments.join(","),
      },
    };
    return this.request("POST", "/crm/v3/objects/marketing_campaigns", payload, {
      id: mockId(),
      properties: payload.properties,
    });
  }
}

function mockId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

// Deterministic pseudo-template-id per newsletter variant.
function stableEmailId(newsletterId) {
  let h = 0;
  for (const ch of newsletterId) h = (Math.imul(h, 31) + ch.codePointAt(0)) >>> 0;
  return `tmpl_${h % 10_000_000}`;
}
