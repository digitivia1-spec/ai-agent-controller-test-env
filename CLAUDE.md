# CLAUDE.md — Working Rules for This Repo

This file is loaded automatically at session start. It exists to keep Claude
fast and token-efficient in a codebase whose main file (`index.html`) is
**2.15 MB / ~48,060 lines**. Follow these rules strictly.

---

## 1. Token-efficiency rules (read first)

1. **Never read `index.html` in full.** It is 48,061 lines. Always:
   - Use `Grep` (the built-in tool) first to locate the symbol / string / selector.
   - Then `Read` with `offset` + `limit` (≤ 500 lines) around the hit.
2. **Never read these files in full either** — grep first, then read a window:
   | File | Size | Why avoid |
   | --- | --- | --- |
   | `index.html` | 2.15 MB / 48,061 L | Most of the app still inlined |
   | `src/styles/main.css` | 442 KB | Concatenated legacy CSS |
   | `src/styles/modules/inbox.css` | 161 KB | |
   | `src/styles/modules/ai-helper.css` | 155 KB | |
   | `public/i18n/ar.json` | 110 KB | Translation data — not logic |
   | `public/i18n/en.json` | 87 KB | Translation data — not logic |
   | `package-lock.json` | 84 KB | Generated lockfile — do not edit |
   | `follow-ups Workflow/*.json` | up to 216 KB | n8n workflow exports — treat as data |
3. **Never spawn `Explore` / general-purpose agents for small lookups** — one
   `Grep` is cheaper than an agent round-trip. Reserve agents for searches that
   genuinely need 3+ passes.
4. **Never dump file contents via `cat` / `head` / `tail` in Bash.** Use `Read`.
   It's paginated; `cat` streams the whole buffer into context.
5. **When editing `index.html`, prefer `Edit` with a small unique `old_string`**
   so only the diff is transmitted. Do not `Write` the file.
6. **Do not regenerate `follow-ups Workflow/*.json` by hand.** They are n8n
   workflow exports — open them via the n8n UI/API, not a text editor.
7. **i18n strings live in `public/i18n/{en,ar}.json`** — edit there, not the
   loader shim at `index.html:129–159`. The shim just fetches those files
   via a blocking XHR so `window.LANG_EN` / `window.LANG_AR` are defined
   before downstream scripts reference them.

---

## 2. Project snapshot

- **Product**: Omnio by Digitivia — AI command center (WhatsApp / Messenger /
  Instagram / Telegram / Web) with CRM, orders, content studio.
- **Stack**: Vanilla JS + Supabase + n8n workflows. Vite builds it.
- **Architecture reality**: single-page app inlined into `index.html`. The
  `src/` directory is a *target* structure for an in-progress decomposition
  (see `src/README.md`), not where most live code runs yet. **i18n has been
  extracted** — see §6 for remaining steps.
- **Scripts**: `npm run dev` (vite), `npm run build`, `npm test` (vitest),
  `npm run lint`.

---

## 3. `index.html` navigation map

The file is organised as: HTML head → i18n loader shim → huge `<style>`
block → body markup → many `<script>` IIFE modules. Use these ranges with
`Read offset:N limit:M` instead of scanning.

### Top of file (1 – 19,500)
| Lines | What it is |
| --- | --- |
| 1 – 65 | `<head>` — meta, CSP, SEO, OG/Twitter, PWA manifest |
| 67 – 71 | CDN script tags (Supabase, SheetJS, Sentry) |
| 72 – 86 | Sentry init |
| 89 – 98 | PostHog snippet |
| 99 – 111 | Saved-theme bootstrap |
| 112 – 128 | Permission stubs (`hasPermission`, `guardPermission`) |
| **129 – 159** | **i18n sync-XHR loader shim** — fetches `/i18n/{en,ar}.json` |
| 160 – 19,505 | **Main `<style>` block** (~19k lines of CSS). Sub-ranges: |
| ~853 – ~1,308 | Phase 4 dashboard CSS |
| ~1,809 – ~1,859 | Inbox search |
| ~2,913 – ~3,019 | Omnio orb brand tokens (`:root` vars) |
| ~3,022 – ~3,257 | Landing-page animations |
| ~3,258 – ~3,320 | Task Manager v2 |
| ~3,326 – ~3,395 | Templates browser |
| ~3,426 – ~3,674 | Light-theme overrides |
| ~3,675 – ~6,354 | Nav group accordion |
| ~6,356 – ~7,354 | Dashboard |
| ~6,571 – ~7,275 | Content Studio |
| ~7,356 – ~7,439 | Top bar |
| ~7,440 – ~7,641 | Pricing modal |
| ~7,642 – ~7,949 | Profile modal |
| ~7,950 – ~8,517 | Team / invitations / roles |
| ~8,519 – ~8,717 | Help modal |
| ~8,718 – ~9,729 | Documentation modal |
| ~9,731 – ~9,886 | RTL (Arabic) overrides |
| ~9,888 – ~12,341 | CRM leads controls & various modules |
| ~12,342 – ~16,440 | Usage widget, misc responsive |
| ~16,441 – ~18,584 | Onboarding wizard |
| ~18,586 – ~18,929 | CRM / Lead profile / Task manager redesign |
| ~18,931 – ~19,174 | Lead profile slide panel |
| ~19,177 – ~19,449 | Task manager card list |

### Landing page (19,510 – 21,217)
| Lines | What it is |
| --- | --- |
| 19,524 – 19,544 | Cookie consent script |
| 19,573 – 19,589 | Rain particles bg |
| 19,592 – 19,623 | `window.omnioOrb` SVG generator |
| 19,626 – 19,741 | Premium interactions engine |
| 19,756 – 21,481 | Landing hero, features, pricing, FAQ, CTA, footer |
| 19,962 – 20,019 | `sendDemoMessage()` demo chat |
| 20,102 – 20,223 | Landing pricing (`detectLpCurrency`, `renderLpPricing`) |

### App shell + modals (20,483 – 21,217)
Sidebar nav, top bar, modals (templates, onboarding, command palette, lead
profile, notes, follow-up, documentation, profile, help, onboarding wizard).

### Main application script (21,219 – 39,079)
One giant `<script>` block — **~17,900 lines** of app logic.
| Lines | What it is |
| --- | --- |
| 21,219 – 21,534 | Supabase config + client (`supabaseClient`, chat-proxy headers) |
| 21,548 – 22,059 | Help system (`applyContextualHelp`, tooltip/popover/sheet) |
| 22,159 – 23,879 | Bootstrap / auth flow / `showApp()` / routing |
| 23,884 – 25,689 | Dashboard tab HTML templates + widgets |
| 25,689 – 25,859 | Legal pages (privacy/terms/cookies/security) inlined |
| 32,649+ | Floating AI widget init (DOMContentLoaded) |
| 33,570 – 33,703 | Website widget embed code generator |
| 33,704 – 34,373 | Stripe pricing / currency / billing period |
| 34,478 – 34,514 | AI helper widget DOM |
| 34,514 – 36,010 | AI helper logic (sending, streaming, UI) |
| 36,013 – 39,079 | Notifications system (real-time, push, unread count) |

### Late-loaded feature modules (39,081 – 48,060)
Each is an IIFE — independent, safe to edit in isolation.
| Lines | Module |
| --- | --- |
| 39,081 – 39,251 | Password-change translations inject |
| 39,253 – 44,996 | **Onboarding wizard (owner-only)** — 5.7k lines, largest module |
| 44,999 – 45,230 | Google Calendar integration |
| 45,233 – 45,306 | Sidebar usage meter (`loadUsageMeter`) |
| 45,309 – 45,584 | Add Lead modal |
| 45,587 – 45,914 | Sprint 26: saved filters |
| 45,917 – 46,202 | Sprint 22: CSAT rating |
| 46,205 – 46,526 | Sprint 18: outbound webhooks |
| 46,529 – 46,744 | Support tickets (`cachedTickets`, status/priority) |
| 46,747 – 46,859 | Agent templates browser |
| 46,862 – 46,967 | A/B test panel (`openABTestPanel`) |
| 46,970 – 47,040 | AI/Human override tracking (inbox) |
| 47,043 – 47,254 | Product onboarding tour |
| 47,364 – 48,060 | Prompt Assistant module (`window.openPromptAssistant`) |

### Common-task lookup

| To work on… | Grep for… | Then read around line… |
| --- | --- | --- |
| Supabase auth / session | `SUPABASE_URL` or `supabaseClient` | 21,219 – 21,535 |
| Login/signup flow | `performLogin\|performSignUp\|performOAuthLogin` | grep then window |
| Dashboard widgets | `loadDashboard\|renderDashboard` | 23,884 – 25,689 |
| Inbox / messages | `loadInbox\|loadInboxMessages\|sendMessage` | grep then window |
| CRM leads | `initCrmTab\|renderCrmGrid\|openLeadProfile` | ~41,360 area |
| Tasks | `loadTaskManager\|openCreateTaskModal` | grep then window |
| Pricing / Stripe | `initiateStripeCheckout\|detectCurrency` | 33,704 – 34,373 |
| Notifications | `notificationsChannel\|insertTaskNotification` | 36,013 – 39,079 |
| Onboarding wizard | section marker `ONBOARDING WIZARD (Owner-Only)` | 39,253 – 44,996 |
| i18n key | `"key.path":` in `public/i18n/en.json` |
| CSS selector | `Grep` for the class — CSS ranges in §3 above |

If a symbol isn't here, **grep first**. Do not scroll through the file.

> **Note**: CSS sub-range line numbers are approximate (marked with `~`) —
> they were shifted after the i18n extract. The script-block ranges are
> exact.

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
| `src/config.js`, `src/utils/*.js` | Extracted helpers (in-progress decomposition) |
| `src/styles/` | Extracted CSS (in-progress decomposition — not yet wired up) |
| `follow-ups Workflow/*.json` | n8n workflow exports — data, not source |
| `.agents/skills/` | Agent skill definitions |
| `tests/` | Vitest tests |

---

## 5. Health findings (recorded 2026-04-24)

- ✅ Repo builds via Vite; 31 tests pass; ESLint clean (1 pre-existing warning).
- ✅ **i18n extracted** — `public/i18n/{en,ar}.json` is the single source of
  truth; `index.html` dropped from 51,731 → 48,061 lines.
- ⚠️ `index.html` is still 2.15 MB / 48,061 lines — main CSS block and app
  JS are still inlined. See **§6** for the remaining fix path.
- ⚠️ `src/` decomposition (JS modules) is started but unfinished.
- ⚠️ `src/styles/main.css` (442 KB) may be a stale full concatenation —
  verify before editing vs. the modular files under `src/styles/modules/`.
- ⚠️ Hard-coded `SUPABASE_KEY` is present in `index.html` around line
  21,222. That's an anon key (safe to ship), but rotate + move to env for
  the Vite build anyway.
- ⚠️ The sync-XHR pattern in the i18n loader shim will log a deprecation
  warning in modern browsers. Cosmetic only — works in all browsers — and
  goes away once the app migrates onto `src/i18n/loader.js` (async).

## 6. Recommended next optimization (requires approval)

Biggest remaining token win is **extracting the inlined CSS and main JS**.
Done/pending:

1. ✅ **i18n extract** (lines 129–3,799 → `public/i18n/{en,ar}.json`) —
   completed. ~7% reduction.
2. ⬜ **CSS extract** (lines 160–19,505 → `<link rel="stylesheet">` to
   already-extracted `src/styles/`). Need visual parity check against
   `src/styles/main.css` before wiring in. ~40% reduction.
3. ⬜ **Late feature IIFEs** (39,081–48,060) — each is self-contained, so
   moving them to `src/modules/<name>.js` is low-risk. ~6% reduction.
4. ⬜ **Main app script** (21,219–39,079) — peel into
   `src/modules/{auth,dashboard,inbox,crm,tasks,billing,notifications}.js`
   per the targets in `src/README.md`. Highest-risk step.

After step 2, `index.html` drops to ~28,700 lines (~55% smaller than the
original 51,731). Every Claude task on this repo becomes proportionally
cheaper.
