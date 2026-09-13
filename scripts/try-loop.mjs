// Runs one real loop from the terminal: a baseline experiment, then the Marketing Agent and
// Content Agent with the providers configured in .env (npm run try:loop). Nothing is stored.
// HubSpot stays in mock mode unless HUBSPOT_MODE=live is set.
//
//   npm run try:loop                 Ramp, product consideration
//   npm run try:loop -- square traffic

import { PROFILES, OBJECTIVES, CHANNEL_LABELS, angleLabel, contentTypeLabel } from "../lib/company.mjs";
import { pct } from "../lib/analytics.mjs";
import { HubSpotClient } from "../lib/hubspot.mjs";
import { LLMClient } from "../lib/llm.mjs";
import { baselineSpec, createContent, newSession, recommendStrategy, runExperiment } from "../lib/loop.mjs";

const [companyKey = "ramp", objectiveId = "product_consideration"] = process.argv.slice(2);
if (!PROFILES[companyKey]) throw new Error(`Unknown company "${companyKey}". Use ramp or square.`);
if (!OBJECTIVES[objectiveId]) throw new Error(`Unknown objective "${objectiveId}". Use one of: ${Object.keys(OBJECTIVES).join(", ")}`);

const profile = PROFILES[companyKey];
const env = (k) => (process.env[k] ?? "").trim();
const hubspot = new HubSpotClient({ token: env("HUBSPOT_ACCESS_TOKEN"), mode: env("HUBSPOT_MODE") || "mock" });
const session = newSession({ sessionId: `local-try-${Date.now()}`, companyKey, objectiveId });
const audienceName = (id) => profile.personas.find((p) => p.id === id)?.short_name ?? id;

console.log(`\n${profile.name} · objective: ${OBJECTIVES[objectiveId].label} · HubSpot: ${hubspot.live ? "LIVE" : "mock"}`);

const { analytics } = await runExperiment({ profile, companyKey, session, spec: baselineSpec(profile), hubspot });
const s = analytics.signal;
console.log(`\n1. Baseline experiment (SIMULATED performance), judged on ${s.label}`);
for (const a of analytics.audiences) console.log(`   ${a.name.padEnd(26)} ${s.label} ${pct(a.rate)}  (${a.events} ${s.event} / ${a.reach} reached) · CTR ${pct(a.ctr)}`);
console.log("   What we learned (code):");
for (const i of analytics.learnings) console.log(`   - ${i.text}`);
console.log("   What we don't know yet (code):");
for (const i of analytics.knowledgeGaps) console.log(`   - ${i.text}`);

const llm = new LLMClient({ env });
if (!llm.configured) {
  console.log("\nNo AI provider configured. Copy .env.example to .env and add GROQ_API_KEY and/or GEMINI_API_KEY.");
  process.exit(0);
}

console.log("\n2. Marketing Agent: what to test next…");
const started = Date.now();
try {
  const { plan: strategy } = await recommendStrategy({ profile, session, llm });
  const m = strategy.marketing;
  const r = m.recommendation;
  console.log(`\nMarketing Agent (AI · ${m.provider} ${m.model})`);
  console.log(`   Decision:      test ${audienceName(r.priorityAudience)} on ${CHANNEL_LABELS[r.recommendedChannel]}: ${angleLabel(profile, r.recommendedAngle)} · ${contentTypeLabel(profile, r.recommendedContentType)} (${r.decisionType})`);
  console.log(`   Learned:       ${r.learned}`);
  console.log(`   Knowledge gap: ${r.knowledgeGap}`);
  console.log(`   Hypothesis:    ${r.hypothesis}`);
  console.log(`   Why this test: ${r.reasoning}`);
  console.log(`   Alternatives:  ${r.alternatives}`);
  console.log(`   Trade-off:     ${r.tradeoff}`);
  console.log(`   Confidence:    ${r.confidence}. ${r.confidenceReason}`);
  console.log(`   Supports if:   ${r.supportIf} → ${r.ifSupported}`);
  console.log(`   Rejects if:    ${r.rejectIf} → ${r.ifRejected}`);
  console.log("   Evidence:");
  for (const e of m.evidence) {
    const source = e.metric ? `${e.metric.label}: ${pct(e.metric.rate)} ${s.label}, ${e.metric.events}/${e.metric.reach}` : e.context ? `strategy · ${e.context.label}` : "?";
    console.log(`   - ${e.statement} [${source}]`);
  }
  console.log(`   Tools: ${m.toolCalls.map((c) => c.name + (c.suppliedBySystem ? "*" : "")).join(", ")}  (* supplied by the system)`);

  console.log("\n3. Content Agent: creating the variant…");
  const { plan } = await createContent({ profile, session, llm });
  const c = plan.content;
  const g = c.generatedContent;
  console.log(`\nContent Agent (AI · ${c.provider} ${c.model})`);
  console.log(`   Topic:    ${c.contentPlan.topic}`);
  console.log(`   Headline: ${c.contentPlan.headline}`);
  console.log(`   Hook:     ${c.contentPlan.hook}`);
  console.log(`   Format:   ${c.contentPlan.format}`);
  console.log(`\n   Title:    ${g.title}`);
  if (g.previewText) console.log(`   Preview:  ${g.previewText}`);
  console.log(`\n   ${g.paragraphs.join("\n\n   ")}`);
  console.log(`\n   [Button: ${g.ctaText}]`);

  const [test, control] = plan.spec.cells;
  const variantLabel = (x) => `${angleLabel(profile, x.messagingAngle)}, ${contentTypeLabel(profile, x.contentType).toLowerCase()}`;
  console.log(`\n4. Next experiment on ${CHANNEL_LABELS[test.channel]}: ${variantLabel(test)} (new variant) vs ${variantLabel(control)} (current control), 50/50`);
} catch (err) {
  console.log(`\nPlanning failed: ${err.message}`);
  for (const a of err.attempts ?? err.details?.attempts ?? []) console.log(`   - ${JSON.stringify(a).slice(0, 240)}`);
  process.exitCode = 1;
}
const tokens = llm.trace.reduce((sum, t) => sum + (t.tokens ?? 0), 0);
console.log(`\nProvider calls: ${llm.trace.map((t) => `${t.provider}${t.ok ? "" : `(${t.status ?? "error"})`}`).join(" → ")} · ${tokens} tokens · ${Math.round((Date.now() - started) / 1000)}s`);
