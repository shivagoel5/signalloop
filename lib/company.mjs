// Shared company data: the company profiles (audiences, channels, messaging angles, content types, PMM strategy
// context, brand rules) and fictional sample contacts, plus labels for channels, response signals and objectives.

import ramp from "../data/companies/ramp.json" with { type: "json" };
import square from "../data/companies/square.json" with { type: "json" };
import contactBook from "../data/contacts.json" with { type: "json" };

export const PROFILES = { ramp, square };
export const CONTACTS = contactBook;

export const CHANNEL_LABELS = {
  email: "Email",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  blog: "Blog",
};

// The simulated response signals. Each counts people out of those reached, so every rate shares one denominator.
export const METRICS = {
  qualifiedViews: { label: "Qualified reach rate", noun: "qualified reach rate", event: "qualified views", definition: "people in the ICP who viewed most of the content" },
  engagements: { label: "Engagement rate", noun: "engagement rate", event: "engagements", definition: "people who reacted, replied, shared or read to the end" },
  clicks: { label: "CTR", noun: "CTR", event: "clicks", definition: "people who clicked through to the content" },
  highIntent: { label: "High-intent rate", noun: "high-intent rate", event: "high-intent visits", definition: "people who went on to a product or proof page, such as pricing, a product tour or a customer story" },
  conversions: { label: "Conversion rate", noun: "conversion rate", event: "conversions", definition: "people who requested a demo or signed up" },
};

// Each objective is judged on its own primary signal. `favors` tells the Marketing Agent whether total volume or
// response rate matters more (guidance, not a rule); `funnelStage` is where the buyer is.
export const OBJECTIVES = {
  awareness: {
    label: "Awareness",
    primaryMetric: "qualifiedViews",
    favors: "volume",
    funnelStage: "Problem-aware: recognizes the pain, not yet looking for a solution",
    guidance: "Grow the number of ICP-fit people who notice the message. Total qualified reach matters more than response rate; a lower rate is acceptable on a channel that reaches far more of the ICP.",
  },
  engagement: {
    label: "Engagement",
    primaryMetric: "engagements",
    favors: "efficiency",
    funnelStage: "Problem-aware: open to a point of view",
    guidance: "Favor the messages and channels that earn the strongest active response from the audience.",
  },
  traffic: {
    label: "Traffic",
    primaryMetric: "clicks",
    favors: "volume",
    funnelStage: "Exploring: looking for ways to solve the problem",
    guidance: "Drive visits to the content. CTR shows how well a message pulls; expected clicks per experiment show which channel delivers the traffic.",
  },
  product_consideration: {
    label: "Product consideration",
    primaryMetric: "highIntent",
    favors: "efficiency",
    funnelStage: "Evaluating: comparing solutions",
    guidance: "Move buying audiences to product and proof content. Favor high-intent response from the audiences that buy; clicks that stop at the article are secondary.",
  },
  conversion: {
    label: "Conversion",
    primaryMetric: "conversions",
    favors: "efficiency",
    funnelStage: "Deciding: ready to talk to sales or try the product",
    guidance: "Favor demo requests and sign-ups from buying audiences, with enough evidence to trust. Avoid unproven bets, and weigh whether a channel can produce enough conversions to learn anything.",
  },
};

// An objective with its primary signal spelled out, for analytics, agents and the page.
export function objectiveView(id) {
  const o = OBJECTIVES[id];
  return { id, ...o, metric: { id: o.primaryMetric, ...METRICS[o.primaryMetric] } };
}

export function getAudience(profile, audienceId) {
  return profile.personas.find((p) => p.id === audienceId);
}

export function angleLabel(profile, id) {
  return profile.messaging_angles.find((a) => a.id === id)?.label ?? id;
}

export function contentTypeLabel(profile, id) {
  return profile.content_types.find((t) => t.id === id)?.label ?? id;
}
