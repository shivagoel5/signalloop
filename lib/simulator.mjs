// Performance simulator (SIMULATED data). Turns an experiment cell into the response signals the campaign objectives
// are judged on (reach, clicks, engagements, qualified views, high-intent visits, conversions), using the hidden
// model in sim-truth.mjs, so different marketing decisions produce different outcomes.

import { INTENT_BY_ANGLE, INTENT_BY_TYPE, TRUTH } from "./sim-truth.mjs";

export const MEASUREMENT_VERSION = 3;

// Every earlier experiment that sent an audience the same message wears it down a little, to a floor.
const WEAR = 0.92;
const WEAR_FLOOR = 0.7;

export function wearFactor(exposures = 0) {
  return Math.max(WEAR_FLOOR, WEAR ** exposures);
}

export function clickProbability(companyKey, cell, exposures = 0) {
  const t = truthFor(companyKey, cell.audienceId);
  const p = t.base
    * (t.channelFit[cell.channel] ?? 1)
    * (t.angleFit[cell.messagingAngle] ?? 1)
    * (t.typeFit[cell.contentType] ?? 1)
    * wearFactor(exposures);
  return clamp(p, 0.002, 0.45);
}

// `share` is the fraction of the audience's addressable reach allocated to this cell (1 for a baseline cell, 0.5
// each for a test/control split). `exposures` is how many earlier experiments sent this audience this message.
export function simulateCell({ companyKey, cell, share = 1, rng, exposures = 0 }) {
  const t = truthFor(companyKey, cell.audienceId);
  const addressable = t.addressable[cell.channel];
  if (addressable === undefined) throw new Error(`No simulated reach for ${cell.audienceId} on ${cell.channel}`);

  const reach = Math.max(0, Math.round(addressable * share * (1 + (rng() * 2 - 1) * 0.08)));
  const pClick = clickProbability(companyKey, cell, exposures);
  const clicks = binomial(reach, pClick, rng);
  const engagements = binomial(reach, clamp(pClick * (t.engage[cell.channel] ?? 1), 0, 0.6), rng);
  const attention = Math.sqrt((t.angleFit[cell.messagingAngle] ?? 1) * (t.typeFit[cell.contentType] ?? 1)) * wearFactor(exposures);
  const qualifiedViews = binomial(reach, clamp((t.qualified[cell.channel] ?? 0) * (t.view[cell.channel] ?? 0) * attention, 0, 0.9), rng);
  const intent = (t.intent[cell.channel] ?? 0)
    * (INTENT_BY_TYPE[companyKey]?.[cell.contentType] ?? 1)
    * (INTENT_BY_ANGLE[companyKey]?.[cell.messagingAngle] ?? 1);
  const highIntent = binomial(clicks, clamp(intent, 0, 0.9), rng);
  const conversions = binomial(highIntent, clamp(t.convert[cell.channel] ?? 0, 0, 0.9), rng);
  return { reach, clicks, ctr: reach ? round4(clicks / reach) : 0, engagements, qualifiedViews, highIntent, conversions };
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

// Binomial draw: exact for small expected counts, normal approximation for large ones.
function binomial(n, p, rng) {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  if (n * p < 25 && n < 5000) {
    let k = 0;
    for (let i = 0; i < n; i++) if (rng() < p) k++;
    return k;
  }
  const sd = Math.sqrt(n * p * (1 - p));
  return Math.min(n, Math.max(0, Math.round(n * p + gaussian(rng) * sd)));
}

function truthFor(companyKey, audienceId) {
  const t = TRUTH[companyKey]?.[audienceId];
  if (!t) throw new Error(`No simulation model for ${companyKey}/${audienceId}`);
  return t;
}

function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round4 = (x) => Math.round(x * 10000) / 10000;
