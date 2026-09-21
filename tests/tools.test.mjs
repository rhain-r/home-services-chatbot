import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS, TOOL_NAMES, validateToolInput, createToolExecutor, bookingLinkFor, availableWindows } from "../agent/tools.js";
import { business } from "../agent/business-config.js";

test("tool definitions are well-formed for the Messages API", () => {
  assert.deepEqual(TOOL_NAMES, ["update_lead_profile", "capture_lead", "trigger_calendar", "escalate_to_human"]);
  for (const tool of TOOLS) {
    assert.ok(tool.description.length > 40, `${tool.name} needs a real description`);
    assert.equal(tool.input_schema.type, "object");
    assert.equal(tool.input_schema.additionalProperties, false);
    assert.equal(tool.eager_input_streaming, true);
    for (const key of tool.input_schema.required ?? []) {
      assert.ok(tool.input_schema.properties[key], `${tool.name}.required names unknown field ${key}`);
    }
  }
});

test("validateToolInput enforces required fields, enums and unknown keys", () => {
  assert.equal(validateToolInput("nope", {}).ok, false);
  assert.equal(validateToolInput("capture_lead", "str").ok, false);

  const missing = validateToolInput("capture_lead", { name: "A" });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.includes("email")));

  const badEnum = validateToolInput("escalate_to_human", { reason: "bored", summary: "x", urgency: "normal" });
  assert.equal(badEnum.ok, false);
  assert.ok(badEnum.errors[0].includes("reason must be one of"));

  const extra = validateToolInput("update_lead_profile", { need: "x", ssn: "123" });
  assert.equal(extra.ok, false);
  assert.ok(extra.errors[0].includes("unexpected field: ssn"));

  const typed = validateToolInput("capture_lead", { name: "A", email: "a@b.co", need_summary: "n", temperature: "hot", consent: "yes" });
  assert.equal(typed.ok, false);
  assert.ok(typed.errors.some((e) => e.includes("consent must be a boolean")));
});

test("capture_lead requires explicit consent and a plausible email", () => {
  const base = { name: "Sam", need_summary: "leads", temperature: "warm" };
  assert.equal(validateToolInput("capture_lead", { ...base, email: "sam@x.io", consent: false }).ok, false);
  assert.equal(validateToolInput("capture_lead", { ...base, email: "not-an-email", consent: true }).ok, false);
  assert.equal(validateToolInput("capture_lead", { ...base, email: "sam@x.io", consent: true }).ok, true);
});

test("update_lead_profile needs at least one fact", () => {
  assert.equal(validateToolInput("update_lead_profile", {}).ok, false);
  assert.equal(validateToolInput("update_lead_profile", { temperature: "hot" }).ok, true);
  assert.equal(validateToolInput("update_lead_profile", { need: "x" }).ok, true);
});

test("trigger_calendar needs at least one contact", () => {
  const base = { meeting_type: "Service call", prospect_name: "Sam", purpose: "p" };
  assert.equal(validateToolInput("trigger_calendar", base).ok, false);
  assert.equal(validateToolInput("trigger_calendar", { ...base, phone: "303-555-0100" }).ok, true);
  assert.equal(validateToolInput("trigger_calendar", { ...base, email: "s@x.io" }).ok, true);
  assert.equal(validateToolInput("trigger_calendar", { ...base, email: "nope" }).ok, false);
});

test("availableWindows stays inside business hours and skips Sundays", () => {
  const sat = availableWindows(new Date("2026-09-26T16:00:00"));
  assert.ok(sat.every((w) => new Date(w.start).getDay() !== 0), "no Sunday windows");
  assert.ok(sat.every((w) => { const h = new Date(w.start).getHours(); return h >= 7 && h <= 17; }));
  const midday = availableWindows(new Date("2026-09-21T09:30:00"));
  assert.match(midday[0].label, /^Today /);
  assert.equal(new Set(midday.map((w) => w.id)).size, midday.length, "ids are unique");
});

test("bookingLinkFor prefills name and email", () => {
  const url = new URL(bookingLinkFor("https://cal.com/acme/intro", { name: "Sam R", email: "s@x.io" }));
  assert.equal(url.searchParams.get("name"), "Sam R");
  assert.equal(url.searchParams.get("email"), "s@x.io");
  assert.equal(bookingLinkFor("not a url", { name: "x" }), "not a url");
});

test("executor: local inbox path fires hooks and returns structured results", async () => {
  const seen = { profile: null, lead: null, booking: null, ticket: null };
  const execute = createToolExecutor({
    business,
    hooks: {
      onProfileUpdate: (p) => (seen.profile = p),
      onLeadCaptured: (l) => (seen.lead = l),
      onCalendar: (b) => (seen.booking = b),
      onHandoff: (t) => (seen.ticket = t),
    },
  });

  const p = await execute("update_lead_profile", { need: "missed calls", temperature: "warm" });
  assert.equal(p.ok, true);
  assert.equal(seen.profile.need, "missed calls");

  const lead = await execute("capture_lead", { name: "Sam", email: "sam@x.io", need_summary: "n", temperature: "hot", consent: true });
  assert.equal(lead.ok, true);
  assert.equal(lead.delivered_to, "local_inbox");
  assert.match(lead.lead_id, /^lead_/);
  assert.equal(seen.lead.profile_snapshot.need, "missed calls", "lead carries the profile snapshot");

  // Step 1: offer windows; nothing is booked yet.
  const cal = await execute("trigger_calendar", { meeting_type: "Service call", prospect_name: "Sam", phone: "(303) 555-0192", purpose: "p" });
  assert.equal(cal.ok, true);
  assert.equal(cal.confirmed, false);
  assert.ok(cal.available_windows.length >= 3, "offers arrival windows");
  assert.ok(cal.available_windows.every((w) => w.id && w.label && w.start));
  assert.ok(cal.booking_url.startsWith(business.bookingUrl), "keeps a booking link as fallback");
  assert.equal(seen.booking.status, "offered");

  // Step 2: the visitor picks a window -> confirmed.
  const pick = cal.available_windows[1];
  const done = await execute("trigger_calendar", { meeting_type: "Service call", prospect_name: "Sam", phone: "(303) 555-0192", purpose: "p", selected_window: pick.id });
  assert.equal(done.confirmed, true);
  assert.equal(done.window.label, pick.label);
  assert.deepEqual(done.confirmation_sent_to, ["(303) 555-0192"]);
  assert.match(done.booking_id, /^book_/);
  assert.equal(seen.booking.status, "confirmed");

  const stale = await execute("trigger_calendar", { meeting_type: "Service call", prospect_name: "Sam", phone: "(303) 555-0192", purpose: "p", selected_window: "w1-1-7" });
  assert.equal(stale.ok, false, "an unknown window is rejected with a fresh list");
  assert.ok(stale.available_windows.length > 0);

  const h = await execute("escalate_to_human", { reason: "support", summary: "s", urgency: "high" });
  assert.equal(h.ok, true);
  assert.equal(h.fallback_email, business.supportEmail);
  assert.equal(seen.ticket.reason, "support");

  const unknown = await execute("format_disk", {});
  assert.equal(unknown.ok, false);
});

test("executor: webhook delivery and failure handling", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: !url.includes("broken"), status: url.includes("broken") ? 500 : 200 };
  };
  try {
    const ok = createToolExecutor({ business, integrations: { leadWebhookUrl: "https://hooks.example/lead", webhookSecret: "s3" } });
    const r = await ok("capture_lead", { name: "A", email: "a@b.co", need_summary: "n", temperature: "warm", consent: true });
    assert.equal(r.delivered_to, "crm_webhook");
    assert.equal(calls[0].init.headers["X-Webhook-Secret"], "s3");
    assert.equal(JSON.parse(calls[0].init.body).event, "lead.captured");

    const broken = createToolExecutor({ business, integrations: { handoffWebhookUrl: "https://hooks.example/broken" } });
    const f = await broken("escalate_to_human", { reason: "support", summary: "s", urgency: "low" });
    assert.equal(f.ok, false);
    assert.match(f.error, /500/);
    assert.ok(f.fallback.includes(business.supportEmail), "failure result tells the model the manual fallback");
  } finally {
    globalThis.fetch = realFetch;
  }
});
