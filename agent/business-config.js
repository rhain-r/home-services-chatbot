/**
 * Business configuration.
 *
 * Every value here fills a [PLACEHOLDER] in prompts/ACCRE_SYSTEM_PROMPT.md.
 * Change this file (and agent/knowledge-base.md) to point the concierge at
 * your own business. Nothing else needs to change.
 *
 * The sample business is a fictional home-services company. Phone numbers,
 * emails and links are placeholders.
 */

export const business = {
  // [BUSINESS_NAME]
  name: "Summit Heating, Air & Roofing",
  shortName: "Summit",
  // [AGENT_NAME]
  agentName: "Riley",
  // [INDUSTRY]
  industry: "residential HVAC and roofing (home services)",
  // [BUSINESS_DESCRIPTION]
  description:
    "Family-owned since 2009, we repair, maintain and replace heating and cooling systems and roofs for homeowners across the Denver metro area, with 24/7 emergency service.",
  // [PRIMARY_CTA]
  primaryCta: "book a service call or a free in-home estimate",
  // [SECONDARY_CTA]
  secondaryCta: "text or email them the relevant pricing sheet and have the office follow up",
  // [BOOKING_URL]
  bookingUrl: "https://cal.com/summit-hvac/book",
  // [SUPPORT_EMAIL]
  supportEmail: "hello@summit-hvac.example",
  phone: "(303) 555-0148",
  address: "4120 Brighton Blvd, Denver, CO 80216",
  // [BUSINESS_HOURS]
  businessHours:
    "Office and scheduling: Monday to Saturday, 7:00 to 19:00 Mountain Time. Emergency repairs: 24 hours a day, 7 days a week, including holidays.",
  // [SERVICES_SUMMARY]
  servicesSummary:
    "AC and furnace repair (same-day in most cases); heat pump, AC and furnace installation with financing; Comfort Club maintenance plan; roof repair, replacement and storm-damage inspections; 24/7 emergency service.",
  // [IDEAL_CLIENT_PROFILE]
  idealClientProfile:
    "Homeowners (and property managers with authority to approve work) in the Denver metro service area who need a repair now, want a system or roof replaced, or want to prevent breakdowns with a maintenance plan.",
  // [PRICING_POSTURE]
  pricingPosture:
    "Transparent flat-rate pricing: diagnostic and tune-up fees are fixed and published; repair quotes are given after diagnosis and before any work starts; replacements and roofing get a free in-home estimate. Ranges in the knowledge base are typical, not quotes.",
  // [MINIMUM_ENGAGEMENT]
  minimumEngagement: "$89 diagnostic visit (waived if the repair is approved the same visit)",
  // [DIFFERENTIATORS]
  differentiators:
    "Same-day service in most cases and true 24/7 emergency dispatch; flat-rate quotes before work starts, never hourly surprises; NATE-certified, background-checked technicians; 1-year labor warranty on every repair; one company for HVAC and roofing, so storm damage gets one visit, not three.",
};

/**
 * Map of [PLACEHOLDER] -> value used by buildSystemPrompt().
 * [KNOWLEDGE_BASE] and [CURRENT_DATE] are supplied at build time.
 */
export function placeholderValues(config = business) {
  return {
    BUSINESS_NAME: config.name,
    AGENT_NAME: config.agentName,
    INDUSTRY: config.industry,
    BUSINESS_DESCRIPTION: config.description,
    PRIMARY_CTA: config.primaryCta,
    SECONDARY_CTA: config.secondaryCta,
    BOOKING_URL: config.bookingUrl,
    SUPPORT_EMAIL: config.supportEmail,
    BUSINESS_HOURS: config.businessHours,
    SERVICES_SUMMARY: config.servicesSummary,
    IDEAL_CLIENT_PROFILE: config.idealClientProfile,
    PRICING_POSTURE: config.pricingPosture,
    MINIMUM_ENGAGEMENT: config.minimumEngagement,
    DIFFERENTIATORS: config.differentiators,
  };
}
