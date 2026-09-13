// Performance simulator (SIMULATED data). Turns an experiment cell into reach and clicks using the
// hidden model in sim-truth.mjs, so different marketing decisions produce different outcomes.

import { TRUTH } from "./sim-truth.mjs";

export const MEASUREMENT_VERSION = 2;

export function clickProbability(companyKey, cell) {
  const t = truthFor(companyKey, cell.audienceId);
  const p = t.base
    * (t.channelFit[cell.channel] ?? 1)
    * (t.angleFit[cell.messagingAngle] ?? 1)
    * (t.typeFit[cell.contentType] ?? 1);
  return Math.min(0.45, Math.max(0.002, p));
}

// `share` is the fraction of the audience's addressable reach allocated to this cell
// (1 for a baseline cell, 0.5 each for a test/control split).
export function simulateCell({ companyKey, cell, share = 1, rng }) {
  const t = truthFor(companyKey, cell.audienceId);
  const addressable = t.addressable[cell.channel];
  if (addressable === undefined) throw new Error(`No simulated reach for ${cell.audienceId} on ${cell.channel}`);

  const reach = Math.max(0, Math.round(addressable * share * (1 + (rng() * 2 - 1) * 0.08)));
  const p = clickProbability(companyKey, cell);
  // Normal approximation to a binomial draw.
  const sd = Math.sqrt(reach * p * (1 - p));
  const clicks = Math.min(reach, Math.max(0, Math.round(reach * p + gaussian(rng) * sd)));
  return { reach, clicks, ctr: reach ? round4(clicks / reach) : 0 };
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

const round4 = (x) => Math.round(x * 10000) / 10000;
