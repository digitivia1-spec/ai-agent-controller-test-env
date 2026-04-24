# CLAUDE.md — Working Rules for This Repo

This file is loaded automatically at session start. It exists to keep Claude
fast and token-efficient in a codebase whose main file (`index.html`) is
**1.56 MB / ~28,745 lines**. Follow these rules strictly.

---

## 1. Token-efficiency rules (read first)

1. **Never read `index.html` in full.** It is 28,745 lines. Always:
   - Use `Grep` (the built-in tool) first to locate the symbol / string / selector.
   - Then `Read` with `offset` + `limit` (≤ 500 lines) around the hit.
2. **Never read these files in full either** — grep first, then read a window:
   | File | Size | Why avoid |
   | --- | --- | --- |
   | `index.html` | 1.56 MB / 28,745 L | Main app JS + body markup still inlined |
   | `src/styles/main.css` | 599 KB / ~19k L | Whole live stylesheet (auto-bundled by Vite) |
   | `public/i18n/ar.json` | 110 KB | Translation data — not logic |
   | `public/i18n/en.json` | 87 KB | Translation data — not logic |
   | `package-lock.json` | 84 KB | Generated lockfile — do not edit |
   | `follow-ups Workflow/*.json` | up to 216 KB | n8n workflow exports — treat as data |
3. **Never spawn `Explore` / general-purpose agents for small lookups** — one
   `Grep` is cheaper than an agent round-trip. Reserve agents for searches that
   genuinely need 3+ passes.
4. **Never dump file contents via `cat` / `head` / `tail` in Bash.** Use `Read`.
   It's paginated; `cat` streams the whole buffer into context.
5. **When editing `index.html` or `src/styles/main.css`, prefer `Edit` with a
   small unique `old_string`** so only the diff is transmitted. Do not `Write`
   these files.
6. **Do not regenerate `follow-ups Workflow/*.json` by hand.** They are n8n
   workflow exports — open them via the n8n UI/API, not a text editor.
7. **i18n strings live in `public/i18n/{en,ar}.json`** — edit there, not the
   loader shim at `index.html:129–159`. The shim just fetches those files
   via a blocking XHR so `window.LANG_EN` / `window.LANG_AR` are defined
   before downstream scripts reference them.
8. **All live CSS lives in `src/styles/main.css`** (linked from
   `index.html:160`). The modular files under `src/styles/{layout,
   components,modules}/` are aspirational snapshots — not wired in. Edit
   `main.css` for now; reconcile into modules in a later PR.

---

## 2. Project snapshot

- **Product**: Omnio by Digitivia — AI command center (WhatsApp / Messenger /
  Instagram / Telegram / Web) with CRM, orders, content studio.
- **Stack**: Vanilla JS + Supabase + n8n workflows. Vite builds it.
- **Architecture reality**: mostly single-page app with body markup +
  app-logic JS still inlined in `index.html`. **i18n and CSS have been
  extracted** — see §6 for remaining steps.
- **Scripts**: `npm run dev` (vite), `npm run build`, `npm test` (vitest),
  `npm run lint`.

---

## 3. `index.html` navigation map

The file is organised as: HTML `<head>` (with i18n loader shim + CSS link) →
body markup → many `<script>` IIFE modules. Use these ranges with
`Read offset:N limit:M` instead of scanning.

### Head + landing page (1 – 1,830)
| Lines | What it is |
| --- | --- |
| 1 – 65 | `<head>` — meta, CSP, SEO, OG/Twitter, PWA manifest |
| 67 – 71 | CDN script tags (Supabase, SheetJS, Sentry) |
| 72 – 86 | Sentry init |
| 89 – 98 | PostHog snippet |
| 99 – 111 | Saved-theme bootstrap |
| 112 – 128 | Permission stubs (`hasPermission`, `guardPermission`) |
| **129 – 159** | **i18n sync-XHR loader shim** — fetches `/i18n/{en,ar}.json` |
| **160** | **`<link rel="stylesheet" href="./src/styles/main.css">`** — all CSS lives in that file now (~19k lines) |
| 166 – 178 | Cookie consent banner HTML |
| 179 – 199 | Cookie consent script |
| 216 – 411 | Landing-page HTML (pre-app) |
| 228 – 244 | Rain particles bg script |
| 247 – 278 | `window.omnioOrb` SVG generator |
| 281 – 396 | Premium interactions engine |
| 617 – 674 | `sendDemoMessage()` demo chat |
| 757 – 878 | Landing pricing (`detectLpCurrency`, `renderLpPricing`) |
| 1,180 – 1,830 | Sidebar nav + top bar + modals (templates, onboarding, command palette, lead profile, notes, follow-up, documentation, profile, help, onboarding banner) |

### Main application script (1,874 – 19,734)
One giant `<script>` block — **~17,900 lines** of app logic.
| Lines | What it is |
| --- | --- |
| 1,874 – 2,189 | Supabase config + client (`supabaseClient`, chat-proxy headers) |
| 2,203 – 2,714 | Help system (`applyContextualHelp`, tooltip/popover/sheet) |
| 2,814 – 4,534 | Bootstrap / auth flow / `showApp()` / routing |
| 4,539 – 6,344 | Dashboard tab HTML templates + widgets |
| 6,344 – 6,514 | Legal pages (privacy/terms/cookies/security) inlined |
| 13,304+ | Floating AI widget init (DOMContentLoaded) |
| 14,225 – 14,358 | Website widget embed code generator |
| 14,359 – 15,028 | Stripe pricing / currency / billing period |
| 15,133 – 15,169 | AI helper widget DOM |
| 15,169 – 16,665 | AI helper logic (sending, streaming, UI) |
| 16,668 – 19,734 | Notifications system (real-time, push, unread count) |

### Late-loaded feature modules (19,736 – 28,715)
Each is an IIFE — independent, safe to edit in isolation.
| Lines | Module |
| --- | --- |
| 19,736 – 19,906 | Password-change translations inject |
| 19,908 – 25,651 | **Onboarding wizard (owner-only)** — 5.7k lines, largest module |
| 25,654 – 25,885 | Google Calendar integration |
| 25,888 – 25,961 | Sidebar usage meter (`loadUsageMeter`) |
| 25,964 – 26,239 | Add Lead modal |
| 26,242 – 26,569 | Sprint 26: saved filters |
| 26,572 – 26,857 | Sprint 22: CSAT rating |
| 26,860 – 27,181 | Sprint 18: outbound webhooks |
| 27,184 – 27,399 | Support tickets (`cachedTickets`, status/priority) |
| 27,402 – 27,514 | Agent templates browser |
| 27,517 – 27,622 | A/B test panel (`openABTestPanel`) |
| 27,625 – 27,695 | AI/Human override tracking (inbox) |
| 27,698 – 27,909 | Product onboarding tour |
| 28,019 – 28,715 | Prompt Assistant module (`window.openPromptAssistant`) |

### Common-task lookup

| To work on… | Grep for… | Then read around line… |
| --- | --- | --- |
| Supabase auth / session | `SUPABASE_URL` or `supabaseClient` | 1,874 – 2,190 |
| Login/signup flow | `performLogin\|performSignUp\|performOAuthLogin` | grep then window |
| Dashboard widgets | `loadDashboard\|renderDashboard` | 4,539 – 6,344 |
| Inbox / messages | `loadInbox\|loadInboxMessages\|sendMessage` | grep then window |
| CRM leads | `initCrmTab\|renderCrmGrid\|openLeadProfile` | ~22,015 area |
| Tasks | `loadTaskManager\|openCreateTaskModal` | grep then window |
| Pricing / Stripe | `initiateStripeCheckout\|detectCurrency` | 14,359 – 15,028 |
| Notifications | `notificationsChannel\|insertTaskNotification` | 16,668 – 19,734 |
| Onboarding wizard | section marker `ONBOARDING WIZARD (Owner-Only)` | 19,908 – 25,651 |
| i18n key | `"key.path":` in `public/i18n/en.json` |
| CSS selector | `Grep` the class name in `src/styles/main.css` |

If a symbol isn't here, **grep first**. Do not scroll through the file.

---

## 4. Other important files

| Path | Purpose |
| --- | --- |
| `chatwindow.html` | Embeddable chat widget (~1,800 lines) |
| `website-widget.js` | Loader script for 3rd-party sites |
| `sw.js` | Service worker (push, caching) |
| `api/google-calendar/callback/` | OAuth return page |
| `demo/google-calendar/` | Demo page |
| `supabase/migrations/*.sql` | DB schema. Phase migrations at repo root (`phase{1,2,3}_migration.sql`) are the canonical reference. |
| `public/i18n/{en,ar}.json` | **Live i18n dictionaries** — single source of truth |
| `src/i18n/loader.js` | Async loader (future migration path; not used at runtime) |
| `src/styles/main.css` | **Live stylesheet** — single source of truth (linked from `index.html:160`) |
| `src/styles/{layout,components,modules}/*.css` | Aspirational modular CSS (not wired up — see `src/styles/README.md`) |
| `src/config.js`, `src/utils/*.js` | Extracted helpers (in-progress decomposition) |
| `follow-ups Workflow/*.json` | n8n workflow exports — data, not source |
| `.agents/skills/` | Agent skill definitions |
| `tests/` | Vitest tests |

---

## 5. Health findings (recorded 2026-04-24)

- ✅ Repo builds via Vite; 31 tests pass; ESLint clean (1 pre-existing warning).
- ✅ **i18n extracted** — `public/i18n/{en,ar}.json` is the single source of
  truth; `index.html` dropped from 51,731 → 48,061 lines (step 1).
- ✅ **CSS extracted** — `src/styles/main.css` is the single source of
  truth (Vite bundles to `dist/assets/main-<hash>.css`); `index.html`
  dropped from 48,061 → 28,745 lines (step 2).
- ⚠️ `index.html` is still 1.56 MB / 28,745 lines — main app JS block
  (~17.9k lines) + late feature IIFEs still inlined. See **§6**.
- ⚠️ `src/` JS decomposition is started but unfinished — the main app
  script still lives inside `index.html`.
- ⚠️ Hard-coded `SUPABASE_KEY` is present in `index.html` around line
  1,877. That's an anon key (safe to ship), but rotate + move to env for
  the Vite build anyway.
- ⚠️ The sync-XHR pattern in the i18n loader shim logs a deprecation
  warning in modern browsers. Cosmetic only — works in all browsers —
  and goes away once the app migrates onto `src/i18n/loader.js` (async).
- ⚠️ `src/styles/main.css` has a pre-existing stray `;` after the first
  `}` block (original inline CSS typo) — ESBuild logs a warning during
  build but the output is correct. Trivial to fix in a followup cleanup.

## 6. Recommended next optimization (requires approval)

Biggest remaining token win is **extracting the inlined JS**. Done/pending:

1. ✅ **i18n extract** — completed (step 1). ~7% reduction.
2. ✅ **CSS extract** (`<link>` to `src/styles/main.css`) — completed
   (step 2). ~40% reduction.
3. ⬜ **Late feature IIFEs** (19,736 – 28,715) — each is self-contained,
   so moving them to `src/modules/<name>.js` is low-risk. Estimated ~6%
   reduction on top of what's already done.
4. ⬜ **Main app script** (1,874 – 19,734) — peel into
   `src/modules/{auth,dashboard,inbox,crm,tasks,billing,notifications}.js`
   per the targets in `src/README.md`. Highest-risk step; ~35%
   reduction.

Cumulative progress: **51,731 → 28,745 lines (−44.4%)**. After step 3
the file drops below ~27k lines; after step 4 it falls to under ~10k
lines — essentially just HTML body markup + a handful of thin
bootstrap scripts.
