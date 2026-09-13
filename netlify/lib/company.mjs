// Shared company data for the live demo: profiles and sample contacts from the Python project
// (one source of truth), plus labels for channels and campaign objectives.

import ramp from "../../ai-content-pipeline/examples/ramp.json" with { type: "json" };
import square from "../../ai-content-pipeline/examples/square.json" with { type: "json" };
import contactBook from "../../ai-content-pipeline/data/contacts.json" with { type: "json" };

export const PROFILES = { ramp, square };
export const CONTACTS = contactBook;

export const CHANNEL_LABELS = {
  email: "Email",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  blog: "Blog",
};

// `favors` is guidance for the Marketing Agent, not a rule it must follow.
export const OBJECTIVES = {
  awareness: {
    label: "Awareness",
    favors: "volume",
    guidance: "Reach and total clicks matter most; a lower CTR is acceptable if the channel reaches far more of the audience.",
  },
  traffic: {
    label: "Traffic",
    favors: "volume",
    guidance: "Maximize clicks to the content; weigh expected click volume above CTR.",
  },
  engagement: {
    label: "Engagement",
    favors: "efficiency",
    guidance: "Favor the combinations that get the strongest response rate from the audience.",
  },
  product_consideration: {
    label: "Product consideration",
    favors: "efficiency",
    guidance: "Favor messages and channels with strong response from high-intent audiences; volume is secondary.",
  },
  conversion: {
    label: "Conversion",
    favors: "efficiency",
    guidance: "Favor the highest-CTR combinations with enough evidence to trust them; avoid unproven bets.",
  },
};

export function getAudience(profile, audienceId) {
  return profile.personas.find((p) => p.id === audienceId);
}

export function angleLabel(profile, id) {
  return profile.messaging_angles.find((a) => a.id === id)?.label ?? id;
}

export function contentTypeLabel(profile, id) {
  return profile.content_types.find((t) => t.id === id)?.label ?? id;
}
