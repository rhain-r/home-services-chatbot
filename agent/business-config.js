/**
 * Business configuration.
 *
 * Every value here fills a [PLACEHOLDER] in prompts/ACCRE_SYSTEM_PROMPT.md.
 * Change this file (and agent/knowledge-base.md) to point the concierge at
 * your own business. Nothing else needs to change.
 *
 * Works in the browser (agent/index.html) and in Node (agent/cli.mjs, tests).
 */

export const business = {
  // [BUSINESS_NAME]
  name: "Northwind Automation",
  // [AGENT_NAME]
  agentName: "Nova",
  // [INDUSTRY]
  industry: "AI automation and custom AI agent studio",
  // [BUSINESS_DESCRIPTION]
  description:
    "We design, build and run AI agents and workflow automations for small and mid-sized businesses that want to stop losing hours (and leads) to manual work.",
  // [PRIMARY_CTA]
  primaryCta: "book a free 20-minute Automation Audit call",
  // [SECONDARY_CTA]
  secondaryCta:
    "send them a short written recommendation by email and follow up in a week",
  // [BOOKING_URL]
  bookingUrl: "https://cal.com/northwind-automation/audit-call",
  // [SUPPORT_EMAIL]
  supportEmail: "hello@northwind-automation.example",
  // [BUSINESS_HOURS]
  businessHours: "Monday to Friday, 9:00 to 18:00 Eastern Time (UTC-5). Replies to messages sent outside hours go out the next business morning.",
  // [SERVICES_SUMMARY]
  servicesSummary:
    "AI website concierge agents; back-office workflow automation (CRM, email, scheduling, documents); AI Automation Audit (fixed-scope diagnostic); ongoing Automation Retainer.",
  // [IDEAL_CLIENT_PROFILE]
  idealClientProfile:
    "Service businesses and e-commerce brands with 5 to 100 staff, an existing flow of inbound leads or support requests, and at least one person who owns operations. Typical: agencies, clinics, law and accounting firms, home-services companies, DTC brands.",
  // [PRICING_POSTURE]
  pricingPosture:
    "Transparent tiered pricing published in the knowledge base; quotes are ranges, final scope is confirmed on the audit call.",
  // [MINIMUM_ENGAGEMENT]
  minimumEngagement: "$2,500 (the Automation Audit)",
  // [DIFFERENTIATORS]
  differentiators:
    "Fixed-scope audit before anyone commits to a build; every agent ships with human-in-the-loop approval gates; we run and monitor what we build rather than hand over a zip file; 30-day tuning period included on every build.",
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
