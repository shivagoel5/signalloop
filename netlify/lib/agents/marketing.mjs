// Marketing Agent: decides WHO, WHERE, WHY and WHICH strategic angle to test next.
// It reads computed metrics through tools and never calculates or changes numbers itself.

import { CHANNEL_LABELS } from "../company.mjs";
import { marketingToolbox } from "./tools.mjs";
import { runAgent } from "./run-agent.mjs";

const SYSTEM = `You are the Marketing Agent in SignalLoop, acting as a product marketing campaign strategist.
Your job: given how each audience, channel, messaging angle and content type is performing, decide the single next experiment.

Rules:
- All numbers come from tools. Never calculate new metrics and never state a number a tool did not return.
- Weigh efficiency (CTR) against volume (expected clicks per experiment) using the campaign objective. The highest CTR is not automatically the right choice.
- If the top options are "too close to call", treat that as uncertainty: consider testing an untested or under-tested angle or content type, or retesting.
- Build on what the experiment history shows. Do not repeat the exact same audience, channel, angle and content type as the last test unless you are deliberately retesting an inconclusive result.
- The channel must be one of the priority audience's available channels.
- Every evidence item must cite a metricId returned by a tool, and its statement must describe what that metric shows.
- decisionType: "exploit" = use a proven winner, "explore" = test something untested, "retest" = repeat an inconclusive test.
- confidence reflects how strong the evidence is, not how good the idea sounds.`;

export async function runMarketingAgent({ llm, profile, analytics, experiments }) {
  const toolbox = marketingToolbox({ profile, analytics, experiments });
  const audienceIds = profile.personas.map((p) => p.id);
  const angleIds = profile.messaging_angles.map((a) => a.id);
  const typeIds = profile.content_types.map((t) => t.id);
  const channelIds = [...new Set(profile.personas.flatMap((p) => p.channels))];

  const jsonSchema = {
    name: "marketing_recommendation",
    schema: {
      type: "object",
      properties: {
        priorityAudience: { type: "string", enum: audienceIds },
        recommendedChannel: { type: "string", enum: channelIds },
        recommendedAngle: { type: "string", enum: angleIds },
        recommendedContentType: { type: "string", enum: typeIds },
        decisionType: { type: "string", enum: ["exploit", "explore", "retest"] },
        hypothesis: { type: "string" },
        reasoning: { type: "string" },
        tradeoff: { type: "string" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        evidence: {
          type: "array",
          items: {
            type: "object",
            properties: { metricId: { type: "string" }, statement: { type: "string" } },
            required: ["metricId", "statement"],
            additionalProperties: false,
          },
        },
      },
      required: ["priorityAudience", "recommendedChannel", "recommendedAngle", "recommendedContentType", "decisionType",
        "hypothesis", "reasoning", "tradeoff", "confidence", "evidence"],
      additionalProperties: false,
    },
  };

  const lastTest = experiments.at(-1)?.cells.find((c) => c.role === "test");

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
    for (const field of ["hypothesis", "reasoning", "tradeoff"]) {
      if (typeof d[field] !== "string" || d[field].trim().length < 20) errors.push(`${field} must be a meaningful sentence`);
    }
    if (!Array.isArray(d.evidence) || d.evidence.length < 2 || d.evidence.length > 5) {
      errors.push("evidence must contain 2 to 5 items");
    } else {
      for (const e of d.evidence) {
        if (!toolbox.seenMetricIds.has(e.metricId)) errors.push(`evidence metricId "${e.metricId}" was not returned by any tool`);
      }
    }
    if (lastTest && d.decisionType !== "retest" && lastTest.audienceId === d.priorityAudience && lastTest.channel === d.recommendedChannel
      && lastTest.messagingAngle === d.recommendedAngle && lastTest.contentType === d.recommendedContentType) {
      errors.push("This repeats the last test exactly; choose a different variable or mark it as a retest");
    }
    return errors;
  };

  const result = await runAgent({
    llm,
    system: SYSTEM,
    task: `Company: ${profile.name}. Campaign objective: ${analytics.objective.label}. Experiments so far: ${experiments.length}.
Available channels: ${Object.entries(CHANNEL_LABELS).map(([id, label]) => `${id} (${label})`).join(", ")}.
Use the tools to retrieve the data you need, then decide the next experiment.`,
    toolbox,
    requiredTools: ["getCampaignObjective", "getAudiencePerformance", "getChannelPerformance", "getMessagingPerformance"],
    finalInstruction: "Return your decision now as JSON matching the schema. Cite 2 to 5 evidence items using metricIds you received from tools.",
    jsonSchema,
    validate,
  });

  return {
    ...result,
    evidence: result.output.evidence.map((e) => ({ ...e, metric: analytics.metrics[e.metricId] ?? null })),
  };
}
