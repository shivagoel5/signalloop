// Run history for the live demo. Uses Netlify Blobs when running on Netlify and falls back
// to process memory for local previews and tests.

const memory = new Map();

const memoryStore = {
  async get(key, { type } = {}) {
    if (!memory.has(key)) return null;
    const value = memory.get(key);
    return type === "json" ? JSON.parse(value) : value;
  },
  async setJSON(key, value) {
    memory.set(key, JSON.stringify(value));
  },
};

export async function openStore(name = "signalloop") {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name, consistency: "strong" });
  } catch (err) {
    // On Netlify a missing store is a real failure; locally, memory is enough.
    if (typeof Netlify !== "undefined") throw err;
    return memoryStore;
  }
}
