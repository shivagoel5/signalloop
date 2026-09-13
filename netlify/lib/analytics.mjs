// Deterministic analytics engine. Normal code calculates what happened; the agents only read
// these results through tools and must cite the metric ids defined here.

import { CHANNEL_LABELS, OBJECTIVES, angleLabel, contentTypeLabel } from "./company.mjs";

// Differences are only "called" with enough clicks on both sides and |z| >= 1.96 (about 95%).
export const MIN_CLICKS = 20;
export const Z_CRITICAL = 1.96;
const MIN_REACH_FOR_LEADER = 100;

export function twoProportionZ(a, b) {
  if (!a.reach || !b.reach) return 0;
  const pooled = (a.clicks + b.clicks) / (a.reach + b.reach);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.reach + 1 / b.reach));
  return se ? (a.clicks / a.reach - b.clicks / b.reach) / se : 0;
}

export function compareRates(a, b) {
  const z = twoProportionZ(a, b);
  const enoughData = a.clicks >= MIN_CLICKS && b.clicks >= MIN_CLICKS;
  const significant = enoughData && Math.abs(z) >= Z_CRITICAL;
  return {
    deltaPp: round2((rate(a) - rate(b)) * 100),
    z: round2(z),
    significant,
    tooCloseToCall: !significant,
    reason: significant ? "significant" : enoughData ? "difference within noise" : "not enough clicks yet",
  };
}

export function computeAnalytics({ profile, experiments, objectiveId }) {
  const rows = experiments.flatMap((e) => e.cells.map((c) => ({ ...c, experimentNumber: e.experimentNumber })));
  const metrics = {};
  const addMetric = (id, label, list, extra = {}) => {
    metrics[id] = { id, label, ...pool(list), ...extra };
    return metrics[id];
  };
  const name = (audienceId) => profile.personas.find((p) => p.id === audienceId)?.short_name ?? audienceId;

  // --- Audience performance ---
  const audiences = profile.personas.map((p) => {
    const list = rows.filter((r) => r.audienceId === p.id);
    const others = rows.filter((r) => r.audienceId !== p.id);
    const m = addMetric(`audience:${p.id}`, `${p.short_name}: all experiments`, list);
    const vsOthers = list.length && others.length ? compareRates(pool(list), pool(others)) : null;
    return { audienceId: p.id, name: p.short_name, ...pick(m), metricId: m.id, vsOthers };
  });

  // --- Per audience: channels, messaging angles, content types ---
  const byAudience = {};
  for (const p of profile.personas) {
    const list = rows.filter((r) => r.audienceId === p.id);

    const channels = p.channels.map((ch) => {
      const cells = list.filter((r) => r.channel === ch);
      const m = addMetric(`audience_channel:${p.id}:${ch}`, `${p.short_name} on ${CHANNEL_LABELS[ch]}`, cells, {
        reachPerExperiment: reachPerExperiment(cells),
      });
      m.expectedClicksPerExperiment = Math.round(m.reachPerExperiment * m.ctr);
      return { channel: ch, label: CHANNEL_LABELS[ch], tested: cells.length > 0, ...pick(m),
        reachPerExperiment: m.reachPerExperiment, expectedClicksPerExperiment: m.expectedClicksPerExperiment, metricId: m.id };
    });

    const angles = dimension(list, "messagingAngle", profile.messaging_angles.map((a) => a.id), (id, cells) =>
      addMetric(`audience_angle:${p.id}:${id}`, `${p.short_name}, ${angleLabel(profile, id)} messaging`, cells));
    const contentTypes = dimension(list, "contentType", profile.content_types.map((t) => t.id), (id, cells) =>
      addMetric(`audience_contentType:${p.id}:${id}`, `${p.short_name}, ${contentTypeLabel(profile, id)}`, cells));

    byAudience[p.id] = {
      channels,
      channelLeaders: leaders(channels),
      angles,
      contentTypes,
    };
  }

  // --- Overall channel, angle and content type performance ---
  const allChannels = [...new Set(profile.personas.flatMap((p) => p.channels))];
  const channels = allChannels.map((ch) => {
    const cells = rows.filter((r) => r.channel === ch);
    const m = addMetric(`channel:${ch}`, `${CHANNEL_LABELS[ch]}: all audiences`, cells, { reachPerExperiment: reachPerExperiment(cells) });
    m.expectedClicksPerExperiment = Math.round(m.reachPerExperiment * m.ctr);
    return { channel: ch, label: CHANNEL_LABELS[ch], tested: cells.length > 0, ...pick(m),
      reachPerExperiment: m.reachPerExperiment, expectedClicksPerExperiment: m.expectedClicksPerExperiment,
      trend: trend(experiments, ch), metricId: m.id };
  });
  const channelLeaders = leaders(channels);
  const angles = dimension(rows, "messagingAngle", profile.messaging_angles.map((a) => a.id), (id, cells) =>
    addMetric(`angle:${id}`, `${angleLabel(profile, id)} messaging: all audiences`, cells));
  const contentTypes = dimension(rows, "contentType", profile.content_types.map((t) => t.id), (id, cells) =>
    addMetric(`contentType:${id}`, `${contentTypeLabel(profile, id)}: all audiences`, cells));

  // --- Latest experiment ---
  const lastExp = experiments.at(-1);
  let latest = null;
  if (lastExp) {
    const cells = lastExp.cells.map((c) => {
      const m = addMetric(`cell:${lastExp.experimentNumber}:${c.cellId}`,
        `Experiment ${lastExp.experimentNumber} ${c.role}: ${name(c.audienceId)} on ${CHANNEL_LABELS[c.channel]}, ${angleLabel(profile, c.messagingAngle)}`, [c]);
      const previous = rows
        .filter((r) => r.experimentNumber < lastExp.experimentNumber && r.audienceId === c.audienceId && r.channel === c.channel);
      const prevExpNumber = previous.length ? Math.max(...previous.map((r) => r.experimentNumber)) : null;
      const prev = prevExpNumber === null ? null : pool(previous.filter((r) => r.experimentNumber === prevExpNumber));
      return { ...c, metricId: m.id, changeVsPreviousPp: prev ? round2((c.ctr - prev.ctr) * 100) : null };
    });
    const test = cells.find((c) => c.role === "test");
    const control = cells.find((c) => c.role === "control");
    let testVsControl = null;
    if (test && control) {
      const cmp = compareRates(test, control);
      const m = addMetric(`experiment:${lastExp.experimentNumber}:test_vs_control`,
        `Experiment ${lastExp.experimentNumber}: test vs control`, [test], { deltaPp: cmp.deltaPp });
      testVsControl = { ...cmp, winner: cmp.significant ? (cmp.deltaPp > 0 ? "test" : "control") : "too close to call", metricId: m.id };
    }
    latest = { experimentNumber: lastExp.experimentNumber, kind: lastExp.kind, cells, testVsControl };
  }

  const analytics = {
    objective: { id: objectiveId, ...OBJECTIVES[objectiveId] },
    totals: { experiments: experiments.length, ...pick(pool(rows)) },
    audiences,
    byAudience,
    channels,
    channelLeaders,
    angles,
    contentTypes,
    latest,
    metrics,
  };
  analytics.insights = buildInsights(profile, analytics);
  return analytics;
}

// --- Insights: plain-language statements derived only from the computed metrics ---
function buildInsights(profile, a) {
  const audience = [];
  const channel = [];
  const pct = (x) => `${(x * 100).toFixed(1)}%`;

  const ranked = a.audiences.filter((x) => x.reach > 0).sort((x, y) => y.ctr - x.ctr);
  const top = ranked[0];
  if (top?.vsOthers?.significant && top.vsOthers.deltaPp > 0) {
    audience.push({ text: `${top.name} are the strongest-responding audience (+${top.vsOthers.deltaPp}pp CTR vs other audiences).`, metricIds: [top.metricId] });
  }

  for (const p of profile.personas) {
    const b = a.byAudience[p.id];
    const tested = b.angles.tested;
    if (tested.length >= 2) {
      const [l, r] = tested;
      const cmp = compareRates(l, r);
      audience.push(cmp.significant
        ? { text: `${p.short_name} respond most strongly to ${l.label.toLowerCase()} messaging (${pct(l.ctr)} CTR vs ${pct(r.ctr)} for ${r.label.toLowerCase()}).`, metricIds: [l.metricId, r.metricId] }
        : { text: `${p.short_name}: ${l.label.toLowerCase()} leads ${r.label.toLowerCase()} (${pct(l.ctr)} vs ${pct(r.ctr)}), but the gap is too small to call.`, metricIds: [l.metricId, r.metricId] });
    } else if (tested.length === 1) {
      audience.push({ text: `${p.short_name}: only ${tested[0].label.toLowerCase()} messaging has been tested; ${b.angles.untested.length} angles are untested.`, metricIds: [tested[0].metricId] });
    }

    const types = b.contentTypes.tested;
    if (types.length >= 2) {
      const [l, r] = types;
      const cmp = compareRates(l, r);
      if (cmp.significant) {
        audience.push({ text: `${p.short_name} respond better to ${l.label.toLowerCase()} content than ${r.label.toLowerCase()} (${pct(l.ctr)} vs ${pct(r.ctr)}).`, metricIds: [l.metricId, r.metricId] });
      }
    }

    const { efficiency, volume, comparison } = b.channelLeaders;
    if (efficiency && volume) {
      if (efficiency.channel !== volume.channel) {
        channel.push({ text: `${p.short_name}: ${efficiency.label} has the highest CTR (${pct(efficiency.ctr)}), but ${volume.label} delivers more clicks per experiment (${volume.expectedClicksPerExperiment} vs ${efficiency.expectedClicksPerExperiment}).`, metricIds: [efficiency.metricId, volume.metricId] });
      } else if (comparison?.tooCloseToCall) {
        audience.push({ text: `${p.short_name} respond consistently across channels (${comparison.labels}), so more testing is needed before shifting focus.`, metricIds: comparison.metricIds });
      } else {
        channel.push({ text: `${p.short_name}: ${efficiency.label} leads on both CTR and click volume.`, metricIds: [efficiency.metricId] });
      }
    }
  }

  const { efficiency, volume } = a.channelLeaders;
  if (efficiency && volume && efficiency.channel !== volume.channel) {
    channel.push({ text: `${volume.label} has the highest reach and click volume but lower response efficiency than ${efficiency.label} (${pct(volume.ctr)} vs ${pct(efficiency.ctr)} CTR).`, metricIds: [volume.metricId, efficiency.metricId] });
  }
  for (const ch of a.channels) {
    if (ch.trend.status === "flat") {
      channel.push({ text: `${ch.label} CTR has not improved across the last ${ch.trend.points.length} experiments (${pct(ch.trend.points[0])} to ${pct(ch.trend.points.at(-1))}).`, metricIds: [ch.metricId] });
    } else if (ch.trend.status === "improving") {
      channel.push({ text: `${ch.label} CTR has improved across the last ${ch.trend.points.length} experiments (${pct(ch.trend.points[0])} to ${pct(ch.trend.points.at(-1))}).`, metricIds: [ch.metricId] });
    }
  }
  // Same channel, different audiences.
  const channelsUsed = [...new Set(profile.personas.flatMap((p) => p.channels))];
  for (const ch of channelsUsed) {
    const perAudience = profile.personas
      .map((p) => ({ p, m: a.byAudience[p.id].channels.find((c) => c.channel === ch) }))
      .filter((x) => x.m && x.m.reach > 0)
      .sort((x, y) => y.m.ctr - x.m.ctr);
    if (perAudience.length >= 2) {
      const best = perAudience[0];
      const worst = perAudience.at(-1);
      if (compareRates(best.m, worst.m).significant) {
        channel.push({ text: `${CHANNEL_LABELS[ch]} performs better for ${best.p.short_name} than for ${worst.p.short_name} (${pct(best.m.ctr)} vs ${pct(worst.m.ctr)}).`, metricIds: [best.m.metricId, worst.m.metricId] });
      }
    }
  }

  return { audience: audience.slice(0, 6), channel: channel.slice(0, 6) };
}

// --- helpers ---
function pool(list) {
  const reach = list.reduce((s, r) => s + r.reach, 0);
  const clicks = list.reduce((s, r) => s + r.clicks, 0);
  return { reach, clicks, ctr: reach ? round4(clicks / reach) : 0, experiments: new Set(list.map((r) => r.experimentNumber)).size };
}

function pick(m) {
  return { reach: m.reach, clicks: m.clicks, ctr: m.ctr, experiments: m.experiments };
}

function rate(x) {
  return x.reach ? x.clicks / x.reach : 0;
}

// Average reach per experiment at full allocation: test and control cells in the same
// experiment are summed, since each gets half the audience.
function reachPerExperiment(cells) {
  const byExp = new Map();
  for (const c of cells) byExp.set(c.experimentNumber, (byExp.get(c.experimentNumber) ?? 0) + c.reach);
  return byExp.size ? Math.round([...byExp.values()].reduce((s, v) => s + v, 0) / byExp.size) : 0;
}

function dimension(list, field, allIds, makeMetric) {
  const tested = [];
  for (const id of allIds) {
    const cells = list.filter((r) => r[field] === id);
    if (!cells.length) continue;
    const m = makeMetric(id, cells);
    tested.push({ id, label: m.label.split(", ").at(-1).replace(/ messaging.*$/, "").replace(/: all audiences$/, ""), ...pick(m), metricId: m.id });
  }
  tested.sort((x, y) => y.ctr - x.ctr);
  const untested = allIds.filter((id) => !tested.some((t) => t.id === id));
  const comparison = tested.length >= 2 ? compareRates(tested[0], tested[1]) : null;
  return { tested, untested, leader: tested[0]?.id ?? null, comparison };
}

function leaders(channels) {
  const eligible = channels.filter((c) => c.tested && c.reach >= MIN_REACH_FOR_LEADER);
  if (!eligible.length) return { efficiency: null, volume: null, comparison: null };
  const byCtr = [...eligible].sort((x, y) => y.ctr - x.ctr);
  const byVolume = [...eligible].sort((x, y) => y.expectedClicksPerExperiment - x.expectedClicksPerExperiment);
  let comparison = null;
  if (byCtr.length >= 2) {
    const [first, last] = [byCtr[0], byCtr.at(-1)];
    comparison = {
      ...compareRates(first, last),
      labels: `${first.label} ${(first.ctr * 100).toFixed(1)}% vs ${last.label} ${(last.ctr * 100).toFixed(1)}%`,
      metricIds: [first.metricId, last.metricId],
    };
  }
  return { efficiency: byCtr[0], volume: byVolume[0], comparison };
}

// CTR trend for a channel over the last three experiments that used it.
function trend(experiments, channel) {
  const points = experiments
    .map((e) => pool(e.cells.filter((c) => c.channel === channel)))
    .filter((p) => p.reach > 0)
    .slice(-3)
    .map((p) => p.ctr);
  if (points.length < 3) return { status: "insufficient", points };
  const change = (points.at(-1) - points[0]) * 100;
  const status = Math.abs(change) < 0.5 ? "flat" : change > 0 ? "improving" : "declining";
  return { status, points };
}

const round2 = (x) => Math.round(x * 100) / 100;
const round4 = (x) => Math.round(x * 10000) / 10000;
