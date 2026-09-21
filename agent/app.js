/**
 * UI controller for the demo page: the client's website, the concierge chat
 * widget, and the "Business view" drawer.
 *
 * The concierge is agent/demo-engine.js: a scripted agent that walks the same
 * stages and fires the same tools as the Claude-powered runtime
 * (agent/accre-agent.js) with no API key and no network. This file only
 * renders; it never decides what the agent says.
 */

import { business } from "./business-config.js";
import { createDemoAgent } from "./demo-engine.js";

const $ = (sel) => document.querySelector(sel);
const els = {
  // widget
  widget: $("#widget"), launcher: $("#launcher"), unread: $("#unread"), teaser: $("#teaser"), teaserClose: $("#teaser-close"),
  panel: $("#panel"), panelMin: $("#panel-min"),
  messages: $("#messages"), chips: $("#chips"), composer: $("#composer"), input: $("#input"), send: $("#send"), stop: $("#stop"),
  reset: $("#reset"), showActions: $("#show-actions"), status: $("#status"), statusText: $("#status-text"),
  // drawer
  drawer: $("#drawer"), drawerClose: $("#drawer-close"), viewVisitor: $("#view-visitor"), viewBusiness: $("#view-business"),
  temp: $("#temp"), tempLabel: $("#temp-label"), profile: $("#profile"), contact: $("#contact"),
  log: $("#log"), logEmpty: $("#log-empty"), actionCount: $("#action-count"), inbox: $("#inbox"), inboxEmpty: $("#inbox-empty"),
  // about
  about: $("#about"), openAbout: $("#open-about"), aboutClose: $("#about-close"),
};

// ─── Persistence (per-browser conveniences only) ─────────────────────────────
const store = {
  get(k, fallback = "") {
    try { return localStorage.getItem(`accre.${k}`) ?? fallback; } catch { return fallback; }
  },
  set(k, v) {
    try { v ? localStorage.setItem(`accre.${k}`, v) : localStorage.removeItem(`accre.${k}`); } catch { /* private mode */ }
  },
};

// ─── State ───────────────────────────────────────────────────────────────────
let agent = null;
let controller = null;
let current = null;    // the assistant message being streamed
let actionCount = 0;
let autoScroll = true;
let unread = 0;
const contact = {};

// ─── Rendering helpers ───────────────────────────────────────────────────────
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Minimal, safe markdown: paragraphs, bullets, **bold**, links. */
function md(text) {
  const inline = (s) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])((https?:\/\/)[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return text.trim().split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
      return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-•*]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).join("");
}

function scrollToBottom(force = false) {
  if (autoScroll || force) els.messages.scrollTop = els.messages.scrollHeight;
}
els.messages.addEventListener("scroll", () => {
  const { scrollTop, scrollHeight, clientHeight } = els.messages;
  autoScroll = scrollHeight - scrollTop - clientHeight < 60;
});

function addMessage(role, html = "") {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  if (role === "assistant") {
    const av = document.createElement("div");
    av.className = "mini-avatar";
    av.textContent = business.agentName[0];
    el.appendChild(av);
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = html;
  el.appendChild(bubble);
  els.messages.appendChild(el);
  scrollToBottom();
  return { el, bubble };
}

function startAssistantMessage() {
  const { el, bubble } = addMessage("assistant", '<div class="typing"><i></i><i></i><i></i></div>');
  current = { el, bubble, textEl: null, text: "", typing: bubble.firstElementChild, cards: new Map(), counted: false };
}

function appendText(delta) {
  if (!current) startAssistantMessage();
  if (current.typing) { current.typing.remove(); current.typing = null; }
  if (!current.textEl) {
    current.textEl = document.createElement("div");
    current.text = "";
    current.bubble.appendChild(current.textEl);
  }
  current.text += delta;
  current.textEl.innerHTML = md(current.text);
  scrollToBottom();
  if (!current.counted && !isChatOpen()) { current.counted = true; bumpUnread(); }
}

function finishAssistantMessage() {
  if (!current) return;
  if (current.typing) current.typing.remove();
  if (!current.textEl && current.cards.size === 0) current.el.remove();
  current = null;
}

// ─── Action cards (inside the chat) ──────────────────────────────────────────
const CARD_TITLES = {
  trigger_calendar: ["calendar", "Opening the booking calendar"],
  capture_lead: ["lead", "Sending your details to the office"],
  escalate_to_human: ["handoff", "Reaching the on-call team"],
};

function addToolCard(evt) {
  if (!current) startAssistantMessage();
  if (current.typing) { current.typing.remove(); current.typing = null; }
  current.textEl = null; // text after this card starts a new part

  if (evt.name === "update_lead_profile") {
    const note = document.createElement("div");
    note.className = "action-note";
    const keys = Object.keys(evt.input).filter((k) => k !== "temperature");
    note.textContent = `↳ noted: ${keys.join(", ") || "temperature"}${evt.input.temperature ? ` · ${evt.input.temperature}` : ""}`;
    current.bubble.appendChild(note);
    current.cards.set(evt.id, note);
    scrollToBottom();
    return;
  }
  const [kind, title] = CARD_TITLES[evt.name] ?? ["generic", evt.name];
  const card = document.createElement("div");
  card.className = `action ${kind}`;
  card.innerHTML = `<div class="title"><span class="tag">${escapeHtml(evt.name)}</span>${escapeHtml(title)}…</div>`;
  current.bubble.appendChild(card);
  current.cards.set(evt.id, card);
  scrollToBottom();
}

function completeToolCard(evt) {
  const card = current?.cards.get(evt.id);
  if (!card || card.classList.contains("action-note")) return;
  const r = evt.result ?? {};
  const tag = `<span class="tag">${escapeHtml(evt.name)}</span>`;
  if (evt.isError) {
    card.classList.add("error");
    card.innerHTML = `<div class="title">${tag}Action failed</div><div class="meta">${escapeHtml(r.error ?? "unknown error")}${r.details ? " — " + escapeHtml(r.details.join("; ")) : ""}</div>`;
    return;
  }
  if (evt.name === "trigger_calendar") {
    card.innerHTML = `<div class="title">${tag}Booking calendar ready</div>
      <div class="meta">${escapeHtml(r.meeting_type)} · pick any slot that suits you</div>
      <a class="btn btn-primary" href="${escapeHtml(r.booking_url)}" target="_blank" rel="noopener">Open booking calendar ↗</a>`;
  } else if (evt.name === "capture_lead") {
    card.innerHTML = `<div class="title">${tag}Details sent to the office</div>
      <div class="meta">Reference ${escapeHtml(r.lead_id)} · delivered to ${escapeHtml(r.delivered_to === "crm_webhook" ? "the CRM" : "the inbox (see Business view)")}</div>`;
  } else if (evt.name === "escalate_to_human") {
    card.innerHTML = `<div class="title">${tag}A person has been notified</div>
      <div class="meta">Ticket ${escapeHtml(r.ticket_id)} · fallback: <a href="tel:${escapeHtml(business.phone.replace(/\D/g, ""))}">${escapeHtml(business.phone)}</a></div>`;
  }
  scrollToBottom();
}

// ─── Business view (drawer) ──────────────────────────────────────────────────
const CORE_FIELDS = new Set(["need", "role", "timeline", "budget_range", "location"]);

function renderProfile(profile) {
  for (const dd of els.profile.querySelectorAll("dd")) {
    const v = profile[dd.dataset.k];
    dd.textContent = v || (CORE_FIELDS.has(dd.dataset.k) ? "not yet known" : "—");
    dd.classList.toggle("empty", !v);
  }
  const t = profile.temperature ?? "unknown";
  for (const span of els.temp.children) span.classList.toggle("on", span.classList.contains(t));
  els.tempLabel.textContent = t === "unknown" ? "no signal yet" : t === "disqualified" ? "not a fit" : t.toUpperCase();
}

function renderContact(fields) {
  Object.assign(contact, Object.fromEntries(Object.entries(fields).filter(([, v]) => v)));
  for (const dd of els.contact.querySelectorAll("dd")) {
    const v = contact[dd.dataset.c];
    dd.textContent = v || "—";
    dd.classList.toggle("empty", !v);
  }
}

function logAction(evt) {
  actionCount += 1;
  els.actionCount.textContent = String(actionCount);
  els.logEmpty.classList.add("hidden");
  const li = document.createElement("li");
  li.dataset.id = evt.id;
  li.innerHTML = `<div class="row"><code>${escapeHtml(evt.name)}</code><button type="button" class="linkish">JSON</button><span class="pending">…</span></div>
    <pre class="hidden">${escapeHtml(JSON.stringify({ input: evt.input }, null, 2))}</pre>`;
  li.querySelector("button").addEventListener("click", () => li.querySelector("pre").classList.toggle("hidden"));
  els.log.prepend(li);

  // Contact details surface from whatever tool carried them.
  const i = evt.input;
  if (evt.name !== "update_lead_profile") {
    renderContact({ name: i.prospect_name ?? i.name, phone: i.phone, email: i.email, location: i.location });
  } else if (i.location) {
    renderContact({ location: i.location });
  }
}

function logResult(evt) {
  const li = els.log.querySelector(`li[data-id="${CSS.escape(evt.id)}"]`);
  if (!li) return;
  const badge = li.querySelector(".pending");
  badge.className = evt.isError ? "err" : "ok";
  badge.textContent = evt.isError ? "ERROR" : "OK";
  const pre = li.querySelector("pre");
  const shown = JSON.parse(pre.textContent);
  shown.result = evt.result;
  pre.textContent = JSON.stringify(shown, null, 2);
}

function addInbox(kind, title, meta) {
  els.inboxEmpty.classList.add("hidden");
  const li = document.createElement("li");
  li.className = kind;
  li.innerHTML = `<b>${escapeHtml(title)}</b><span>${escapeHtml(meta)}</span>`;
  els.inbox.prepend(li);
}

const hooks = {
  onProfileUpdate: renderProfile,
  onLeadCaptured: (lead) => addInbox("lead", `Lead: ${lead.name} · ${lead.temperature}`, `${lead.email}${lead.phone ? " · " + lead.phone : ""} — ${lead.need_summary}`),
  onCalendar: (b) => addInbox("booking", `Booking request: ${b.meeting_type} · ${b.prospect_name}`, b.purpose),
  onHandoff: (t) => addInbox("handoff", `Handoff (${t.reason}, ${t.urgency})`, t.summary),
};

// ─── Agent events ────────────────────────────────────────────────────────────
function onEvent(evt) {
  switch (evt.type) {
    case "text_delta": appendText(evt.text); break;
    case "tool_call": addToolCard(evt); logAction(evt); break;
    case "tool_result": completeToolCard(evt); logResult(evt); break;
    case "notice": addMessage("system", escapeHtml(evt.text)); break;
  }
}

// ─── Chips ───────────────────────────────────────────────────────────────────
function renderChips() {
  els.chips.innerHTML = "";
  for (const text of agent.suggestions()) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = text;
    b.addEventListener("click", () => sendMessage(text));
    els.chips.appendChild(b);
  }
}

// ─── Sending ─────────────────────────────────────────────────────────────────
function setBusy(busy) {
  els.status.classList.toggle("busy", busy);
  els.statusText.textContent = busy ? "Typing…" : "Online";
  els.send.classList.toggle("hidden", busy);
  els.stop.classList.toggle("hidden", !busy);
  els.input.disabled = busy;
  els.chips.style.pointerEvents = busy ? "none" : "";
  els.chips.style.opacity = busy ? "0.5" : "";
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || controller) return;
  els.input.value = "";
  autosize();
  addMessage("user", md(text));
  autoScroll = true;
  scrollToBottom(true);
  setBusy(true);
  startAssistantMessage();
  controller = new AbortController();
  try {
    await agent.send(text, { signal: controller.signal });
  } catch (err) {
    finishAssistantMessage();
    if (err?.name === "AbortError") addMessage("system", "Stopped.");
    else addMessage("error", escapeHtml(err.message));
    console.error(err);
  } finally {
    finishAssistantMessage();
    controller = null;
    setBusy(false);
    renderChips();
    if (isChatOpen()) els.input.focus();
  }
}

els.composer.addEventListener("submit", (e) => { e.preventDefault(); sendMessage(els.input.value); });
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(els.input.value); }
});
els.stop.addEventListener("click", () => controller?.abort());
function autosize() { els.input.style.height = "auto"; els.input.style.height = Math.min(els.input.scrollHeight, 120) + "px"; }
els.input.addEventListener("input", autosize);

// ─── Widget open / close ─────────────────────────────────────────────────────
const isChatOpen = () => document.body.classList.contains("chat-open");

function bumpUnread() {
  unread += 1;
  els.unread.textContent = String(unread);
  els.unread.classList.remove("hidden");
}

function openChat() {
  document.body.classList.add("chat-open");
  els.panel.classList.remove("hidden");
  els.teaser.classList.add("hidden");
  unread = 0;
  els.unread.classList.add("hidden");
  store.set("chatSeen", "1");
  scrollToBottom(true);
  if (window.innerWidth > 640) els.input.focus();
}

function closeChat() {
  document.body.classList.remove("chat-open");
  els.panel.classList.add("hidden");
}

els.launcher.addEventListener("click", () => (isChatOpen() ? closeChat() : openChat()));
els.panelMin.addEventListener("click", closeChat);
els.teaser.addEventListener("click", (e) => { if (e.target !== els.teaserClose) openChat(); });
els.teaserClose.addEventListener("click", () => { els.teaser.classList.add("hidden"); store.set("teaserDismissed", "1"); });

// Any element on the site with data-chat-prompt hands that line to the concierge.
for (const el of document.querySelectorAll("[data-chat-prompt]")) {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    openChat();
    if (!controller) sendMessage(el.dataset.chatPrompt);
  });
}

// ─── Business view ───────────────────────────────────────────────────────────
function setBusinessView(open) {
  document.body.classList.toggle("business-open", open);
  els.drawer.setAttribute("aria-hidden", String(!open));
  els.viewVisitor.classList.toggle("active", !open);
  els.viewBusiness.classList.toggle("active", open);
  store.set("businessView", open ? "1" : "");
  if (open && !isChatOpen() && window.innerWidth > 900) openChat();
}
els.viewVisitor.addEventListener("click", () => setBusinessView(false));
els.viewBusiness.addEventListener("click", () => setBusinessView(true));
els.drawerClose.addEventListener("click", () => setBusinessView(false));

// ─── About ───────────────────────────────────────────────────────────────────
els.openAbout.addEventListener("click", () => els.about.showModal());
els.aboutClose.addEventListener("click", () => els.about.close());
els.about.addEventListener("click", (e) => { if (e.target === els.about) els.about.close(); });

// ─── Conversation lifecycle ──────────────────────────────────────────────────
function clearConsole() {
  actionCount = 0;
  els.actionCount.textContent = "0";
  els.log.innerHTML = "";
  els.logEmpty.classList.remove("hidden");
  els.inbox.innerHTML = "";
  els.inboxEmpty.classList.remove("hidden");
  for (const k of Object.keys(contact)) delete contact[k];
  renderContact({});
  renderProfile({});
}

function resetConversation() {
  controller?.abort();
  els.messages.innerHTML = "";
  current = null;
  agent.reset();
  clearConsole();
  addMessage(
    "assistant",
    md(`Hi, I'm ${business.agentName}, ${business.shortName}'s concierge. Heating, cooling or roof: what's going on? I can book a visit, give you straight pricing, or get the on-call team if it's urgent.`),
  );
  renderChips();
}

els.reset.addEventListener("click", resetConversation);
els.showActions.addEventListener("change", () => {
  document.body.classList.toggle("hide-actions", !els.showActions.checked);
  store.set("showActions", els.showActions.checked ? "" : "off");
});

// ─── Boot ────────────────────────────────────────────────────────────────────
$("#agent-name").textContent = business.agentName;
$("#agent-avatar").textContent = business.agentName[0];
$("#agent-sub").textContent = `${business.shortName} · replies instantly`;
document.body.classList.toggle("hide-actions", store.get("showActions") === "off");
els.showActions.checked = store.get("showActions") !== "off";

agent = createDemoAgent({ business, onEvent, hooks });
resetConversation();

// First visit on a desktop: show the teaser, then open the chat so the concierge
// is the first thing a visitor meets. Returning visitors just get the launcher.
if (store.get("businessView") === "1" && window.innerWidth > 900) setBusinessView(true);
const seen = store.get("chatSeen") === "1";
if (!seen) {
  setTimeout(() => { if (!isChatOpen() && store.get("teaserDismissed") !== "1") els.teaser.classList.remove("hidden"); }, 1200);
  if (window.innerWidth > 900) setTimeout(() => { if (!isChatOpen()) openChat(); }, 3200);
  else bumpUnread();
} else if (store.get("teaserDismissed") !== "1") {
  setTimeout(() => { if (!isChatOpen()) els.teaser.classList.remove("hidden"); }, 1500);
}
