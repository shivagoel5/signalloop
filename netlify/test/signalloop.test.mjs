import test from "node:test";
import assert from "node:assert/strict";

import handler from "../functions/api.mjs";
import { PROFILES } from "../lib/company.mjs";
import { HubSpotClient } from "../lib/hubspot.mjs";
import { LLMClient } from "../lib/llm.mjs";
import { AgentError } from "../lib/agents/run-agent.mjs";
import { similarity } from "../lib/agents/content.mjs";
import { compareRates, computeAnalytics, twoProportionZ } from "../lib/analytics.mjs";
import { baselineSpec, newSession, planNextExperiment, runExperiment } from "../lib/loop.mjs";
import { clickProbability, makeRng, simulateCell } from "../lib/simulator.mjs";
import { TRUTH } from "../lib/sim-truth.mjs";

const ramp = PROFILES.ramp;

const marketingDecision = {
  priorityAudience: "finance_leader",
  recommendedChannel: "linkedin",
  recommendedAngle: "real_time_visibility",
  recommendedContentType: "thought_leadership",
  decisionType: "explore",
  hypothesis: "Finance Leaders will respond better to visibility messaging on LinkedIn than to the baseline cost-control message.",
  reasoning: "LinkedIn delivers the most clicks per experiment for Finance Leaders, and visibility messaging has not been tested yet.",
  tradeoff: "The objective is traffic, so LinkedIn's click volume outweighs email's higher CTR.",
  confidence: "medium",
  evidence: [
    { metricId: "audience:finance_leader", statement: "Finance Leaders' pooled CTR across the baseline." },
    { metricId: "audience_channel:finance_leader:linkedin", statement: "LinkedIn's expected clicks per experiment for Finance Leaders." },
  ],
};

const contentOutput = {
  contentPlan: {
    audienceInsight: "Finance Leaders need earlier signals, not more reports.",
    contentAngle: "Reactive month-end reporting to proactive control",
    topic: "Why monthly spend reviews arrive too late for modern finance leaders",
    hook: "Month-end reporting tells finance leaders what went wrong. Real-time visibility lets them stop it first.",
    headline: "Your spend report is already outdated",
    keyMessage: "Real-time spend visibility gives finance leaders control before problems occur.",
    supportingPoints: ["Delay between transaction and report", "Earlier signals improve forecasting"],
    tone: "Confident and practical",
    cta: "See how real-time spend visibility works",
    format: "LinkedIn thought-leadership post",
    contentBrief: ["Open with the reporting delay", "Explain reactive finance", "Introduce real-time visibility", "Close with the CTA"],
  },
  generatedContent: {
    title: "Your spend report is already outdated",
    body: "Most finance teams do not lack data. They get it too late. By the time a monthly spend review lands, the duplicate tool has renewed and the off-policy purchase is already booked. Real-time visibility changes the job from explaining last month to steering this one, with limits and approvals built into every purchase. See how real-time spend visibility works.",
  },
};

// Fake OpenAI-compatible provider: one tool call, then a final JSON decision.
function fakeProviders({ failGroq = false, badEvidenceTimes = 0, decision = marketingDecision, content = contentOutput } = {}) {
  const calls = [];
  let badLeft = badEvidenceTimes;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const provider = url.includes("groq") ? "groq" : "gemini";
    calls.push({ provider, tools: Boolean(body.tools), schema: body.response_format?.json_schema?.name ?? null, auth: init.headers.Authorization });
    if (provider === "groq" && failGroq) return new Response('{"error":{"message":"rate limited"}}', { status: 429 });
    let message;
    if (body.tools) {
      message = body.messages.some((m) => m.role === "tool")
        ? { role: "assistant", content: "I have what I need." }
        : { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: body.tools[0].function.name, arguments: "{}" } }] };
    } else if (body.response_format?.json_schema?.name === "marketing_recommendation") {
      let d = decision;
      if (badLeft > 0) {
        badLeft -= 1;
        d = { ...decision, evidence: [{ metricId: "made:up", statement: "Invented" }, { metricId: "also:fake", statement: "Invented" }] };
      }
      message = { role: "assistant", content: JSON.stringify(d) };
    } else {
      message = { role: "assistant", content: JSON.stringify(content) };
    }
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  };
  return { calls, fetchImpl };
}

const llmWith = (fetchImpl) => new LLMClient({ env: (k) => ({ GROQ_API_KEY: "groq-test", GEMINI_API_KEY: "gemini-test" })[k], fetchImpl });

async function baselineSession(objectiveId = "traffic") {
  const session = newSession({ sessionId: "test-session-000001", companyKey: "ramp", objectiveId });
  await runExperiment({ profile: ramp, companyKey: "ramp", session, spec: baselineSpec(ramp), hubspot: new HubSpotClient(), seed: 11 });
  return session;
}

// --- Simulator ---
test("simulator: reproducible from a seed, reach bounded by the addressable audience", () => {
  const cell = { audienceId: "finance_leader", channel: "linkedin", messagingAngle: "cost_control", contentType: "thought_leadership" };
  const a = simulateCell({ companyKey: "ramp", cell, share: 0.5, rng: makeRng(5) });
  const b = simulateCell({ companyKey: "ramp", cell, share: 0.5, rng: makeRng(5) });
  assert.deepEqual(a, b);
  assert.ok(a.reach <= Math.ceil(TRUTH.ramp.finance_leader.addressable.linkedin * 0.5 * 1.08));
  assert.ok(a.clicks <= a.reach);
});

test("simulator: marketing decisions change the outcome (hidden best angle has higher click probability)", () => {
  const base = { audienceId: "finance_leader", channel: "email", contentType: "thought_leadership" };
  assert.ok(clickProbability("ramp", { ...base, messagingAngle: "real_time_visibility" }) > clickProbability("ramp", { ...base, messagingAngle: "cost_control" }));
});

// --- Analytics ---
test("analytics: significance test and too-close-to-call rules", () => {
  assert.equal(twoProportionZ({ clicks: 10, reach: 100 }, { clicks: 10, reach: 100 }), 0);
  assert.ok(compareRates({ clicks: 120, reach: 1000 }, { clicks: 60, reach: 1000 }).significant);
  assert.equal(compareRates({ clicks: 12, reach: 100 }, { clicks: 6, reach: 100 }).reason, "not enough clicks yet");
  assert.equal(compareRates({ clicks: 52, reach: 1000 }, { clicks: 50, reach: 1000 }).tooCloseToCall, true);
});

test("analytics: baseline produces efficiency and volume leaders and data-backed insights", async () => {
  const session = await baselineSession();
  const a = computeAnalytics({ profile: ramp, experiments: session.experiments, objectiveId: "traffic" });
  const fl = a.byAudience.finance_leader;
  assert.equal(fl.channels.length, 3);
  assert.ok(fl.channelLeaders.efficiency && fl.channelLeaders.volume);
  assert.equal(fl.channelLeaders.efficiency.ctr, Math.max(...fl.channels.map((c) => c.ctr)));
  assert.equal(fl.channelLeaders.volume.expectedClicksPerExperiment, Math.max(...fl.channels.map((c) => c.expectedClicksPerExperiment)));
  assert.deepEqual(fl.angles.untested.sort(), ["policy_compliance", "real_time_visibility", "time_savings"]);
  for (const insight of [...a.insights.audience, ...a.insights.channel]) {
    assert.ok(insight.metricIds.length && insight.metricIds.every((id) => a.metrics[id]), insight.text);
  }
});

// --- Agents and the loop ---
test("plan: Marketing Agent then Content Agent produce a test-vs-control next experiment", async () => {
  const session = await baselineSession();
  const { calls, fetchImpl } = fakeProviders();
  const llm = llmWith(fetchImpl);
  const { plan } = await planNextExperiment({ profile: ramp, session, llm });

  assert.equal(plan.marketing.recommendation.recommendedChannel, "linkedin");
  assert.ok(plan.marketing.evidence.every((e) => e.metric), "every evidence item resolves to a real metric");
  assert.ok(plan.marketing.toolCalls.some((c) => c.name === "getCampaignObjective"));
  assert.equal(plan.content.contentPlan.headline, "Your spend report is already outdated");

  const [testCell, control] = plan.spec.cells;
  assert.equal(testCell.role, "test");
  assert.equal(testCell.messagingAngle, "real_time_visibility");
  assert.equal(testCell.variant.source, "Content Agent");
  assert.equal(control.role, "control");
  assert.equal(control.channel, "linkedin");
  assert.equal(control.messagingAngle, "cost_control", "control reuses the best existing variant");
  assert.ok(calls.every((c) => c.provider === "groq"));
  assert.ok(calls.some((c) => c.schema === "marketing_recommendation") && calls.some((c) => c.schema === "content_plan"));
});

test("run N+1 executes exactly the planned experiment and feeds analytics", async () => {
  const session = await baselineSession();
  await planNextExperiment({ profile: ramp, session, llm: llmWith(fakeProviders().fetchImpl) });
  const spec = session.pendingPlan.spec;
  const { experiment, analytics } = await runExperiment({ profile: ramp, companyKey: "ramp", session, spec, hubspot: new HubSpotClient(), seed: 12 });

  assert.equal(experiment.experimentNumber, 2);
  assert.equal(experiment.kind, "test_vs_control");
  assert.equal(session.pendingPlan, null);
  assert.equal(experiment.marketingAgentRecommendation.hypothesis, marketingDecision.hypothesis);
  assert.equal(experiment.dataSource.performance, "simulated");
  assert.ok(analytics.latest.testVsControl, "test vs control comparison computed");
  assert.ok(analytics.byAudience.finance_leader.angles.tested.some((x) => x.id === "real_time_visibility"));
});

test("fallback: Groq rate limit switches to Gemini", async () => {
  const session = await baselineSession();
  const { calls, fetchImpl } = fakeProviders({ failGroq: true });
  const { plan } = await planNextExperiment({ profile: ramp, session, llm: llmWith(fetchImpl) });
  assert.equal(plan.marketing.provider, "gemini");
  assert.ok(calls.some((c) => c.provider === "groq") && calls.some((c) => c.provider === "gemini"));
  assert.ok(plan.llmTrace.some((t) => t.provider === "groq" && t.status === 429));
});

test("validation: evidence not returned by tools is rejected, repaired, and fails loudly if it persists", async () => {
  const repaired = await planNextExperiment({ profile: ramp, session: await baselineSession(), llm: llmWith(fakeProviders({ badEvidenceTimes: 1 }).fetchImpl) });
  assert.ok(repaired.plan.marketing.evidence.every((e) => e.metric));

  await assert.rejects(
    planNextExperiment({ profile: ramp, session: await baselineSession(), llm: llmWith(fakeProviders({ badEvidenceTimes: 5 }).fetchImpl) }),
    (err) => err instanceof AgentError,
  );
});

test("validation: channel must be available for the audience", async () => {
  const bad = { ...marketingDecision, priorityAudience: "employee_spender", recommendedChannel: "linkedin" };
  await assert.rejects(
    planNextExperiment({ profile: ramp, session: await baselineSession(), llm: llmWith(fakeProviders({ decision: bad }).fetchImpl) }),
    (err) => err instanceof AgentError && JSON.stringify(err.details).includes("not available"),
  );
});

test("content: topics too similar to earlier content are detected", () => {
  assert.ok(similarity("How finance teams control spend without slowing the business", "How finance teams control spend without slowing down the business") >= 0.6);
  assert.ok(similarity("Your spend report is already outdated", "See spend as it happens, not at month-end") < 0.6);
});

// --- API ---
test("api: session lifecycle, AI-not-configured state, and input checks", async () => {
  const sessionId = "api-test-session-0001";
  const call = (route, body) => handler(new Request(`http://localhost/api/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, company: "ramp", ...body }),
  }));
  const saved = { GROQ_API_KEY: process.env.GROQ_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const first = await (await handler(new Request(`http://localhost/api/session?sessionId=${sessionId}&company=ramp`))).json();
    assert.equal(first.experimentCount, 0);
    assert.equal(first.labels.performance, "SIMULATED");

    assert.equal((await call("plan", {})).status, 409, "cannot plan before a baseline");
    const run = await call("run", { objective: "awareness" });
    assert.equal(run.status, 200);
    const runBody = await run.json();
    assert.equal(runBody.experimentCount, 1);
    assert.equal(runBody.objective.id, "awareness");
    assert.ok(runBody.analytics.insights);

    assert.equal((await call("run", {})).status, 409, "next run needs a plan");
    const plan = await call("plan", {});
    assert.equal(plan.status, 503);
    assert.equal((await plan.json()).aiUnavailable, true);

    const reset = await (await call("reset", {})).json();
    assert.equal(reset.experimentCount, 0);

    assert.equal((await call("run", { objective: "nonsense" })).status, 400);
    const badSession = await handler(new Request("http://localhost/api/run", { method: "POST", body: JSON.stringify({ sessionId: "x", company: "ramp" }) }));
    assert.equal(badSession.status, 400);
  } finally {
    Object.assign(process.env, Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)));
  }
});

test("api: plan with configured providers returns a pending plan", async () => {
  const sessionId = "api-test-session-0002";
  const call = (route, body) => handler(new Request(`http://localhost/api/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, company: "ramp", ...body }),
  }));
  const originalFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = "groq-test";
  globalThis.fetch = fakeProviders().fetchImpl;
  try {
    assert.equal((await call("run", { objective: "traffic" })).status, 200);
    const plan = await call("plan", {});
    assert.equal(plan.status, 200);
    const body = await plan.json();
    assert.equal(body.pendingPlan.spec.cells.length, 2);
    assert.equal((await call("run", {})).status, 200);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
  }
});
