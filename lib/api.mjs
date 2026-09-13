// SignalLoop live demo API.
//   GET  /api/session?sessionId=&company=                    current session: experiments, analytics, pending plan
//   POST /api/run      {sessionId, company, objective}          run the baseline, or the pending planned experiment
//   POST /api/strategy {sessionId, company, objective, refresh} Marketing Agent: what to test next. With refresh after
//                                                               an objective change, re-runs it on the same evidence
//   POST /api/content  {sessionId, company}                     Content Agent: the variant; the next experiment is ready
//   POST /api/reset    {sessionId, company}                     start the session over

import { HubSpotClient, HubSpotError } from "./hubspot.mjs";
import { LLMClient, LLMUnavailableError } from "./llm.mjs";
import { AgentError } from "./agents/run-agent.mjs";
import { METRICS, OBJECTIVES, PROFILES, objectiveView } from "./company.mjs";
import { MIN_EVENTS, computeAnalytics } from "./analytics.mjs";
import { MEASUREMENT_VERSION } from "./simulator.mjs";
import { MAX_EXPERIMENTS, baselineSpec, createContent, newSession, planSummary, recommendStrategy, runExperiment } from "./loop.mjs";
import { StoreNotConfiguredError, openStore } from "./store.mjs";

// Bounds CRM and AI usage from a public page, on top of the per-visitor rate limit.
const DAILY_RUN_CAP = 400;
const DAILY_AI_CAP = 300; // agent calls: a recommendation and its content count separately
const RATE_LIMIT_PER_MINUTE = 30;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // a visitor's history expires after 30 days without use
const SESSION_ID = /^[a-z0-9-]{16,64}$/i;

// One handler for every route; the files in api/ expose it as Vercel Functions.
export async function handleApi(req) {
  try {
    return await handle(req);
  } catch (err) {
    console.error("SignalLoop API error:", err);
    const error = err instanceof StoreNotConfiguredError
      ? "The demo's storage isn't connected yet."
      : "The demo is temporarily unavailable. Please try again in a minute.";
    return json({ error }, 503);
  }
}
export default handleApi;

async function handle(req) {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\//, "");
  const store = openStore();

  const ip = clientIp(req);
  if (ip && (await store.incr(`rate/${ip}/${Math.floor(Date.now() / 60000)}`, 120)) > RATE_LIMIT_PER_MINUTE) {
    return json({ error: "Too many requests. Please wait a minute and try again." }, 429);
  }

  const input = req.method === "GET"
    ? { sessionId: url.searchParams.get("sessionId"), company: url.searchParams.get("company") }
    : await req.json().catch(() => ({}));
  if (!SESSION_ID.test(input.sessionId ?? "")) return json({ error: "A valid sessionId is required." }, 400);
  if (!Object.hasOwn(PROFILES, input.company ?? "")) return json({ error: "Choose ramp or square." }, 400);
  if (input.objective !== undefined && !Object.hasOwn(OBJECTIVES, input.objective)) return json({ error: "Unknown campaign objective." }, 400);

  const profile = PROFILES[input.company];
  const key = `sessions/${input.sessionId}/${input.company}`;
  const saved = await store.get(key, { type: "json" });
  // Sessions recorded under an earlier simulation model lack today's response signals, so they start fresh.
  const current = saved?.experiments?.every((e) => e.measurementVersion === MEASUREMENT_VERSION) ? saved : null;
  const session = current
    ?? newSession({ sessionId: input.sessionId, companyKey: input.company, objectiveId: input.objective ?? saved?.objectiveId ?? "product_consideration" });
  if (input.objective) session.objectiveId = input.objective;

  if (req.method === "GET" && route === "session") {
    return json(sessionView(profile, session));
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  if (route === "reset") {
    const fresh = newSession({ sessionId: input.sessionId, companyKey: input.company, objectiveId: session.objectiveId });
    await store.setJSON(key, fresh, { ttlSeconds: SESSION_TTL_SECONDS });
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
      await store.setJSON(key, session, { ttlSeconds: SESSION_TTL_SECONDS });
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
    const plan = session.pendingPlan;
    const objectiveChanged = Boolean(plan?.marketing && plan.marketing.objectiveId !== session.objectiveId);
    // A repeated click returns the step that already exists. Asking again after changing the objective (before any
    // content exists) re-runs the recommendation on the same evidence and keeps the earlier one for comparison.
    if (route === "strategy" && plan && !(input.refresh && objectiveChanged && !plan.spec)) return json(sessionView(profile, session));
    if (route === "content" && !plan?.marketing) return json({ error: "Get a recommendation before creating content." }, 409);
    if (route === "content" && plan.spec) return json(sessionView(profile, session));
    if (route === "content" && objectiveChanged) {
      return json({ error: `This recommendation was made for ${OBJECTIVES[plan.marketing.objectiveId].label}. Get a new recommendation for ${OBJECTIVES[session.objectiveId].label} first.` }, 422);
    }

    const llm = new LLMClient({ env });
    if (!llm.configured) return json({ error: "AI agents are not connected yet (no GROQ_API_KEY or GEMINI_API_KEY is set).", aiUnavailable: true }, 503);
    if (!(await withinDailyCap(store, "ai", DAILY_AI_CAP))) return json({ error: "The AI agents have reached today's limit. Please try again tomorrow.", aiUnavailable: true }, 429);

    try {
      const step = route === "strategy" ? recommendStrategy : createContent;
      const { analytics } = await step({ profile, session, llm });
      if (route === "strategy" && plan?.marketing) {
        session.pendingPlan.alternatives = [...(plan.alternatives ?? []), planSummary(plan.marketing)].slice(-4);
      }
      await store.setJSON(key, session, { ttlSeconds: SESSION_TTL_SECONDS });
      return json(sessionView(profile, session, analytics));
    } catch (err) {
      console.error(`SignalLoop ${route} failed:`, err);
      if (err instanceof LLMUnavailableError) {
        return json({ error: "The AI providers are unavailable right now (rate limit or outage). Please try again shortly.", aiUnavailable: true, attempts: err.attempts }, 503);
      }
      if (err instanceof AgentError) {
        const what = route === "strategy" ? "a valid, evidence-backed recommendation" : "content that passes the checks";
        return json({ error: `The agent could not produce ${what}. Please try again.`, attempts: err.details?.attempts }, 502);
      }
      return json({ error: "Something went wrong. Please try again in a minute." }, 502);
    }
  }

  return json({ error: "Not found." }, 404);
}

function sessionView(profile, session, analytics) {
  const experiments = session.experiments;
  return {
    company: profile.name,
    companyKey: session.company,
    objective: objectiveView(session.objectiveId),
    objectives: Object.entries(OBJECTIVES).map(([id, o]) => ({ id, label: o.label, metric: METRICS[o.primaryMetric].label })),
    signals: METRICS,
    guardrail: MIN_EVENTS,
    measurementVersion: MEASUREMENT_VERSION,
    experimentCount: experiments.length,
    maxExperiments: MAX_EXPERIMENTS,
    experiments: experiments.map(({ experimentNumber, kind, objectiveId, cells, marketingAgentRecommendation, contentAgentRecommendation, dataSource, createdAt }) => ({
      experimentNumber, kind, objectiveId, cells, dataSource, createdAt,
      hypothesis: marketingAgentRecommendation?.hypothesis ?? null,
      knowledgeGap: marketingAgentRecommendation?.knowledgeGap ?? null,
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
  const used = await store.incr(`usage/${kind}/${new Date().toISOString().slice(0, 10)}`, 60 * 60 * 48);
  return used <= cap;
}

// The visitor's IP as reported by the platform. Local previews and tests send none, so they aren't rate limited.
function clientIp(req) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || (req.headers.get("x-real-ip") ?? "").trim();
}

function env(key) {
  return (process.env[key] ?? "").trim();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
