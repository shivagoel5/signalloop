// Checks each configured AI provider for the three capabilities the agents rely on:
// a basic reply, tool calling, and JSON-schema output. Keys are read from the environment
// (npm run check:ai loads .env) and are never printed.

import { LLMClient, parseJsonObject } from "../lib/llm.mjs";

const PROVIDERS = [
  { name: "groq", key: "GROQ_API_KEY", model: "GROQ_MODEL" },
  { name: "gemini", key: "GEMINI_API_KEY", model: "GEMINI_MODEL" },
];

const tool = {
  type: "function",
  function: {
    name: "getCampaignObjective",
    description: "Returns the current campaign objective.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
};

const schema = {
  name: "check",
  schema: {
    type: "object",
    properties: { status: { type: "string", enum: ["ok"] }, channel: { type: "string" } },
    required: ["status", "channel"],
    additionalProperties: false,
  },
};

let configured = 0;
let failures = 0;

for (const p of PROVIDERS) {
  if (!(process.env[p.key] ?? "").trim()) {
    console.log(`${p.name}: not configured (${p.key} is empty)`);
    continue;
  }
  configured += 1;
  // A client that only knows this one provider, so there is no fallback during the check.
  const llm = new LLMClient({ env: (k) => (k === p.key || k === p.model ? process.env[k] : "") });
  const { provider, model } = llm.activeProvider;
  console.log(`\n${provider} (${model})`);

  await check("basic reply", async () => {
    const { message } = await llm.chat({ messages: [{ role: "user", content: "Reply with the single word OK." }], maxTokens: 200 });
    if (!String(message.content ?? "").trim()) throw new Error("empty reply");
  });

  await check("tool calling", async () => {
    const { message } = await llm.chat({
      messages: [
        { role: "system", content: "You must call the getCampaignObjective tool before answering." },
        { role: "user", content: "What is the campaign objective? Use the tool." },
      ],
      tools: [tool],
      maxTokens: 400,
    });
    if (!message.tool_calls?.length) throw new Error("model answered without calling the tool");
  });

  await check("JSON-schema output", async () => {
    const { message } = await llm.chat({
      messages: [{ role: "user", content: 'Return JSON with status "ok" and channel "linkedin".' }],
      jsonSchema: schema,
      maxTokens: 400,
    });
    const out = parseJsonObject(message.content);
    if (out.status !== "ok" || typeof out.channel !== "string") throw new Error(`unexpected JSON: ${JSON.stringify(out).slice(0, 120)}`);
  });
}

if (!configured) {
  console.log("\nNo AI provider configured. Copy .env.example to .env and add GROQ_API_KEY and/or GEMINI_API_KEY.");
}
process.exitCode = failures ? 1 : 0;

async function check(label, fn) {
  const started = Date.now();
  try {
    await fn();
    console.log(`  PASS  ${label} (${Date.now() - started} ms)`);
  } catch (err) {
    failures += 1;
    const detail = err.attempts?.map((a) => `${a.status ?? ""} ${a.error ?? ""}`.trim()).join("; ") || err.message;
    console.log(`  FAIL  ${label}: ${String(detail).slice(0, 220)}`);
  }
}
