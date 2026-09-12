// One SignalLoop run for the live demo, ported from ai-content-pipeline (main.py and pipeline/*).
// Company profiles and sample contacts are read from the Python project, so both versions
// share one source of truth.

import ramp from "../../ai-content-pipeline/examples/ramp.json" with { type: "json" };
import square from "../../ai-content-pipeline/examples/square.json" with { type: "json" };
import contactBook from "../../ai-content-pipeline/data/contacts.json" with { type: "json" };

export const PROFILES = { ramp, square };
export const HISTORY_LIMIT = 50;

export async function runPipeline({ companyKey, history = [], hubspot, seed, now = new Date() }) {
  const profile = PROFILES[companyKey];
  if (!profile) throw new Error(`Unknown company: ${companyKey}`);
  seed = (seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;

  const personas = profile.personas;
  const campaignId = `cmp_${now.toISOString().replace(/\D/g, "").slice(0, 14)}_${seed.toString(36).slice(-4)}`;

  // --- Stage 1: generate (template mode, same as the Python mock engine) ---
  const blog = profile.blog;
  const newsletters = Object.fromEntries(personas.map((p) => [p.id, p.newsletter]));

  // --- Stage 2: distribute through the CRM ---
  const segments = new Set(personas.map((p) => p.segment));
  const contacts = contactBook.filter((c) => segments.has(c.persona));
  await hubspot.upsertContacts(contacts);
  for (const p of personas) await hubspot.createSegmentList(p.id, p.segment);

  const crmContacts = {};
  const newsletterIds = {};
  for (const p of personas) {
    const newsletterId = `${campaignId}_${p.id}`;
    newsletterIds[p.id] = newsletterId;
    const recipients = contacts.filter((c) => c.persona === p.segment);
    for (const c of recipients) {
      await hubspot.sendMarketingEmail(c, { ...newsletters[p.id], newsletter_id: newsletterId }, blog.title);
    }
    crmContacts[p.id] = recipients.length;
  }

  const campaign = {
    id: campaignId,
    blog_title: blog.title,
    topic: blog.title,
    send_date: now.toISOString().slice(0, 10),
    newsletter_ids: Object.values(newsletterIds),
    segments: personas.map((p) => p.segment),
  };
  await hubspot.logCampaign(campaign);

  // --- Stage 3: measure (simulated engagement around each persona's baseline) ---
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

  const runRecord = {
    campaign_id: campaignId,
    at: now.toISOString(),
    metrics: metrics.map(({ persona_id, open_rate, click_rate, unsub_rate }) => ({
      persona_id, open_rate, click_rate, unsub_rate,
    })),
  };
  const updatedHistory = [...history, runRecord].slice(-HISTORY_LIMIT);
  const averages = averagesByPersona(updatedHistory, personas);
  const leader = maxBy(averages, (a) => a.avg_click);
  const runs = updatedHistory.length;

  // --- Stage 4: optimize (lean into the audience that leads across saved runs) ---
  const optimization = {
    next_topics: profile.optimization.next_topics,
    headline_variants: profile.optimization.headline_variants,
    rationale:
      `${leader.persona} has the strongest average click-through (${pct(leader.avg_click)} across ` +
      `${runs} run${runs === 1 ? "" : "s"}), so the next slate leans into the angle that resonated ` +
      "with that segment.",
  };

  const report = {
    company: profile.name,
    company_key: companyKey,
    campaign,
    mode: {
      content: "templates",
      crm: hubspot.live ? "live" : "mock",
      engagement: "simulated",
    },
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
    },
  };

  return { report, history: updatedHistory };
}

export function summarizeHistory(companyKey, history) {
  const profile = PROFILES[companyKey];
  return {
    company: profile.name,
    runs: history.length,
    averages: averagesByPersona(history, profile.personas),
  };
}

function averagesByPersona(history, personas) {
  return personas.map((p) => {
    const rows = history.flatMap((run) => run.metrics.filter((m) => m.persona_id === p.id));
    const avg = (key) => (rows.length ? round4(rows.reduce((s, r) => s + r[key], 0) / rows.length) : 0);
    return {
      persona_id: p.id,
      persona: p.name,
      runs: rows.length,
      avg_open: avg("open_rate"),
      avg_click: avg("click_rate"),
      avg_unsub: avg("unsub_rate"),
    };
  });
}

function summarize(metrics, leader, runs) {
  const best = maxBy(metrics, (m) => m.click_rate);
  const worst = maxBy(metrics, (m) => -m.click_rate);
  const lift = ((best.click_rate - worst.click_rate) * 100).toFixed(1);
  let summary =
    `${best.persona} led this send with a ${pct(best.click_rate)} click rate, about ${lift} points ` +
    `higher than ${worst.persona}. Open rates were healthy across segments, so the gap is driven by ` +
    "message-to-offer fit rather than subject lines.";
  if (runs > 1) {
    summary += ` Across ${runs} runs, ${leader.persona} leads on average click rate (${pct(leader.avg_click)}).`;
  }
  return {
    summary,
    recommendations: [
      `Double down on the angle that worked for ${best.persona}: lead with the concrete ROI or time-saved hook in future sends.`,
      `Rework the ${worst.persona} variant: swap abstract framing for a specific case study or before-and-after example.`,
      "Add a single, unmissable primary CTA per email to lift click-through.",
    ],
  };
}

function groupRequests(log) {
  const groups = new Map();
  for (const r of log) {
    const path = new URL(r.url).pathname;
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
