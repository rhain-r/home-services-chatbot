# Setup guide

## 1. Run it locally

The demo is plain HTML + ES modules, so it needs a static server (browsers block `import` and `fetch` over `file://`). Any of these work:

```bash
npm start                      # npx serve on http://localhost:8080
python3 -m http.server 8080    # or Python
```

Open <http://localhost:8080/agent/>.

## 2. Publish on GitHub Pages

1. Create a new repository on GitHub (for example `client-concierge`).
2. Push this folder:

   ```bash
   git init
   git add .
   git commit -m "ACCRE client concierge"
   git branch -M main
   git remote add origin https://github.com/<you>/client-concierge.git
   git push -u origin main
   ```

3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `/ (root)` → Save**.
4. Wait about a minute. Your demo is live at
   `https://<you>.github.io/client-concierge/agent/`
   (the repository root redirects there too).

Every later `git push` to `main` redeploys automatically. No build step, no secrets in the repo.

Keep the empty `.nojekyll` file at the root: it stops GitHub Pages from running Jekyll, which would otherwise turn `prompts/ACCRE_SYSTEM_PROMPT.md` and `agent/knowledge-base.md` into HTML pages and break the agent's runtime fetch.

## 3. Make it your business

| What to change | Where |
|---|---|
| Company name, agent name, CTA, booking link, support email, hours, service summary, ideal client, pricing posture | `agent/business-config.js` |
| Everything the agent is allowed to state as fact: services, prices, process, results, FAQ, objection facts, meeting types | `agent/knowledge-base.md` |
| Persona, tone, discovery method, objection playbooks, guardrails, tool protocol | `prompts/ACCRE_SYSTEM_PROMPT.md` (rarely needs edits) |
| Scripted demo conversation (only if you keep the no-key demo for your own business) | `agent/demo-engine.js` |
| The demo website itself (copy, sections, colours, CTAs that hand a prompt to the concierge via `data-chat-prompt`) | `agent/index.html`, `agent/styles.css` |

Run `npm test` after editing the config or the knowledge base: the tests fail if a placeholder is left unfilled or a section goes missing.

## 4. Where the API key goes

The web demo never needs one; it runs the scripted engine on sample data.

**Terminal chat with the live agent:** copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`, then:

```bash
npm install
npm run chat
```

**Production widget:** do not ship a key to visitors. Put `agent/accre-agent.js` behind a small server that holds the key; see `docs/architecture.md`.

## 5. Connect your CRM and Slack (optional)

In `.env` (used by the CLI and by any server you put in front of the runtime):

- `LEAD_WEBHOOK_URL` receives `POST { event: "lead.captured", lead: {...} }` every time `capture_lead` runs. Point it at Zapier, Make, n8n, HubSpot Workflows, or your own endpoint.
- `HANDOFF_WEBHOOK_URL` receives `POST { event: "handoff.requested", ticket: {...} }` on `escalate_to_human`. A Slack incoming webhook works if you add a tiny transform; most automation tools can map the JSON directly.
- `WEBHOOK_SECRET`, if set, is sent as the `X-Webhook-Secret` header so the receiver can verify the source.

Payload shapes are documented in `docs/tool-definitions.md`. If a webhook fails, the agent receives an error result, apologises once, and gives the visitor the support email and booking link instead.

## 6. Tests and CI

```bash
npm test
```

`node --test` runs 27 checks in under a second: prompt assembly, tool schema validity, input validation and business rules, webhook delivery/failure, and the full demo conversation flows. The included GitHub Actions workflow runs the same suite on every push.
