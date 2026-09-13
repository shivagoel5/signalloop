import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import handler from "../lib/api.mjs";
import { openStore } from "../lib/store.mjs";
import { PROFILES } from "../lib/company.mjs";
import { HubSpotClient } from "../lib/hubspot.mjs";
import { LLMClient } from "../lib/llm.mjs";
import { AgentError } from "../lib/agents/run-agent.mjs";
import { similarity } from "../lib/agents/content.mjs";
import { compareRates, computeAnalytics, twoProportionZ } from "../lib/analytics.mjs";
import { baselineSpec, createContent, newSession, planNextExperiment, recommendStrategy, runExperiment } from "../lib/loop.mjs";
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
    previewText: "Month-end reviews explain what went wrong. Real-time visibility helps you stop it first.",
    paragraphs: [
      "Most finance teams do not lack data. They get it too late.",
      "By the time a monthly spend review lands, the duplicate tool has renewed and the off-policy purchase is already booked.",
      "Real-time visibility changes the job from explaining last month to steering this one, with limits and approvals built into every purchase.",
    ],
    ctaText: "See how it works",
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

test("plan in two steps: the recommendation waits for review before any content is created", async () => {
  const session = await baselineSession();
  const { calls, fetchImpl } = fakeProviders();
  const llm = llmWith(fetchImpl);
  await recommendStrategy({ profile: ramp, session, llm });
  assert.equal(session.pendingPlan.stage, "strategy");
  assert.equal(session.pendingPlan.spec, undefined, "nothing to run until the content exists");
  assert.ok(calls.every((c) => c.schema !== "content_plan"), "the Content Agent has not run");

  await createContent({ profile: ramp, session, llm });
  assert.equal(session.pendingPlan.stage, "content");
  const variant = session.pendingPlan.spec.cells[0].variant;
  assert.equal(variant.paragraphs.length, 3);
  assert.equal(variant.ctaText, "See how it works");
  assert.ok(session.pendingPlan.content.sampleContact.firstName, "a sample contact for the preview");
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

test("fallback: Gemini can continue a conversation whose tool calls came from Groq", async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ provider: url.includes("groq") ? "groq" : "gemini", body });
    if (url.includes("groq")) return new Response('{"error":{"message":"rate limited"}}', { status: 429 });
    // Mirrors Gemini 3: tool calls in the history must carry a thought signature.
    const unsigned = body.messages.some((m) => m.tool_calls?.some((c) => !c.extra_content?.google?.thought_signature));
    if (unsigned) return new Response('{"error":{"message":"Function call is missing a thought_signature"}}', { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I have what I need." } }] }), { status: 200 });
  };
  const history = [
    { role: "user", content: "Check audience performance." },
    { role: "assistant", content: "", tool_calls: [{ id: "fc_groq_1", type: "function", function: { name: "getAudiencePerformance", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "fc_groq_1", name: "getAudiencePerformance", content: "{}" },
  ];
  const tools = [{ type: "function", function: { name: "getAudiencePerformance", description: "CTR per audience.", parameters: { type: "object", properties: {} } } }];
  const { provider } = await llmWith(fetchImpl).chat({ messages: history, tools });
  assert.equal(provider, "gemini");
  assert.equal(sent[0].body.messages[1].tool_calls[0].extra_content, undefined, "Groq requests are unchanged");
  assert.equal(history[1].tool_calls[0].extra_content, undefined, "the stored history is not mutated");
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

async function expectPlanRejected(options, pattern) {
  await assert.rejects(
    planNextExperiment({ profile: ramp, session: await baselineSession(), llm: llmWith(fakeProviders(options).fetchImpl) }),
    (err) => err instanceof AgentError && pattern.test(JSON.stringify(err.details)),
  );
}

test("validation: a test identical to its control is rejected", async () => {
  // After the baseline, the control for Finance Leaders on LinkedIn is cost control + thought leadership.
  await expectPlanRejected({ decision: { ...marketingDecision, recommendedAngle: "cost_control" } }, /control for finance_leader on linkedin/);
});

test("validation: high confidence is rejected before three experiments", async () => {
  await expectPlanRejected({ decision: { ...marketingDecision, confidence: "high" } }, /confidence must be low or medium/);
});

test("validation: content with numbers or invented stats is rejected", async () => {
  const withStat = { ...contentOutput, generatedContent: { ...contentOutput.generatedContent, paragraphs: [...contentOutput.generatedContent.paragraphs, "Teams save 30% of their close time."] } };
  await expectPlanRejected({ content: withStat }, /Remove every number/);
});

test("validation: content framed for a different audience or with other merge fields is rejected", async () => {
  const wrongAudience = { ...contentOutput, contentPlan: { ...contentOutput.contentPlan, topic: "Why controllers need faster month-end close" } };
  await expectPlanRejected({ content: wrongAudience }, /framed for Controllers/);
  const opening = (text) => ({ ...contentOutput, generatedContent: { ...contentOutput.generatedContent, paragraphs: [text, ...contentOutput.generatedContent.paragraphs] } });
  await expectPlanRejected({ content: opening("Hi {{FirstName}},") }, /only merge field allowed/);
  // The fake decision targets LinkedIn, where content is not personalized per contact.
  await expectPlanRejected({ content: opening("Hi {first_name},") }, /not personalized per contact/);
});

test("validation: links and placeholders in content are rejected, since the CTA is shown as a button", async () => {
  const withPlaceholder = { ...contentOutput, generatedContent: { ...contentOutput.generatedContent, paragraphs: [...contentOutput.generatedContent.paragraphs, "Read the full story here: [Link]"] } };
  await expectPlanRejected({ content: withPlaceholder }, /Remove links, URLs and placeholders/);
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

    assert.equal((await call("strategy", {})).status, 409, "cannot ask for a recommendation before a baseline");
    const run = await call("run", { objective: "awareness" });
    assert.equal(run.status, 200);
    const runBody = await run.json();
    assert.equal(runBody.experimentCount, 1);
    assert.equal(runBody.objective.id, "awareness");
    assert.ok(runBody.analytics.insights);

    assert.equal((await call("run", {})).status, 409, "next run needs content");
    assert.equal((await call("content", {})).status, 409, "content needs a recommendation");
    const strategy = await call("strategy", {});
    assert.equal(strategy.status, 503);
    assert.equal((await strategy.json()).aiUnavailable, true);

    const reset = await (await call("reset", {})).json();
    assert.equal(reset.experimentCount, 0);

    assert.equal((await call("run", { objective: "nonsense" })).status, 400);
    const badSession = await handler(new Request("http://localhost/api/run", { method: "POST", body: JSON.stringify({ sessionId: "x", company: "ramp" }) }));
    assert.equal(badSession.status, 400);
  } finally {
    Object.assign(process.env, Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)));
  }
});

test("api: recommendation, then content, then the planned run", async () => {
  const sessionId = "api-test-session-0002";
  const call = (route, body) => handler(new Request(`http://localhost/api/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, company: "ramp", ...body }),
  }));
  const originalFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = "groq-test";
  globalThis.fetch = fakeProviders().fetchImpl;
  try {
    assert.equal((await call("run", { objective: "traffic" })).status, 200);
    const strategy = await (await call("strategy", {})).json();
    assert.equal(strategy.pendingPlan.stage, "strategy");
    assert.equal((await call("run", {})).status, 409, "cannot run before the content exists");
    const content = await call("content", {});
    assert.equal(content.status, 200);
    const body = await content.json();
    assert.equal(body.pendingPlan.spec.cells.length, 2);
    assert.equal((await call("run", {})).status, 200);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
  }
});

test("page: built-in demo settings match the API, and opening the page makes no API request", async () => {
  const html = readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
  const match = html.match(/<script type="application\/json" id="demo-static">([\s\S]*?)<\/script>/);
  assert.ok(match, "docs/index.html embeds the demo settings");
  const settings = JSON.parse(match[1]);
  assert.deepEqual(Object.keys(settings.companies), Object.keys(PROFILES));
  for (const company of Object.keys(PROFILES)) {
    const view = await (await handler(new Request(`http://localhost/api/session?sessionId=static-settings-check&company=${company}`))).json();
    assert.equal(settings.companies[company].name, view.company);
    assert.deepEqual(settings.companies[company].audiences, view.audiences);
    assert.deepEqual(settings.objectives, view.objectives);
    assert.equal(settings.defaultObjective, view.objective.id);
    assert.equal(settings.maxExperiments, view.maxExperiments);
    const { crm, ...labels } = view.labels;
    assert.deepEqual(settings.labels, labels);
  }
  // The only session read in the demo script is the refresh used when the browser's saved copy is out of date.
  assert.match(html, /<script src="demo.js"><\/script>/);
  const script = readFileSync(new URL("../docs/demo.js", import.meta.url), "utf8");
  assert.equal(script.match(/api\('GET','session'\)/g)?.length, 1);
  assert.match(script, /async function refreshFromServer\(\)\{\s*var res=await api\('GET','session'\)/);
});

// --- Vercel deployment ---
test("store: Upstash REST commands for history, counters and expiry", async () => {
  const data = new Map();
  const calls = [];
  const fetchImpl = async (url, init) => {
    assert.equal(url, "https://example-redis.upstash.io");
    assert.equal(init.headers.Authorization, "Bearer test-token");
    const [command, key, value] = JSON.parse(init.body);
    calls.push(command);
    let result = null;
    if (command === "GET") result = data.has(key) ? data.get(key) : null;
    if (command === "SET") { data.set(key, value); result = "OK"; }
    if (command === "INCR") { const n = Number(data.get(key) ?? 0) + 1; data.set(key, String(n)); result = n; }
    if (command === "EXPIRE") result = 1;
    return new Response(JSON.stringify({ result }), { status: 200 });
  };
  const store = openStore({ env: { KV_REST_API_URL: "https://example-redis.upstash.io/", KV_REST_API_TOKEN: "test-token" }, fetchImpl });
  assert.equal(await store.get("sessions/missing/ramp", { type: "json" }), null);
  await store.setJSON("sessions/a/ramp", { experiments: [1] }, { ttlSeconds: 60 });
  assert.deepEqual(await store.get("sessions/a/ramp", { type: "json" }), { experiments: [1] });
  assert.equal(await store.incr("usage/ai/today", 3600), 1);
  assert.equal(await store.incr("usage/ai/today", 3600), 2);
  assert.deepEqual(calls, ["GET", "SET", "GET", "INCR", "EXPIRE", "INCR"], "the expiry is set once, when a counter is created");
  assert.throws(() => openStore({ env: { VERCEL: "1" } }), /Storage is not configured/);
});

test("vercel routes: each api/ file exposes its method, and a visitor is rate limited per IP", async () => {
  const routes = {
    session: await import("../api/session.mjs"),
    run: await import("../api/run.mjs"),
    strategy: await import("../api/strategy.mjs"),
    content: await import("../api/content.mjs"),
    reset: await import("../api/reset.mjs"),
  };
  assert.equal(typeof routes.session.GET, "function");
  for (const name of ["run", "strategy", "content", "reset"]) assert.equal(typeof routes[name].POST, "function", `${name} handles POST`);

  const minute = () => Math.floor(Date.now() / 60000);
  const started = minute();
  const statuses = [];
  for (let i = 0; i < 31; i++) {
    const req = new Request("https://signalloop.example/api/session?sessionId=rate-limit-check-0001&company=ramp", {
      headers: { "x-forwarded-for": `203.0.113.7, 10.0.0.${i}` },
    });
    statuses.push((await routes.session.GET(req)).status);
  }
  if (minute() === started) {
    assert.equal(statuses.filter((s) => s === 200).length, 30);
    assert.equal(statuses.at(-1), 429);
  }
});
