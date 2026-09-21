# Architecture

ACCRE is deliberately small: one prompt, one knowledge base, four tools, one runtime. Everything else is presentation.

```
   ┌──────────────────────────────────────┐     ┌──────────────────────────────────────┐
   │  agent/index.html + app.js           │     │  agent/cli.mjs  ·  your server       │
   │  demo site + widget + Business view  │     │  (Node)                              │
   └───────────────┬──────────────────────┘     └───────────────┬──────────────────────┘
                   ▼                                            ▼
   ┌──────────────────────────────────────┐     ┌──────────────────────────────────────┐
   │ demo-engine.js                       │     │ accre-agent.js                       │
   │ scripted, no key, no network         │     │ Claude via @anthropic-ai/sdk         │
   │ same stages, same tools              │     │ streaming manual tool loop           │
   └───────────────┬──────────────────────┘     └───────────────┬──────────────────────┘
                   │                                            │
                   │              ┌───────────────────────────┐ │
                   │              │ system-prompt.js          │◄┘
                   │              │ ACCRE_SYSTEM_PROMPT.md    │
                   │              │ + business-config.js      │
                   │              │ + knowledge-base.md       │
                   │              └───────────────────────────┘
                   ▼                                            ▼
   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │ tools.js — schemas, validation, executors                                        │
   │ update_lead_profile · capture_lead · trigger_calendar · escalate_to_human        │
   │ → local inbox (demo)   or   → LEAD_WEBHOOK_URL / HANDOFF_WEBHOOK_URL             │
   └──────────────────────────────────────────────────────────────────────────────────┘
```

## The request

Every turn of the live runtime is one `client.messages.stream()` call:

| Parameter | Value | Why |
|---|---|---|
| `model` | `claude-opus-5` (`ANTHROPIC_MODEL`) | Default to the most capable model; switch to Sonnet 5 / Haiku 4.5 per deployment |
| `system` | built prompt, `cache_control: ephemeral` | ~37K characters, identical across turns within a day → prompt cache hits from turn 2 |
| `tools` | `TOOLS` from `tools.js`, `eager_input_streaming: true` | Fixed order keeps the cached prefix stable; eager streaming means we validate inputs ourselves |
| `thinking` | `{ type: "adaptive" }` | Model decides when to reason; effort caps the spend |
| `output_config.effort` | `medium` (configurable) | Chat replies do not need `xhigh`; tune per deployment |
| `max_tokens` | 16 000 | Ceiling for thinking + reply; a public widget wants a hard cap |
| `messages` | full transcript incl. thinking and tool blocks | Echoed back unchanged, as the API requires |

## The loop

```
send(userText)
  push user message
  loop:
    stream request → text deltas go to the UI as they arrive
    message = finalMessage()
    refusal?      → tell UI, stop
    pause_turn?   → push assistant content, continue
    max_tokens with a tool_use? → error (never run a truncated tool input)
    push assistant content
    no tool_use?  → turn_end, stop
    for each tool_use:
        validateToolInput(name, input)   ← schema + business rules
        execute(name, input)             ← side effects live here
        collect tool_result (is_error on failure)
    push tool results as one user message
    more than 6 rounds? → tool_choice: none on the next request
```

Validation happens before execution because `eager_input_streaming` turns off server-side input validation; the tolerant streaming parser can hand back a truncated object without throwing. Invalid input goes back to the model as an `is_error` tool result with the reasons, so it can correct itself.

## Running it for real

The hosted page is a demo on sample data; it never calls a model, so it never needs a secret. The live runtime lives in `agent/accre-agent.js` and runs anywhere Node runs:

- **Terminal:** `npm run chat` (`agent/cli.mjs`) — streamed replies, every tool call with its JSON, per-turn token usage.
- **Behind your website:** wrap the module in a small server that holds `ANTHROPIC_API_KEY` (a Node handler, a Cloudflare Worker, a container) and forward the same event stream to your chat widget over SSE or WebSocket. Keep one agent instance per conversation, rate-limit by IP, cap history length, and keep the tool executors server-side so webhook URLs and secrets never reach the browser. The module needs no changes; only the transport is new.

## Prompt caching

The prefix is `tools → system → messages`. Tools are a constant array; the system prompt is built once per process and only changes when the date rolls over (the date is `YYYY-MM-DD`, never a timestamp). The CLI prints `cached` tokens after every turn so you can see the hit rate: expect 0 on the first request of a conversation and most of the input after.

## Demo engine

`demo-engine.js` is a keyword-and-state-machine agent scripted for the sample business. It exists so a visitor can experience the full flow on a static page without a key, and so the UI can be tested deterministically. It is not the product; the system prompt is. The engine uses the same tool executor as the live runtime, which is why the Business view, inbox and cards look the same whichever one is driving.

## The demo page

`agent/index.html` is deliberately a client's website, not a product page: header, hero, services, pricing, reviews, service area, footer. The concierge is the floating widget, and any element with `data-chat-prompt="…"` opens the widget and hands that line to the agent, so "Book a visit", "Get pricing" and "Check my ZIP" all route through the concierge.

The **customer view** shows nothing internal: no tool names, no lead notes, no JSON. Tool results become plain cards — "Pick an arrival window" (buttons), "Booked: Tomorrow 9–11 AM", "Sent to the office", "Dispatcher notified". The **What the business sees** drawer renders the other side: contact details from whichever tool carried them, the lead profile from `update_lead_profile`, each action in a plain sentence with its data behind a toggle, and the inbox. A thin bar at the top is the only thing on the page that admits it is a demo.
