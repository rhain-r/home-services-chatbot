# Tool definitions

The concierge has four internal actions. They are defined once in `agent/tools.js` as native Claude tool schemas and referenced by name in `<tool_and_action_handling>` of the system prompt. The model calls them with native tool use; the runtime validates every input before executing.

All schemas are `additionalProperties: false`. Enum values are exact.

## `update_lead_profile`

Internal CRM notes. Silent. Called whenever a **new** qualification fact appears.

| Field | Type | Notes |
|---|---|---|
| `need` | string | Problem or goal, in the visitor's words (≤200 chars) |
| `role` | string | Decision authority |
| `company` | string | Name / type / size |
| `location` | string | City, ZIP or address; used to check a service area |
| `timeline` | string | When, and any trigger event |
| `budget_range` | string | Range or ceiling |
| `temperature` | enum | `hot` · `warm` · `cold` · `disqualified` · `unknown` |
| `objection` | string | A notable objection |
| `notes` | string | Anything else short and factual |

Rule: at least one field must be present. Result: `{ ok, profile }`.

## `capture_lead`

Sends a prospect to the CRM / inbox. Only after explicit agreement in the conversation.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | ✓ | |
| `email` | string | ✓ | Must look like an email; otherwise rejected with a reason |
| `need_summary` | string | ✓ | One or two sentences |
| `temperature` | enum | ✓ | as above |
| `consent` | boolean | ✓ | Must be `true`; the executor refuses otherwise |
| `phone`, `company`, `location`, `budget_range`, `timeline`, `recommended_offer`, `notes` | string | | `phone` when the knowledge base requires it for the next step |
| `lead_type` | enum | | `prospect` · `existing_client` · `partner` · `other` |

Result: `{ ok, lead_id, delivered_to: "local_inbox" | "crm_webhook", next_step }`.

Webhook payload (`LEAD_WEBHOOK_URL`):

```json
{
  "event": "lead.captured",
  "lead": {
    "lead_id": "lead_…",
    "captured_at": "2026-09-21T14:02:11.000Z",
    "source": "website_concierge",
    "name": "Sam Rivera",
    "email": "sam@acme-hvac.com",
    "need_summary": "Missing after-hours calls; leads go cold.",
    "temperature": "hot",
    "consent": true,
    "profile_snapshot": { "need": "…", "role": "…", "timeline": "…", "budget_range": "…", "temperature": "hot" }
  }
}
```

## `trigger_calendar`

Books an appointment in **two steps**, so the model can never claim something is booked that is not.

| Field | Type | Required | Notes |
|---|---|---|---|
| `meeting_type` | string | ✓ | A meeting type named in the knowledge base |
| `prospect_name` | string | ✓ | |
| `purpose` | string | ✓ | One line the human reads before the visit |
| `phone` / `email` | string | one of | At least one contact; the knowledge base says which the business needs (home services: mobile) |
| `location` | string | | City, ZIP or address, when the knowledge base requires it for booking |
| `company`, `preferred_times`, `timezone` | string | | |
| `selected_window` | string | step 2 | The `id` of a window from step 1's `available_windows` |

**Step 1** (no `selected_window`) → `{ ok, confirmed: false, meeting_type, available_windows: [{ id, label, start }], booking_url, instructions }`. The runtime generates 2-hour windows inside business hours (`availableWindows()` in `tools.js`); in production, swap that for your calendar API. The UI renders the windows as buttons.

**Step 2** (with `selected_window`) → `{ ok, confirmed: true, booking_id, meeting_type, window, confirmation_sent_to, instructions }`. An unknown or stale id returns `ok: false` with a fresh `available_windows` list so the model re-offers.

Only a `confirmed: true` result lets the prompt say "booked".

## `escalate_to_human`

Routes to a person. For `emergency`, the prompt gives any safety instruction from the knowledge base before collecting details, and never books a calendar slot instead.

| Field | Type | Required | Notes |
|---|---|---|---|
| `reason` | enum | ✓ | `support` · `complaint` · `enterprise` · `unanswered_question` · `sensitive` · `emergency` · `visitor_requested` |
| `summary` | string | ✓ | 2–3 sentences a human can act on |
| `urgency` | enum | ✓ | `low` · `normal` · `high` |
| `name`, `email`, `phone` | string | | |
| `preferred_channel` | enum | | `email` · `phone` · `chat` |

Result: `{ ok, ticket_id, delivered_to, fallback_email, business_hours }`.

Webhook payload (`HANDOFF_WEBHOOK_URL`): `{ "event": "handoff.requested", "ticket": { "ticket_id", "created_at", ...input, "profile_snapshot" } }`.

## Error contract

Every executor returns an object; it never throws. On failure:

```json
{ "ok": false, "error": "webhook responded 500", "fallback": "Give the visitor hello@… or https://cal.com/… and continue." }
```

The runtime marks the `tool_result` with `is_error: true`. Invalid input (schema or business rule) is returned as:

```json
{ "ok": false, "error": "INVALID_INPUT", "details": ["consent must be true; ask the visitor first"], "received": { … } }
```

so the model can ask the visitor for what is missing instead of guessing.

## Adding a tool

1. Add the schema to `TOOLS` in `agent/tools.js` (keep `additionalProperties: false`, list `required`).
2. Add a handler in `createToolExecutor`; return an object, never throw.
3. Add any business rules to `validateToolInput`.
4. Describe when to call it in `<tool_and_action_handling>` of `prompts/ACCRE_SYSTEM_PROMPT.md`.
5. Render it in `agent/app.js` (`CARD_TITLES` / `completeToolCard`) if the visitor should see a card.
6. Add a test in `tests/tools.test.mjs`; `npm test` already checks that every tool named in the prompt exists.
