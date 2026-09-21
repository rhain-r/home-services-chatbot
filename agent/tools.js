/**
 * Tool definitions and executors for the ACCRE concierge.
 *
 * `TOOLS` is the exact array sent to the Claude API. The system prompt refers
 * to these four actions by name; the model calls them with native tool use.
 *
 * Executors are side-effect boundaries. In the browser demo they write to an
 * in-page inbox; with LEAD_WEBHOOK_URL / HANDOFF_WEBHOOK_URL configured they
 * POST JSON to your CRM, Zapier, Make, n8n or Slack.
 */

export const TEMPERATURES = ["hot", "warm", "cold", "disqualified", "unknown"];
export const ESCALATION_REASONS = [
  "support",
  "complaint",
  "enterprise",
  "unanswered_question",
  "sensitive",
  "visitor_requested",
];

const str = (description, extra = {}) => ({ type: "string", description, ...extra });

export const TOOLS = [
  {
    name: "update_lead_profile",
    description:
      "Internal CRM notes. Record a NEW qualification fact about the visitor (need, role, company, timeline, budget range, temperature, objection). Silent: never mention it to the visitor. Do not call with nothing new.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        need: str("The problem or goal, in the visitor's own words. Under 200 characters."),
        role: str("The visitor's role or decision authority, e.g. 'owner, sole decision-maker' or 'ops manager, reports to COO'."),
        company: str("Company name and/or type and size if shared."),
        timeline: str("When they want this solved, and any trigger event."),
        budget_range: str("Budget signal, as a range or a stated ceiling."),
        temperature: str("Current lead temperature.", { enum: TEMPERATURES }),
        objection: str("A notable objection raised, if any."),
        notes: str("Any other short, factual note. Under 200 characters."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "capture_lead",
    description:
      "Send a lead to the business's CRM / inbox. Only after the visitor explicitly agreed to be contacted or to receive something. Requires a real-looking email. Call at most once per visitor unless they give new information.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        name: str("Visitor's name."),
        email: str("Visitor's email address, exactly as they gave it."),
        phone: str("Phone number, only if they offered it or prefer calls."),
        company: str("Company name, if shared."),
        need_summary: str("One or two sentences describing what they need, in their words."),
        budget_range: str("Budget signal, if shared."),
        timeline: str("Timeline, if shared."),
        temperature: str("Lead temperature at time of capture.", { enum: TEMPERATURES }),
        lead_type: str("What kind of contact this is.", {
          enum: ["prospect", "existing_client", "partner", "other"],
        }),
        recommended_offer: str("The service or tier you recommended, if any."),
        notes: str("Anything the human should know before following up. Under 300 characters."),
        consent: {
          type: "boolean",
          description:
            "True only if the visitor explicitly agreed in this conversation to be contacted or to receive something.",
        },
      },
      required: ["name", "email", "need_summary", "temperature", "consent"],
      additionalProperties: false,
    },
  },
  {
    name: "trigger_calendar",
    description:
      "Open the booking flow so the visitor can pick a meeting slot. Only after they agreed to book. Never for disqualified leads. The result contains the booking link to present; do not claim the meeting is confirmed.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        meeting_type: str("Meeting type name from the knowledge base, e.g. 'Automation Audit call'."),
        prospect_name: str("Visitor's name."),
        email: str("Visitor's email address."),
        company: str("Company name, if shared."),
        purpose: str("One line the human will read before the call: who they are and what they want."),
        preferred_times: str("Any stated preference, e.g. 'mornings next week'."),
        timezone: str("Visitor's timezone if stated, e.g. 'America/Chicago' or 'UK time'."),
      },
      required: ["meeting_type", "prospect_name", "email", "purpose"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Route the conversation to a person: support issues, complaints, enterprise requirements, sensitive matters, blocking questions you cannot answer, or when the visitor asks for a human.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        reason: str("Why a human is needed.", { enum: ESCALATION_REASONS }),
        summary: str("Two or three sentences a human can act on without reading the transcript."),
        urgency: str("How urgent.", { enum: ["low", "normal", "high"] }),
        name: str("Visitor's name, if known."),
        email: str("Visitor's email, if known."),
        phone: str("Visitor's phone, if offered."),
        preferred_channel: str("How they prefer to be reached.", {
          enum: ["email", "phone", "chat"],
        }),
      },
      required: ["reason", "summary", "urgency"],
      additionalProperties: false,
    },
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

// ─── Validation ──────────────────────────────────────────────────────────────
// With eager_input_streaming the API no longer validates tool input, so we do.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validate `input` against a tool's JSON schema (the subset we use: object with
 * string/boolean properties, enums, required, additionalProperties:false).
 * Returns { ok: true, value } or { ok: false, errors: string[] }.
 */
export function validateToolInput(name, input) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, errors: [`unknown tool: ${name}`] };
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["input must be an object"] };
  }

  const errors = [];
  const { properties, required = [] } = tool.input_schema;

  for (const key of required) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      errors.push(`missing required field: ${key}`);
    }
  }
  for (const [key, value] of Object.entries(input)) {
    const spec = properties[key];
    if (!spec) {
      errors.push(`unexpected field: ${key}`);
      continue;
    }
    if (value === undefined || value === null) continue;
    if (typeof value !== spec.type) {
      errors.push(`${key} must be a ${spec.type}`);
      continue;
    }
    if (spec.enum && !spec.enum.includes(value)) {
      errors.push(`${key} must be one of: ${spec.enum.join(", ")}`);
    }
  }

  // Tool-specific business rules the schema cannot express.
  if (name === "capture_lead") {
    if (input.consent !== true) errors.push("consent must be true; ask the visitor first");
    if (typeof input.email === "string" && !EMAIL_RE.test(input.email.trim())) {
      errors.push("email does not look valid; ask the visitor to check it");
    }
  }
  if (name === "trigger_calendar" && typeof input.email === "string" && !EMAIL_RE.test(input.email.trim())) {
    errors.push("email does not look valid; ask the visitor to check it");
  }
  if (name === "update_lead_profile") {
    const meaningful = Object.keys(input).filter((k) => k !== "temperature" && input[k]);
    if (meaningful.length === 0 && !input.temperature) {
      errors.push("provide at least one field");
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: input };
}

// ─── Execution ───────────────────────────────────────────────────────────────

function newId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

async function postJson(url, payload, secret) {
  const headers = { "Content-Type": "application/json" };
  if (secret) headers["X-Webhook-Secret"] = secret;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  return res;
}

/** Append prefill params to a Cal.com / Calendly style booking URL. */
export function bookingLinkFor(baseUrl, { name, email }) {
  try {
    const url = new URL(baseUrl);
    if (name) url.searchParams.set("name", name);
    if (email) url.searchParams.set("email", email);
    return url.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * Create an executor bound to a business config and optional integrations.
 *
 * @param {object} options
 * @param {object} options.business         - from business-config.js
 * @param {object} [options.integrations]   - { leadWebhookUrl, handoffWebhookUrl, webhookSecret }
 * @param {object} [options.hooks]          - UI callbacks: onProfileUpdate(profile), onLeadCaptured(lead), onHandoff(ticket)
 * @returns {(name: string, input: object) => Promise<object>} execute
 */
export function createToolExecutor({ business, integrations = {}, hooks = {} }) {
  const profile = {};

  const handlers = {
    async update_lead_profile(input) {
      for (const [k, v] of Object.entries(input)) if (v) profile[k] = v;
      profile.updated_at = new Date().toISOString();
      hooks.onProfileUpdate?.({ ...profile });
      return { ok: true, profile: { ...profile } };
    },

    async capture_lead(input) {
      const lead = {
        lead_id: newId("lead"),
        captured_at: new Date().toISOString(),
        source: "website_concierge",
        ...input,
        profile_snapshot: { ...profile },
      };
      let delivered_to = "local_inbox";
      if (integrations.leadWebhookUrl) {
        await postJson(integrations.leadWebhookUrl, { event: "lead.captured", lead }, integrations.webhookSecret);
        delivered_to = "crm_webhook";
      }
      hooks.onLeadCaptured?.(lead);
      return {
        ok: true,
        lead_id: lead.lead_id,
        delivered_to,
        next_step: "Tell the visitor what they will receive and roughly when, based on business hours.",
      };
    },

    async trigger_calendar(input) {
      const booking_url = bookingLinkFor(business.bookingUrl, {
        name: input.prospect_name,
        email: input.email,
      });
      const booking = { booking_id: newId("book"), requested_at: new Date().toISOString(), ...input, booking_url };
      hooks.onCalendar?.(booking);
      return {
        ok: true,
        booking_url,
        meeting_type: input.meeting_type,
        instructions:
          "Present booking_url to the visitor. Availability is shown on the calendar itself. Do not say the meeting is confirmed.",
      };
    },

    async escalate_to_human(input) {
      const ticket = {
        ticket_id: newId("hand"),
        created_at: new Date().toISOString(),
        ...input,
        profile_snapshot: { ...profile },
      };
      let delivered_to = "local_inbox";
      if (integrations.handoffWebhookUrl) {
        await postJson(integrations.handoffWebhookUrl, { event: "handoff.requested", ticket }, integrations.webhookSecret);
        delivered_to = "handoff_webhook";
      }
      hooks.onHandoff?.(ticket);
      return {
        ok: true,
        ticket_id: ticket.ticket_id,
        delivered_to,
        fallback_email: business.supportEmail,
        business_hours: business.businessHours,
      };
    },
  };

  return async function execute(name, input) {
    const handler = handlers[name];
    if (!handler) return { ok: false, error: `unknown tool: ${name}` };
    try {
      return await handler(input);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        fallback: `Give the visitor ${business.supportEmail} or ${business.bookingUrl} and continue.`,
      };
    }
  };
}
