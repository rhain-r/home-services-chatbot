/**
 * System prompt builder.
 *
 * Takes prompts/ACCRE_SYSTEM_PROMPT.md, fills every [PLACEHOLDER] from the
 * business config, injects the knowledge base and today's date, and returns
 * the final string sent as the `system` parameter.
 *
 * Runs unchanged in the browser and in Node.
 */

import { business, placeholderValues } from "./business-config.js";

const PROMPT_URL = new URL("../prompts/ACCRE_SYSTEM_PROMPT.md", import.meta.url);
const KB_URL = new URL("./knowledge-base.md", import.meta.url);

/** Read a text file relative to this module, in either runtime. */
async function loadText(url) {
  if (typeof window === "undefined" && url.protocol === "file:") {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    return readFile(fileURLToPath(url), "utf8");
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
  return res.text();
}

export function loadPromptTemplate() {
  return loadText(PROMPT_URL);
}

export function loadKnowledgeBase() {
  return loadText(KB_URL);
}

/** ISO date (YYYY-MM-DD) with no time component, so the prompt prefix stays cache-stable within a day. */
export function todayISO(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Fill the template. Throws if any [UPPER_CASE] placeholder is left unfilled,
 * which is the failure mode you want to catch in tests, not in production.
 */
export function buildSystemPrompt({
  template,
  knowledgeBase,
  config = business,
  today = todayISO(),
}) {
  if (typeof template !== "string" || !template.trim()) {
    throw new Error("buildSystemPrompt: template is empty");
  }
  if (typeof knowledgeBase !== "string" || !knowledgeBase.trim()) {
    throw new Error("buildSystemPrompt: knowledgeBase is empty");
  }

  const values = {
    ...placeholderValues(config),
    CURRENT_DATE: today,
    KNOWLEDGE_BASE: knowledgeBase.trim(),
  };

  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`[${key}]`).join(String(value));
  }

  const leftover = out.match(/\[[A-Z][A-Z_]+\]/g);
  if (leftover) {
    throw new Error(
      `buildSystemPrompt: unfilled placeholders: ${[...new Set(leftover)].join(", ")}`,
    );
  }
  return out;
}

/** Convenience: load both files and build in one call. */
export async function loadSystemPrompt(options = {}) {
  const [template, knowledgeBase] = await Promise.all([
    loadPromptTemplate(),
    loadKnowledgeBase(),
  ]);
  return buildSystemPrompt({ template, knowledgeBase, ...options });
}
