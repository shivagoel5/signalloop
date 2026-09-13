// SignalLoop live demo API.
//   GET  /api/session?sessionId=&company=         current session: experiments, analytics, pending plan
//   POST /api/run    {sessionId, company, objective}  run the baseline, or the pending planned experiment
//   POST /api/strategy {sessionId, company, objective}  Marketing Agent: what to test next
//   POST /api/content  {sessionId, company}             Content Agent: the variant; the next experiment is then ready to run
//   POST /api/reset  {sessionId, company}            start the session over

import { HubSpotClient, HubSpotError } from "../lib/hubspot.mjs";
import { LLMClient, LLMUnavailableError } from "../lib/llm.mjs";
import { AgentError } from "../lib/agents/run-agent.mjs";
import { OBJECTIVES, PROFILES } from "../lib/company.mjs";
import { computeAnalytics } from "../lib/analytics.mjs";
import { MAX_EXPERIMENTS, baselineSpec, createContent, newSession, recommendStrategy, runExperiment } from "../lib/loop.mjs";
import { openStore } from "../lib/store.mjs";

// Bounds CRM and AI usage from a public page, on top of the per-visitor rate limit below.
const DAILY_RUN_CAP = 400;
const DAILY_AI_CAP = 300; // agent calls: a recommendation and its content count separately
const SESSION_ID = /^[a-z0-9-]{16,64}$/i;

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\//, "");
  const store = await openStore();

  const input = req.method === "GET"
    ? { sessionId: url.searchParams.get("sessionId"), company: url.searchParams.get("company") }
    : await req.json().catch(() => ({}));
  if (!SESSION_ID.test(input.sessionId ?? "")) return json({ error: "A valid sessionId is required." }, 400);
  if (!Object.hasOwn(PROFILES, input.company ?? "")) return json({ error: "Choose ramp or square." }, 400);
  if (input.objective !== undefined && !Object.hasOwn(OBJECTIVES, input.objective)) return json({ error: "Unknown campaign objective." }, 400);

  const profile = PROFILES[input.company];
  const key = `sessions/${input.sessionId}/${input.company}`;
  const session = (await store.get(key, { type: "json" }))
    ?? newSession({ sessionId: input.sessionId, companyKey: input.company, objectiveId: input.objective ?? "product_consideration" });
  if (input.objective) session.objectiveId = input.objective;

  if (req.method === "GET" && route === "session") {
    return json(sessionView(profile, session));
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  if (route === "reset") {
    const fresh = newSession({ sessionId: input.sessionId, companyKey: input.company, objectiveId: session.objectiveId });
    await store.setJSON(key, fresh);
    return json(sessionView(profile, fresh));
  }

  if (route === "run") {
    if (session.experiments.length >= MAX_EXPERIMENTS) return json({ error: `This session has reached ${MAX_EXPERIMENTS} experiments. Start over to run more.` }, 409);
    const spec = session.experiments.length === 0 ? baselineSpec(profile) : session.pendingPlan?.spec;
    if (!spec) return json({ error: "Create the content for the next experiment before running it." }, 409);
    if (!(await withinDailyCap(store, "runs", DAILY_RUN_CAP))) return json({ error: "The demo has reached today's run limit. Please try again tomorrow." }, 429);

    const hubspot = new HubSpotClient({ token: env("HUBSPOT_ACCESS_TOKEN"), mode: env("HUBSPOT_MODE") || "mock" });
    const crmKey = `crm-state/${hubspot.live ? "live" : "mock"}`;
    const crmState = (await store.get(crmKey, { type: "json" })) ?? {};
    try {
      const result = await runExperiment({ profile, companyKey: input.company, session, spec, hubspot, crmState });
      await store.setJSON(crmKey, result.crmState);
      await store.setJSON(key, session);
      return json({ ...sessionView(profile, session, result.analytics), distribution: withoutState(result.distribution) });
    } catch (err) {
      console.error("SignalLoop run failed:", err);
      const detail = err instanceof HubSpotError ? err.toDetail() : undefined;
      return json({ error: "The experiment run failed. Please try again in a minute.", detail }, 502);
    }
  }

  if (route === "strategy" || route === "content") {
    if (!session.experiments.length) return json({ error: "Run the baseline experiment first." }, 409);
    if (session.experiments.length >= MAX_EXPERIMENTS) return json({ error: `This session has reached ${MAX_EXPERIMENTS} experiments.` }, 409);
    // A repeated click returns the step that already exists instead of calling the agent again.
    if (route === "strategy" && session.pendingPlan) return json(sessionView(profile, session));
    if (route === "content" && !session.pendingPlan?.marketing) return json({ error: "Get a recommendation before creating content." }, 409);
    if (route === "content" && session.pendingPlan.spec) return json(sessionView(profile, session));

    const llm = new LLMClient({ env });
    if (!llm.configured) return json({ error: "AI agents are not connected yet (no GROQ_API_KEY or GEMINI_API_KEY is set).", aiUnavailable: true }, 503);
    if (!(await withinDailyCap(store, "ai", DAILY_AI_CAP))) return json({ error: "The AI agents have reached today's limit. Please try again tomorrow.", aiUnavailable: true }, 429);

    try {
      const step = route === "strategy" ? recommendStrategy : createContent;
      const { analytics } = await step({ profile, session, llm });
      await store.setJSON(key, session);
      return json(sessionView(profile, session, analytics));
    } catch (err) {
      console.error(`SignalLoop ${route} failed:`, err);
      if (err instanceof LLMUnavailableError) {
        return json({ error: "The AI providers are unavailable right now (rate limit or outage). Please try again shortly.", aiUnavailable: true, attempts: err.attempts }, 503);
      }
      if (err instanceof AgentError) {
        const what = route === "strategy" ? "a valid, data-backed recommendation" : "content that passes the checks";
        return json({ error: `The agent could not produce ${what}. Please try again.`, attempts: err.details?.attempts }, 502);
      }
      return json({ error: "Something went wrong. Please try again in a minute." }, 502);
    }
  }

  return json({ error: "Not found." }, 404);
};

export const config = {
  path: ["/api/session", "/api/run", "/api/strategy", "/api/content", "/api/reset"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip"] },
};

function sessionView(profile, session, analytics) {
  const experiments = session.experiments;
  return {
    company: profile.name,
    companyKey: session.company,
    objective: { id: session.objectiveId, ...OBJECTIVES[session.objectiveId] },
    objectives: Object.entries(OBJECTIVES).map(([id, o]) => ({ id, label: o.label })),
    experimentCount: experiments.length,
    maxExperiments: MAX_EXPERIMENTS,
    experiments: experiments.map(({ experimentNumber, kind, cells, marketingAgentRecommendation, contentAgentRecommendation, dataSource, createdAt }) => ({
      experimentNumber, kind, cells, dataSource, createdAt,
      hypothesis: marketingAgentRecommendation?.hypothesis ?? null,
      decisionType: marketingAgentRecommendation?.decisionType ?? null,
      contentHeadline: contentAgentRecommendation?.contentPlan?.headline ?? null,
    })),
    analytics: experiments.length ? analytics ?? computeAnalytics({ profile, experiments, objectiveId: session.objectiveId }) : null,
    pendingPlan: session.pendingPlan,
    labels: {
      crm: env("HUBSPOT_MODE") === "live" && env("HUBSPOT_ACCESS_TOKEN") ? "LIVE" : "MOCK",
      delivery: "SIMULATED",
      performance: "SIMULATED",
      analytics: "CODE",
      marketing: "AI",
      contentPlanning: "AI",
      contentGeneration: "AI",
      history: "STORED",
    },
    audiences: profile.personas.map((p) => ({ id: p.id, name: p.short_name, channels: p.channels })),
    angles: profile.messaging_angles,
    contentTypes: profile.content_types,
  };
}

function withoutState({ crmState, ...rest }) {
  return rest;
}

async function withinDailyCap(store, kind, cap) {
  const key = `usage/${kind}/${new Date().toISOString().slice(0, 10)}`;
  const used = (await store.get(key, { type: "json" })) ?? 0;
  if (used >= cap) return false;
  await store.setJSON(key, used + 1);
  return true;
}

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
