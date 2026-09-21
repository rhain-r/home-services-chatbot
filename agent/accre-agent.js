/**
 * ACCRE agent runtime — the live, Claude-powered concierge.
 *
 * One conversation = one agent instance. `send()` streams the reply, runs any
 * tool calls the model makes (validated first), feeds the results back, and
 * loops until the model ends its turn.
 *
 * Runs in Node (agent/cli.mjs) and behind any server you put in front of it
 * (see docs/architecture.md). The web demo in agent/index.html does not use
 * this module; it runs the scripted demo-engine.js so visitors need no key.
 */

import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, validateToolInput, createToolExecutor } from "./tools.js";

export const DEFAULT_MODEL = "claude-opus-5";
export const DEFAULT_EFFORT = "medium";
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.systemPrompt        - output of buildSystemPrompt()
 * @param {object} options.business            - from business-config.js
 * @param {(event: object) => void} options.onEvent
 *   Events: text_delta {text} · tool_call {id,name,input} · tool_result {id,name,result,isError}
 *           turn_end {stopReason, usage, totals} · refusal {} · notice {text}
 * @param {string} [options.model]
 * @param {string} [options.effort]            - low | medium | high | xhigh | max
 * @param {object} [options.integrations]      - { leadWebhookUrl, handoffWebhookUrl, webhookSecret }
 * @param {object} [options.hooks]             - see createToolExecutor
 * @param {number} [options.maxTokens]         - per-response ceiling (thinking + text)
 * @param {number} [options.maxToolRounds]     - tool round-trips allowed per visitor message
 */
export function createAgent({
  apiKey,
  systemPrompt,
  business,
  onEvent = () => {},
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
  integrations = {},
  hooks = {},
  maxTokens = 16000,
  maxToolRounds = 6,
}) {
  if (!apiKey) throw new Error("createAgent: apiKey is required");
  if (!systemPrompt) throw new Error("createAgent: systemPrompt is required");

  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const execute = createToolExecutor({ business, integrations, hooks });

  /** @type {import("@anthropic-ai/sdk").Anthropic.MessageParam[]} */
  let messages = [];
  const totals = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, requests: 0 };
  let busy = false;

  function addUsage(usage) {
    totals.requests += 1;
    totals.input_tokens += usage.input_tokens ?? 0;
    totals.output_tokens += usage.output_tokens ?? 0;
    totals.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
    totals.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
  }

  async function runTools(toolUses) {
    const results = [];
    for (const tu of toolUses) {
      onEvent({ type: "tool_call", id: tu.id, name: tu.name, input: tu.input });

      // The tolerant streaming parser can hand back a silently truncated object,
      // so every input is checked against its schema before anything runs.
      const check = validateToolInput(tu.name, tu.input);
      const result = check.ok
        ? await execute(tu.name, check.value)
        : { ok: false, error: "INVALID_INPUT", details: check.errors, received: tu.input };

      onEvent({ type: "tool_result", id: tu.id, name: tu.name, result, isError: !result.ok });
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        is_error: !result.ok,
        content: JSON.stringify(result),
      });
    }
    return results;
  }

  /**
   * Send one visitor message and stream the concierge's reply through onEvent.
   * Resolves when the model ends its turn. Rejects on API errors or abort.
   */
  async function send(userText, { signal } = {}) {
    if (busy) throw new Error("agent is already processing a message");
    const text = String(userText ?? "").trim();
    if (!text) return;
    busy = true;

    messages.push({ role: "user", content: text });

    let rounds = 0;
    let jsonRetries = 0;
    let toolsExhausted = false;

    try {
      while (true) {
        const stream = client.messages.stream(
          {
            model,
            max_tokens: maxTokens,
            // Stable prefix first (system + tools) so prompt caching hits on every turn.
            system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
            thinking: { type: "adaptive" },
            output_config: { effort },
            tools: TOOLS,
            ...(toolsExhausted ? { tool_choice: { type: "none" } } : {}),
            messages,
          },
          { signal },
        );

        stream.on("text", (delta) => onEvent({ type: "text_delta", text: delta }));

        let message;
        try {
          message = await stream.finalMessage();
          jsonRetries = 0;
        } catch (err) {
          // Only a tool input the SDK could not parse at all is worth re-issuing;
          // typed API errors (auth, rate limit, abort) propagate to the UI.
          if (err instanceof Anthropic.APIError || signal?.aborted || jsonRetries++ >= 1) throw err;
          onEvent({ type: "notice", text: "Malformed tool input from the model; retrying the turn." });
          continue;
        }

        addUsage(message.usage);

        if (message.stop_reason === "refusal") {
          // Nothing usable was produced; leave history as-is (consecutive user turns are allowed).
          onEvent({ type: "refusal" });
          onEvent({ type: "turn_end", stopReason: "refusal", usage: message.usage, totals: { ...totals } });
          return;
        }

        if (message.stop_reason === "pause_turn") {
          messages.push({ role: "assistant", content: message.content });
          continue;
        }

        const toolUses = message.content.filter((b) => b.type === "tool_use");

        if (message.stop_reason === "max_tokens" && toolUses.length > 0) {
          throw new Error("The reply was cut off while preparing an action (max_tokens). Please try again.");
        }

        // Echo the full content (including thinking blocks) back unchanged.
        messages.push({ role: "assistant", content: message.content });

        if (message.stop_reason !== "tool_use" || toolUses.length === 0) {
          onEvent({ type: "turn_end", stopReason: message.stop_reason, usage: message.usage, totals: { ...totals } });
          return;
        }

        rounds += 1;
        if (rounds > maxToolRounds) {
          // Answer the tool calls with an error and force a text-only final turn.
          messages.push({
            role: "user",
            content: toolUses.map((tu) => ({
              type: "tool_result",
              tool_use_id: tu.id,
              is_error: true,
              content: JSON.stringify({ ok: false, error: "Tool budget for this turn is exhausted. Reply to the visitor without tools." }),
            })),
          });
          toolsExhausted = true;
          continue;
        }

        const results = await runTools(toolUses);
        messages.push({ role: "user", content: results });
      }
    } finally {
      busy = false;
    }
  }

  return {
    send,
    reset() {
      messages = [];
    },
    /** Read-only snapshot of the API-shaped transcript. */
    getMessages: () => structuredClone(messages),
    getTotals: () => ({ ...totals }),
    isBusy: () => busy,
    model,
    effort,
  };
}

/** Turn an SDK error into a sentence the UI can show. */
export function describeError(err) {
  if (err instanceof Anthropic.APIUserAbortError) return "Stopped.";
  if (err instanceof Anthropic.AuthenticationError) return "That API key was rejected. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key is not allowed to use that model.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the API. Wait a moment and try again.";
  if (err instanceof Anthropic.BadRequestError) return `The API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach api.anthropic.com. Check your connection.";
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
