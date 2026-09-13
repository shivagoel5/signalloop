// Hidden simulation model. SIMULATED, illustrative values only, not real company or market data.
//
// The simulator uses these to decide how people respond; the analytics engine and both agents never see them.
// They only see measured results, so the agents have to learn what works from experiments, the way a marketer would.
//
//   clicks          base × channelFit × angleFit × typeFit (worn down when a message is repeated)
//   engagements     click probability × engage[channel]            (social earns more light engagement)
//   qualifiedViews  qualified[channel] × view[channel] × attention  (share of reach in the ICP who view most of it)
//   highIntent      clicks × intent[channel] × INTENT_BY_TYPE × INTENT_BY_ANGLE  (go on to product or proof pages)
//   conversions     high-intent visits × convert[channel]           (request a demo or sign up)
//   reach           addressable[channel] × share of the audience allocated to the cell
//
// The trade-offs are deliberate: email reaches fewer people but brings higher intent, social reaches far more
// people with lower intent, Controllers click readily but convert less than Finance Leaders, and the lead
// positioning message pulls more high-intent visits than its click rate alone suggests.

export const TRUTH = {
  ramp: {
    finance_leader: {
      base: 0.06,
      addressable: { email: 2600, linkedin: 14000, blog: 5000 },
      channelFit: { email: 1.6, linkedin: 1.0, blog: 0.9 },
      angleFit: { cost_control: 0.9, real_time_visibility: 1.35, time_savings: 0.85, policy_compliance: 0.8 },
      typeFit: { thought_leadership: 1.15, how_to_guide: 0.9, customer_story: 1.05, product_update: 0.8 },
      engage: { email: 1.2, linkedin: 2.6, blog: 1.5 },
      qualified: { email: 0.9, linkedin: 0.5, blog: 0.3 },
      view: { email: 0.35, linkedin: 0.18, blog: 0.4 },
      intent: { email: 0.35, linkedin: 0.18, blog: 0.25 },
      convert: { email: 0.4, linkedin: 0.2, blog: 0.22 },
    },
    controller: {
      base: 0.055,
      addressable: { email: 2400, linkedin: 9000, blog: 4500 },
      channelFit: { email: 1.5, linkedin: 0.8, blog: 1.2 },
      angleFit: { cost_control: 0.9, real_time_visibility: 1.0, time_savings: 1.3, policy_compliance: 0.85 },
      typeFit: { thought_leadership: 0.9, how_to_guide: 1.25, customer_story: 1.0, product_update: 1.05 },
      engage: { email: 1.2, linkedin: 2.6, blog: 1.4 },
      qualified: { email: 0.9, linkedin: 0.45, blog: 0.35 },
      view: { email: 0.35, linkedin: 0.18, blog: 0.4 },
      intent: { email: 0.16, linkedin: 0.09, blog: 0.14 },
      convert: { email: 0.12, linkedin: 0.06, blog: 0.08 },
    },
    employee_spender: {
      base: 0.03,
      addressable: { email: 9000, blog: 16000 },
      channelFit: { email: 1.3, blog: 1.0 },
      angleFit: { cost_control: 0.7, real_time_visibility: 0.8, time_savings: 1.3, policy_compliance: 1.0 },
      typeFit: { thought_leadership: 0.85, how_to_guide: 1.3, customer_story: 0.95, product_update: 0.9 },
      engage: { email: 1.1, blog: 1.4 },
      qualified: { email: 0.4, blog: 0.2 },
      view: { email: 0.3, blog: 0.35 },
      intent: { email: 0.08, blog: 0.06 },
      convert: { email: 0.05, blog: 0.03 },
    },
  },
  square: {
    new_seller: {
      base: 0.035,
      addressable: { email: 6000, instagram: 30000, facebook: 20000 },
      channelFit: { email: 0.9, instagram: 1.3, facebook: 1.0 },
      angleFit: { ease_of_setup: 1.3, sell_everywhere: 1.0, grow_revenue: 0.9, run_operations: 0.6 },
      typeFit: { how_to_guide: 1.2, customer_story: 1.1, checklist: 1.25, product_update: 0.8 },
      engage: { email: 1.1, instagram: 3.0, facebook: 2.2 },
      qualified: { email: 0.7, instagram: 0.25, facebook: 0.3 },
      view: { email: 0.3, instagram: 0.2, facebook: 0.15 },
      intent: { email: 0.2, instagram: 0.1, facebook: 0.12 },
      convert: { email: 0.2, instagram: 0.1, facebook: 0.12 },
    },
    growing_business: {
      base: 0.05,
      addressable: { email: 3000, instagram: 13000, blog: 4500 },
      channelFit: { email: 1.4, instagram: 1.0, blog: 1.1 },
      angleFit: { ease_of_setup: 0.8, sell_everywhere: 1.35, grow_revenue: 1.15, run_operations: 0.9 },
      typeFit: { how_to_guide: 1.1, customer_story: 1.3, checklist: 1.0, product_update: 0.9 },
      engage: { email: 1.2, instagram: 2.8, blog: 1.5 },
      qualified: { email: 0.85, instagram: 0.35, blog: 0.4 },
      view: { email: 0.35, instagram: 0.2, blog: 0.4 },
      intent: { email: 0.3, instagram: 0.15, blog: 0.25 },
      convert: { email: 0.3, instagram: 0.12, blog: 0.18 },
    },
    multi_location: {
      base: 0.045,
      addressable: { email: 1500, linkedin: 3500, facebook: 5500 },
      channelFit: { email: 1.1, linkedin: 1.0, facebook: 0.95 },
      angleFit: { ease_of_setup: 0.7, sell_everywhere: 1.0, grow_revenue: 1.1, run_operations: 1.3 },
      typeFit: { how_to_guide: 1.0, customer_story: 1.05, checklist: 1.1, product_update: 1.2 },
      engage: { email: 1.1, linkedin: 2.2, facebook: 2.0 },
      qualified: { email: 0.9, linkedin: 0.55, facebook: 0.3 },
      view: { email: 0.35, linkedin: 0.16, facebook: 0.12 },
      intent: { email: 0.35, linkedin: 0.22, facebook: 0.12 },
      convert: { email: 0.3, linkedin: 0.18, facebook: 0.08 },
    },
  },
};

// Proof-heavy formats send more visitors on to product and proof pages.
export const INTENT_BY_TYPE = {
  ramp: { thought_leadership: 0.8, how_to_guide: 0.9, customer_story: 1.35, product_update: 1.25 },
  square: { how_to_guide: 0.95, customer_story: 1.3, checklist: 0.85, product_update: 1.3 },
};

// Messages close to the lead positioning hypothesis create more buying intent per click.
export const INTENT_BY_ANGLE = {
  ramp: { real_time_visibility: 1.3, cost_control: 1.0, time_savings: 0.8, policy_compliance: 0.85 },
  square: { sell_everywhere: 1.25, grow_revenue: 1.1, ease_of_setup: 0.9, run_operations: 1.0 },
};
