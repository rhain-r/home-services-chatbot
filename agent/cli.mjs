#!/usr/bin/env node
/**
 * Terminal chat with the concierge — proves the agent module is not tied to the
 * browser. Same prompt, same tools, same runtime as the live web demo.
 *
 *   npm install
 *   ANTHROPIC_API_KEY=sk-ant-... npm run chat
 *
 * Optional env: ANTHROPIC_MODEL, ANTHROPIC_EFFORT, LEAD_WEBHOOK_URL,
 * HANDOFF_WEBHOOK_URL, WEBHOOK_SECRET (see .env.example).
 */

import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { business } from "./business-config.js";
import { loadSystemPrompt } from "./system-prompt.js";
import { createAgent, describeError, DEFAULT_MODEL, DEFAULT_EFFORT } from "./accre-agent.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY (or copy .env.example to .env) and try again.");
  process.exit(1);
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const violet = (s) => `\x1b[35m${s}\x1b[0m`;

const systemPrompt = await loadSystemPrompt();

const agent = createAgent({
  apiKey,
  systemPrompt,
  business,
  model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
  effort: process.env.ANTHROPIC_EFFORT || DEFAULT_EFFORT,
  integrations: {
    leadWebhookUrl: process.env.LEAD_WEBHOOK_URL,
    handoffWebhookUrl: process.env.HANDOFF_WEBHOOK_URL,
    webhookSecret: process.env.WEBHOOK_SECRET,
  },
  onEvent(evt) {
    switch (evt.type) {
      case "text_delta":
        stdout.write(evt.text);
        break;
      case "tool_call":
        stdout.write(`\n${dim(`  ⚙ ${evt.name} ${JSON.stringify(evt.input)}`)}\n`);
        break;
      case "tool_result":
        stdout.write(`${dim(`  ${evt.isError ? "✗" : "✓"} ${JSON.stringify(evt.result)}`)}\n`);
        break;
      case "notice":
        stdout.write(`\n${dim(evt.text)}\n`);
        break;
      case "refusal":
        stdout.write(`\n${dim("(the model declined to answer)")}\n`);
        break;
      case "turn_end":
        stdout.write(`\n${dim(`  [${evt.totals.requests} req · in ${evt.totals.input_tokens + evt.totals.cache_read_input_tokens + evt.totals.cache_creation_input_tokens} · cached ${evt.totals.cache_read_input_tokens} · out ${evt.totals.output_tokens}]`)}\n\n`);
        break;
    }
  },
});

console.log(bold(`${business.agentName} · ${business.name}`), dim(`(${agent.model}, effort ${agent.effort}) — type "exit" to quit\n`));

const rl = readline.createInterface({ input: stdin, output: stdout });
while (true) {
  const line = (await rl.question(violet("you › "))).trim();
  if (!line) continue;
  if (["exit", "quit", "/q"].includes(line.toLowerCase())) break;
  stdout.write(bold(`${business.agentName} › `));
  try {
    await agent.send(line);
  } catch (err) {
    console.error(`\n${describeError(err)}\n`);
  }
}
rl.close();
