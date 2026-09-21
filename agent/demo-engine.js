/**
 * Demo engine — a deterministic, scripted concierge that needs no API key.
 *
 * It walks the same stages the ACCRE system prompt defines (triage -> discover
 * -> qualify -> recommend -> convert / hand off), handles the same objections,
 * and fires the same four tools through the real executor in tools.js, so the
 * business dashboard behaves exactly as it does with the live runtime.
 *
 * Scripted for the sample business (a Denver HVAC + roofing company). Exposes
 * the same interface as createAgent(): send(), reset(), plus suggestions().
 *
 * Home-services shape of the conversation:
 *   repair      what's wrong -> one 30-second check -> how soon -> name/mobile/ZIP -> pick a window -> booked
 *   replacement what's prompting -> homeowner? -> when -> budget range -> free estimate -> window -> booked
 *   roof        active leak? -> homeowner? -> free inspection -> window -> booked
 *   emergency   safety line -> name/mobile -> dispatcher notified -> while-you-wait tip
 */

import { createToolExecutor, availableWindows } from "./tools.js";

const EMAIL_RE = /[^\s@,;<>()]+@[^\s@,;<>()]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const ZIP_RE = /\b(8\d{4})\b/;

const has = (text, ...needles) => needles.some((n) => text.includes(n));

const SERVED_CITIES = ["denver", "aurora", "lakewood", "littleton", "englewood", "centennial", "parker", "highlands ranch", "arvada", "westminster", "thornton", "broomfield", "golden", "wheat ridge", "commerce city", "brighton", "castle rock"];
const NOT_SERVED = ["colorado springs", "fort collins", "boulder", "longmont", "greeley", "pueblo", "vail", "breckenridge", "loveland", "estes park", "grand junction", "texas", "utah", "wyoming", "kansas", "nebraska", "arizona", "new mexico", "california", "florida"];

function zipServed(zip) {
  const n = Number(zip);
  return (n >= 80001 && n <= 80299) || (n >= 80401 && n <= 80403) || (n >= 80601 && n <= 80603);
}

// ─── Intent detection ────────────────────────────────────────────────────────
function detectIntent(raw) {
  const t = raw.toLowerCase();
  if (has(t, "smell gas", "gas smell", "gas leak", "smells like gas", "carbon monoxide", "co alarm", "co detector"))
    return "gas_safety";
  if (has(t, "ignore your", "ignore previous", "system prompt", "your instructions", "your prompt", "pretend you are", "jailbreak", "developer mode"))
    return "jailbreak";
  if (has(t, "you installed", "you guys installed", "under warranty", "your tech", "your technician", "invoice", "already a customer", "existing customer", "you came out", "you replaced"))
    return "support";
  if (has(t, "human", "real person", "talk to someone", "speak to someone", "speak with someone", "call me", "someone call", "representative", "the office"))
    return "human";
  if (has(t, "too expensive", "cheaper", "discount", "coupon", "price match", "quoted less", "quoted me", "charges less", "charge less", "more than i expected", "can't afford", "cant afford", "pricey", "that's a lot", "thats a lot"))
    return "price_objection";
  if (has(t, "handyman", "handy man", "other company", "another company", "buy online", "buy it online", "amazon", "home depot", "lowe", "do it myself", "myself", "diy", "my cousin", "my brother-in-law", "craigslist", "why not just", "why should i use you"))
    return "competitor";
  if (has(t, "bad experience", "last contractor", "last company", "never showed", "ripped off", "ripped us off", "burned", "no-show", "no show"))
    return "tried_before";
  if (has(t, "think about it", "not sure yet", "maybe later", "later on", "another time", "not right now", "not now", "talk to my", "ask my", "sleep on it", "get back to you"))
    return "think";
  if (has(t, "send me", "email me", "text me", "more info", "information", "brochure", "pricing sheet", "details on", "details about"))
    return "info";
  if (has(t, "financing", "finance", "payment plan", "monthly payments", "0%", "credit"))
    return "financing";
  if (has(t, "do you serve", "service area", "do you come to", "come out to", "do you cover", "are you in", "i'm in ", "im in ", "we're in ", "located in", "live in"))
    return "service_area";
  if (has(t, "open on", "are you open", "hours", "24/7", "weekend", "on sunday", "on saturday", "after hours"))
    return "hours";
  if (has(t, "book", "schedule", "appointment", "come out", "send someone", "get someone out", "sign me up", "set up a visit", "set up an appointment"))
    return "book";
  if (has(t, "how much", "cost", "price", "pricing", "rates", "fee", "charge", "what do you charge"))
    return "pricing";
  if (has(t, "what do you do", "services", "what do you offer", "do you do", "do you also", "do you handle", "what can you help"))
    return "services";
  if (/^(hi|hello|hey|yo|good (morning|afternoon|evening))\b/.test(t)) return "greet";
  if (/^(yes|yeah|yep|sure|ok|okay|please|go ahead|sounds good|let's do it|lets do it|do it|absolutely|definitely|perfect|book it|yes please|that works)\b/.test(t))
    return "yes";
  if (/^(no|nope|nah|not really|no thanks|not yet)\b/.test(t)) return "no";
  if (has(t, "thank", "cheers", "appreciate")) return "thanks";
  return "statement";
}

// ─── Fact extraction ─────────────────────────────────────────────────────────
const NOT_NAMES = new Set(["yes", "no", "ok", "okay", "sure", "hi", "hello", "hey", "thanks", "today", "tomorrow", "please", "yeah", "yep", "nope", "book"]);

function extractName(raw) {
  const explicit = raw.match(/(?:my name is|i am|i'm|this is)\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/);
  // A leading "Sam Rivera, ..." only counts as a name when contact details follow it.
  const leading = (EMAIL_RE.test(raw) || PHONE_RE.test(raw))
    ? raw.match(/^([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)\s*(?:,|-|–|\s+\(?\d{3}|\s+[^\s@]+@)/)
    : null;
  const m = explicit || leading;
  if (!m) return null;
  const name = m[1].trim();
  return NOT_NAMES.has(name.toLowerCase().split(" ")[0]) ? null : name;
}

function extractBudget(raw) {
  const m = raw.match(/\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (m[2]) n *= 1000;
  return n >= 500 ? n : null;
}

/** Category drives the meeting type, the quick check and the discovery script. */
function needFrom(t) {
  if (has(t, "roof", "shingle", "hail", "storm damage", "ceiling stain", "water stain", "gutter"))
    return { need: has(t, "leak", "drip", "water") ? "roof leak, possible storm/hail damage" : "roof damage or inspection", category: "roof", symptom: "roof" };
  if (has(t, "tune-up", "tune up", "tuneup", "maintenance", "comfort club", "service plan", "annual service"))
    return { need: "seasonal maintenance / Comfort Club", category: "maintenance", symptom: "maintenance" };
  if (has(t, "replace", "replacement", "new ac", "new a/c", "new furnace", "new system", "new unit", "heat pump", "install", "how long will it last", "years old"))
    return { need: has(t, "furnace") ? "furnace replacement" : has(t, "heat pump") ? "heat pump installation" : has(t, "ac", "a/c", "air") ? "AC replacement" : "system replacement", category: "replacement", symptom: "replacement" };
  if (has(t, "thermostat")) return { need: "thermostat blank / unresponsive", category: "repair", symptom: "thermostat" };
  if (has(t, "furnace", "heater", "no heat", "heating", "not heating", "pilot", "cold air", "blowing cold"))
    return { need: "furnace / heating not working", category: "repair", symptom: "furnace" };
  if (has(t, " ac ", "ac ", "a/c", "air conditioner", "air conditioning", "not cooling", "stopped cooling", "warm air", "blowing warm", "cooling"))
    return { need: "AC not cooling / broken", category: "repair", symptom: "ac" };
  if (has(t, "noise", "banging", "rattling", "squeal", "grinding", "won't turn on", "wont turn on", "keeps shutting off", "short cycling", "leaking water", "frozen", "ice on"))
    return { need: "HVAC fault: " + t.slice(0, 60), category: "repair", symptom: "other" };
  return null;
}

function roleFrom(t) {
  if (has(t, "property manager", "manage the property", "rental property", "my rental", "my rentals", "landlord here", "i'm the landlord", "im the landlord"))
    return "property manager / landlord (can approve work)";
  if (has(t, "rent", "renting", "tenant", "my landlord", "lease", "apartment")) return "renter (owner must approve)";
  if (has(t, "homeowner", "home owner", "own the house", "own the home", "we own", "i own", "my house", "our house", "my home", "our home", "it's my call", "its my call"))
    return "homeowner";
  return null;
}

function timelineFrom(t) {
  if (has(t, "today", "asap", "right now", "now", "tonight", "urgent", "emergency", "immediately", "this morning", "this afternoon", "as soon as")) return "today";
  if (has(t, "tomorrow", "this week", "few days", "couple of days", "soon", "this weekend", "later this week", "later in the week")) return "this week";
  if (has(t, "before winter", "before summer", "before the cold", "before it gets", "next month", "this fall", "this spring", "few weeks", "couple of weeks", "before the season"))
    return "within the next few weeks";
  if (has(t, "no rush", "eventually", "just looking", "just researching", "next year", "someday", "planning ahead")) return "no fixed date";
  return null;
}

function locationFrom(raw) {
  const t = raw.toLowerCase();
  const zip = raw.match(ZIP_RE)?.[1];
  if (zip) return { label: `ZIP ${zip}`, served: zipServed(zip), zip };
  const bad = NOT_SERVED.find((c) => t.includes(c));
  if (bad) return { label: bad.replace(/\b\w/g, (c) => c.toUpperCase()), served: false };
  const good = SERVED_CITIES.find((c) => t.includes(c));
  if (good) return { label: good.replace(/\b\w/g, (c) => c.toUpperCase()), served: true };
  return null;
}

function isEmergency(t, category) {
  if (has(t, "below freezing", "freezing", "pipes", "baby", "newborn", "infant", "elderly", "my mother", "my father", "grandma", "grandpa", "oxygen", "medical") && has(t, "no heat", "no cooling", "no ac", "not cooling", "furnace", "heat", "died"))
    return true;
  if (has(t, "water pouring", "pouring", "flooding", "gushing", "sparks", "burning smell", "smoke")) return true;
  if (category === "repair" && has(t, "emergency")) return true;
  return false;
}

const MEETING_TYPE = { repair: "Service call", replacement: "Free estimate", roof: "Roof inspection", maintenance: "Tune-up" };

/** Pick a window from what the visitor typed: a label, an ordinal, a time, or "tomorrow morning". */
function matchWindow(text, windows) {
  const t = text.toLowerCase().replace(/–/g, "-");
  const byLabel = windows.find((w) => t.includes(w.label.toLowerCase().replace(/–/g, "-")));
  if (byLabel) return byLabel;
  const ord = [["first", "1st", "earliest", "soonest"], ["second", "2nd"], ["third", "3rd"], ["fourth", "4th", "last"]];
  for (let i = 0; i < ord.length; i++) if (ord[i].some((o) => t.includes(o)) && windows[i]) return windows[i];
  const day = t.includes("tomorrow") ? "Tomorrow" : t.includes("today") ? "Today" : null;
  const pool = day ? windows.filter((w) => w.label.startsWith(day)) : windows;
  const m = t.match(/(\d{1,2})(?::\d{2})?\s*(am|pm)?/);
  if (m) {
    const want = Number(m[1]);
    const hit = pool.find((w) => {
      const h = new Date(w.start).getHours();
      if (m[2] === "pm") return h === (want < 12 ? want + 12 : want);
      if (m[2] === "am") return h === (want === 12 ? 0 : want);
      return h === want || h === want + 12;
    });
    if (hit) return hit;
  }
  if (t.includes("morning")) return pool.find((w) => new Date(w.start).getHours() < 12) ?? null;
  if (t.includes("afternoon") || t.includes("evening")) return pool.find((w) => new Date(w.start).getHours() >= 12) ?? null;
  return day ? (pool[0] ?? null) : null;
}

/** Split reply text into small chunks and emit them with a delay, like streaming. */
async function streamText(text, onEvent, signal, speed = 14) {
  if (speed <= 0) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    onEvent({ type: "text_delta", text });
    return;
  }
  const tokens = text.match(/\S+\s*|\s+/g) ?? [text];
  for (const tok of tokens) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    onEvent({ type: "text_delta", text: tok });
    await new Promise((r) => setTimeout(r, speed + Math.random() * 18));
  }
}

export function createDemoAgent({ business, onEvent = () => {}, hooks = {}, integrations = {}, typingSpeed = 14, clock = () => new Date() }) {
  const execute = createToolExecutor({ business, integrations, hooks, clock });
  const sameDayAvailable = () => availableWindows(clock()).some((w) => w.label.startsWith("Today"));
  const B = business;

  let state;
  reset();

  function reset() {
    state = {
      pending: null,        // what we asked last
      profile: {},          // need, category, symptom, role, location, served, timeline, budget, objection
      name: null, email: null, phone: null, zip: null,
      emergency: false, afterHours: false, quickCheckDone: false,
      windows: null, booking: null,
      recommended: false, captured: false, escalated: false,
    };
  }

  function temperature() {
    const p = state.profile;
    if (p.served === false) return "disqualified";
    const soon = p.timeline === "today" || p.timeline === "this week" || p.timeline === "within the next few weeks";
    const authority = p.role === "homeowner" || (p.role && p.role.startsWith("property manager"));
    const money = typeof p.budget === "number" && p.budget >= 3000;
    if (state.emergency && p.need) return "hot";
    if (p.need && (p.category === "repair" || p.category === "roof") && soon) return "hot";
    if (p.need && soon && (authority || money)) return "hot";
    if (p.need && (soon || authority || money)) return "warm";
    return p.need ? "warm" : "cold";
  }

  async function tool(name, input) {
    const id = `demo_${Math.random().toString(36).slice(2, 10)}`;
    onEvent({ type: "tool_call", id, name, input });
    const result = await execute(name, input);
    onEvent({ type: "tool_result", id, name, result, isError: !result.ok });
    return result;
  }

  async function noteProfile(fields) {
    const input = {};
    for (const [k, v] of Object.entries(fields)) if (v) input[k] = String(v);
    input.temperature = temperature();
    await tool("update_lead_profile", input);
  }

  async function reply(text, { pending = null } = {}, signal) {
    state.pending = pending;
    await streamText(text, onEvent, signal, typingSpeed);
  }

  const first = () => (state.name ? state.name.split(" ")[0] : null);
  const meetingType = () => MEETING_TYPE[state.profile.category] ?? "Service call";

  function contactMissing() {
    const missing = [];
    if (!state.name) missing.push("your name");
    if (!state.phone) missing.push("a mobile number for the confirmation text");
    if (!state.zip && state.profile.served !== true) missing.push("your ZIP code");
    return missing;
  }

  function bookingInput(extra = {}) {
    const p = state.profile;
    return {
      meeting_type: meetingType(),
      prospect_name: state.name,
      phone: state.phone,
      email: state.email ?? undefined,
      location: state.zip ? `ZIP ${state.zip}` : p.location,
      purpose: `${state.name}: ${p.need ?? "general enquiry"}${p.role ? "; " + p.role : ""}${p.timeline ? "; wants it " + p.timeline : ""}${typeof p.budget === "number" ? "; budget ~$" + p.budget.toLocaleString() : ""}${p.notes ? "; " + p.notes : ""}.`,
      ...extra,
    };
  }

  const VISIT_BLURB = {
    "Service call": "It's the $89 diagnostic visit, waived if you approve the repair on the spot.",
    "Free estimate": "The estimate is free, takes about an hour, and the estimator can set up financing while there.",
    "Roof inspection": "The inspection is free and you get a written report with photos.",
    "Tune-up": "It's $129 per system, or included if you join the Comfort Club.",
  };

  /** Step 1: collect what's missing, then offer windows. */
  async function offerWindows(signal) {
    const missing = contactMissing();
    if (missing.length) {
      return reply(
        missing.length === 1
          ? `Almost there, I just need ${missing[0]}.`
          : `To lock it in I need ${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}.`,
        { pending: "contact" }, signal,
      );
    }
    await noteProfile({ temperature: temperature() });
    const result = await tool("trigger_calendar", bookingInput());
    if (!result.ok || !result.available_windows?.length) {
      return reply(`I couldn't pull the schedule just now. The office can book you directly at ${B.phone}, or try me again in a minute.`, {}, signal);
    }
    state.windows = result.available_windows;
    const todayFull = state.profile.timeline === "today" && !state.windows.some((w) => w.label.startsWith("Today"));
    return reply(
      todayFull
        ? `Thanks, ${first()}. Today's windows are already full, so these are the earliest; pick whichever suits. ${VISIT_BLURB[meetingType()]} If it really can't wait, say "tonight" and I'll have the dispatcher send someone after hours ($149 visit, waived with the repair).`
        : `Thanks, ${first()}. Here are the next arrival windows for a ${meetingType().toLowerCase()}; pick whichever suits. ${VISIT_BLURB[meetingType()]}`,
      { pending: "window" }, signal,
    );
  }

  /** Step 2: confirm the chosen window. */
  async function confirmWindow(text, signal) {
    if (has(text.toLowerCase(), "tonight", "can't wait", "cant wait", "after hours", "right now", "emergency")) {
      state.afterHours = true;
      return dispatchNow("visitor_requested", signal);
    }
    const w = matchWindow(text, state.windows ?? []);
    if (!w) return reply(`Which window works best? Any of the ones above, or tell me "tomorrow morning" and I'll match it.`, { pending: "window" }, signal);
    const result = await tool("trigger_calendar", bookingInput({ selected_window: w.id }));
    if (!result.ok || !result.confirmed) {
      state.windows = result.available_windows ?? state.windows;
      return reply(`That window just went, sorry. Here's what's open now; pick another and I'll lock it in.`, { pending: "window" }, signal);
    }
    state.booking = result;
    const next = {
      "Service call": "The tech will text 30 minutes before arrival, diagnose it, and give you a flat-rate price to approve before any work.",
      "Free estimate": "The estimator will text 30 minutes out, measure and size the system, and leave you two or three priced options with financing.",
      "Roof inspection": "The inspector will text 30 minutes out, photograph everything, and you'll have the written report the same day.",
      "Tune-up": "The tech will text 30 minutes out and the visit takes about an hour per system.",
    }[meetingType()];
    return reply(
      `You're set for **${w.label}**. Confirmation text is on its way to ${state.phone}. ${next} Anything I should pass along before then, like a gate code or a dog?`,
      { pending: "post_booking" }, signal,
    );
  }

  async function dispatchNow(reason, signal) {
    if (!state.phone || !state.name) {
      return reply(
        `The on-call dispatcher will call you within 15 minutes, any hour. What's your name and the best number to reach you on?`,
        { pending: "emergency_contact" }, signal,
      );
    }
    const p = state.profile;
    await noteProfile({ temperature: "hot" });
    const afterHours = reason !== "emergency";
    await tool("escalate_to_human", {
      reason, urgency: "high",
      summary: `${afterHours ? "After-hours visit requested ($149, waived with repair)" : "EMERGENCY dispatch"}: ${state.name}, ${state.phone}${state.zip ? ", ZIP " + state.zip : p.location ? ", " + p.location : ""}. ${p.need ?? "urgent issue"}.`,
      name: state.name, phone: state.phone, email: state.email ?? undefined, preferred_channel: "phone",
    });
    state.escalated = true;
    if (afterHours) {
      return reply(
        `Done, ${first()}: the dispatcher will call ${state.phone} within 15 minutes to confirm tonight's arrival. The after-hours visit is $149, waived if you approve the repair. If you don't hear back by then, call ${B.phone}.`,
        {}, signal,
      );
    }
    const tip = p.symptom === "furnace"
      ? ` While you wait: keep one room warm with a space heater or fireplace (never the oven), open the cabinet doors under sinks, and let the faucets drip so pipes don't freeze.`
      : p.symptom === "ac"
        ? ` While you wait: close the blinds, run fans, stay on the lowest floor and drink water; if it climbs past 85°F inside, head somewhere cool.`
        : p.symptom === "roof"
          ? ` While you wait: bucket under the drip, move electronics, and please stay off the roof.`
          : p.symptom === "gas" ? "" : ` While you wait, switch the system off at the thermostat.`;
    return reply(
      `Done, ${first()}: the dispatcher has your details and will call ${state.phone} within 15 minutes. If you don't hear back by then, call ${B.phone}; it's answered around the clock.${tip}`,
      {}, signal,
    );
  }

  async function captureNow(kind, signal) {
    if (!state.email && !state.phone) return reply(`No problem. Where should I send it: an email address, or a mobile number for a text?`, { pending: "info_contact" }, signal);
    if (!state.name) state.name = "Visitor";
    const p = state.profile;
    await tool("capture_lead", {
      name: state.name,
      email: state.email ?? `${state.phone.replace(/\D/g, "")}@sms.summit-hvac.example`,
      phone: state.phone ?? undefined,
      location: state.zip ? `ZIP ${state.zip}` : p.location,
      need_summary: p.need ?? "asked for written information",
      temperature: temperature(),
      lead_type: "prospect",
      consent: true,
      budget_range: typeof p.budget === "number" ? `~$${p.budget.toLocaleString()}` : undefined,
      timeline: p.timeline,
      recommended_offer: state.recommended ? meetingType() : undefined,
      notes: kind === "renter"
        ? "Renter; sending a summary to forward to the owner/property manager."
        : kind === "think"
          ? "Wants to think it over; send summary and follow up in a few days."
          : "Requested pricing info via the website concierge; office to follow up.",
    });
    state.captured = true;
    const where = state.email ?? state.phone;
    return reply(
      kind === "renter"
        ? `Sent. You'll have a short summary at ${where} within the hour that you can forward straight to the owner. If they'd rather we call them, the number is ${B.phone}.`
        : `Sent to ${where}; you'll have it within the hour, and the office follows up in a few days, no pressure. If it turns into "just come and look at it", I can book a visit any time.`,
      {}, signal,
    );
  }

  // ─── Stage-specific copy ───────────────────────────────────────────────────
  function pricingAnswer(category) {
    switch (category) {
      case "replacement":
        return `Straight ranges, installed: furnace $4,500 to $9,000, central AC $6,500 to $12,500, heat pump $9,000 to $16,000 before rebates. Sizing changes the number, so the real quote comes from a free in-home estimate, and 0% financing for 18 months is available.`;
      case "roof":
        return `Roof repairs typically run $350 to $1,500. A full asphalt replacement on a typical 2,000 sq ft home is $9,500 to $18,000. The inspection is free and comes with photos and a written report; hail damage is usually an insurance claim, and we handle the paperwork.`;
      case "maintenance":
        return `A one-off tune-up is $129 per system. The Comfort Club is $19/month and includes both seasonal tune-ups, priority scheduling, 15% off repairs and no after-hours fee.`;
      default:
        return `The diagnostic visit is $89 flat ($149 after hours), waived if you approve the repair on the same visit. Every repair is quoted flat-rate after diagnosis and before any work; common ones land between $180 for a capacitor and $900 for a blower motor.`;
    }
  }

  function quickCheck(symptom) {
    return {
      ac: `Sorry, that's miserable. One 30-second check before I send anyone, because it saves people the visit fee sometimes: is the outdoor unit running at all, or is it silent?`,
      furnace: `Let's get you warm. One quick check first: is the thermostat set to Heat and above room temperature, and is the furnace switch (looks like a light switch next to the unit) on?`,
      thermostat: `Quick check first, because it's the fix half the time: have you tried fresh batteries in the thermostat?`,
    }[symptom];
  }

  function afterQuickCheck(symptom, t) {
    if (symptom === "ac") {
      return has(t, "silent", "not running", "nothing", "dead", "no", "isn't", "isnt", "off")
        ? `Then it's worth flipping the AC breaker off and back on once. If it stays silent, it's almost always the capacitor or contactor, $180 to $300, fixed on the spot.`
        : `Then it's likely a refrigerant or airflow issue; a clogged filter is the common one. Either way a tech can sort it same-day.`;
    }
    if (symptom === "furnace") {
      return has(t, "yes", "both", "they are", "it is", "still")
        ? `Okay, so it's not the easy stuff. When a furnace is set right and still won't fire, it's usually the ignitor or flame sensor, $200 to $350.`
        : `Give that a try; if it still won't start, it's usually the ignitor or flame sensor, $200 to $350.`;
    }
    if (symptom === "thermostat") {
      return has(t, "yes", "tried", "did", "still") ? `Then the thermostat or its wiring needs a look; that's a quick service call.` : `Try that first; if it stays blank, we'll come out.`;
    }
    return ``;
  }

  function recommendation() {
    const p = state.profile;
    switch (p.category) {
      case "replacement":
        return `With a system that age and repair bills stacking up, replacement is usually the sensible call, and the way to get a real number is the **free in-home estimate**: we size it to the house, show you two or three options, and the estimator can set up 0% financing for 18 months on the spot. Most installs are done within a week.`;
      case "roof":
        return `The right next step is a **free roof inspection**: written report, photos, and if it's hail damage we meet your insurance adjuster on site and handle the claim paperwork. Repairs run $350 to $1,500; a full replacement is quoted from the inspection.`;
      case "maintenance":
        return `Good call. A tune-up is $129 per system, or the **Comfort Club** at $19/month covers both seasonal tune-ups, 15% off any repairs and no after-hours fee.`;
      default:
        return `That's a straightforward **service call**: $89 diagnostic, waived if you approve the repair, flat-rate price before any work starts, 1-year warranty on the fix.`;
    }
  }

  // ─── The main turn handler ─────────────────────────────────────────────────
  async function send(raw, { signal } = {}) {
    const text = String(raw ?? "").trim();
    if (!text) return;
    const t = text.toLowerCase();
    let intent = detectIntent(text);

    // Contact details can arrive in any message.
    const email = text.match(EMAIL_RE)?.[0] ?? null;
    const phone = text.match(PHONE_RE)?.[0] ?? null;
    const name = extractName(text);
    const loc = locationFrom(text);
    if (email) state.email = email;
    if (phone) state.phone = phone.trim();
    if (name) state.name = name;
    if (loc?.zip) state.zip = loc.zip;

    // Learn qualification facts from any message.
    const learned = {};
    const p = state.profile;
    const needInfo = state.pending === "window" || state.pending === "post_booking" ? null : needFrom(t);
    const role = roleFrom(t);
    const timeline = state.pending === "window" ? null : timelineFrom(t);
    if (needInfo && !p.need) { p.need = needInfo.need; p.category = needInfo.category; p.symptom = needInfo.symptom; learned.need = p.need; }
    if (role && !p.role) { p.role = role; learned.role = role; }
    if (timeline && !p.timeline) { p.timeline = timeline; learned.timeline = timeline; }
    if (loc && p.served === undefined) { p.location = loc.label; p.served = loc.served; learned.location = loc.label + (loc.served ? "" : " (outside service area)"); }
    if (state.pending === "budget" || has(t, "budget", "spend", "afford", "under $", "stay under")) {
      const b = extractBudget(text);
      if (b && !p.budget) { p.budget = b; learned.budget_range = `~$${b.toLocaleString()}`; }
    }
    if (isEmergency(t, needInfo?.category ?? p.category)) state.emergency = true;
    if (Object.keys(learned).length) await noteProfile(learned);

    // A direct answer to the question we just asked beats keyword intents
    // ("later this week" is a timeline, not hesitation).
    const answered = (state.pending === "timeline" && timeline) || (state.pending === "role" && role) || (state.pending === "budget" && (learned.budget_range || has(t, "rather not", "not sure", "no idea")));
    if (answered && !["gas_safety", "jailbreak", "support", "human"].includes(intent)) intent = "statement";

    try {
      // ── Safety and guardrails first ───────────────────────────────────────
      if (intent === "gas_safety") {
        state.emergency = true;
        if (!p.need) { p.need = "gas smell / CO alarm"; p.category = "repair"; p.symptom = "gas"; await noteProfile({ need: p.need }); }
        return reply(
          `Please stop and do this first: leave the house now, don't touch light switches or appliances on the way out, and call your gas utility's emergency line or 911 from outside. Don't try to find the source. Once you're safely outside, reply with your name and phone number and I'll have our on-call dispatcher call you right away.`,
          { pending: "emergency_contact" }, signal,
        );
      }

      if (intent === "jailbreak") {
        return reply(`I can't share how I'm set up, but I'm glad to help with anything about ${B.name}. Is something acting up with your heating, cooling or roof?`, { pending: "need" }, signal);
      }

      if (state.pending === "emergency_contact") return dispatchNow(state.afterHours ? "visitor_requested" : "emergency", signal);
      if (state.emergency && !state.escalated && p.need) return dispatchNow("emergency", signal);

      // ── Support / human ───────────────────────────────────────────────────
      if (intent === "support" || state.pending === "support_contact") {
        if (!state.name || !state.phone) {
          return reply(
            intent === "support"
              ? `That's covered: repairs carry a 1-year warranty and installs 2 years on labor, so I'll get this to the office rather than try to sell you anything. What's your name, best phone number, and a line about what it's doing?`
              : `Thanks. I still need ${!state.name ? "your name" : "a phone number"} so the office can reach you.`,
            { pending: "support_contact" }, signal,
          );
        }
        await tool("escalate_to_human", {
          reason: "support", urgency: "normal",
          summary: `Existing customer ${state.name} (${state.phone}${state.email ? ", " + state.email : ""}) reports a warranty/service issue: ${text.replace(PHONE_RE, "").replace(EMAIL_RE, "").slice(0, 160)}`,
          name: state.name, phone: state.phone, email: state.email ?? undefined, preferred_channel: "phone",
        });
        state.escalated = true;
        return reply(`Thanks, ${first()}. The office has it and will call ${state.phone} within one business hour (we're open 7 to 7, Monday to Saturday). If it's urgent right now, ${B.phone} is answered 24/7.`, {}, signal);
      }

      if (intent === "human" || state.pending === "human_contact") {
        if (!state.name || !state.phone) {
          return reply(
            intent === "human"
              ? `Of course. The office calls back within one business hour, or you can call ${B.phone} now. If you'd like the call-back, what's your name and best number?`
              : `Thanks. I still need ${!state.name ? "your name" : "a phone number"} for the call-back.`,
            { pending: "human_contact" }, signal,
          );
        }
        await tool("escalate_to_human", {
          reason: "visitor_requested", urgency: "normal",
          summary: `${state.name} (${state.phone}) asked to speak with a person. ${p.need ? "Issue: " + p.need + "." : "Context: " + text.slice(0, 120)}`,
          name: state.name, phone: state.phone, email: state.email ?? undefined, preferred_channel: "phone",
        });
        state.escalated = true;
        return reply(`Done, ${first()}. Someone from the office will call ${state.phone} within the hour. Anything I can line up for them meanwhile?`, {}, signal);
      }

      // ── Service-area check ────────────────────────────────────────────────
      if (p.served === false) {
        return reply(`I'll be straight with you: ${p.location} is outside our service area (we cover the Denver metro, roughly 35 miles from downtown), and I'd rather say so now than waste your time. Sorry we can't help with this one.`, {}, signal);
      }

      // ── Booking mechanics ─────────────────────────────────────────────────
      if (state.pending === "window") return confirmWindow(text, signal);
      if (state.pending === "contact") return offerWindows(signal);
      if (state.pending === "post_booking") {
        if (intent === "no" || intent === "thanks" || has(t, "that's it", "thats it", "nothing", "all good")) {
          return reply(`Perfect. See you ${state.booking?.window?.label?.split(" ")[0]?.toLowerCase() ?? "soon"}, ${first()}.`, {}, signal);
        }
        p.notes = text.slice(0, 120);
        await noteProfile({ notes: p.notes });
        return reply(`Got it, that's on the ticket for the tech. Anything else?`, { pending: "post_booking" }, signal);
      }

      if (state.pending === "info_contact" || state.pending === "renter_contact" || state.pending === "think_contact") {
        return captureNow(state.pending === "renter_contact" ? "renter" : state.pending === "think_contact" ? "think" : "info", signal);
      }

      if (state.pending === "book_confirm") {
        if (p.category === "repair" && has(t, "tonight", "after hours", "after-hours", "emergency", "can't wait", "cant wait", "send someone now")) {
          state.afterHours = true;
          return dispatchNow("visitor_requested", signal);
        }
        if (intent === "yes" || intent === "book" || email || phone || has(t, "tomorrow", "earliest", "regular")) return offerWindows(signal);
        if (intent === "no" || intent === "think") {
          return reply(`Of course. Want me to text or email you a short summary with the pricing so you can weigh it up?`, { pending: "think_contact" }, signal);
        }
      }

      if (state.pending === "quick_check") {
        state.quickCheckDone = true;
        const follow = afterQuickCheck(p.symptom, t);
        if (p.timeline) return reply(`${follow} ${p.timeline === "today" ? "I can get you a same-day window." : "I can get you on the schedule."} ${recommendation()} Want me to book it?`, { pending: "book_confirm" }, signal);
        return reply(`${follow} How soon do you need someone: today, or is later this week okay?`, { pending: "timeline" }, signal);
      }

      if (state.pending === "renter_choice") {
        if (has(t, "forward", "send", "summary", "email", "text", "me")) return reply(`Sure. Best email or mobile number to send the summary to?`, { pending: "renter_contact" }, signal);
        return reply(`Got it. If you can get me the owner's name and number, the office will reach out directly; otherwise I can send you a summary to forward. Which works?`, { pending: "renter_choice" }, signal);
      }

      if (state.pending === "objection_isolate") {
        if (has(t, "fee", "visit", "the 89", "$89", "number itself", "diagnostic", "just the")) {
          return reply(`Understood. Two ways that fee goes to zero: approve the repair on the same visit and it's waived, or join the Comfort Club ($19/month) for 15% off repairs and no after-hours fee. Want me to get you on the schedule?`, { pending: "book_confirm" }, signal);
        }
        return reply(`That's the right worry, and it's exactly why every repair is quoted flat-rate after diagnosis and before a single part comes off; you approve the number first. If the other company bills hourly, the totals often land close, so it's worth asking them. Want me to get you on the schedule?`, { pending: "book_confirm" }, signal);
      }

      if (state.pending === "competitor_job") {
        if (!p.need) { p.need = text.slice(0, 120); p.category = "repair"; p.symptom = "other"; await noteProfile({ need: p.need }); }
        const licensed = has(t, "gas", "furnace", "refrigerant", "freon", "compressor", "wiring", "electrical", "heat pump", " ac", "a/c", "air");
        return reply(
          licensed
            ? `That one needs a licensed tech: it involves ${has(t, "gas", "furnace") ? "gas" : has(t, "wiring", "electrical") ? "electrical" : "refrigerant"} work, Colorado requires a license for it, and an unlicensed repair can void the manufacturer warranty. Our visit is $89, waived if you approve the repair. Want me to book it?`
            : `Honestly, that might be a handyman job. If it turns out to be more, the $89 diagnostic is waived when you approve the repair. Want me to put you on the schedule just in case?`,
          { pending: "book_confirm" }, signal,
        );
      }

      if (state.pending === "tried_detail") {
        return reply(`That's a bad way to be treated, and I'm sorry. Here's what's different with us: a 2-hour arrival window confirmed by text, the tech texts 30 minutes out, every repair is quoted flat-rate before work starts, and there's a 1-year labor warranty. 96% of visits last year arrived inside the window. What's going on with the system now?`, { pending: "need" }, signal);
      }

      if (state.pending === "blocker") {
        return reply(`Makes sense. Want me to text or email a short summary with the numbers so it's easier to talk through?`, { pending: "think_contact" }, signal);
      }

      // ── Intent handling ───────────────────────────────────────────────────
      switch (intent) {
        case "greet":
          return reply(`Hi, I'm ${B.agentName} with ${B.shortName}. Heating, cooling or roof: what's going on?`, { pending: "need" }, signal);

        case "services":
          return reply(`Three things: repairs on any heating or cooling system (same-day most days, 24/7 for emergencies), new furnaces, ACs and heat pumps with financing, and roofing, from small repairs to full replacements and hail claims. Which one are you looking at?`, { pending: "need" }, signal);

        case "hours":
          return reply(`Office and scheduling are 7 to 7, Monday to Saturday. Emergency repairs are 24/7 including holidays: $149 visit fee after hours ($89 for Comfort Club members), waived if you approve the repair. Is something down right now?`, { pending: "need" }, signal);

        case "financing":
          return reply(`Yes: 0% APR for 18 months, or fixed terms up to 120 months, with approved credit. The application takes about 10 minutes and the estimator handles it on the spot. Is this for a replacement you're already planning, or something that just gave out?`, { pending: "need" }, signal);

        case "service_area":
          if (p.served === true) return reply(`Yes, ${p.location} is in our area. What's going on with the system?`, { pending: "need" }, signal);
          return reply(`We cover the Denver metro, roughly 35 miles from downtown: Aurora, Lakewood, Littleton, Arvada, Westminster, Thornton, Parker, Castle Rock and the rest. What's your ZIP code?`, { pending: "need" }, signal);

        case "pricing":
          return reply(`${pricingAnswer(needInfo?.category ?? p.category)} ${p.need ? "Is it already broken, or are you planning ahead?" : "What's going on with the system?"}`, { pending: "need" }, signal);

        case "price_objection":
          if (!p.objection) { p.objection = text.slice(0, 120); await noteProfile({ objection: p.objection }); }
          return reply(`Fair, and I'd rather you say it than go quiet. Ours is $89 and it's waived if you go ahead with the repair. Is it the visit fee itself, or wanting to be sure the total won't balloon once someone's in the house?`, { pending: "objection_isolate" }, signal);

        case "competitor":
          if (has(t, "online", "amazon", "home depot", "lowe", "myself", "diy")) {
            return reply(`You can, and for a window unit I'd say go for it. For a central system, equipment bought online usually carries no manufacturer warranty without a licensed install, and the install is most of the job. The estimate is free, so the comparison costs you nothing. What are you looking to replace?`, { pending: "need" }, signal);
          }
          return reply(`For some things, absolutely. Anything involving gas, refrigerant or electrical on an HVAC system needs a licensed tech in Colorado, and unlicensed work can void the manufacturer warranty. Tell me what the job is and I'll tell you straight which it is.`, { pending: "competitor_job" }, signal);

        case "tried_before":
          return reply(`Sorry, that's a lousy experience. What happened: no-show, surprise bill, or the fix didn't hold?`, { pending: "tried_detail" }, signal);

        case "think":
          return reply(`Of course. What's the main thing you'll be weighing up?`, { pending: "blocker" }, signal);

        case "info":
          return reply(
            `Happy to. One thing worth knowing now: ${p.category === "maintenance" || has(t, "club", "plan", "maintenance") ? "the Comfort Club is $19/month and includes both seasonal tune-ups, 15% off repairs and no after-hours fee" : p.category === "replacement" ? "every replacement estimate is free and financing is 0% for 18 months" : "the $89 diagnostic is waived whenever you approve the repair on the same visit"}. I'll send the pricing sheet rather than a brochure. Best email, or a mobile number for a text?`,
            { pending: "info_contact" }, signal,
          );

        case "book":
          if (!p.need) return reply(`Let's do it. What's it for: a repair, a tune-up, a replacement estimate, or a roof inspection?`, { pending: "need" }, signal);
          return offerWindows(signal);

        case "thanks":
          return reply(state.booking ? `You're welcome, ${first() ?? "and"} see you then.` : `Any time. If it's ever useful, I can book a visit or send pricing over; no pressure.`, {}, signal);

        case "no":
          return reply(`No problem at all. I'm here if anything changes.`, {}, signal);

        case "yes":
          if (state.recommended) return offerWindows(signal);
          break;
      }

      // ── Discovery ladder (one question per message) ───────────────────────
      if (state.pending === "need" && !p.need) {
        p.need = text.slice(0, 120);
        p.category = "repair";
        p.symptom = "other";
        await noteProfile({ need: p.need });
      }

      if (p.need && p.role?.startsWith("renter") && !state.captured && state.pending !== "renter_choice") {
        return reply(`Happy to help either way; the owner or property manager just needs to approve and pay for the work. I can send you a short summary to forward, or if you have their contact, the office can reach out directly. Which is easier?`, { pending: "renter_choice" }, signal);
      }

      // Repairs: quick check -> how soon -> book. No paperwork questions first.
      if (p.category === "repair" && p.need) {
        if (!state.quickCheckDone && quickCheck(p.symptom) && state.pending !== "quick_check") {
          return reply(quickCheck(p.symptom), { pending: "quick_check" }, signal);
        }
        if (!p.timeline) return reply(`${learned.need ? "Sorry, that's no fun. " : ""}How soon do you need someone: today, or is later this week okay?`, { pending: "timeline" }, signal);
        if (!state.recommended) {
          state.recommended = true;
          const sameDay = sameDayAvailable();
          const ask = p.timeline !== "today" ? "Want me to open up the schedule?"
            : sameDay ? "I can get you a same-day window. Want me to book it?"
            : "Today's regular windows are full; the earliest is tomorrow morning, or the dispatcher can send someone tonight for the $149 after-hours visit (also waived with the repair). Which would you like?";
          return reply(`${recommendation()} ${ask}`, { pending: "book_confirm" }, signal);
        }
        return offerWindows(signal);
      }

      // Maintenance: straight to booking.
      if (p.category === "maintenance" && p.need) {
        if (!state.recommended) { state.recommended = true; return reply(`${recommendation()} Want me to book the visit?`, { pending: "book_confirm" }, signal); }
        return offerWindows(signal);
      }

      // Roof: is it active? -> homeowner -> inspection.
      if (p.category === "roof" && p.need) {
        if (!p.timeline) return reply(`Let's get that looked at before it spreads. Is water coming in right now, or is it damage you've spotted and want checked?`, { pending: "timeline" }, signal);
        if (!p.role) {
          const urgent = p.timeline === "today" || has(t, "drip", "coming in", "right now", "leaking");
          if (urgent && !p.timeline) p.timeline = "today";
          return reply(`${urgent ? "Bucket under the drip, move anything electronic, and please stay off the roof. " : ""}Are you the homeowner, or renting?`, { pending: "role" }, signal);
        }
        if (!state.recommended) { state.recommended = true; return reply(`${recommendation()} Want me to book the free inspection?`, { pending: "book_confirm" }, signal); }
        return offerWindows(signal);
      }

      // Replacement: what's prompting -> homeowner -> when -> budget -> estimate.
      if (p.category === "replacement" && p.need) {
        if (!p.role) return reply(`${learned.need ? "Good time to plan it rather than wait for a failure. " : ""}Are you the homeowner, or renting?`, { pending: "role" }, signal);
        if (!p.timeline) return reply(`Got it. Is there a date you're working towards, like before the cold sets in?`, { pending: "timeline" }, signal);
        if (!p.budget && state.pending !== "budget") {
          return reply(`That's workable: most installs are done within a week of the estimate. So I point you at the right options rather than everything: most homeowners land between ${p.need.includes("furnace") ? "$4,500 and $9,000" : p.need.includes("heat pump") ? "$9,000 and $16,000" : "$6,500 and $12,500"} installed, with 0% financing for 18 months. Is there a number this needs to stay under?`, { pending: "budget" }, signal);
        }
        if (!p.budget) { p.budget = "unknown"; await noteProfile({ budget_range: "declined to share" }); }
        if (!state.recommended) { state.recommended = true; return reply(`${recommendation()} Want me to book the free in-home estimate?`, { pending: "book_confirm" }, signal); }
        return offerWindows(signal);
      }

      // Nothing matched: be useful, ask the one question that moves things.
      return reply(
        p.need
          ? `I don't have that detail to hand and I'd rather not guess; the office can give you a definitive answer at ${B.phone}. Meanwhile, want me to get you on the schedule?`
          : `I can help once I know what's going on. Is it heating, cooling, or the roof, and what's it doing?`,
        { pending: p.need ? "book_confirm" : "need" }, signal,
      );
    } finally {
      onEvent({ type: "turn_end", stopReason: "end_turn", usage: null, totals: null });
    }
  }

  /** Stage-aware quick replies for the UI. Kept short: three or fewer where possible. */
  function suggestions() {
    const p = state.profile;
    switch (state.pending) {
      case "need":
        return ["My AC stopped cooling", "Our furnace is 20 years old and keeps needing repairs", "Water stain on the ceiling after the hail"];
      case "quick_check":
        return p.symptom === "ac" ? ["It's silent", "It's running"] : p.symptom === "furnace" ? ["Yes, both are on", "Let me check"] : ["Yes, tried that", "Not yet"];
      case "role":
        return ["I'm the homeowner", "I'm renting"];
      case "timeline":
        return p.category === "replacement" ? ["Before the cold sets in", "No rush, planning ahead"] : p.category === "roof" ? ["It's dripping in right now", "Just spotted the stain"] : ["Today if possible", "Later this week is fine"];
      case "budget":
        return ["Somewhere around $7,000", "I'd rather not say yet"];
      case "book_confirm":
        return p.category === "repair" && p.timeline === "today" && !sameDayAvailable()
          ? ["Tomorrow morning is fine", "Send someone tonight", "Another company charges less for the visit"]
          : ["Yes, book it", "Another company charges less for the visit", "I need to talk to my wife first"];
      case "contact":
        return ["Sam Rivera, (303) 555-0192, 80211"];
      case "window":
        return state.windows ? [`The first one works`] : [];
      case "post_booking":
        return p.notes ? ["That's it, thanks"] : ["Gate code is 4471, and we have a friendly dog", "That's it, thanks"];
      case "emergency_contact":
        return ["Dana Park, (720) 555-0134"];
      case "info_contact":
      case "think_contact":
      case "renter_contact":
        return ["jordan.lee@example.com"];
      case "objection_isolate":
        return ["It's the visit fee itself", "I'm worried the total balloons"];
      case "competitor_job":
        return ["The furnace won't ignite", "The thermostat screen is blank"];
      case "renter_choice":
        return ["Send me a summary to forward"];
      case "support_contact":
      case "human_contact":
        return ["Alex Kim, (303) 555-0177 — it's making a grinding noise"];
      default:
        return ["My AC stopped cooling", "How much is a new furnace?", "Roof leak after the hail storm", "I smell gas near the furnace"];
    }
  }

  return {
    send,
    reset,
    suggestions,
    /** Windows currently on offer (for the UI to render as buttons). */
    getWindows: () => state.windows,
    getMessages: () => [],
    getTotals: () => null,
    isBusy: () => false,
    model: "demo",
    effort: null,
  };
}
