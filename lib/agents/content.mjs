// Content Agent: executes an experiment strategy the marketer has already approved. Given the Marketing Agent's
// decision and the strategy behind it, it plans the content and writes the variant. It never chooses or changes the
// audience, channel, message, format or hypothesis.

import { CHANNEL_LABELS, angleLabel, contentTypeLabel, getAudience } from "../company.mjs";
import { contentToolbox } from "./tools.mjs";
import { runAgent } from "./run-agent.mjs";

const SYSTEM = `You are the Content Agent in SignalLoop: a B2B/SMB content strategist who executes an experiment strategy a product marketer has already approved.
You receive the approved decision (audience, channel, messaging angle, content type, hypothesis) and the strategy behind it (buyer role, job to be done, positioning, value proposition, competitive alternative). You never choose or change those choices; your job is execution.

Your job:
1. Plan the content: the audience insight it builds on, the content angle (the framing shift), topic, hook, headline, key message, supporting points, tone, CTA, format and a short brief.
2. Then write the content variant for the channel.

Rules:
- The plan must visibly test the approved hypothesis and messaging angle, speak to the audience's job to be done, and stay true to the positioning.
- Use product proof only as capabilities described in the brand context. Contrast with the competitive alternative (the status quo) without naming competitors.
- Write the approved format faithfully: a customer story describes an anonymized customer situation (for example, a finance team at a growing company) and what changed for them, without names, quotes or numbers; a product update explains what the product does; thought leadership argues a point of view; a how-to guide or checklist gives practical steps.
- Check previous content and do not reuse a topic or headline that was already tested for this audience.
- Follow the brand voice, proof rules and channel constraints. Never invent statistics, customer names, quotes or product features.
- Do not use numbers of any kind: no percentages, hours saved, durations, prices or offers. They are claims we cannot verify.
- Write for the priority audience only, and refer to that audience by its own name.
- Merge fields: only {first_name}, and only in email. Social posts and blog content are not personalized per contact.
- One clear CTA.

The generated content is shown as a preview of the real channel, so return it in parts:
- title: the email subject line; for LinkedIn and Facebook the headline of the linked article; for Instagram the short text shown on the image; for a blog the article title.
- previewText: the email's inbox preview text; for LinkedIn and Facebook a one-line description of the link; for a blog the standfirst under the title; for Instagram an empty string.
- paragraphs: the body as separate paragraphs. An email starts with the greeting "Hi {first_name},".
- ctaText: only the words on the button or link. Never write URLs, links or placeholders such as [Link]; the CTA is shown as a button.`;

export async function runContentAgent({ llm, profile, analytics, experiments, recommendation }) {
  const toolbox = contentToolbox({ profile, analytics, experiments, recommendation });
  const audience = getAudience(profile, recommendation.priorityAudience);
  const constraints = profile.content_constraints[recommendation.recommendedChannel];
  const strategy = profile.strategy ?? {};
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
          properties: { title: str, previewText: str, paragraphs: { type: "array", items: str }, ctaText: str },
          required: ["title", "previewText", "paragraphs", "ctaText"],
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
    const paragraphs = Array.isArray(gen.paragraphs) ? gen.paragraphs.map((p) => String(p ?? "").trim()).filter(Boolean) : [];
    if (!paragraphs.length || paragraphs.length > 8) errors.push("generatedContent.paragraphs must have 1 to 8 paragraphs");
    if (typeof gen.title !== "string" || gen.title.trim().length < 3) errors.push("generatedContent.title is missing");
    if (constraints?.subject_max_chars && String(gen.title ?? "").length > constraints.subject_max_chars) {
      errors.push(`The subject line must be ${constraints.subject_max_chars} characters or fewer`);
    }
    if (String(gen.previewText ?? "").length > 160) errors.push("generatedContent.previewText must be 160 characters or fewer");
    if (typeof gen.ctaText !== "string" || gen.ctaText.trim().length < 2 || gen.ctaText.length > 40) {
      errors.push("generatedContent.ctaText must be the button text only, 40 characters or fewer");
    }
    const body = paragraphs.join("\n\n");
    const words = body.split(/\s+/).filter(Boolean).length;
    if (words < 30) errors.push("generatedContent.paragraphs are too short");
    if (constraints?.max_words && words > Math.round(constraints.max_words * 1.3)) {
      errors.push(`generatedContent.paragraphs have ${words} words; the ${recommendation.recommendedChannel} limit is ${constraints.max_words}`);
    }
    const generated = [gen.title, gen.previewText, body, gen.ctaText].map((t) => String(t ?? "")).join("\n");
    if (/\[[^\]]*\]|https?:\/\/|www\./i.test(generated)) {
      errors.push("Remove links, URLs and placeholders such as [Link]: the CTA text is shown as a button");
    }
    for (const prior of previousTopics) {
      if (similarity(plan.topic, prior) >= 0.6 || similarity(plan.headline, prior) >= 0.6) {
        errors.push(`topic or headline is too close to previously tested content: "${prior}"`);
        break;
      }
    }
    const claimText = [plan.topic, plan.hook, plan.headline, plan.keyMessage, plan.cta, ...(plan.supportingPoints ?? []), generated];
    if (claimText.some((t) => /\d/.test(String(t ?? "")))) {
      errors.push("Remove every number (statistics, percentages, hours saved, durations, prices, offers): the proof rules forbid claims we cannot verify");
    }
    const mergeFields = generated.match(/\{+[^{}]*\}+/g) ?? [];
    if (mergeFields.some((f) => f !== "{first_name}")) errors.push("The only merge field allowed is {first_name}");
    if (recommendation.recommendedChannel !== "email" && mergeFields.length) {
      errors.push(`Remove merge fields: ${recommendation.recommendedChannel} content is not personalized per contact`);
    }
    const framing = [plan.audienceInsight, plan.topic, plan.headline, plan.hook, plan.keyMessage, gen.title].join(" ").toLowerCase();
    const misaddressed = profile.personas.find((p) => p.id !== audience.id && audienceNames(p).some((n) => framing.includes(n)));
    if (misaddressed) errors.push(`The content is framed for ${misaddressed.short_name}, but the target audience is ${audience.short_name}`);
    return errors;
  };

  const result = await runAgent({
    llm,
    system: SYSTEM,
    task: `Approved experiment strategy:
${JSON.stringify({
  company: profile.name,
  campaignObjective: `${analytics.objective.label} (judged on ${analytics.objective.metric.noun})`,
  funnelStage: analytics.objective.funnelStage,
  audience: `${audience.short_name} (${audience.id})`,
  buyerRole: audience.buying_role ?? null,
  jobToBeDone: audience.jtbd ?? null,
  channel: CHANNEL_LABELS[recommendation.recommendedChannel],
  messagingAngle: angleLabel(profile, recommendation.recommendedAngle),
  messageHypothesis: strategy.message_hypotheses?.[recommendation.recommendedAngle]?.hypothesis ?? null,
  contentType: contentTypeLabel(profile, recommendation.recommendedContentType),
  hypothesis: recommendation.hypothesis,
  whyThisTest: recommendation.reasoning,
  positioning: strategy.positioning ?? profile.brand_context?.positioning ?? null,
  valueProposition: strategy.value_proposition ?? null,
  competitiveAlternative: strategy.competitive_alternative ?? null,
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

// Plural and singular forms of an audience's name, e.g. "finance leaders" and "finance leader".
function audienceNames(persona) {
  const plural = persona.short_name.toLowerCase();
  return [plural, plural.replace(/(sses|ses)$/, (m) => m.slice(0, -2)).replace(/s$/, "")];
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
