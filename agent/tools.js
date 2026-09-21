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
  "emergency",
  "visitor_requested",
];

const str = (description, extra = {}) => ({ type: "string", description, ...extra });

export const TOOLS = [
  {
    name: "update_lead_profile",
    description:
      "Internal CRM notes. Record a NEW qualification fact about the visitor (need, role, company, location, timeline, budget range, temperature, objection). Silent: never mention it to the visitor. Do not call with nothing new.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        need: str("The problem or goal, in the visitor's own words. Under 200 characters."),
        role: str("The visitor's role or decision authority, e.g. 'owner, sole decision-maker' or 'ops manager, reports to COO'."),
        company: str("Company name and/or type and size if shared."),
        location: str("Where they are: city, ZIP or address, if shared. Use it to check the service area."),
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
        phone: str("Phone number, if they offered it, prefer calls, or the knowledge base requires it for the next step."),
        company: str("Company name, if shared."),
        location: str("City, ZIP or address, if shared."),
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
      "Book an appointment in two steps. Step 1: call without selected_window once the visitor agrees to book and you have their details; the result lists available_windows (and a booking_url fallback). Present the windows. Step 2: when the visitor picks one, call again with the same details plus selected_window; only a result with confirmed:true means it is booked. Never for disqualified leads.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        meeting_type: str("Meeting type name exactly as listed in the knowledge base, e.g. 'Service call' or 'Free estimate'."),
        prospect_name: str("Visitor's name."),
        email: str("Visitor's email address, if given. At least one of email or phone is required."),
        phone: str("Visitor's phone number, if given. At least one of email or phone is required; follow the knowledge base on which the business needs."),
        company: str("Company name, if shared."),
        location: str("City, ZIP or address, if the knowledge base requires it for booking."),
        purpose: str("One line the human will read before the call: who they are and what they want."),
        preferred_times: str("Any stated preference, e.g. 'mornings next week'."),
        timezone: str("Visitor's timezone if stated, e.g. 'America/Chicago' or 'UK time'."),
        selected_window: str("Step 2 only: the id of the window the visitor chose, exactly as returned in available_windows."),
      },
      required: ["meeting_type", "prospect_name", "purpose"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Route the conversation to a person: support issues, complaints, enterprise requirements, sensitive matters, emergencies that need immediate human dispatch, blocking questions you cannot answer, or when the visitor asks for a human.",
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
  if (name === "trigger_calendar") {
    if (typeof input.email === "string" && input.email && !EMAIL_RE.test(input.email.trim())) {
      errors.push("email does not look valid; ask the visitor to check it");
    }
    if (!input.email && !input.phone) errors.push("provide at least one contact: email or phone");
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

/**
 * Next arrival windows (2-hour slots inside Mon-Sat 07:00-19:00), starting a
 * few hours from now. In production this comes from the real calendar; the
 * shape { id, label, start } is what the model and the UI rely on.
 */
export function availableWindows(now = new Date(), count = 4) {
  const out = [];
  const t = new Date(now);
  t.setMinutes(0, 0, 0);
  t.setHours(t.getHours() + 3);                 // earliest start: about three hours out
  if (t.getHours() % 2 === 0) t.setHours(t.getHours() + 1); // windows start on odd hours: 7, 9, ... 17
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const fmt = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
  while (out.length < count) {
    const day = t.getDay(), hour = t.getHours();
    if (day === 0 || hour > 17) { t.setDate(t.getDate() + 1); t.setHours(7, 0, 0, 0); continue; }
    if (hour < 7) { t.setHours(7, 0, 0, 0); continue; }
    const start = new Date(t);
    const end = new Date(t); end.setHours(end.getHours() + 2);
    const dayLabel = start.toDateString() === now.toDateString() ? "Today"
      : start.toDateString() === tomorrow.toDateString() ? "Tomorrow"
      : start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    out.push({
      id: `w${start.getMonth() + 1}-${start.getDate()}-${start.getHours()}`,
      label: `${dayLabel} ${fmt(start)}–${fmt(end)}`,
      start: start.toISOString(),
    });
    t.setHours(t.getHours() + 2);
  }
  return out;
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
export function createToolExecutor({ business, integrations = {}, hooks = {}, clock = () => new Date() }) {
  const profile = {};
  const windowsNow = () => availableWindows(clock());

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

      // Step 2: the visitor chose a window -> confirm it.
      if (input.selected_window) {
        const window = windowsNow().find((w) => w.id === input.selected_window);
        if (!window) {
          return { ok: false, error: "That window is no longer available; offer the current available_windows again.", available_windows: windowsNow() };
        }
        const booking = { booking_id: newId("book"), confirmed_at: new Date().toISOString(), status: "confirmed", ...input, window, booking_url };
        hooks.onCalendar?.(booking);
        return {
          ok: true,
          confirmed: true,
          booking_id: booking.booking_id,
          meeting_type: input.meeting_type,
          window,
          confirmation_sent_to: [input.phone, input.email].filter(Boolean),
          instructions: "Booked. Tell the visitor the window and where the confirmation went. The technician texts 30 minutes before arrival.",
        };
      }

      // Step 1: offer windows.
      const windows = windowsNow();
      hooks.onCalendar?.({ booking_id: null, status: "offered", requested_at: new Date().toISOString(), ...input, booking_url, windows });
      return {
        ok: true,
        confirmed: false,
        meeting_type: input.meeting_type,
        available_windows: windows,
        booking_url,
        instructions: "Present available_windows as choices (label only). When the visitor picks one, call trigger_calendar again with selected_window set to its id. Do not say it is booked until then.",
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
