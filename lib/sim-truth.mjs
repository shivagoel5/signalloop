// Hidden simulation model. SIMULATED, illustrative values only, not real company or market data.
//
// The simulator uses these to decide how many people click; the analytics engine and both agents
// never see them. They only see measured reach and clicks, so the agents have to learn what works
// from experiments, the way a marketer would.
//
//   clickProbability = base × channelFit × angleFit × typeFit
//   reach            = addressable[channel] × share of the audience allocated to the cell
//
// `addressable` is the sample in-market audience a channel can reach: email is limited to CRM
// contacts in the segment, social and blog reach a wider pool of people in that role or stage.

export const TRUTH = {
  ramp: {
    finance_leader: {
      base: 0.06,
      addressable: { email: 260, linkedin: 1400, blog: 500 },
      channelFit: { email: 1.6, linkedin: 1.0, blog: 0.9 },
      angleFit: { cost_control: 0.9, real_time_visibility: 1.35, time_savings: 0.85, policy_compliance: 0.8 },
      typeFit: { thought_leadership: 1.15, how_to_guide: 0.9, customer_story: 1.05, product_update: 0.8 },
    },
    controller: {
      base: 0.055,
      addressable: { email: 240, linkedin: 900, blog: 450 },
      channelFit: { email: 1.5, linkedin: 0.8, blog: 1.2 },
      angleFit: { cost_control: 0.9, real_time_visibility: 1.0, time_savings: 1.3, policy_compliance: 0.85 },
      typeFit: { thought_leadership: 0.9, how_to_guide: 1.25, customer_story: 1.0, product_update: 1.05 },
    },
    employee_spender: {
      base: 0.03,
      addressable: { email: 900, blog: 1600 },
      channelFit: { email: 1.3, blog: 1.0 },
      angleFit: { cost_control: 0.7, real_time_visibility: 0.8, time_savings: 1.3, policy_compliance: 1.0 },
      typeFit: { thought_leadership: 0.85, how_to_guide: 1.3, customer_story: 0.95, product_update: 0.9 },
    },
  },
  square: {
    new_seller: {
      base: 0.035,
      addressable: { email: 1200, instagram: 6000, facebook: 4000 },
      channelFit: { email: 0.9, instagram: 1.3, facebook: 1.0 },
      angleFit: { ease_of_setup: 1.3, sell_everywhere: 1.0, grow_revenue: 0.9, run_operations: 0.6 },
      typeFit: { how_to_guide: 1.2, customer_story: 1.1, checklist: 1.25, product_update: 0.8 },
    },
    growing_business: {
      base: 0.05,
      addressable: { email: 600, instagram: 2600, blog: 900 },
      channelFit: { email: 1.4, instagram: 1.0, blog: 1.1 },
      angleFit: { ease_of_setup: 0.8, sell_everywhere: 1.35, grow_revenue: 1.15, run_operations: 0.9 },
      typeFit: { how_to_guide: 1.1, customer_story: 1.3, checklist: 1.0, product_update: 0.9 },
    },
    multi_location: {
      base: 0.045,
      addressable: { email: 300, linkedin: 700, facebook: 1100 },
      channelFit: { email: 1.1, linkedin: 1.0, facebook: 0.95 },
      angleFit: { ease_of_setup: 0.7, sell_everywhere: 1.0, grow_revenue: 1.1, run_operations: 1.3 },
      typeFit: { how_to_guide: 1.0, customer_story: 1.05, checklist: 1.1, product_update: 1.2 },
    },
  },
};
