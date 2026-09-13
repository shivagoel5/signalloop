// Content Agent: given the Marketing Agent's decision, decides WHAT content to create and HOW to
// frame and express it: a content plan first, then the generated variant. It does not re-decide
// audience, channel or angle.

import { CHANNEL_LABELS, angleLabel, contentTypeLabel, getAudience } from "../company.mjs";
import { contentToolbox } from "./tools.mjs";
import { runAgent } from "./run-agent.mjs";

const SYSTEM = `You are the Content Agent in SignalLoop, acting as a B2B/SMB content strategist and planner.
You receive a decision from the Marketing Agent (audience, channel, messaging angle, content type, hypothesis). Do not change those choices.

Your job:
1. Plan the content: the audience insight it builds on, the content angle (the framing shift), topic, hook, headline, key message, supporting points, tone, CTA, format and a short brief.
2. Then write the content variant for the channel.

Rules:
- The plan must visibly reflect the Marketing Agent's hypothesis and the messaging angle.
- Check previous content and do not reuse a topic or headline that was already tested for this audience.
- Follow the brand voice, proof rules and channel constraints. Never invent statistics, customer names, quotes or product features.
- One clear CTA.`;

export async function runContentAgent({ llm, profile, analytics, experiments, recommendation }) {
  const toolbox = contentToolbox({ profile, analytics, experiments, recommendation });
  const audience = getAudience(profile, recommendation.priorityAudience);
  const constraints = profile.content_constraints[recommendation.recommendedChannel];
  const previousTopics = experiments.flatMap((e) => e.cells
    .filter((c) => c.audienceId === audience.id)
    .flatMap((c) => [c.topic, c.headline]))
    .filter(Boolean);

  const str = { type: "string" };
  const jsonSchema = {
    name: "content_plan",
    schema: {
      type: "object",
      properties: {
        contentPlan: {
          type: "object",
          properties: {
            audienceInsight: str, contentAngle: str, topic: str, hook: str, headline: str, keyMessage: str,
            supportingPoints: { type: "array", items: str }, tone: str, cta: str, format: str,
            contentBrief: { type: "array", items: str },
          },
          required: ["audienceInsight", "contentAngle", "topic", "hook", "headline", "keyMessage", "supportingPoints", "tone", "cta", "format", "contentBrief"],
          additionalProperties: false,
        },
        generatedContent: {
          type: "object",
          properties: { title: str, body: str },
          required: ["title", "body"],
          additionalProperties: false,
        },
      },
      required: ["contentPlan", "generatedContent"],
      additionalProperties: false,
    },
  };

  const validate = (out) => {
    const errors = [];
    const plan = out?.contentPlan;
    const gen = out?.generatedContent;
    if (!plan || !gen) return ["Both contentPlan and generatedContent are required"];
    for (const f of ["audienceInsight", "contentAngle", "topic", "hook", "headline", "keyMessage", "tone", "cta", "format"]) {
      if (typeof plan[f] !== "string" || plan[f].trim().length < 3) errors.push(`contentPlan.${f} is missing`);
    }
    if (!Array.isArray(plan.supportingPoints) || plan.supportingPoints.length < 2 || plan.supportingPoints.length > 5) {
      errors.push("contentPlan.supportingPoints must have 2 to 5 items");
    }
    if (!Array.isArray(plan.contentBrief) || plan.contentBrief.length < 3 || plan.contentBrief.length > 7) {
      errors.push("contentPlan.contentBrief must have 3 to 7 steps");
    }
    if (typeof plan.headline === "string" && plan.headline.length > 110) errors.push("headline must be 110 characters or fewer");
    const words = String(gen.body ?? "").split(/\s+/).filter(Boolean).length;
    if (words < 30) errors.push("generatedContent.body is too short");
    if (constraints?.max_words && words > Math.round(constraints.max_words * 1.3)) {
      errors.push(`generatedContent.body has ${words} words; the ${recommendation.recommendedChannel} limit is ${constraints.max_words}`);
    }
    for (const prior of previousTopics) {
      if (similarity(plan.topic, prior) >= 0.6 || similarity(plan.headline, prior) >= 0.6) {
        errors.push(`topic or headline is too close to previously tested content: "${prior}"`);
        break;
      }
    }
    return errors;
  };

  const result = await runAgent({
    llm,
    system: SYSTEM,
    task: `Marketing Agent decision:
${JSON.stringify({
  company: profile.name,
  campaignObjective: analytics.objective.label,
  audience: `${audience.short_name} (${audience.id})`,
  channel: CHANNEL_LABELS[recommendation.recommendedChannel],
  messagingAngle: angleLabel(profile, recommendation.recommendedAngle),
  contentType: contentTypeLabel(profile, recommendation.recommendedContentType),
  hypothesis: recommendation.hypothesis,
  reasoning: recommendation.reasoning,
}, null, 2)}
Use the tools to check the audience, previous content, what has performed, brand context and channel constraints. Then plan and write the next content variant.`,
    toolbox,
    requiredTools: ["getAudienceProfile", "getPreviousContent", "getBrandContext", "getContentConstraints"],
    finalInstruction: "Return the content plan and the generated content now as JSON matching the schema.",
    jsonSchema,
    validate,
  });

  return result;
}

// Token-overlap similarity (Jaccard) used to catch repeated topics.
export function similarity(a, b) {
  const tokens = (s) => new Set(String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2));
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared);
}
