/**
 * UI controller for the demo page: the client's website, the concierge chat
 * widget (what the customer sees) and the "What the business sees" drawer.
 *
 * The concierge is agent/demo-engine.js: a scripted agent that walks the same
 * stages and fires the same tools as the Claude-powered runtime
 * (agent/accre-agent.js) with no API key and no network. This file only
 * renders; it never decides what the agent says.
 *
 * Customer view shows only what a real customer would see: messages, quick
 * replies, and plain cards (pick a window, booked, sent, dispatcher notified).
 * Tool names, JSON and lead notes live in the business drawer only.
 */

import { business } from "./business-config.js";
import { createDemoAgent } from "./demo-engine.js";

const $ = (sel) => document.querySelector(sel);
const els = {
  launcher: $("#launcher"), unread: $("#unread"), teaser: $("#teaser"), teaserClose: $("#teaser-close"),
  panel: $("#panel"), panelMin: $("#panel-min"), reset: $("#reset"),
  messages: $("#messages"), chips: $("#chips"), composer: $("#composer"), input: $("#input"), send: $("#send"), stop: $("#stop"),
  agentSub: $("#agent-sub"),
  drawer: $("#drawer"), drawerClose: $("#drawer-close"), viewVisitor: $("#view-visitor"), viewBusiness: $("#view-business"),
  temp: $("#temp"), tempLabel: $("#temp-label"), profile: $("#profile"), contact: $("#contact"),
  log: $("#log"), logEmpty: $("#log-empty"), actionCount: $("#action-count"), inbox: $("#inbox"), inboxEmpty: $("#inbox-empty"),
  restartDemo: $("#restart-demo"),
  about: $("#about"), openAbout: $("#open-about"), aboutClose: $("#about-close"),
};

const store = {
  get(k, fallback = "") { try { return localStorage.getItem(`accre.${k}`) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { v ? localStorage.setItem(`accre.${k}`, v) : localStorage.removeItem(`accre.${k}`); } catch { /* private mode */ } },
};

// ─── State ───────────────────────────────────────────────────────────────────
let agent = null;
let controller = null;
let current = null;
let actionCount = 0;
let autoScroll = true;
let unread = 0;
const contact = {};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Minimal, safe markdown: paragraphs, bullets, **bold**, links. */
function md(text) {
  const inline = (s) => escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])((https?:\/\/)[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return text.trim().split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-•*]\s+/, ""))}</li>`).join("")}</ul>`;
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).join("");
}

const ICONS = {
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M3 10h18M8 3v4m8-4v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="m8 12 3 3 5-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M3 11.5 21 3l-8.5 18-2-7.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M12 10v4m0 3v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

function scrollToBottom(force = false) { if (autoScroll || force) els.messages.scrollTop = els.messages.scrollHeight; }
els.messages.addEventListener("scroll", () => {
  const { scrollTop, scrollHeight, clientHeight } = els.messages;
  autoScroll = scrollHeight - scrollTop - clientHeight < 60;
});

// ─── Messages ────────────────────────────────────────────────────────────────
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
  if (!current.textEl) { current.textEl = document.createElement("div"); current.text = ""; current.bubble.appendChild(current.textEl); }
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

// ─── Cards in the chat (customer-facing, plain language) ─────────────────────
function addToolCard(evt) {
  if (evt.name === "update_lead_profile") return; // internal notes never appear in the customer view
  if (!current) startAssistantMessage();
  if (current.typing) { current.typing.remove(); current.typing = null; }
  current.textEl = null; // any text after this card starts a new part
  const card = document.createElement("div");
  card.className = "action";
  card.innerHTML = `<div class="title">${ICONS.calendar}<span>One moment…</span></div>`;
  current.bubble.appendChild(card);
  current.cards.set(evt.id, card);
  scrollToBottom();
}

function completeToolCard(evt) {
  const card = current?.cards.get(evt.id);
  if (!card) return;
  const r = evt.result ?? {};
  if (evt.isError) {
    card.className = "action error";
    card.innerHTML = `<div class="title">${ICONS.alert}<span>That didn't go through</span></div><div class="meta">${escapeHtml(r.error ?? "Please try again, or call " + business.phone + ".")}</div>`;
    return;
  }
  if (evt.name === "trigger_calendar" && !r.confirmed && r.available_windows?.length) {
    card.className = "action calendar";
    card.innerHTML = `<div class="title">${ICONS.calendar}<span>Pick an arrival window</span></div>
      <div class="meta">${escapeHtml(r.meeting_type)} · 2-hour windows · the tech texts 30 minutes before</div>
      <div class="windows">${r.available_windows.map((w) => `<button type="button" class="window-btn" data-window="${escapeHtml(w.label)}">${escapeHtml(w.label)}</button>`).join("")}</div>`;
    for (const b of card.querySelectorAll(".window-btn")) {
      b.addEventListener("click", () => {
        if (controller) return;
        for (const x of card.querySelectorAll(".window-btn")) { x.disabled = true; x.classList.toggle("picked", x === b); }
        sendMessage(b.dataset.window);
      });
    }
  } else if (evt.name === "trigger_calendar" && r.confirmed) {
    card.className = "action booked";
    card.innerHTML = `<div class="title">${ICONS.check}<span>Booked: ${escapeHtml(r.window.label)}</span></div>
      <div class="meta">${escapeHtml(r.meeting_type)} · confirmation ${r.confirmation_sent_to?.length ? "sent to " + escapeHtml(r.confirmation_sent_to.join(" and ")) : "on its way"}</div>`;
  } else if (evt.name === "trigger_calendar") {
    card.className = "action calendar";
    card.innerHTML = `<div class="title">${ICONS.calendar}<span>Book online</span></div><a class="fallback" href="${escapeHtml(r.booking_url)}" target="_blank" rel="noopener">Open the booking page ↗</a>`;
  } else if (evt.name === "capture_lead") {
    card.className = "action lead";
    card.innerHTML = `<div class="title">${ICONS.send}<span>Sent to the office</span></div><div class="meta">They'll follow up; no pressure either way.</div>`;
  } else if (evt.name === "escalate_to_human") {
    const emergency = evt.input?.reason === "emergency";
    card.className = "action handoff";
    card.innerHTML = `<div class="title">${ICONS.phone}<span>${emergency ? "Dispatcher notified" : "A person has been notified"}</span></div>
      <div class="meta">${emergency ? "Expect a call within 15 minutes." : "The office will call you back."} If not, call <a href="tel:${escapeHtml(business.phone.replace(/\D/g, ""))}">${escapeHtml(business.phone)}</a>.</div>`;
  }
  scrollToBottom();
}

// ─── What the business sees ──────────────────────────────────────────────────
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

/** One plain sentence per tool call, for people who don't read JSON. */
function describeAction(evt) {
  const i = evt.input ?? {};
  switch (evt.name) {
    case "update_lead_profile": {
      const keys = Object.keys(i).filter((k) => k !== "temperature").map((k) => ({ need: "need", role: "authority", timeline: "timing", budget_range: "budget", location: "area", objection: "objection", notes: "notes", company: "company" }[k] ?? k));
      return `Noted ${keys.length ? keys.join(", ") : "lead temperature"}${i.temperature ? ` · marked ${i.temperature}` : ""}`;
    }
    case "trigger_calendar": return i.selected_window ? `Booked the ${i.meeting_type.toLowerCase()} for ${i.prospect_name}` : `Offered arrival windows for a ${i.meeting_type.toLowerCase()}`;
    case "capture_lead": return `Sent ${i.name}'s details to the office (${i.temperature} lead)`;
    case "escalate_to_human": return i.reason === "emergency" ? `Paged the on-call dispatcher (urgency ${i.urgency})` : `Handed off to a person (${i.reason.replace(/_/g, " ")}, ${i.urgency})`;
    default: return evt.name;
  }
}

function logAction(evt) {
  actionCount += 1;
  els.actionCount.textContent = `${actionCount} action${actionCount === 1 ? "" : "s"}`;
  els.logEmpty.classList.add("hidden");
  const li = document.createElement("li");
  li.dataset.id = evt.id;
  li.innerHTML = `<span class="what">${escapeHtml(describeAction(evt))}</span>
    <div class="row"><span class="name">${escapeHtml(evt.name)}</span><button type="button" class="linkish">data</button><span class="pending">…</span></div>
    <pre class="hidden">${escapeHtml(JSON.stringify({ input: evt.input }, null, 2))}</pre>`;
  li.querySelector("button").addEventListener("click", () => li.querySelector("pre").classList.toggle("hidden"));
  els.log.prepend(li);

  const i = evt.input ?? {};
  if (evt.name !== "update_lead_profile") renderContact({ name: i.prospect_name ?? i.name, phone: i.phone, email: i.email, location: i.location });
  else if (i.location) renderContact({ location: i.location });
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
  if (evt.name === "trigger_calendar" && evt.result?.confirmed) {
    li.querySelector(".what").textContent = `Booked ${evt.result.window.label} (${evt.result.meeting_type})`;
  }
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
  onLeadCaptured: (lead) => addInbox("lead", `New lead: ${lead.name} · ${lead.temperature}`, `${lead.phone ?? lead.email} — ${lead.need_summary}`),
  onCalendar: (b) => { if (b.status === "confirmed") addInbox("booking", `Booked: ${b.meeting_type} · ${b.window.label}`, `${b.prospect_name} · ${b.phone ?? b.email}${b.location ? " · " + b.location : ""} — ${b.purpose}`); },
  onHandoff: (t) => addInbox("handoff", t.reason === "emergency" ? `Dispatch: ${t.name ?? "caller"} · ${t.phone ?? ""}` : `Call-back: ${t.reason.replace(/_/g, " ")} (${t.urgency})`, t.summary),
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

// ─── Quick replies ───────────────────────────────────────────────────────────
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
  els.agentSub.innerHTML = busy ? `<i class="dot"></i> ${escapeHtml(business.agentName)} is typing…` : `<i class="dot"></i> ${escapeHtml(business.shortName)} · online now`;
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
  els.chips.innerHTML = "";
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
    if (isChatOpen() && window.innerWidth > 640) els.input.focus();
  }
}

els.composer.addEventListener("submit", (e) => { e.preventDefault(); sendMessage(els.input.value); });
els.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(els.input.value); } });
els.stop.addEventListener("click", () => controller?.abort());
function autosize() { els.input.style.height = "auto"; els.input.style.height = Math.min(els.input.scrollHeight, 120) + "px"; }
els.input.addEventListener("input", autosize);

// ─── Widget open / close ─────────────────────────────────────────────────────
const isChatOpen = () => document.body.classList.contains("chat-open");

function bumpUnread() { unread += 1; els.unread.textContent = String(unread); els.unread.classList.remove("hidden"); }

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
function closeChat() { document.body.classList.remove("chat-open"); els.panel.classList.add("hidden"); }

els.launcher.addEventListener("click", () => (isChatOpen() ? closeChat() : openChat()));
els.panelMin.addEventListener("click", closeChat);
els.teaser.addEventListener("click", (e) => { if (e.target !== els.teaserClose) openChat(); });
els.teaserClose.addEventListener("click", () => { els.teaser.classList.add("hidden"); store.set("teaserDismissed", "1"); });

// Any element on the site with data-chat-prompt hands that line to the concierge.
for (const el of document.querySelectorAll("[data-chat-prompt]")) {
  el.addEventListener("click", (e) => { e.preventDefault(); openChat(); if (!controller) sendMessage(el.dataset.chatPrompt); });
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
  els.actionCount.textContent = "0 actions";
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
  addMessage("assistant", md(`Hi, I'm ${business.agentName} with ${business.shortName}. Heating, cooling or roof — what's going on? I can book a visit, give you straight pricing, or get the on-call team if it's urgent.`));
  renderChips();
}
els.reset.addEventListener("click", resetConversation);
els.restartDemo.addEventListener("click", () => { resetConversation(); if (!isChatOpen()) openChat(); });

// ─── Boot ────────────────────────────────────────────────────────────────────
$("#agent-name").textContent = business.agentName;
$("#agent-avatar").textContent = business.agentName[0];
agent = createDemoAgent({ business, onEvent, hooks });
resetConversation();
setBusy(false);

if (store.get("businessView") === "1" && window.innerWidth > 900) setBusinessView(true);
const seen = store.get("chatSeen") === "1";
if (!seen) {
  setTimeout(() => { if (!isChatOpen() && store.get("teaserDismissed") !== "1") els.teaser.classList.remove("hidden"); }, 1200);
  if (window.innerWidth > 900) setTimeout(() => { if (!isChatOpen()) openChat(); }, 3200);
  else bumpUnread();
} else if (store.get("teaserDismissed") !== "1") {
  setTimeout(() => { if (!isChatOpen()) els.teaser.classList.remove("hidden"); }, 1500);
}
