// Live demo endpoint.
//   POST /api/run {"company": "ramp" | "square"}  runs one full loop and returns the report
//   GET  /api/run?company=ramp                     returns saved run history for that company

import { HubSpotClient } from "../lib/hubspot.mjs";
import { PROFILES, runPipeline, summarizeHistory } from "../lib/pipeline.mjs";
import { openStore } from "../lib/store.mjs";

// Bounds CRM calls from a public page, on top of the per-visitor rate limit below.
const DAILY_RUN_CAP = 300;

export default async (req) => {
  const store = await openStore();

  if (req.method === "GET") {
    const company = new URL(req.url).searchParams.get("company");
    if (!Object.hasOwn(PROFILES, company ?? "")) return json({ error: "Choose ramp or square." }, 400);
    const history = (await store.get(`history/${company}`, { type: "json" })) ?? [];
    return json(summarizeHistory(company, history));
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const { company } = await req.json().catch(() => ({}));
  if (!Object.hasOwn(PROFILES, company ?? "")) return json({ error: "Choose ramp or square." }, 400);

  const usageKey = `usage/${new Date().toISOString().slice(0, 10)}`;
  const used = (await store.get(usageKey, { type: "json" })) ?? 0;
  if (used >= DAILY_RUN_CAP) {
    return json({ error: "The demo has reached today's run limit. Please try again tomorrow." }, 429);
  }

  const hubspot = new HubSpotClient({
    token: env("HUBSPOT_ACCESS_TOKEN"),
    mode: env("HUBSPOT_MODE") || "mock",
  });
  const history = (await store.get(`history/${company}`, { type: "json" })) ?? [];

  try {
    const { report, history: updated } = await runPipeline({ companyKey: company, history, hubspot });
    await store.setJSON(`history/${company}`, updated);
    await store.setJSON(usageKey, used + 1);
    return json(report);
  } catch (err) {
    console.error("SignalLoop run failed:", err);
    return json({ error: "The run failed. Please try again in a minute." }, 502);
  }
};

export const config = {
  path: "/api/run",
  // Per visitor only: domain-wide aggregation is an Enterprise feature and blocked every request
  // on the free plan. The page also calls GET on load and on company switch, so leave headroom.
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
};

function env(key) {
  const value = typeof Netlify !== "undefined" ? Netlify.env.get(key) : process.env[key];
  return (value ?? "").trim();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
