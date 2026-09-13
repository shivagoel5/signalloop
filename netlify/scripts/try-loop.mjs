// Runs one real loop from the terminal: a baseline experiment, then the Marketing Agent and
// Content Agent with the providers configured in .env (npm run try:loop). Nothing is stored.
// HubSpot stays in mock mode unless HUBSPOT_MODE=live is set.
//
//   npm run try:loop                 Ramp, product consideration
//   npm run try:loop -- square traffic

import { PROFILES, OBJECTIVES, CHANNEL_LABELS, angleLabel, contentTypeLabel } from "../lib/company.mjs";
import { HubSpotClient } from "../lib/hubspot.mjs";
import { LLMClient } from "../lib/llm.mjs";
import { baselineSpec, newSession, planNextExperiment, runExperiment } from "../lib/loop.mjs";

const [companyKey = "ramp", objectiveId = "product_consideration"] = process.argv.slice(2);
if (!PROFILES[companyKey]) throw new Error(`Unknown company "${companyKey}". Use ramp or square.`);
if (!OBJECTIVES[objectiveId]) throw new Error(`Unknown objective "${objectiveId}". Use one of: ${Object.keys(OBJECTIVES).join(", ")}`);

const profile = PROFILES[companyKey];
const env = (k) => (process.env[k] ?? "").trim();
const hubspot = new HubSpotClient({ token: env("HUBSPOT_ACCESS_TOKEN"), mode: env("HUBSPOT_MODE") || "mock" });
const session = newSession({ sessionId: `local-try-${Date.now()}`, companyKey, objectiveId });
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const audienceName = (id) => profile.personas.find((p) => p.id === id)?.short_name ?? id;

console.log(`\n${profile.name} · objective: ${OBJECTIVES[objectiveId].label} · HubSpot: ${hubspot.live ? "LIVE" : "mock"}`);

const { analytics } = await runExperiment({ profile, companyKey, session, spec: baselineSpec(profile), hubspot });
console.log("\n1. Baseline experiment (SIMULATED performance)");
for (const a of analytics.audiences) console.log(`   ${a.name.padEnd(26)} CTR ${pct(a.ctr)}  (${a.clicks} clicks / ${a.reach} reached)`);
console.log("   Insights (code):");
for (const i of [...analytics.insights.audience, ...analytics.insights.channel].slice(0, 6)) console.log(`   - ${i.text}`);

const llm = new LLMClient({ env });
if (!llm.configured) {
  console.log("\nNo AI provider configured. Copy .env.example to .env and add GROQ_API_KEY and/or GEMINI_API_KEY.");
  process.exit(0);
}

console.log("\n2. Planning with the agents…");
const started = Date.now();
try {
  const { plan } = await planNextExperiment({ profile, session, llm });
  const m = plan.marketing;
  const r = m.recommendation;
  console.log(`\nMarketing Agent (AI · ${m.provider} ${m.model})`);
  console.log(`   Target:     ${audienceName(r.priorityAudience)} on ${CHANNEL_LABELS[r.recommendedChannel]}`);
  console.log(`   Angle:      ${angleLabel(profile, r.recommendedAngle)} · ${contentTypeLabel(profile, r.recommendedContentType)}`);
  console.log(`   Decision:   ${r.decisionType}, ${r.confidence} confidence`);
  console.log(`   Hypothesis: ${r.hypothesis}`);
  console.log(`   Trade-off:  ${r.tradeoff}`);
  console.log("   Evidence:");
  for (const e of m.evidence) console.log(`   - ${e.statement} [${e.metricId}: ${e.metric ? `${pct(e.metric.ctr)} CTR, ${e.metric.clicks}/${e.metric.reach}` : "?"}]`);
  console.log(`   Tools: ${m.toolCalls.map((c) => c.name + (c.suppliedBySystem ? "*" : "")).join(", ")}  (* supplied by the system)`);

  const c = plan.content;
  console.log(`\nContent Agent (AI · ${c.provider} ${c.model})`);
  console.log(`   Topic:    ${c.contentPlan.topic}`);
  console.log(`   Headline: ${c.contentPlan.headline}`);
  console.log(`   Hook:     ${c.contentPlan.hook}`);
  console.log(`   CTA:      ${c.contentPlan.cta}`);
  console.log(`   Format:   ${c.contentPlan.format}`);
  console.log(`\n   ${c.generatedContent.title}\n   ${c.generatedContent.body.replace(/\n/g, "\n   ")}`);

  const [test, control] = plan.spec.cells;
  const variantLabel = (c) => `${angleLabel(profile, c.messagingAngle)}, ${contentTypeLabel(profile, c.contentType).toLowerCase()}`;
  console.log(`\n3. Next experiment on ${CHANNEL_LABELS[test.channel]}: ${variantLabel(test)} (test) vs ${variantLabel(control)} (control), 50/50`);
} catch (err) {
  console.log(`\nPlanning failed: ${err.message}`);
  for (const a of err.attempts ?? err.details?.attempts ?? []) console.log(`   - ${JSON.stringify(a).slice(0, 240)}`);
  process.exitCode = 1;
}
const tokens = llm.trace.reduce((sum, t) => sum + (t.tokens ?? 0), 0);
console.log(`\nProvider calls: ${llm.trace.map((t) => `${t.provider}${t.ok ? "" : `(${t.status ?? "error"})`}`).join(" → ")} · ${tokens} tokens · ${Math.round((Date.now() - started) / 1000)}s`);
