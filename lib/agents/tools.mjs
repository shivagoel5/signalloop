// Read-only tools for the two agents. Every tool returns PMM strategy context from the company profile or data
// computed by the analytics engine; nothing here lets an agent change metrics, strategy or history.

import { CHANNEL_LABELS, angleLabel, contentTypeLabel, getAudience } from "../company.mjs";

const FIT_LABELS = { primary: "primary ICP", secondary: "secondary ICP", user: "end user, not a buyer" };

// The PMM strategy the Marketing Agent reasons from. Every item has a contextId the agent can cite as evidence.
export function strategyContext(profile, analytics) {
  const s = profile.strategy ?? {};
  const o = analytics.objective;
  const hypotheses = s.message_hypotheses ?? {};
  return {
    basis: s.basis ?? null,
    objective: {
      contextId: "ctx:objective",
      label: `Objective: ${o.label}`,
      text: `${o.guidance} Judged on ${o.metric.noun} (${o.metric.definition}). Funnel stage: ${o.funnelStage}.`,
      favors: o.favors,
    },
    icp: { contextId: "ctx:icp", label: "ICP", text: s.icp ?? null },
    audiences: profile.personas.map((p) => ({
      contextId: `ctx:audience:${p.id}`,
      audienceId: p.id,
      label: `${p.short_name}: ${FIT_LABELS[p.icp_fit] ?? "audience"}`,
      text: `${p.buying_role ?? p.profile_summary}. Job to be done: ${p.jtbd ?? p.profile_summary}`,
      painPoints: p.pain_points,
    })),
    positioning: { contextId: "ctx:positioning", label: "Positioning", text: s.positioning ?? profile.brand_context?.positioning ?? null },
    valueProposition: { contextId: "ctx:value_proposition", label: "Value proposition", text: s.value_proposition ?? null },
    proof: { contextId: "ctx:proof", label: "Product proof", text: (s.proof_points ?? []).join("; ") || null },
    competitiveAlternative: { contextId: "ctx:alternative", label: "Competitive alternative", text: s.competitive_alternative ?? null },
    messageHypotheses: profile.messaging_angles.map((a) => ({
      contextId: `ctx:message:${a.id}`,
      angleId: a.id,
      label: `${a.label}: ${hypotheses[a.id]?.role ?? "message hypothesis"}`,
      text: hypotheses[a.id]?.hypothesis ?? a.description,
    })),
    constraints: { contextId: "ctx:constraints", label: "Constraints", text: (s.constraints ?? []).join("; ") || null },
  };
}

export function marketingToolbox({ profile, analytics, experiments, controlFor }) {
  const audienceIds = profile.personas.map((p) => p.id);
  const audienceParam = optionalAudienceParam(audienceIds);
  const forAudiences = (audienceId) => (audienceId ? [audienceId] : audienceIds);
  const s = analytics.signal;
  const controlLabel = (audienceId, channel) => {
    const c = controlFor?.(audienceId, channel);
    return c ? `${angleLabel(profile, c.messagingAngle)} + ${contentTypeLabel(profile, c.contentType)}` : null;
  };

  const tools = {
    getStrategyContext: {
      description: "The PMM strategy: campaign objective (primary success signal and funnel stage), ICP, each audience's ICP fit, buying role and job to be done, positioning, value proposition, product proof, competitive alternative, message hypotheses and constraints. Cite items by contextId.",
      parameters: noParams(),
      run: () => strategyContext(profile, analytics),
    },
    getEvidenceSummary: {
      description: "What code has established so far: the primary signal and evidence guardrail, key learnings, knowledge gaps, the latest test result, and the last three experiments with the hypothesis, knowledge gap and planned next steps behind each.",
      parameters: noParams(),
      run: () => {
        const t = analytics.latest?.testVsControl;
        return {
          primarySignal: `${s.label}: ${s.definition}`,
          guardrail: `Prototype guardrail: each variant needs at least ${s.minEvents} ${s.event} before a difference is judged, and a difference only counts if it is statistically significant (about 95%).`,
          learnings: analytics.learnings,
          knowledgeGaps: analytics.knowledgeGaps,
          latestTest: t ? {
            experimentNumber: t.experimentNumber,
            audienceId: t.audienceId,
            channel: t.channel,
            newVariant: t.test.label,
            currentControl: t.control.label,
            decision: t.decision,
            status: t.status,
            observedDifferencePp: t.deltaPp,
            newVariantEvents: t.eventsA,
            controlEvents: t.eventsB,
            summary: t.summary,
            metricId: t.metricId,
          } : null,
          history: experiments.slice(-3).map((e) => {
            const r = e.marketingAgentRecommendation;
            return {
              experimentNumber: e.experimentNumber,
              objective: e.objectiveId,
              tested: r
                ? `${getAudience(profile, r.priorityAudience)?.short_name} on ${CHANNEL_LABELS[r.recommendedChannel]}: ${angleLabel(profile, r.recommendedAngle)} (${contentTypeLabel(profile, r.recommendedContentType)})`
                : "Baseline: every audience on every channel with its original message",
              hypothesis: r?.hypothesis ?? null,
              knowledgeGap: r?.knowledgeGap ?? null,
              ifSupported: r?.ifSupported ?? null,
              ifRejected: r?.ifRejected ?? null,
            };
          }),
        };
      },
    },
    getAudiencePerformance: {
      description: "Each audience's pooled results on the objective's primary signal, with CTR for reference, ICP fit, and how it compares with the other audiences.",
      parameters: noParams(),
      run: () => ({
        primarySignal: s.label,
        audiences: analytics.audiences.map((x) => ({
          audienceId: x.audienceId, name: x.name, icpFit: x.icpFit, ratePercent: pctNum(x.rate), events: x.events, reach: x.reach,
          ctrPercent: pctNum(x.ctr), experiments: x.experiments,
          vsOthers: x.vsOthers ? { deltaPp: x.vsOthers.deltaPp, status: x.vsOthers.status } : null, metricId: x.metricId,
        })),
      }),
    },
    getChannelPerformance: {
      description: "Channel results per audience on the primary signal: rate, reach, expected events per experiment, the efficiency leader (highest rate), the volume leader (most events), the current control, and whether the leaders' gap is settled. Also overall channel results and trends.",
      parameters: audienceParam,
      run: ({ audienceId } = {}) => ({
        primarySignal: s.label,
        byAudience: forAudiences(audienceId).map((id) => {
          const b = analytics.byAudience[id];
          return {
            audienceId: id,
            channels: b.channels.map((c) => ({
              channel: c.channel, ratePercent: pctNum(c.rate), events: c.events, reach: c.reach, expectedPerExperiment: c.expectedPerExperiment,
              ctrPercent: pctNum(c.ctr), currentControl: controlLabel(id, c.channel), metricId: c.metricId,
            })),
            efficiencyLeader: b.channelLeaders.efficiency?.channel ?? null,
            volumeLeader: b.channelLeaders.volume?.channel ?? null,
            leaderGap: b.channelLeaders.comparison ? { deltaPp: b.channelLeaders.comparison.deltaPp, status: b.channelLeaders.comparison.status } : null,
          };
        }),
        overall: analytics.channels.map((c) => ({ channel: c.channel, ratePercent: pctNum(c.rate), expectedPerExperiment: c.expectedPerExperiment, trend: c.trend.status, metricId: c.metricId })),
      }),
    },
    getMessagingPerformance: {
      description: "Message hypothesis (messaging angle) results per audience on the primary signal: tested angles ranked, untested angles, and whether the top two are settled.",
      parameters: audienceParam,
      run: ({ audienceId } = {}) => ({
        byAudience: forAudiences(audienceId).map((id) => slimDimension(id, analytics.byAudience[id].angles, (x) => angleLabel(profile, x))),
        overall: analytics.angles.tested.map(slimRow),
      }),
    },
    getContentPerformance: {
      description: "Content-type results per audience on the primary signal: tested formats ranked, untested formats, and whether the top two are settled.",
      parameters: audienceParam,
      run: ({ audienceId } = {}) => ({
        byAudience: forAudiences(audienceId).map((id) => slimDimension(id, analytics.byAudience[id].contentTypes, (x) => contentTypeLabel(profile, x))),
        overall: analytics.contentTypes.tested.map(slimRow),
      }),
    },
  };
  return toolbox(tools);
}

export function contentToolbox({ profile, analytics, experiments, recommendation }) {
  const audienceIds = profile.personas.map((p) => p.id);
  const audienceParam = optionalAudienceParam(audienceIds);
  const audienceOf = (args) => args?.audienceId || recommendation.priorityAudience;
  const P = analytics.objective.primaryMetric;
  const variantsFor = (audienceId) => experiments.flatMap((e) => e.cells
    .filter((c) => c.audienceId === audienceId)
    .map((c) => ({ ...c, experimentNumber: e.experimentNumber })));

  const tools = {
    getAudienceProfile: {
      description: "Who the audience is: buying role, job to be done, pain points, and the messaging angle definitions.",
      parameters: audienceParam,
      run: (args) => {
        const p = getAudience(profile, audienceOf(args));
        return { audienceId: p.id, name: p.short_name, role: p.name, summary: p.profile_summary, buyingRole: p.buying_role ?? null, jobToBeDone: p.jtbd ?? null,
          painPoints: p.pain_points, messagingAngles: profile.messaging_angles };
      },
    },
    getPreviousContent: {
      description: "Topics and headlines already used for the audience, so new content does not repeat them.",
      parameters: audienceParam,
      run: (args) => ({
        items: dedupeVariants(variantsFor(audienceOf(args))).map((v) => ({ experimentNumber: v.experimentNumber, channel: v.channel,
          messagingAngle: v.messagingAngle, contentType: v.contentType, topic: v.topic, headline: v.headline })),
      }),
    },
    getMessagingHistory: {
      description: "Which messaging angles have been tested with the audience and how they performed on the objective's primary signal.",
      parameters: audienceParam,
      run: (args) => slimDimension(audienceOf(args), analytics.byAudience[audienceOf(args)].angles, (x) => angleLabel(profile, x)),
    },
    getTopPerformingContent: {
      description: "The audience's best-performing content variants on the objective's primary signal, with their topics and headlines.",
      parameters: audienceParam,
      run: (args) => {
        const byVariant = new Map();
        for (const v of variantsFor(audienceOf(args))) {
          const agg = byVariant.get(v.contentVariantId) ?? { ...v, reach: 0, events: 0 };
          agg.reach += v.reach;
          agg.events += v[P] ?? 0;
          byVariant.set(v.contentVariantId, agg);
        }
        return {
          primarySignal: analytics.signal.label,
          top: [...byVariant.values()]
            .map((v) => ({ channel: v.channel, messagingAngle: v.messagingAngle, contentType: v.contentType, topic: v.topic,
              headline: v.headline, reach: v.reach, events: v.events, ratePercent: v.reach ? pctNum(v.events / v.reach) : 0 }))
            .sort((a, b) => b.ratePercent - a.ratePercent)
            .slice(0, 3),
        };
      },
    },
    getBrandContext: {
      description: "Company positioning, value proposition, product proof, competitive alternative, brand voice and proof rules.",
      parameters: noParams(),
      run: () => {
        const s = profile.strategy ?? {};
        return { company: profile.name, context: profile.context, ...profile.brand_context,
          valueProposition: s.value_proposition ?? null, proofPoints: s.proof_points ?? [], competitiveAlternative: s.competitive_alternative ?? null };
      },
    },
    getContentConstraints: {
      description: "Format and length constraints for a channel.",
      parameters: {
        type: "object",
        properties: { channel: { type: "string", enum: Object.keys(CHANNEL_LABELS) } },
        required: [],
        additionalProperties: false,
      },
      run: ({ channel } = {}) => {
        const ch = channel || recommendation.recommendedChannel;
        return { channel: ch, ...profile.content_constraints[ch], general: profile.content_constraints.general };
      },
    },
  };
  return toolbox(tools);
}

// Wraps tool specs into OpenAI-style definitions plus a runner that records what was called, which metric ids and
// strategy context ids the agent has seen (used to validate its evidence), and what each context id says.
function toolbox(tools) {
  const calls = [];
  const seenMetricIds = new Set();
  const seenContextIds = new Set();
  const contexts = new Map();
  return {
    definitions: Object.entries(tools).map(([name, t]) => ({
      type: "function",
      function: { name, description: t.description, parameters: t.parameters },
    })),
    calls,
    seenMetricIds,
    seenContextIds,
    contexts,
    run(name, rawArgs) {
      const tool = tools[name];
      if (!tool) return { error: `Unknown tool ${name}` };
      let args = {};
      try {
        args = typeof rawArgs === "string" && rawArgs.trim() ? JSON.parse(rawArgs) : rawArgs ?? {};
      } catch {
        return { error: "Arguments were not valid JSON" };
      }
      const result = tool.run(args);
      calls.push({ name, args, result });
      collectRefs(result, { seenMetricIds, seenContextIds, contexts });
      return result;
    },
  };
}

function collectRefs(value, refs) {
  if (Array.isArray(value)) value.forEach((v) => collectRefs(v, refs));
  else if (value && typeof value === "object") {
    if (typeof value.contextId === "string") {
      refs.seenContextIds.add(value.contextId);
      refs.contexts.set(value.contextId, { label: value.label, text: value.text });
    }
    for (const [k, v] of Object.entries(value)) {
      if (k === "metricId" && typeof v === "string") refs.seenMetricIds.add(v);
      else if (v && typeof v === "object") collectRefs(v, refs);
    }
  }
}

function slimRow(r) {
  return { label: r.label, ratePercent: pctNum(r.rate), events: r.events, reach: r.reach, metricId: r.metricId };
}

function slimDimension(audienceId, d, labelFor) {
  return {
    audienceId,
    tested: d.tested.map(slimRow),
    untested: d.untested.map(labelFor),
    topTwo: d.comparison ? { deltaPp: d.comparison.deltaPp, status: d.comparison.status } : null,
  };
}

function dedupeVariants(variants) {
  const seen = new Set();
  return variants.filter((v) => (seen.has(v.contentVariantId) ? false : seen.add(v.contentVariantId)));
}

// A rate as a percentage (0.0973 -> 9.7; 0.0042 -> 0.42), so agents quote rates the way marketers read them.
function pctNum(rate) {
  return rate < 0.01 ? Math.round(rate * 10000) / 100 : Math.round(rate * 1000) / 10;
}

function noParams() {
  return { type: "object", properties: {}, required: [], additionalProperties: false };
}

function optionalAudienceParam(audienceIds) {
  return {
    type: "object",
    properties: { audienceId: { type: "string", enum: audienceIds, description: "Limit results to one audience." } },
    required: [],
    additionalProperties: false,
  };
}
