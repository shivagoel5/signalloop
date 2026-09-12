// HubSpot CRM client for the live demo, built around what a free HubSpot account allows:
// custom contact properties, batch contact upserts, and static (MANUAL) lists.
//
//   mock (default)  Build the real request, record it, return a simulated response.
//   live            Send it with HUBSPOT_ACCESS_TOKEN (set HUBSPOT_MODE=live in Netlify).
//
// Email sends are not HubSpot calls here: HubSpot's transactional email API needs a paid
// add-on, so the pipeline simulates sends and only counts them.

const BASE_URL = "https://api.hubapi.com";

// Labels are prefixed so they can't collide with HubSpot's built-in "Persona" property.
export const CONTACT_PROPERTIES = [
  { name: "persona", label: "SignalLoop persona", description: "SignalLoop audience segment" },
  {
    name: "signalloop_last_newsletter",
    label: "SignalLoop last newsletter",
    description: "Subject line of the newsletter variant assigned in the last SignalLoop run",
  },
  {
    name: "signalloop_last_campaign",
    label: "SignalLoop last campaign",
    description: "Campaign id and date of the last SignalLoop run",
  },
];

export class HubSpotError extends Error {
  constructor(message, { status, method, path, category, hubspotMessage } = {}) {
    super(message);
    this.status = status;
    this.method = method;
    this.path = path;
    this.category = category;
    this.hubspotMessage = hubspotMessage;
  }

  // Safe to return to the page: no token, just which call failed and HubSpot's reason.
  toDetail() {
    return {
      step: `${this.method} ${this.path}`,
      status: this.status,
      category: this.category,
      message: this.hubspotMessage?.slice(0, 200),
    };
  }
}

export class HubSpotClient {
  constructor({ token = "", mode = "mock", fetchImpl = globalThis.fetch } = {}) {
    this.live = mode === "live" && Boolean(token);
    this.token = token;
    this.fetch = fetchImpl;
    this.requestLog = [];
  }

  // `simulated` is the mock response, or a function that returns (or throws) one.
  async request(method, path, body, simulated) {
    const entry = { method, path, body };
    this.requestLog.push(entry);

    if (this.live) {
      const resp = await this.fetch(`${BASE_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      entry.status = resp.status;
      const text = await resp.text();
      if (!resp.ok) {
        let parsed = {};
        try { parsed = JSON.parse(text); } catch {}
        throw new HubSpotError(`HubSpot ${method} ${path} failed with ${resp.status}: ${text.slice(0, 200)}`, {
          status: resp.status, method, path, category: parsed.category, hubspotMessage: parsed.message ?? text,
        });
      }
      return text ? JSON.parse(text) : {};
    }

    entry.status = "MOCK";
    return typeof simulated === "function" ? simulated() : simulated ?? {};
  }

  // Create the SignalLoop contact properties that don't exist yet.
  async ensureContactProperties() {
    for (const p of CONTACT_PROPERTIES) {
      try {
        await this.request("GET", `/crm/v3/properties/contacts/${p.name}`, undefined, () => {
          throw new HubSpotError("Simulated: property not found", { status: 404 });
        });
      } catch (err) {
        if (err.status !== 404) throw err;
        try {
          await this.request("POST", "/crm/v3/properties/contacts", {
            groupName: "contactinformation",
            name: p.name,
            label: p.label,
            description: p.description,
            type: "string",
            fieldType: "text",
          }, { name: p.name });
        } catch (createErr) {
          // Another run created it in the meantime.
          if (createErr.status !== 409) throw createErr;
        }
      }
    }
  }

  // One batch upsert keyed on email, so repeat runs update the same records.
  // Returns a Map of lowercase email -> HubSpot record id.
  async upsertContacts(contacts) {
    const inputs = contacts.map((c) => ({ idProperty: "email", id: c.email, properties: c.properties }));
    const resp = await this.request("POST", "/crm/v3/objects/contacts/batch/upsert", { inputs }, () => ({
      status: "COMPLETE",
      results: inputs.map((i) => ({ id: mockId(), properties: { email: i.id } })),
    }));
    return new Map((resp.results ?? [])
      .filter((r) => r.properties?.email)
      .map((r) => [r.properties.email.toLowerCase(), String(r.id)]));
  }

  // Create a static list, or find it by name if an earlier run already created it.
  async ensureStaticList(name) {
    try {
      const resp = await this.request("POST", "/crm/v3/lists", {
        name,
        objectTypeId: "0-1", // contacts
        processingType: "MANUAL",
      }, () => ({ list: { listId: mockId(), name } }));
      return String(resp.list.listId);
    } catch (err) {
      if (err.status !== 400 && err.status !== 409) throw err;
      const resp = await this.request("GET", `/crm/v3/lists/object-type-id/0-1/name/${encodeURIComponent(name)}`);
      return String(resp.list.listId);
    }
  }

  addToStaticList(listId, recordIds) {
    return this.request("PUT", `/crm/v3/lists/${listId}/memberships/add`, recordIds, {
      recordIdsAdded: recordIds,
    });
  }
}

function mockId() {
  return String(Math.floor(1e10 + Math.random() * 9e10));
}
