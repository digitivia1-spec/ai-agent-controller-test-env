# Omnio by Digitivia — AI Agent Controller

AI command center for managing intelligent agents across WhatsApp, Messenger,
Instagram, Telegram, and the web, with built-in CRM, orders, content studio,
and analytics.

## Environments

| Host | Branch | Purpose |
| --- | --- | --- |
| https://testaienv.digitivia.com | `main` | **Test env** — what you're looking at. Deploy to verify before promoting. |
| https://ai-agent.digitivia.com | (separate production branch) | Production — live customer traffic |

## Stack

Vanilla JS + Supabase (DB, Auth, Edge Functions) + n8n workflows. Built with
Vite.

## Scripts

```bash
npm run dev      # vite dev server (port 3000)
npm run build    # vite build → dist/
npm run preview  # serve built output
npm test         # vitest
npm run lint     # eslint src/
```

## Project layout (post-refactor 2026-04-24)

```
index.html                        # 19.9k lines — body markup + main app script
public/
├── i18n/{en,ar}.json              # Live translations (loaded by sync-XHR shim)
├── modules/*.js                   # 14 late-loaded feature IIFEs (onboarding, CRM,
│                                  # billing, prompt assistant, etc.)
└── styles/                        # (reserved — no files yet)
src/
├── styles/main.css                # Live stylesheet (linked from index.html:160)
├── styles/{layout,components,modules}/  # Aspirational modular CSS (not wired)
├── i18n/loader.js                 # Async loader (future migration path)
├── config.js, utils/*.js          # Extracted helpers
supabase/
├── functions/prompt-assistant/    # Edge Function: Prompt Assistant backend
├── migrations/*.sql               # Schema migrations
follow-ups Workflow/*.json         # n8n workflow exports (data)
Prompt Assistant API v1.json       # n8n workflow reference for PA API
```

## For AI coding assistants

Read `CLAUDE.md` in the repo root first — it documents:
- **Token-efficiency rules** for working with the still-large `index.html`
- **Line-range navigation map** so you jump to the right 500-line window
  instead of scanning 20k lines
- **Source-of-truth rules** (i18n lives in `public/i18n/`, CSS in
  `src/styles/main.css`, etc.)

## Recent optimization history (April 2026)

`index.html` was 51,731 lines before a 3-step refactor that extracted inline
content into proper source files. Each step has its own commit with a
smoke-test checklist in the body:

| Step | Commit | What | Line change |
| --- | --- | --- | --- |
| 1 | `430e468` | i18n dictionaries → `public/i18n/*.json` | 51,731 → 48,061 |
| 2 | `7077b03` | CSS → `src/styles/main.css` (linked) | 48,061 → 28,745 |
| 3 | `5521317` | 14 late-loaded IIFEs → `public/modules/*.js` | 28,745 → 19,882 |

Cumulative reduction: **−61.6%** (51,731 → 19,882 lines). Goal was to make
the file small enough that AI coding assistants can reason about the whole
codebase without context-window timeouts.

Step 4 (extracting the main app script) was considered and deferred —
it would need a proper decomposition of shared state, not a mechanical move.
See `CLAUDE.md` §6 for reasoning.
