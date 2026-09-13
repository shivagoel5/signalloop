// Deterministic analytics engine. Code measures what happened; the agents only read these results through tools
// and must cite the metric ids defined here. Every signal counts people out of those reached, so all rates share
// one denominator, and each campaign objective is judged on its own primary signal (OBJECTIVES in company.mjs).

import { CHANNEL_LABELS, METRICS, angleLabel, contentTypeLabel, objectiveView } from "./company.mjs";

// Prototype evidence guardrail: the fewest events each variant needs before a difference is judged at all. It is a
// fixed floor per signal, not a power calculation. A production system would size each test in advance from the
// baseline rate, the minimum detectable effect, the significance level and the statistical power.
export const MIN_EVENTS = { qualifiedViews: 30, engagements: 30, clicks: 20, highIntent: 15, conversions: 10 };
export const Z_CRITICAL = 1.96; // two-sided, about 95%
export const SIGNALS = Object.keys(METRICS);
const MIN_REACH_FOR_LEADER = 200;

export function twoProportionZ(a, b) {
  if (!a.reach || !b.reach) return 0;
  const pooled = (a.events + b.events) / (a.reach + b.reach);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.reach + 1 / b.reach));
  return se ? (a.events / a.reach - b.events / b.reach) / se : 0;
}

// Compares two groups on one signal, keeping three things apart: the observed difference, whether the evidence
// guardrail is met, and whether the difference is statistically significant.
export function compareRates(a, b, metric = "clicks") {
  const x = { events: a[metric] ?? a.events ?? 0, reach: a.reach ?? 0 };
  const y = { events: b[metric] ?? b.events ?? 0, reach: b.reach ?? 0 };
  const minEvents = MIN_EVENTS[metric];
  const enoughEvidence = x.events >= minEvents && y.events >= minEvents;
  const z = twoProportionZ(x, y);
  const significant = enoughEvidence && Math.abs(z) >= Z_CRITICAL;
  return {
    metric,
    deltaPp: round2((ratio(x) - ratio(y)) * 100),
    z: round2(z),
    minEvents,
    eventsA: x.events,
    eventsB: y.events,
    enoughEvidence,
    significant,
    status: !enoughEvidence ? "not_enough_evidence" : significant ? "significant" : "no_clear_difference",
  };
}

export function computeAnalytics({ profile, experiments, objectiveId }) {
  const objective = objectiveView(objectiveId);
  const P = objective.primaryMetric;
  const signal = { id: P, ...METRICS[P], minEvents: MIN_EVENTS[P] };
  const rows = experiments.flatMap((e) => e.cells.map((c) => ({ ...c, experimentNumber: e.experimentNumber })));
  const metrics = {};
  const addMetric = (id, label, list, extra = {}) => (metrics[id] = { id, label, ...pool(list, P), ...extra });
  const name = (audienceId) => profile.personas.find((p) => p.id === audienceId)?.short_name ?? audienceId;

  const channelRow = (id, label, cells, channel) => {
    const m = addMetric(id, label, cells, { reachPerExperiment: reachPerExperiment(cells) });
    m.expectedPerExperiment = Math.round(m.reachPerExperiment * m.rate);
    return { channel, label: CHANNEL_LABELS[channel], tested: cells.length > 0, ...slim(m),
      reachPerExperiment: m.reachPerExperiment, expectedPerExperiment: m.expectedPerExperiment, metricId: m.id };
  };

  // --- Audience performance on the objective's primary signal ---
  const audiences = profile.personas.map((p) => {
    const list = rows.filter((r) => r.audienceId === p.id);
    const others = rows.filter((r) => r.audienceId !== p.id);
    const m = addMetric(`audience:${p.id}`, `${p.short_name}: all experiments`, list);
    return { audienceId: p.id, name: p.short_name, icpFit: p.icp_fit ?? null, ...slim(m), metricId: m.id,
      vsOthers: list.length && others.length ? compareRates(pool(list, P), pool(others, P), P) : null };
  });

  // --- Per audience: channels, messaging angles, content types ---
  const byAudience = {};
  for (const p of profile.personas) {
    const list = rows.filter((r) => r.audienceId === p.id);
    const channels = p.channels.map((ch) => channelRow(`audience_channel:${p.id}:${ch}`, `${p.short_name} on ${CHANNEL_LABELS[ch]}`, list.filter((r) => r.channel === ch), ch));
    byAudience[p.id] = {
      channels,
      channelLeaders: leaders(channels, P),
      angles: dimension(list, "messagingAngle", profile.messaging_angles.map((a) => a.id), P, (id, cells) =>
        addMetric(`audience_angle:${p.id}:${id}`, `${p.short_name}, ${angleLabel(profile, id)} messaging`, cells, { name: angleLabel(profile, id) })),
      contentTypes: dimension(list, "contentType", profile.content_types.map((t) => t.id), P, (id, cells) =>
        addMetric(`audience_contentType:${p.id}:${id}`, `${p.short_name}, ${contentTypeLabel(profile, id)}`, cells, { name: contentTypeLabel(profile, id) })),
    };
  }

  // --- Overall channel, angle and content type performance ---
  const allChannels = [...new Set(profile.personas.flatMap((p) => p.channels))];
  const channels = allChannels.map((ch) => ({ ...channelRow(`channel:${ch}`, `${CHANNEL_LABELS[ch]}: all audiences`, rows.filter((r) => r.channel === ch), ch), trend: trend(experiments, ch, P) }));
  const angles = dimension(rows, "messagingAngle", profile.messaging_angles.map((a) => a.id), P, (id, cells) =>
    addMetric(`angle:${id}`, `${angleLabel(profile, id)} messaging: all audiences`, cells, { name: angleLabel(profile, id) }));
  const contentTypes = dimension(rows, "contentType", profile.content_types.map((t) => t.id), P, (id, cells) =>
    addMetric(`contentType:${id}`, `${contentTypeLabel(profile, id)}: all audiences`, cells, { name: contentTypeLabel(profile, id) }));

  // --- Latest experiment ---
  const lastExp = experiments.at(-1);
  let latest = null;
  if (lastExp) {
    const cells = lastExp.cells.map((c) => {
      const m = addMetric(`cell:${lastExp.experimentNumber}:${c.cellId}`,
        `Experiment ${lastExp.experimentNumber} ${ROLE_NAMES[c.role] ?? c.role}: ${name(c.audienceId)} on ${CHANNEL_LABELS[c.channel]}, ${angleLabel(profile, c.messagingAngle)}`, [c]);
      const previous = rows.filter((r) => r.experimentNumber < lastExp.experimentNumber && r.audienceId === c.audienceId && r.channel === c.channel);
      const prevNumber = previous.length ? Math.max(...previous.map((r) => r.experimentNumber)) : null;
      const prev = prevNumber === null ? null : pool(previous.filter((r) => r.experimentNumber === prevNumber), P);
      return { ...c, rate: m.rate, events: m.events, metricId: m.id, changeVsPreviousPp: prev ? round2((m.rate - prev.rate) * 100) : null };
    });
    const test = cells.find((c) => c.role === "test");
    const control = cells.find((c) => c.role === "control");
    let testVsControl = null;
    if (test && control) {
      const cmp = compareRates(test, control, P);
      const decision = cmp.status === "significant" ? (cmp.deltaPp > 0 ? "adopt_new_variant" : "keep_control")
        : cmp.status === "no_clear_difference" ? "keep_control" : "not_enough_evidence";
      const m = addMetric(`experiment:${lastExp.experimentNumber}:test_vs_control`,
        `Experiment ${lastExp.experimentNumber} result: new variant vs current control on ${signal.noun}`, [test], { deltaPp: cmp.deltaPp, status: cmp.status, decision });
      testVsControl = {
        ...cmp, decision, metricId: m.id, experimentNumber: lastExp.experimentNumber,
        audienceId: test.audienceId, channel: test.channel,
        test: variantDesc(profile, test), control: variantDesc(profile, control),
        summary: verdictSummary(cmp, signal),
      };
    }
    latest = { experimentNumber: lastExp.experimentNumber, kind: lastExp.kind, cells, testVsControl };
  }

  const analytics = {
    objective,
    signal,
    totals: { experiments: experiments.length, ...slim(pool(rows, P)) },
    audiences,
    byAudience,
    channels,
    channelLeaders: leaders(channels, P),
    angles,
    contentTypes,
    latest,
    metrics,
  };
  Object.assign(analytics, buildFindings(profile, experiments, analytics, signal, addMetric));
  return analytics;
}

// --- Findings: what we learned, what is still unknown, and the supporting observations ---
// Plain-language statements derived only from computed metrics. Judgment about what to do next is left to the
// Marketing Agent; these state facts and open questions.
function buildFindings(profile, experiments, a, s, addMetric) {
  const learned = [];
  const gaps = [];
  const observations = [];
  const P = s.id;
  const persona = (id) => profile.personas.find((p) => p.id === id);

  const t = a.latest?.testVsControl;
  if (t) {
    const where = `${persona(t.audienceId).short_name} on ${CHANNEL_LABELS[t.channel]}`;
    const headline = {
      adopt_new_variant: `the new variant won on ${s.noun}`,
      keep_control: t.status === "significant" ? `the current control won on ${s.noun}` : `no clear difference on ${s.noun}, so the control stays`,
      not_enough_evidence: "not enough evidence yet to decide",
    }[t.decision];
    learned.push({ kind: "latest_test", text: `Experiment ${t.experimentNumber} (${where}): ${t.test.label} vs the current control, ${t.control.label}: ${headline}.`, metricIds: [t.metricId] });
    if (t.decision === "not_enough_evidence") {
      gaps.push({ kind: "inconclusive_test", text: `Whether ${t.test.label} beats ${t.control.label} for ${where} is still unknown: the test fell short of the evidence guardrail.`, metricIds: [t.metricId] });
    }
  }

  // A variant re-run as the control for the same audience and channel, losing response each time.
  for (const sat of saturation(experiments, P)) {
    const c = sat.cell;
    const m = addMetric(`saturation:${c.audienceId}:${c.channel}`, `${persona(c.audienceId).short_name} on ${CHANNEL_LABELS[c.channel]}: "${c.headline}" across ${sat.runs} runs`, sat.cells);
    learned.push({ kind: "saturation", text: `${persona(c.audienceId).short_name} on ${CHANNEL_LABELS[c.channel]}: "${c.headline}" (${angleLabel(profile, c.messagingAngle)}) has run ${sat.runs} times and its ${s.noun} fell from ${pct(sat.first)} to ${pct(sat.last)}. The message may be wearing out.`, metricIds: [m.id] });
  }

  // The objective's signal can rank audiences differently from CTR.
  const reached = a.audiences.filter((x) => x.reach > 0);
  const byRate = [...reached].sort((x, y) => y.rate - x.rate);
  const byCtr = [...reached].sort((x, y) => y.ctr - x.ctr);
  if (byRate.length >= 2) {
    const top = byRate[0];
    if (P !== "clicks" && byCtr[0].audienceId !== top.audienceId) {
      learned.push({ kind: "objective_signal", text: `${byCtr[0].name} lead on CTR (${pct(byCtr[0].ctr)}), but ${top.name} lead on ${s.noun}, the signal this objective is judged on (${pct(top.rate)} vs ${pct(byCtr[0].rate)}).`, metricIds: [top.metricId, byCtr[0].metricId] });
    } else if (top.vsOthers?.significant && top.vsOthers.deltaPp > 0) {
      learned.push({ kind: "audience_lead", text: `${top.name} lead on ${s.noun} (${pct(top.rate)}, ${signed(top.vsOthers.deltaPp)}pp vs the other audiences).`, metricIds: [top.metricId] });
    }
  }

  // Channel trade-off for the primary ICP audience (or the best-responding one).
  const focus = a.audiences.find((x) => x.icpFit === "primary" && x.reach > 0) ?? byRate[0];
  if (focus) {
    const { efficiency, volume, comparison } = a.byAudience[focus.audienceId].channelLeaders;
    if (efficiency && volume && efficiency.channel !== volume.channel) {
      learned.push({ kind: "channel_tradeoff", text: `${focus.name}: ${efficiency.label} has the highest ${s.noun} (${pct(efficiency.rate)}), but ${volume.label} would deliver more ${s.event} per experiment (${volume.expectedPerExperiment} vs ${efficiency.expectedPerExperiment}).`, metricIds: [efficiency.metricId, volume.metricId] });
    }
    if (comparison && comparison.status !== "significant") {
      gaps.push({ kind: "channel_unsettled", text: `For ${focus.name}, the ${s.noun} gap between ${comparison.labels} is not settled (${statusPhrase(comparison.status)}).`, metricIds: comparison.metricIds });
    }
  }

  for (const aud of a.audiences) {
    const p = persona(aud.audienceId);
    const angles = a.byAudience[aud.audienceId].angles;
    if (aud.icpFit === "primary" && angles.untested.length) {
      gaps.push({ kind: "untested_messages", text: `${aud.name} (primary ICP): ${angles.untested.length} of ${profile.messaging_angles.length} message hypotheses are untested (${angles.untested.map((id) => angleLabel(profile, id)).join(", ")}).`, metricIds: [aud.metricId] });
    }
    if (aud.reach > 0 && aud.events < s.minEvents) {
      gaps.push({ kind: "thin_evidence", text: `${aud.name}: too few ${s.event} so far to judge a difference (${aud.events} of the ${s.minEvents} needed).`, metricIds: [aud.metricId] });
    }

    const [l, r] = angles.tested;
    if (l && r) {
      observations.push({ kind: "message", text: `${p.short_name}: ${l.label} ${pct(l.rate)} vs ${r.label} ${pct(r.rate)} on ${s.noun} (${statusPhrase(angles.comparison.status)}).`, metricIds: [l.metricId, r.metricId] });
    }
    const { efficiency, volume } = a.byAudience[aud.audienceId].channelLeaders;
    if (efficiency && volume) {
      observations.push({ kind: "channel", text: efficiency.channel === volume.channel
        ? `${p.short_name}: ${efficiency.label} leads on both ${s.noun} (${pct(efficiency.rate)}) and ${s.event} per experiment.`
        : `${p.short_name}: ${efficiency.label} leads on ${s.noun} (${pct(efficiency.rate)}); ${volume.label} on ${s.event} per experiment (${volume.expectedPerExperiment}).`,
      metricIds: [...new Set([efficiency.metricId, volume.metricId])] });
    }
  }
  for (const ch of a.channels) {
    if (ch.trend.status === "declining" || ch.trend.status === "improving") {
      observations.push({ kind: "trend", text: `${ch.label}: ${s.noun} ${ch.trend.status === "declining" ? "declined" : "improved"} across the last ${ch.trend.points.length} experiments (${pct(ch.trend.points[0])} to ${pct(ch.trend.points.at(-1))}).`, metricIds: [ch.metricId] });
    }
  }

  return {
    learnings: learned.slice(0, 3),
    knowledgeGaps: gaps.slice(0, 3),
    observations: [...learned.slice(3), ...gaps.slice(3), ...observations],
  };
}

function verdictSummary(c, s) {
  const gap = `${Math.abs(c.deltaPp)} percentage points`;
  if (c.status === "not_enough_evidence") {
    return `Not enough evidence to decide under the prototype guardrail: each variant needs at least ${c.minEvents} ${s.event}, and the new variant had ${c.eventsA} and the current control ${c.eventsB}. The observed difference (${signed(c.deltaPp)}pp ${s.noun}) is not yet a result.`;
  }
  if (c.status === "no_clear_difference") {
    return `Both variants met the evidence guardrail, but the ${gap} difference in ${s.noun} is not statistically significant, so the current control stays.`;
  }
  return c.deltaPp > 0
    ? `The new variant's ${s.noun} was ${gap} higher than the current control's, with enough evidence and a statistically significant difference (about 95% confidence).`
    : `The current control's ${s.noun} was ${gap} higher than the new variant's, with enough evidence and a statistically significant difference (about 95% confidence), so the control stays.`;
}

// The same variant measured at least three times for an audience and channel, falling each time by at least 10%.
function saturation(experiments, P) {
  const series = new Map();
  for (const e of experiments) {
    for (const c of e.cells) {
      const key = `${c.audienceId}|${c.channel}|${c.contentVariantId}`;
      if (!series.has(key)) series.set(key, []);
      series.get(key).push({ ...c, experimentNumber: e.experimentNumber, rate: c.reach ? c[P] / c.reach : 0 });
    }
  }
  const found = [];
  for (const points of series.values()) {
    if (points.length < 3) continue;
    const [a, b, c] = points.slice(-3);
    if (a.rate > 0 && b.rate <= a.rate && c.rate <= b.rate && c.rate <= a.rate * 0.9) {
      found.push({ cell: c, cells: points, runs: points.length, first: a.rate, last: c.rate });
    }
  }
  return found;
}

// --- helpers ---
const ROLE_NAMES = { test: "new variant", control: "current control", baseline: "baseline" };

function pool(list, P) {
  const reach = list.reduce((s, r) => s + (r.reach ?? 0), 0);
  const out = { reach, experiments: new Set(list.map((r) => r.experimentNumber)).size };
  for (const k of SIGNALS) out[k] = list.reduce((s, r) => s + (r[k] ?? 0), 0);
  out.ctr = reach ? round4(out.clicks / reach) : 0;
  out.rates = Object.fromEntries(SIGNALS.map((k) => [k, reach ? round4(out[k] / reach) : 0]));
  out.events = out[P] ?? 0;
  out.rate = out.rates[P] ?? 0;
  return out;
}

function slim(m) {
  return { reach: m.reach, events: m.events, rate: m.rate, clicks: m.clicks, ctr: m.ctr, experiments: m.experiments };
}

function ratio(x) {
  return x.reach ? x.events / x.reach : 0;
}

function variantDesc(profile, c) {
  return { label: `${angleLabel(profile, c.messagingAngle)} (${contentTypeLabel(profile, c.contentType).toLowerCase()})`,
    headline: c.headline ?? null, messagingAngle: c.messagingAngle, contentType: c.contentType };
}

// Average reach per experiment at full allocation: test and control cells in the same experiment are summed,
// since each gets half the audience.
function reachPerExperiment(cells) {
  const byExp = new Map();
  for (const c of cells) byExp.set(c.experimentNumber, (byExp.get(c.experimentNumber) ?? 0) + c.reach);
  return byExp.size ? Math.round([...byExp.values()].reduce((s, v) => s + v, 0) / byExp.size) : 0;
}

function dimension(list, field, allIds, P, makeMetric) {
  const tested = [];
  for (const id of allIds) {
    const cells = list.filter((r) => r[field] === id);
    if (!cells.length) continue;
    const m = makeMetric(id, cells);
    tested.push({ id, label: m.name, ...slim(m), metricId: m.id });
  }
  tested.sort((x, y) => y.rate - x.rate);
  const untested = allIds.filter((id) => !tested.some((t) => t.id === id));
  const comparison = tested.length >= 2 ? compareRates(tested[0], tested[1], P) : null;
  return { tested, untested, leader: tested[0]?.id ?? null, comparison };
}

function leaders(channels, P) {
  const eligible = channels.filter((c) => c.tested && c.reach >= MIN_REACH_FOR_LEADER);
  if (!eligible.length) return { efficiency: null, volume: null, comparison: null };
  const byRate = [...eligible].sort((x, y) => y.rate - x.rate);
  const byVolume = [...eligible].sort((x, y) => y.expectedPerExperiment - x.expectedPerExperiment);
  let comparison = null;
  if (byRate.length >= 2) {
    const [first, last] = [byRate[0], byRate.at(-1)];
    comparison = { ...compareRates(first, last, P), labels: `${first.label} (${pct(first.rate)}) and ${last.label} (${pct(last.rate)})`, metricIds: [first.metricId, last.metricId] };
  }
  return { efficiency: byRate[0], volume: byVolume[0], comparison };
}

// Primary-signal trend for a channel over the last three experiments that used it.
function trend(experiments, channel, P) {
  const points = experiments
    .map((e) => pool(e.cells.filter((c) => c.channel === channel), P))
    .filter((p) => p.reach > 0)
    .slice(-3)
    .map((p) => p.rate);
  if (points.length < 3 || !points[0]) return { status: "insufficient", points };
  const change = points.at(-1) / points[0] - 1;
  return { status: Math.abs(change) < 0.1 ? "flat" : change > 0 ? "improving" : "declining", points };
}

function statusPhrase(status) {
  return { significant: "a significant difference", no_clear_difference: "no clear difference", not_enough_evidence: "not enough evidence yet" }[status];
}

// Rates as percentages: one decimal, or two below 1% so small conversion rates stay readable.
export function pct(x) {
  return `${x < 0.01 ? (x * 100).toFixed(2) : (x * 100).toFixed(1)}%`;
}

const signed = (x) => (x > 0 ? `+${x}` : `${x}`);
const round2 = (x) => Math.round(x * 100) / 100;
const round4 = (x) => Math.round(x * 10000) / 10000;
