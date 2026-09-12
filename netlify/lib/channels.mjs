// Channel mix per audience for the live demo.
//
// Email runs through the HubSpot CRM step (engagement simulated). LinkedIn, Instagram, Facebook
// and blog figures are SAMPLE DATA standing in for HubSpot Social (Marketing Hub Professional)
// and HubSpot website analytics. Baselines are illustrative, not real company figures.

export const CHANNELS = {
  email: { label: "Email" },
  linkedin: { label: "LinkedIn", source: "sample data · HubSpot Social" },
  instagram: { label: "Instagram", source: "sample data · HubSpot Social" },
  facebook: { label: "Facebook", source: "sample data · HubSpot Social" },
  blog: { label: "Blog", source: "sample data · HubSpot website analytics" },
};

// reach: people reached per run; rate: engagement rate (social interactions, blog CTA clicks).
export const CHANNEL_MIX = {
  ramp: {
    finance_leader: {
      next_topic: "From expense reports to real-time spend visibility: a finance leader's playbook",
      channels: { linkedin: { reach: 1800, rate: 0.021 }, blog: { reach: 640, rate: 0.048 } },
    },
    controller: {
      next_topic: "Month-end close in days, not weeks: what to automate first",
      channels: { linkedin: { reach: 1200, rate: 0.017 }, blog: { reach: 520, rate: 0.061 } },
    },
    employee_spender: {
      next_topic: "Card policies that employees actually follow",
      channels: { blog: { reach: 2100, rate: 0.022 } },
    },
  },
  square: {
    new_seller: {
      next_topic: "Taking your first payments: a no-overwhelm setup guide",
      channels: { instagram: { reach: 5200, rate: 0.038 }, facebook: { reach: 3400, rate: 0.027 } },
    },
    growing_business: {
      next_topic: "Selling in person and online from one catalog",
      channels: { instagram: { reach: 2600, rate: 0.044 }, blog: { reach: 900, rate: 0.057 } },
    },
    multi_location: {
      next_topic: "Opening a second location without losing control",
      channels: { linkedin: { reach: 700, rate: 0.026 }, facebook: { reach: 1100, rate: 0.019 } },
    },
  },
};
