import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  loadPromptTemplate,
  loadKnowledgeBase,
  loadSystemPrompt,
  todayISO,
} from "../agent/system-prompt.js";
import { business } from "../agent/business-config.js";

const REQUIRED_SECTIONS = [
  "system_instructions",
  "tone_and_persona",
  "triage_and_routing",
  "qualification_framework",
  "guardrails",
  "tool_and_action_handling",
  "knowledge_base",
];

test("template and knowledge base load from disk", async () => {
  const [template, kb] = await Promise.all([loadPromptTemplate(), loadKnowledgeBase()]);
  assert.ok(template.length > 5000, "template looks too short");
  assert.ok(kb.length > 1000, "knowledge base looks too short");
});

test("built prompt has every section and no unfilled placeholders", async () => {
  const prompt = await loadSystemPrompt({ today: "2026-09-21" });
  for (const tag of REQUIRED_SECTIONS) {
    assert.ok(prompt.includes(`<${tag}>`) && prompt.includes(`</${tag}>`), `missing <${tag}>`);
  }
  assert.equal(prompt.match(/\[[A-Z][A-Z_]+\]/g), null, "unfilled placeholder left in prompt");
  assert.ok(prompt.includes(business.name));
  assert.ok(prompt.includes(business.agentName));
  assert.ok(prompt.includes(business.bookingUrl));
  assert.ok(prompt.includes("Today: 2026-09-21"));
  // Knowledge base is injected inside its tag, not somewhere else.
  const kbStart = prompt.indexOf("<knowledge_base>");
  assert.ok(prompt.indexOf("## Services") > kbStart);
});

test("every tool the prompt names is a real tool", async () => {
  const { TOOL_NAMES } = await import("../agent/tools.js");
  const prompt = await loadSystemPrompt();
  for (const name of TOOL_NAMES) assert.ok(prompt.includes(name), `prompt never mentions ${name}`);
});

test("unknown placeholders fail loudly", () => {
  assert.throws(
    () => buildSystemPrompt({ template: "Hello [BUSINESS_NAME] and [NOT_A_THING]", knowledgeBase: "kb" }),
    /unfilled placeholders: \[NOT_A_THING\]/,
  );
});

test("empty inputs are rejected", () => {
  assert.throws(() => buildSystemPrompt({ template: "", knowledgeBase: "kb" }));
  assert.throws(() => buildSystemPrompt({ template: "x", knowledgeBase: "  " }));
});

test("todayISO has no time component (cache-stable prefix)", () => {
  assert.match(todayISO(new Date("2026-09-21T15:04:05Z")), /^2026-09-21$/);
});
