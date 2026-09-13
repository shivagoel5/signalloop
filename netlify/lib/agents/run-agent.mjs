// Shared two-phase agent runner.
//   Phase 1: the model calls read-only tools to fetch only what it needs.
//   Phase 2: the model returns its final decision as JSON (no tools; Groq cannot combine
//            tools with structured output). Code validates it; invalid output gets one repair
//            attempt, then one attempt on the fallback provider, then fails loudly.

import { parseJsonObject } from "../llm.mjs";

export class AgentError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

const MAX_TOOL_ROUNDS = 4;

export async function runAgent({ llm, system, task, toolbox, finalInstruction, jsonSchema, validate, requiredTools = [] }) {
  const messages = [{ role: "system", content: system }, { role: "user", content: task }];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const { message } = await llm.chat({ messages, tools: toolbox.definitions, maxTokens: 1200 });
    const toolCalls = message.tool_calls ?? [];
    messages.push({ role: "assistant", content: message.content ?? "", ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    if (!toolCalls.length) break;
    for (const call of toolCalls) {
      const result = toolbox.run(call.function?.name, call.function?.arguments);
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function?.name, content: JSON.stringify(result) });
    }
  }

  // Guarantee the decision is grounded: fetch any core tool the model skipped and record that
  // the system (not the model) supplied it.
  const systemSupplied = [];
  for (const name of requiredTools) {
    if (toolbox.calls.some((c) => c.name === name)) continue;
    const result = toolbox.run(name, {});
    toolbox.calls.at(-1).suppliedBySystem = true;
    systemSupplied.push(name);
    messages.push({ role: "user", content: `Data from ${name} (supplied by the system):\n${JSON.stringify(result)}` });
  }

  messages.push({ role: "user", content: finalInstruction });

  const attempts = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const { message, provider, model } = await llm.chat({ messages, jsonSchema, maxTokens: 2000 });
    let output;
    let errors;
    try {
      output = parseJsonObject(message.content);
      errors = validate(output);
    } catch (err) {
      errors = [err.message];
    }
    attempts.push({ provider, model, errors });
    if (!errors.length) {
      return { output, provider, model, toolCalls: toolbox.calls, systemSupplied, attempts };
    }
    messages.push({ role: "assistant", content: String(message.content ?? "") });
    messages.push({ role: "user", content: `That response failed validation:\n- ${errors.join("\n- ")}\nReturn corrected JSON only.` });
    // Second failure: give the fallback provider one try.
    if (attempt === 1 && !llm.useNextProvider()) break;
  }
  throw new AgentError("The agent could not produce a valid decision.", { attempts });
}
