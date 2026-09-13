// Marketing Agent: the judgment step. It combines PMM strategy (objective and funnel stage, ICP, buying roles,
// positioning, message hypotheses, constraints) with the evidence code has measured, and decides which experiment
// would reduce the most important uncertainty next. It reads everything through tools and never calculates or
// changes numbers.

import { CHANNEL_LABELS } from "../company.mjs";
import { marketingToolbox } from "./tools.mjs";
import { runAgent } from "./run-agent.mjs";

const SYSTEM = `You are the Marketing Agent in SignalLoop: a senior product marketing strategist deciding the next go-to-market experiment.
You combine three things: the PMM strategy (objective and funnel stage, ICP, each audience's buying role and job to be done, positioning, value proposition, proof, competitive alternative, message hypotheses, constraints), the campaign evidence calculated by code, and what is still uncertain.

Work through this before deciding:
1. The campaign objective, its primary signal and funnel stage. Judge results on that signal, not on CTR by default.
2. What the evidence shows, and what the last experiment taught: a win, a loss, no clear difference, or not enough evidence.
3. Which assumption or hypothesis that changes.
4. What is still unknown, and which unknown matters most for this objective and this ICP.
5. The experiment that would reduce that uncertainty, and why it is worth more than the alternatives (changing the audience, the channel, the message or the format).
6. What result would support or reject the hypothesis, and what should happen after each.

Rules:
- Every number comes from tools. Never calculate new metrics; quote rates and counts exactly as returned.
- The highest rate is not automatically the answer. Weigh ICP fit and buying role, message wear-out, the lead positioning hypothesis, channel scale versus efficiency, and how much evidence exists.
- "not_enough_evidence" means the prototype guardrail was not met: treat it as uncertainty, never as a win or a loss. "no_clear_difference" means there was enough evidence but no significant difference.
- The next experiment runs against the current control for that audience and channel (currentControl). Change exactly one variable, the messaging angle or the content type, so the result can be attributed to that change.
- The channel must be one of the priority audience's channels. Do not repeat the last test exactly unless decisionType is "retest".
- decisionType: "exploit" = build on a proven result, "explore" = test an untested hypothesis, "retest" = repeat an inconclusive test to get enough evidence.
- learned: what the evidence so far has taught, including the last experiment's result if there is one. knowledgeGap: the single most important unknown this experiment reduces.
- alternatives: why this test is worth more than the most credible alternative tests.
- Evidence: 3 to 6 items. Each cites a ref returned by a tool: a metricId for campaign evidence or a contextId for PMM strategy. Cite at least one of each, and cite the last experiment's result if it exists.
- confidence reflects the strength of the evidence, not how good the idea sounds; confidenceReason says why.
- Write for a product marketer, in plain language. Name audiences, channels, messages and formats by their labels (for example "Finance Leaders", "Real-time visibility", "How-to guide"); never write ids such as real_time_visibility or refs such as ctx:icp outside the ref field.`;

const TEXT_FIELDS = ["learned", "knowledgeGap", "hypothesis", "reasoning", "alternatives", "tradeoff", "confidenceReason", "supportIf", "rejectIf", "ifSupported", "ifRejected"];

export async function runMarketingAgent({ llm, profile, analytics, experiments, controlFor }) {
  const toolbox = marketingToolbox({ profile, analytics, experiments, controlFor });
  const audienceIds = profile.personas.map((p) => p.id);
  const angleIds = profile.messaging_angles.map((a) => a.id);
  const typeIds = profile.content_types.map((t) => t.id);
  const channelIds = [...new Set(profile.personas.flatMap((p) => p.channels))];

  const str = { type: "string" };
  const properties = {
    priorityAudience: { type: "string", enum: audienceIds },
    recommendedChannel: { type: "string", enum: channelIds },
    recommendedAngle: { type: "string", enum: angleIds },
    recommendedContentType: { type: "string", enum: typeIds },
    decisionType: { type: "string", enum: ["exploit", "explore", "retest"] },
    learned: str,
    knowledgeGap: str,
    hypothesis: str,
    reasoning: str,
    alternatives: str,
    tradeoff: str,
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    confidenceReason: str,
    supportIf: str,
    rejectIf: str,
    ifSupported: str,
    ifRejected: str,
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: { ref: str, statement: str },
        required: ["ref", "statement"],
        additionalProperties: false,
      },
    },
  };
  const jsonSchema = {
    name: "marketing_recommendation",
    schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
  };

  const lastTest = experiments.at(-1)?.cells.find((c) => c.role === "test");
  const latestResult = analytics.latest?.testVsControl;
  const internalIds = [...audienceIds, ...angleIds, ...typeIds].filter((id) => id.includes("_"));
  const leaksIds = new RegExp(`\\b(?:${internalIds.join("|")})\\b|\\b(?:ctx|audience_channel|audience_angle|audience_contentType|test_vs_control):`, "i");

  const validate = (d) => {
    const errors = [];
    const audience = profile.personas.find((p) => p.id === d.priorityAudience);
    if (!audience) errors.push(`priorityAudience must be one of ${audienceIds.join(", ")}`);
    if (audience && !audience.channels.includes(d.recommendedChannel)) {
      errors.push(`${d.recommendedChannel} is not available for ${audience.id}; use one of ${audience.channels.join(", ")}`);
    }
    if (!angleIds.includes(d.recommendedAngle)) errors.push(`recommendedAngle must be one of ${angleIds.join(", ")}`);
    if (!typeIds.includes(d.recommendedContentType)) errors.push(`recommendedContentType must be one of ${typeIds.join(", ")}`);
    if (!["exploit", "explore", "retest"].includes(d.decisionType)) errors.push("decisionType must be exploit, explore or retest");
    if (!["low", "medium", "high"].includes(d.confidence)) errors.push("confidence must be low, medium or high");
    for (const field of TEXT_FIELDS) {
      if (typeof d[field] !== "string" || d[field].trim().length < 20) errors.push(`${field} must be a meaningful sentence`);
      else if (leaksIds.test(d[field])) errors.push(`${field} contains an internal id or ref; use plain labels such as "Real-time visibility" or "Finance Leaders"`);
    }

    if (!Array.isArray(d.evidence) || d.evidence.length < 3 || d.evidence.length > 6) {
      errors.push("evidence must contain 3 to 6 items");
    } else {
      const refs = d.evidence.map((e) => e?.ref);
      for (const ref of refs) {
        if (!toolbox.seenMetricIds.has(ref) && !toolbox.seenContextIds.has(ref)) errors.push(`evidence ref "${ref}" was not returned by any tool`);
      }
      if (!refs.some((r) => toolbox.seenContextIds.has(r))) errors.push("evidence must cite at least one PMM strategy item (a contextId from getStrategyContext)");
      if (!refs.some((r) => toolbox.seenMetricIds.has(r))) errors.push("evidence must cite at least one campaign metric (a metricId)");
      if (latestResult && !refs.includes(latestResult.metricId)) {
        errors.push(`evidence must cite the result of experiment ${latestResult.experimentNumber} (${latestResult.metricId}): the next test has to build on it`);
      }
      if (d.evidence.some((e) => leaksIds.test(String(e?.statement ?? "")))) errors.push("evidence statements contain internal ids or refs; use plain labels");
    }

    if (lastTest && d.decisionType !== "retest" && lastTest.audienceId === d.priorityAudience && lastTest.channel === d.recommendedChannel
      && lastTest.messagingAngle === d.recommendedAngle && lastTest.contentType === d.recommendedContentType) {
      errors.push("This repeats the last test exactly; choose a different variable or mark it as a retest");
    }
    const control = controlFor?.(d.priorityAudience, d.recommendedChannel);
    if (control && control.messagingAngle === d.recommendedAngle && control.contentType === d.recommendedContentType) {
      errors.push(`The control for ${d.priorityAudience} on ${d.recommendedChannel} already uses ${d.recommendedAngle} with ${d.recommendedContentType}; change the angle or the content type so the test compares something`);
    } else if (control && control.messagingAngle !== d.recommendedAngle && control.contentType !== d.recommendedContentType) {
      errors.push(`The control for ${d.priorityAudience} on ${d.recommendedChannel} uses ${control.messagingAngle} with ${control.contentType}; change only the messaging angle or only the content type, so the result can be attributed to one change`);
    }
    if (experiments.length < 3 && d.confidence === "high") {
      errors.push("With fewer than three experiments the evidence is thin; confidence must be low or medium");
    }
    return errors;
  };

  const o = analytics.objective;
  const result = await runAgent({
    llm,
    system: SYSTEM,
    task: `Company: ${profile.name}. Campaign objective: ${o.label}, judged on ${o.metric.noun}. Experiments so far: ${experiments.length}.
Available channels: ${Object.entries(CHANNEL_LABELS).map(([id, label]) => `${id} (${label})`).join(", ")}.
Use the tools to retrieve the strategy and the evidence you need, then decide the next experiment.`,
    toolbox,
    requiredTools: ["getStrategyContext", "getEvidenceSummary", "getAudiencePerformance", "getChannelPerformance", "getMessagingPerformance"],
    finalInstruction: "Return your decision now as JSON matching the schema. Cite 3 to 6 evidence items by ref: at least one contextId from the strategy and at least one metricId from the results.",
    jsonSchema,
    validate,
    decisionMaxTokens: 2600,
    // The decision is the largest request (strategy plus evidence) and tends to hit Groq's per-minute token
    // limit, so it goes to Gemini first. Groq still handles the tool calls and is the fallback here.
    decisionProvider: "gemini",
  });

  return {
    ...result,
    evidence: result.output.evidence.map((e) => ({
      ...e,
      metric: analytics.metrics[e.ref] ?? null,
      context: toolbox.contexts.get(e.ref) ?? null,
    })),
  };
}
