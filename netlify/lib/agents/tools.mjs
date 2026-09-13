// Read-only tools for the two agents. Every tool returns data computed by the analytics engine or
// stored in the company profile; nothing here lets an agent change metrics or history.

import { CHANNEL_LABELS, getAudience } from "../company.mjs";

export function marketingToolbox({ profile, analytics, experiments, controlFor }) {
  const audienceIds = profile.personas.map((p) => p.id);
  const audienceParam = optionalAudienceParam(audienceIds);
  const forAudiences = (audienceId) => (audienceId ? [audienceId] : audienceIds);

  const tools = {
    getCampaignObjective: {
      description: "The current campaign objective and how it should weigh efficiency (CTR) against volume (clicks).",
      parameters: noParams(),
      run: () => analytics.objective,
    },
    getAvailableChannels: {
      description: "The channels each audience can be reached on.",
      parameters: noParams(),
      run: () => ({ audiences: profile.personas.map((p) => ({ audienceId: p.id, name: p.short_name, channels: p.channels })) }),
    },
    getAvailableMessagingAngles: {
      description: "All messaging angles and content types that can be tested.",
      parameters: noParams(),
      run: () => ({
        angles: profile.messaging_angles.map(({ id, label }) => ({ id, label })),
        contentTypes: profile.content_types.map(({ id, label }) => ({ id, label })),
      }),
    },
    getAudiencePerformance: {
      description: "Pooled CTR, reach and clicks for each audience, and how each compares with the other audiences.",
      parameters: noParams(),
      run: () => ({ audiences: analytics.audiences.map(({ audienceId, name, reach, clicks, ctr, experiments: n, vsOthers, metricId }) =>
        ({ audienceId, name, reach, clicks, ctrPercent: pct1(ctr), experiments: n, vsOthers, metricId })) }),
    },
    getChannelPerformance: {
      description: "Channel results per audience: CTR, reach and expected clicks per experiment, the efficiency leader (highest CTR), the volume leader (most clicks), and whether the gap is too close to call. Also overall channel results and trends.",
      parameters: audienceParam,
      run: ({ audienceId } = {}) => ({
        byAudience: forAudiences(audienceId).map((id) => {
          const b = analytics.byAudience[id];
          return {
            audienceId: id,
            channels: b.channels.map((c) => {
              const control = controlFor?.(id, c.channel);
              return { ...slimChannel(c), currentControl: control ? `${control.messagingAngle} + ${control.contentType}` : null };
            }),
            efficiencyLeader: b.channelLeaders.efficiency?.channel ?? null,
            volumeLeader: b.channelLeaders.volume?.channel ?? null,
            leaderComparison: b.channelLeaders.comparison
              ? { deltaPp: b.channelLeaders.comparison.deltaPp, tooCloseToCall: b.channelLeaders.comparison.tooCloseToCall, reason: b.channelLeaders.comparison.reason }
              : null,
          };
        }),
        overall: analytics.channels.map((c) => ({ channel: c.channel, ctrPercent: pct1(c.ctr), expectedClicksPerExperiment: c.expectedClicksPerExperiment, trend: c.trend.status, metricId: c.metricId })),
      }),
    },
    getMessagingPerformance: {
      description: "Messaging-angle results per audience: tested angles ranked by CTR, untested angles, and whether the top two are too close to call.",
      parameters: audienceParam,
      run: ({ audienceId } = {}) => ({
        byAudience: forAudiences(audienceId).map((id) => slimDimension(id, analytics.byAudience[id].angles)),
        overall: analytics.angles.tested.map(slimRow),
      }),
    },
    getContentPerformance: {
      description: "Content-type results per audience: tested content types ranked by CTR, untested types, and whether the top two are too close to call.",
      parameters: audienceParam,
      run: ({ audienceId } = {}) => ({
        byAudience: forAudiences(audienceId).map((id) => slimDimension(id, analytics.byAudience[id].contentTypes)),
        overall: analytics.contentTypes.tested.map(slimRow),
      }),
    },
    getExperimentHistory: {
      description: "The last three experiments: what was tested, results per cell, test-vs-control outcome, and the hypothesis behind each.",
      parameters: noParams(),
      run: () => ({
        experiments: experiments.slice(-3).map((e) => ({
          experimentNumber: e.experimentNumber,
          kind: e.kind,
          hypothesis: e.marketingAgentRecommendation?.hypothesis ?? null,
          cells: e.cells.map((c) => ({ role: c.role, audienceId: c.audienceId, channel: c.channel, messagingAngle: c.messagingAngle,
            contentType: c.contentType, reach: c.reach, clicks: c.clicks, ctrPercent: pct1(c.ctr) })),
        })),
        latestTestVsControl: analytics.latest?.testVsControl ?? null,
      }),
    },
  };
  return toolbox(tools);
}

export function contentToolbox({ profile, analytics, experiments, recommendation }) {
  const audienceIds = profile.personas.map((p) => p.id);
  const audienceParam = optionalAudienceParam(audienceIds);
  const audienceOf = (args) => args?.audienceId || recommendation.priorityAudience;
  const variantsFor = (audienceId) => experiments.flatMap((e) => e.cells
    .filter((c) => c.audienceId === audienceId)
    .map((c) => ({ ...c, experimentNumber: e.experimentNumber })));

  const tools = {
    getAudienceProfile: {
      description: "Who the audience is, their pain points, and the messaging angle definitions.",
      parameters: audienceParam,
      run: (args) => {
        const p = getAudience(profile, audienceOf(args));
        return { audienceId: p.id, name: p.short_name, role: p.name, summary: p.profile_summary, painPoints: p.pain_points, messagingAngles: profile.messaging_angles };
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
      description: "Which messaging angles have been tested with the audience and how they performed.",
      parameters: audienceParam,
      run: (args) => slimDimension(audienceOf(args), analytics.byAudience[audienceOf(args)].angles),
    },
    getTopPerformingContent: {
      description: "The audience's best-performing content variants by CTR, with their topics and headlines.",
      parameters: audienceParam,
      run: (args) => {
        const byVariant = new Map();
        for (const v of variantsFor(audienceOf(args))) {
          const agg = byVariant.get(v.contentVariantId) ?? { ...v, reach: 0, clicks: 0 };
          agg.reach += v.reach;
          agg.clicks += v.clicks;
          byVariant.set(v.contentVariantId, agg);
        }
        return {
          top: [...byVariant.values()]
            .map((v) => ({ channel: v.channel, messagingAngle: v.messagingAngle, contentType: v.contentType, topic: v.topic,
              headline: v.headline, reach: v.reach, clicks: v.clicks, ctrPercent: v.reach ? pct1(v.clicks / v.reach) : 0 }))
            .sort((a, b) => b.ctrPercent - a.ctrPercent)
            .slice(0, 3),
        };
      },
    },
    getBrandContext: {
      description: "Company positioning, brand voice and proof rules.",
      parameters: noParams(),
      run: () => ({ company: profile.name, context: profile.context, ...profile.brand_context }),
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

// Wraps tool specs into OpenAI-style definitions plus a runner that records what was called
// and which metric ids the agent has seen (used to validate its evidence).
function toolbox(tools) {
  const calls = [];
  const seenMetricIds = new Set();
  return {
    definitions: Object.entries(tools).map(([name, t]) => ({
      type: "function",
      function: { name, description: t.description, parameters: t.parameters },
    })),
    calls,
    seenMetricIds,
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
      collectMetricIds(result, seenMetricIds);
      return result;
    },
  };
}

function collectMetricIds(value, set) {
  if (Array.isArray(value)) value.forEach((v) => collectMetricIds(v, set));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "metricId" && typeof v === "string") set.add(v);
      else collectMetricIds(v, set);
    }
  }
}

function slimChannel(c) {
  return { channel: c.channel, ctrPercent: pct1(c.ctr), clicks: c.clicks, reach: c.reach, expectedClicksPerExperiment: c.expectedClicksPerExperiment, metricId: c.metricId };
}

function slimRow(r) {
  return { id: r.id, ctrPercent: pct1(r.ctr), clicks: r.clicks, reach: r.reach, metricId: r.metricId };
}

function slimDimension(audienceId, d) {
  return {
    audienceId,
    tested: d.tested.map(slimRow),
    untested: d.untested,
    topTwo: d.comparison ? { deltaPp: d.comparison.deltaPp, tooCloseToCall: d.comparison.tooCloseToCall, reason: d.comparison.reason } : null,
  };
}

function dedupeVariants(variants) {
  const seen = new Set();
  return variants.filter((v) => (seen.has(v.contentVariantId) ? false : seen.add(v.contentVariantId)));
}

// CTR as a percentage with one decimal (0.0973 -> 9.7), so agents quote rates the way marketers read them.
function pct1(ctr) {
  return Math.round(ctr * 1000) / 10;
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
