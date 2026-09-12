// One SignalLoop run for the live demo, ported from ai-content-pipeline (main.py and pipeline/*).
// Company profiles and sample contacts are read from the Python project, so both versions
// share one source of truth. Channel mixes beyond email live in channels.mjs.

import ramp from "../../ai-content-pipeline/examples/ramp.json" with { type: "json" };
import square from "../../ai-content-pipeline/examples/square.json" with { type: "json" };
import contactBook from "../../ai-content-pipeline/data/contacts.json" with { type: "json" };
import { CHANNELS, CHANNEL_MIX } from "./channels.mjs";

export const PROFILES = { ramp, square };
export const HISTORY_LIMIT = 50;

export async function runPipeline({ companyKey, history = [], hubspot, crmState = {}, seed, now = new Date() }) {
  const profile = PROFILES[companyKey];
  if (!profile) throw new Error(`Unknown company: ${companyKey}`);
  seed = (seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;

  const personas = profile.personas;
  const mix = CHANNEL_MIX[companyKey];
  const sendDate = now.toISOString().slice(0, 10);
  const campaignId = `cmp_${now.toISOString().replace(/\D/g, "").slice(0, 14)}_${seed.toString(36).slice(-4)}`;
  const channelKeys = (p) => ["email", ...Object.keys(mix[p.id].channels)];

  // --- Stage 1: generate (template mode, same as the Python mock engine) ---
  const blog = profile.blog;
  const newsletters = Object.fromEntries(personas.map((p) => [p.id, p.newsletter]));

  // --- Stage 2: distribute through the CRM ---
  const state = { propertiesReady: false, lists: {}, ...crmState };
  state.lists = { ...state.lists };
  if (!state.propertiesReady) {
    await hubspot.ensureContactProperties();
    state.propertiesReady = true;
  }

  const bySegment = new Map(personas.map((p) => [p.segment, p]));
  const contacts = contactBook
    .filter((c) => bySegment.has(c.persona))
    .map((c) => ({
      email: c.email,
      persona: c.persona,
      properties: {
        email: c.email,
        firstname: c.first_name ?? "",
        lastname: c.last_name ?? "",
        company: c.company ?? "",
        persona: c.persona,
        signalloop_last_newsletter: newsletters[bySegment.get(c.persona).id].subject,
        signalloop_last_campaign: `${campaignId} (${sendDate})`,
      },
    }));
  const idsByEmail = await hubspot.upsertContacts(contacts);

  const crmContacts = {};
  await Promise.all(personas.map(async (p) => {
    const listName = `SignalLoop - ${profile.name} - ${p.id}`;
    state.lists[listName] ??= await hubspot.ensureStaticList(listName);
    const ids = contacts
      .filter((c) => c.persona === p.segment)
      .map((c) => idsByEmail.get(c.email.toLowerCase()))
      .filter(Boolean);
    if (ids.length) await hubspot.addToStaticList(state.lists[listName], ids);
    crmContacts[p.id] = ids.length;
  }));

  const campaign = {
    id: campaignId,
    blog_title: blog.title,
    topic: blog.title,
    send_date: sendDate,
    segments: personas.map((p) => p.segment),
  };

  // --- Stage 3: measure (simulated email engagement, sample data for other channels) ---
  const rng = makeRng(seed);
  const metrics = personas.map((p) => {
    const base = p.engagement;
    const openRate = jitter(rng, base.open, 0.06);
    const clickRate = Math.min(jitter(rng, base.click, 0.04), openRate); // can't exceed opens
    const unsubRate = jitter(rng, base.unsub, 0.003);
    const delivered = Math.max(Math.round(p.audience_size * jitter(rng, 0.98, 0.01)), 0);
    const opens = Math.round(delivered * openRate);
    const clicks = Math.round(delivered * clickRate);
    const unsubscribes = Math.round(delivered * unsubRate);
    return {
      persona_id: p.id,
      persona: p.name,
      subject: newsletters[p.id].subject,
      sent: p.audience_size,
      delivered,
      opens,
      clicks,
      unsubscribes,
      open_rate: delivered ? round4(opens / delivered) : 0,
      click_rate: delivered ? round4(clicks / delivered) : 0,
      unsub_rate: delivered ? round4(unsubscribes / delivered) : 0,
    };
  });

  for (const m of metrics) {
    const sampled = Object.entries(mix[m.persona_id].channels).map(([channel, b]) => {
      const reach = Math.round(b.reach * (1 + (rng() * 2 - 1) * 0.15));
      const rate = round4(jitter(rng, b.rate, b.rate * 0.25));
      return { channel, reach, rate, engaged: Math.round(reach * rate) };
    });
    m.channels = [{ channel: "email", reach: m.delivered, rate: m.click_rate, engaged: m.clicks }, ...sampled];
    m.best_channel = maxBy(m.channels, (c) => c.engaged).channel;
  }

  const runRecord = {
    campaign_id: campaignId,
    at: now.toISOString(),
    metrics: metrics.map((m) => ({
      persona_id: m.persona_id,
      open_rate: m.open_rate,
      click_rate: m.click_rate,
      unsub_rate: m.unsub_rate,
      channels: m.channels.map(({ channel, rate, engaged }) => ({ channel, rate, engaged })),
    })),
  };
  const updatedHistory = [...history, runRecord].slice(-HISTORY_LIMIT);
  const averages = averagesByPersona(updatedHistory, personas, mix);
  const leader = maxBy(averages, (a) => a.avg_click);
  const runs = updatedHistory.length;

  // --- Stage 4: optimize (next topic and best channel per audience, from every saved run) ---
  const optimization = {
    by_audience: averages.map((a) => ({
      persona: a.persona,
      best_channel: a.best_channel,
      best_channel_label: CHANNELS[a.best_channel].label,
      next_topic: mix[a.persona_id].next_topic,
    })),
    headline_variants: profile.optimization.headline_variants,
    rationale:
      `${leader.persona} has the strongest average email click-through (${pct(leader.avg_click)} across ` +
      `${runs} run${runs === 1 ? "" : "s"}), so the next slate leans into the angle that resonated ` +
      "with that segment.",
  };

  const usedChannels = [...new Set(personas.flatMap(channelKeys))];
  const report = {
    company: profile.name,
    company_key: companyKey,
    campaign,
    mode: {
      content: "templates",
      crm: hubspot.live ? "live" : "mock",
      email_engagement: "simulated",
      social_and_blog: "sample data",
    },
    channels: usedChannels.map((key) => ({
      key,
      label: CHANNELS[key].label,
      source: key === "email"
        ? `HubSpot CRM ${hubspot.live ? "(live)" : "(mock)"} · engagement simulated`
        : CHANNELS[key].source,
    })),
    blog: {
      title: blog.title,
      outline_points: blog.outline.length,
      words: blog.draft.split(/\s+/).filter(Boolean).length,
    },
    newsletters: personas.map((p) => ({
      persona: p.name,
      subject: newsletters[p.id].subject,
      preview: newsletters[p.id].preview,
    })),
    distribution: personas.map((p) => ({
      persona: p.name,
      channels: channelKeys(p).map((k) => CHANNELS[k].label),
      segment_size: p.audience_size,
      crm_contacts: crmContacts[p.id],
      subject: newsletters[p.id].subject,
    })),
    metrics,
    summary: summarize(metrics, leader, runs),
    optimization,
    loop: { run_number: runs, leader: leader.persona, averages },
    crm: {
      mode: hubspot.live ? "live" : "mock",
      request_count: hubspot.requestLog.length,
      requests: groupRequests(hubspot.requestLog),
      simulated_sends: contacts.length,
    },
  };

  return { report, history: updatedHistory, crmState: state };
}

export function summarizeHistory(companyKey, history) {
  const profile = PROFILES[companyKey];
  return {
    company: profile.name,
    runs: history.length,
    averages: averagesByPersona(history, profile.personas, CHANNEL_MIX[companyKey]),
  };
}

function averagesByPersona(history, personas, mix) {
  return personas.map((p) => {
    const rows = history.flatMap((run) => run.metrics.filter((m) => m.persona_id === p.id));
    const avg = (values) => (values.length ? round4(values.reduce((s, v) => s + v, 0) / values.length) : 0);

    // Runs saved before channels existed have no per-channel data; skip them for channel averages.
    const channelAverages = ["email", ...Object.keys(mix[p.id].channels)].map((channel) => {
      const engaged = rows.flatMap((r) => (r.channels ?? []).filter((c) => c.channel === channel).map((c) => c.engaged));
      return { channel, runs: engaged.length, avg_engaged: avg(engaged) };
    });
    const best = maxBy(channelAverages, (c) => c.avg_engaged);

    return {
      persona_id: p.id,
      persona: p.name,
      runs: rows.length,
      avg_open: avg(rows.map((r) => r.open_rate)),
      avg_click: avg(rows.map((r) => r.click_rate)),
      avg_unsub: avg(rows.map((r) => r.unsub_rate)),
      channels: channelAverages,
      best_channel: best.channel,
    };
  });
}

function summarize(metrics, leader, runs) {
  const best = maxBy(metrics, (m) => m.click_rate);
  const worst = maxBy(metrics, (m) => -m.click_rate);
  const lift = ((best.click_rate - worst.click_rate) * 100).toFixed(1);
  let summary =
    `${best.persona} led email this send with a ${pct(best.click_rate)} click rate, about ${lift} points ` +
    `higher than ${worst.persona}. Across channels, ${best.persona} engaged most on ` +
    `${CHANNELS[best.best_channel].label}.`;
  if (runs > 1) {
    summary += ` Across ${runs} runs, ${leader.persona} leads on average email click rate (${pct(leader.avg_click)}).`;
  }
  return {
    summary,
    recommendations: [
      `Double down on the angle that worked for ${best.persona}: lead with the concrete ROI or time-saved hook in future sends.`,
      `Rework the ${worst.persona} variant: swap abstract framing for a specific case study or before-and-after example.`,
      "Put each audience's next piece on the channel where it engages most, not on every channel.",
    ],
  };
}

// Group the CRM log by endpoint, with record ids and names folded into placeholders.
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

// Small seeded PRNG (mulberry32) so a run can be reproduced from its seed.
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitter(rng, mean, spread, floor = 0, ceil = 1) {
  return Math.max(floor, Math.min(ceil, mean + (rng() * 2 - 1) * spread));
}

function maxBy(items, score) {
  return items.reduce((best, item) => (score(item) > score(best) ? item : best));
}

const round4 = (x) => Math.round(x * 10000) / 10000;
const pct = (x) => `${(x * 100).toFixed(1)}%`;
