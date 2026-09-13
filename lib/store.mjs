// Storage for the live demo: each visitor's experiment history, CRM list state and usage counters.
// On Vercel this is Upstash Redis, called over its REST API (no SDK). Without Redis credentials, for local
// previews and tests, it falls back to process memory.

export class StoreNotConfiguredError extends Error {
  constructor() {
    super("Storage is not configured: connect Upstash Redis to this Vercel project.");
  }
}

export function openStore({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  // The Vercel Marketplace integration names these KV_REST_API_*; Upstash's own dashboard uses UPSTASH_REDIS_REST_*.
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || "").trim().replace(/\/+$/, "");
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || "").trim();
  if (url && token) return redisStore(url, token, fetchImpl);
  // On Vercel, missing credentials are a configuration error, not something to hide behind memory.
  if (env.VERCEL) throw new StoreNotConfiguredError();
  return memoryStore;
}

function redisStore(url, token, fetchImpl) {
  async function command(...args) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`Upstash ${args[0]} failed: ${body.error ?? res.status}`);
    return body.result;
  }
  return {
    async get(key, { type } = {}) {
      const value = await command("GET", key);
      if (value == null) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    async setJSON(key, value, { ttlSeconds } = {}) {
      const args = ["SET", key, JSON.stringify(value)];
      if (ttlSeconds) args.push("EX", String(ttlSeconds));
      await command(...args);
    },
    // Atomic counter; the expiry is set once, when the counter is created.
    async incr(key, ttlSeconds) {
      const count = await command("INCR", key);
      if (count === 1 && ttlSeconds) await command("EXPIRE", key, String(ttlSeconds));
      return count;
    },
  };
}

const values = new Map();
const counters = new Map();

const memoryStore = {
  async get(key, { type } = {}) {
    if (!values.has(key)) return null;
    const value = values.get(key);
    return type === "json" ? JSON.parse(value) : value;
  },
  async setJSON(key, value) {
    values.set(key, JSON.stringify(value));
  },
  async incr(key, ttlSeconds) {
    const now = Date.now();
    const current = counters.get(key);
    const live = current && (!current.expires || current.expires > now);
    const next = { count: live ? current.count + 1 : 1, expires: live ? current.expires : ttlSeconds ? now + ttlSeconds * 1000 : 0 };
    counters.set(key, next);
    return next.count;
  },
};
