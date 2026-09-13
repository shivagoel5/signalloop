// Provider adapter for the two agents. Both providers expose an OpenAI-compatible chat completions
// API, so one request shape covers them. Groq is tried first; Gemini is the fallback when Groq
// fails (rate limit, error, timeout). Keys come from environment variables and are never logged.

const PROVIDERS = [
  {
    name: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    defaultModel: "openai/gpt-oss-120b",
  },
  {
    name: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-3.1-flash-lite",
  },
];

export class LLMUnavailableError extends Error {
  constructor(message, attempts) {
    super(message);
    this.attempts = attempts;
  }
}

export class LLMClient {
  constructor({ env = (key) => process.env[key], fetchImpl = globalThis.fetch, timeoutMs = 25000 } = {}) {
    this.providers = PROVIDERS
      .map((p) => ({ ...p, apiKey: (env(p.keyEnv) ?? "").trim(), model: (env(p.modelEnv) ?? "").trim() || p.defaultModel }))
      .filter((p) => p.apiKey);
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.active = 0;
    this.trace = [];
  }

  get configured() {
    return this.providers.length > 0;
  }

  get activeProvider() {
    const p = this.providers[this.active];
    return p ? { provider: p.name, model: p.model } : null;
  }

  // Move to the next provider for the rest of this request. Returns false if none is left.
  useNextProvider() {
    if (this.active + 1 >= this.providers.length) return false;
    this.active += 1;
    return true;
  }

  // Returns the assistant message. Falls through providers in order on any failure.
  async chat({ messages, tools, jsonSchema, maxTokens = 1500 }) {
    const failures = [];
    for (let i = this.active; i < this.providers.length; i++) {
      const p = this.providers[i];
      try {
        const { message, usage } = await this.#request(p, { messages, tools, jsonSchema, maxTokens });
        this.active = i;
        this.trace.push({ provider: p.name, model: p.model, ok: true, kind: jsonSchema ? "decision" : "tools", tokens: usage?.total_tokens ?? null });
        return { provider: p.name, model: p.model, message };
      } catch (err) {
        const failure = { provider: p.name, model: p.model, ok: false, status: err.status ?? null, error: String(err.message).slice(0, 160) };
        failures.push(failure);
        this.trace.push(failure);
      }
    }
    throw new LLMUnavailableError(
      failures.length ? "All AI providers failed for this request." : "No AI provider is configured.",
      failures,
    );
  }

  async #request(p, { messages, tools, jsonSchema, maxTokens }) {
    const body = { model: p.model, messages, max_tokens: maxTokens, temperature: 0.3 };
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    if (jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: jsonSchema.name, schema: jsonSchema.schema, ...(p.name === "groq" ? { strict: true } : {}) },
      };
    }
    if (p.name === "groq" && p.model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";

    const resp = await this.fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await resp.text();
    if (!resp.ok) {
      const err = new Error(`${p.name} returned ${resp.status}: ${text.slice(0, 200)}`);
      err.status = resp.status;
      throw err;
    }
    const data = JSON.parse(text);
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error(`${p.name} returned no message`);
    return { message, usage: data.usage };
  }
}

// Parse a JSON object from model text, tolerating code fences.
export function parseJsonObject(text) {
  const cleaned = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Response was not valid JSON");
  }
}
