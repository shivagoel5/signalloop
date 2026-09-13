// The SignalLoop experiment loop:
// content variant -> HubSpot distribution -> simulated measurement -> deterministic analytics
// -> Marketing Agent -> Content Agent -> next experiment spec (run on the next request).

import { CONTACTS, getAudience } from "./company.mjs";
import { computeAnalytics } from "./analytics.mjs";
import { MEASUREMENT_VERSION, makeRng, simulateCell } from "./simulator.mjs";
import { runMarketingAgent } from "./agents/marketing.mjs";
import { runContentAgent } from "./agents/content.mjs";

export const MAX_EXPERIMENTS = 12;

export function newSession({ sessionId, companyKey, objectiveId, now = new Date() }) {
  return { sessionId, company: companyKey, objectiveId, experiments: [], pendingPlan: null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

// Experiment 1: every audience on every channel with its default angle and content type,
// using the profile's existing newsletter copy, to establish baselines.
export function baselineSpec(profile) {
  return {
    kind: "baseline",
    cells: profile.personas.flatMap((p) => p.channels.map((channel) => ({
      cellId: `${p.id}-${channel}`,
      role: "baseline",
      share: 1,
      audienceId: p.id,
      channel,
      messagingAngle: p.default_angle,
      contentType: p.default_content_type,
      variant: {
        contentVariantId: `${p.id}-baseline`,
        topic: profile.blog.title,
        headline: p.newsletter.subject,
        body: p.newsletter.body,
        source: "profile template",
      },
    }))),
    marketingAgentRecommendation: null,
    contentAgentRecommendation: null,
  };
}

export async function runExperiment({ profile, companyKey, session, spec, hubspot, crmState = {}, seed, now = new Date() }) {
  seed = (seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;
  const experimentNumber = session.experiments.length + 1;
  const runId = `run_${now.toISOString().replace(/\D/g, "").slice(0, 14)}_${seed.toString(36).slice(-4)}`;

  const distribution = await distributeToHubSpot({ profile, spec, runId, now, hubspot, crmState });

  const rng = makeRng(seed);
  const cells = spec.cells.map((c) => {
    const measured = simulateCell({ companyKey, cell: c, share: c.share, rng });
    return {
      cellId: c.cellId,
      role: c.role,
      audienceId: c.audienceId,
      channel: c.channel,
      messagingAngle: c.messagingAngle,
      contentType: c.contentType,
      contentVariantId: c.variant.contentVariantId,
      topic: c.variant.topic,
      headline: c.variant.headline,
      contentSource: c.variant.source,
      ...measured,
    };
  });

  const experiment = {
    runId,
    sessionId: session.sessionId,
    company: companyKey,
    experimentNumber,
    kind: spec.kind,
    objectiveId: session.objectiveId,
    cells,
    variants: Object.fromEntries(spec.cells.map((c) => [c.variant.contentVariantId, c.variant])),
    marketingAgentRecommendation: spec.marketingAgentRecommendation,
    contentAgentRecommendation: spec.contentAgentRecommendation,
    dataSource: {
      crm: hubspot.live ? "live" : "mock",
      delivery: "simulated",
      performance: "simulated",
      recommendation: spec.marketingAgentRecommendation ? "ai" : "baseline",
      content: spec.contentAgentRecommendation ? "ai" : "profile template",
    },
    measurementVersion: MEASUREMENT_VERSION,
    seed,
    createdAt: now.toISOString(),
  };

  session.experiments.push(experiment);
  session.pendingPlan = null;
  session.updatedAt = now.toISOString();

  const analytics = computeAnalytics({ profile, experiments: session.experiments, objectiveId: session.objectiveId });
  return { experiment, analytics, distribution, crmState: distribution.crmState };
}

export async function planNextExperiment({ profile, session, llm }) {
  const analytics = computeAnalytics({ profile, experiments: session.experiments, objectiveId: session.objectiveId });

  const marketing = await runMarketingAgent({
    llm, profile, analytics, experiments: session.experiments,
    controlFor: (audienceId, channel) => controlFor(profile, session.experiments, audienceId, channel),
  });
  const rec = marketing.output;
  const content = await runContentAgent({ llm, profile, analytics, experiments: session.experiments, recommendation: rec });

  const nextNumber = session.experiments.length + 1;
  const test = {
    cellId: `${rec.priorityAudience}-${rec.recommendedChannel}-test`,
    role: "test",
    share: 0.5,
    audienceId: rec.priorityAudience,
    channel: rec.recommendedChannel,
    messagingAngle: rec.recommendedAngle,
    contentType: rec.recommendedContentType,
    variant: {
      contentVariantId: `exp${nextNumber}-test`,
      topic: content.output.contentPlan.topic,
      headline: content.output.contentPlan.headline,
      body: content.output.generatedContent.body,
      title: content.output.generatedContent.title,
      source: "Content Agent",
    },
  };
  const control = controlCell(profile, session.experiments, rec, nextNumber);

  const spec = {
    kind: "test_vs_control",
    cells: [test, control],
    marketingAgentRecommendation: { ...rec, provider: marketing.provider, model: marketing.model },
    contentAgentRecommendation: { ...content.output, provider: content.provider, model: content.model },
  };

  session.pendingPlan = {
    spec,
    marketing: {
      recommendation: rec,
      evidence: marketing.evidence,
      toolCalls: marketing.toolCalls,
      systemSupplied: marketing.systemSupplied,
      provider: marketing.provider,
      model: marketing.model,
    },
    content: {
      ...content.output,
      toolCalls: content.toolCalls,
      systemSupplied: content.systemSupplied,
      provider: content.provider,
      model: content.model,
    },
    llmTrace: llm.trace,
    createdAt: new Date().toISOString(),
  };
  return { plan: session.pendingPlan, analytics };
}

// Control = the best-performing variant so far for the same audience and channel, re-run on the
// other half of the audience. Falls back to the audience's baseline variant.
function controlCell(profile, experiments, rec, nextNumber) {
  const audience = getAudience(profile, rec.priorityAudience);
  const best = bestVariant(experiments, rec.priorityAudience, rec.recommendedChannel);

  return {
    cellId: `${rec.priorityAudience}-${rec.recommendedChannel}-control`,
    role: "control",
    share: 0.5,
    audienceId: rec.priorityAudience,
    channel: rec.recommendedChannel,
    messagingAngle: best?.cell.messagingAngle ?? audience.default_angle,
    contentType: best?.cell.contentType ?? audience.default_content_type,
    variant: best?.variant
      ? { ...best.variant }
      : {
        contentVariantId: `${audience.id}-baseline`,
        topic: profile.blog.title,
        headline: audience.newsletter.subject,
        body: audience.newsletter.body,
        source: "profile template",
      },
  };
}

// The best-performing variant so far (pooled CTR) for an audience on a channel, if any.
function bestVariant(experiments, audienceId, channel) {
  const byVariant = new Map();
  for (const e of experiments) {
    for (const c of e.cells) {
      if (c.audienceId !== audienceId || c.channel !== channel) continue;
      const agg = byVariant.get(c.contentVariantId) ?? { cell: c, variant: e.variants?.[c.contentVariantId], reach: 0, clicks: 0 };
      agg.reach += c.reach;
      agg.clicks += c.clicks;
      byVariant.set(c.contentVariantId, agg);
    }
  }
  return [...byVariant.values()].sort((a, b) => b.clicks / (b.reach || 1) - a.clicks / (a.reach || 1))[0];
}

// The messaging angle and content type the control would use for an audience on a channel.
export function controlFor(profile, experiments, audienceId, channel) {
  const audience = getAudience(profile, audienceId);
  if (!audience) return null;
  const best = bestVariant(experiments, audienceId, channel);
  return {
    messagingAngle: best?.cell.messagingAngle ?? audience.default_angle,
    contentType: best?.cell.contentType ?? audience.default_content_type,
  };
}

// Write the audiences in this experiment to HubSpot (live or mock). Unchanged behavior from the
// previous demo: persona property, last newsletter/campaign properties, one static list per audience.
async function distributeToHubSpot({ profile, spec, runId, now, hubspot, crmState }) {
  const state = { propertiesReady: false, lists: {}, ...crmState };
  state.lists = { ...state.lists };
  if (!state.propertiesReady) {
    await hubspot.ensureContactProperties();
    state.propertiesReady = true;
  }

  const audienceIds = [...new Set(spec.cells.map((c) => c.audienceId))];
  const headlineFor = (audienceId) => spec.cells.find((c) => c.audienceId === audienceId && c.role !== "control")?.variant.headline
    ?? spec.cells.find((c) => c.audienceId === audienceId).variant.headline;

  const segments = new Map(audienceIds.map((id) => [getAudience(profile, id).segment, id]));
  const contacts = CONTACTS
    .filter((c) => segments.has(c.persona))
    .map((c) => ({
      email: c.email,
      persona: c.persona,
      properties: {
        email: c.email,
        firstname: c.first_name ?? "",
        lastname: c.last_name ?? "",
        company: c.company ?? "",
        persona: c.persona,
        signalloop_last_newsletter: headlineFor(segments.get(c.persona)),
        signalloop_last_campaign: `${runId} (${now.toISOString().slice(0, 10)})`,
      },
    }));
  const idsByEmail = await hubspot.upsertContacts(contacts);

  const crmContacts = {};
  await Promise.all(audienceIds.map(async (id) => {
    const audience = getAudience(profile, id);
    const listName = `SignalLoop - ${profile.name} - ${id}`;
    state.lists[listName] ??= await hubspot.ensureStaticList(listName);
    const ids = contacts.filter((c) => c.persona === audience.segment).map((c) => idsByEmail.get(c.email.toLowerCase())).filter(Boolean);
    if (ids.length) await hubspot.addToStaticList(state.lists[listName], ids);
    crmContacts[id] = ids.length;
  }));

  return {
    crmState: state,
    crmMode: hubspot.live ? "live" : "mock",
    crmContacts,
    requests: groupRequests(hubspot.requestLog),
    requestCount: hubspot.requestLog.length,
  };
}

function groupRequests(log) {
  const groups = new Map();
  for (const r of log) {
    const path = r.path
      .replace(/\/lists\/[^/]+\/memberships\/add$/, "/lists/{listId}/memberships/add")
      .replace(/\/name\/[^/]+$/, "/name/{listName}")
      .replace(/\/properties\/contacts\/[^/]+$/, "/properties/contacts/{name}");
    const key = `${r.method} ${path}`;
    const group = groups.get(key) ?? { method: r.method, path, count: 0, status: r.status };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()];
}
