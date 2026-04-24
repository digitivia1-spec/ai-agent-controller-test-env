# CLAUDE.md — Working Rules for This Repo

This file is loaded automatically at session start. It exists to keep Claude
fast and token-efficient in a codebase whose main file (`index.html`) is
**2.4 MB / ~51,700 lines**. Follow these rules strictly.

---

## 1. Token-efficiency rules (read first)

1. **Never read `index.html` in full.** It is 51,731 lines. Always:
   - Use `Grep` (the built-in tool) first to locate the symbol / string / selector.
   - Then `Read` with `offset` + `limit` (≤ 500 lines) around the hit.
2. **Never read these files in full either** — grep first, then read a window:
   | File | Size | Why avoid |
   | --- | --- | --- |
   | `index.html` | 2.4 MB / 51,731 L | Entire app inlined |
   | `src/styles/main.css` | 442 KB | Concatenated legacy CSS |
   | `src/styles/modules/inbox.css` | 161 KB | |
   | `src/styles/modules/ai-helper.css` | 155 KB | |
   | `src/i18n/ar.json` | 106 KB | Translation data — not logic |
   | `src/i18n/en.json` | 84 KB | Translation data — not logic |
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

---

## 2. Project snapshot

- **Product**: Omnio by Digitivia — AI command center (WhatsApp / Messenger /
  Instagram / Telegram / Web) with CRM, orders, content studio.
- **Stack**: Vanilla JS + Supabase + n8n workflows. Vite builds it.
- **Architecture reality**: single-page app inlined into `index.html`. The
  `src/` directory is a *target* structure for an in-progress decomposition
  (see `src/README.md`), not where the live code runs.
- **Scripts**: `npm run dev` (vite), `npm run build`, `npm test` (vitest),
  `npm run lint`.

---

## 3. `index.html` navigation map

The file is organised as: HTML head → i18n blob → huge `<style>` block → body
markup → many `<script>` IIFE modules. Use these ranges with `Read offset:N
limit:M` instead of scanning.

### Top of file (1 – 23,163)
| Lines | What it is |
| --- | --- |
| 1 – 65 | `<head>` — meta, CSP, SEO, OG/Twitter, PWA manifest |
| 67 – 71 | CDN script tags (Supabase, SheetJS, Sentry) |
| 72 – 86 | Sentry init |
| 89 – 98 | PostHog snippet |
| 99 – 111 | Saved-theme bootstrap |
| 112 – 128 | Permission stubs (`hasPermission`, `guardPermission`) |
| **129 – 3,799** | **`window.LANG_EN` + `LANG_AR` i18n dictionaries** (3.6k lines of strings — avoid) |
| 3,801 – 23,163 | **Main `<style>` block** (~19k lines of CSS). Sub-ranges: |
| 4,494 – 4,949 | Phase 4 dashboard CSS |
| 5,450 – 5,500 | Inbox search |
| 6,554 – 6,660 | Omnio orb brand tokens (`:root` vars) |
| 6,663 – 6,898 | Landing-page animations |
| 6,899 – 6,961 | Task Manager v2 |
| 6,967 – 7,036 | Templates browser |
| 7,067 – 7,315 | Light-theme overrides |
| 7,316 – 9,995 | Nav group accordion |
| 9,997 – 10,995 | Dashboard |
| 10,212 – 10,916 | Content Studio |
| 10,997 – 11,080 | Top bar |
| 11,081 – 11,282 | Pricing modal |
| 11,283 – 11,590 | Profile modal |
| 11,591 – 12,158 | Team / invitations / roles |
| 12,160 – 12,358 | Help modal |
| 12,359 – 13,370 | Documentation modal |
| 13,372 – 13,527 | RTL (Arabic) overrides |
| 13,529 – 15,982 | CRM leads controls & various modules |
| 15,983 – 20,081 | Usage widget, misc responsive |
| 20,082 – 22,225 | Onboarding wizard |
| 22,227 – 22,570 | CRM / Lead profile / Task manager redesign |
| 22,572 – 22,815 | Lead profile slide panel |
| 22,818 – 23,090 | Task manager card list |

### Landing page (23,151 – 24,858)
| Lines | What it is |
| --- | --- |
| 23,165 – 23,196 | Cookie consent script |
| 23,214 – 23,230 | Rain particles bg |
| 23,233 – 23,264 | `window.omnioOrb` SVG generator |
| 23,267 – 23,382 | Premium interactions engine |
| 23,397 – 24,122 | Landing hero, features, pricing, FAQ, CTA, footer |
| 23,603 – 23,660 | `sendDemoMessage()` demo chat |
| 23,743 – 23,864 | Landing pricing (`detectLpCurrency`, `renderLpPricing`) |

### App shell + modals (24,124 – 24,858)
Sidebar nav, top bar, modals (templates, onboarding, command palette, lead
profile, notes, follow-up, documentation, profile, help, onboarding wizard).

### Main application script (24,860 – 42,720)
One giant `<script>` block — **~18,000 lines** of app logic.
| Lines | What it is |
| --- | --- |
| 24,860 – 25,175 | Supabase config + client (`supabaseClient`, chat-proxy headers) |
| 25,189 – 25,700 | Help system (`applyContextualHelp`, tooltip/popover/sheet) |
| 25,800 – 27,520 | Bootstrap / auth flow / `showApp()` / routing |
| 27,525 – 29,330 | Dashboard tab HTML templates + widgets |
| 29,330 – 29,500 | Legal pages (privacy/terms/cookies/security) inlined |
| 36,290+ | Floating AI widget init (DOMContentLoaded) |
| 37,211 – 37,344 | Website widget embed code generator |
| 37,345 – 38,014 | Stripe pricing / currency / billing period |
| 38,119 – 38,155 | AI helper widget DOM |
| 38,155 – 39,651 | AI helper logic (sending, streaming, UI) |
| 39,654 – 42,720 | Notifications system (real-time, push, unread count) |

### Late-loaded feature modules (42,722 – 51,730)
Each is an IIFE — independent, safe to edit in isolation.
| Lines | Module |
| --- | --- |
| 42,722 – 42,892 | Password-change translations inject |
| 42,894 – 48,637 | **Onboarding wizard (owner-only)** — 5.7k lines, largest module |
| 48,640 – 48,871 | Google Calendar integration |
| 48,874 – 48,947 | Sidebar usage meter (`loadUsageMeter`) |
| 48,950 – 49,225 | Add Lead modal |
| 49,228 – 49,555 | Sprint 26: saved filters |
| 49,558 – 49,843 | Sprint 22: CSAT rating |
| 49,846 – 50,167 | Sprint 18: outbound webhooks |
| 50,170 – 50,385 | Support tickets (`cachedTickets`, status/priority) |
| 50,388 – 50,500 | Agent templates browser |
| 50,503 – 50,608 | A/B test panel (`openABTestPanel`) |
| 50,611 – 50,681 | AI/Human override tracking (inbox) |
| 50,684 – 50,895 | Product onboarding tour |
| 51,005 – 51,730 | Prompt Assistant module (`window.openPromptAssistant`) |

### Common-task lookup

| To work on… | Grep for… | Then read around line… |
| --- | --- | --- |
| Supabase auth / session | `SUPABASE_URL` or `supabaseClient` | 24,860 – 25,200 |
| Login/signup flow | `performLogin\|performSignUp\|performOAuthLogin` | grep then window |
| Dashboard widgets | `loadDashboard\|renderDashboard` | 27,525 – 29,330 |
| Inbox / messages | `loadInbox\|loadInboxMessages\|sendMessage` | grep then window |
| CRM leads | `initCrmTab\|renderCrmGrid\|openLeadProfile` | 45,000 – 45,300 area |
| Tasks | `loadTaskManager\|openCreateTaskModal` | grep then window |
| Pricing / Stripe | `initiateStripeCheckout\|detectCurrency` | 37,345 – 38,014 |
| Notifications | `notificationsChannel\|insertTaskNotification` | 39,654 – 42,720 |
| Onboarding wizard | section marker `ONBOARDING WIZARD (Owner-Only)` | 42,894 – 48,637 |
| i18n key | `"key.path":` in `src/i18n/en.json` (extracted copy) or lines 129–3,799 |
| CSS selector | `Grep` for the class — CSS ranges in §3 above |

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
| `src/config.js`, `src/utils/*.js` | Extracted helpers (in-progress decomposition) |
| `src/i18n/{en,ar}.json` | Extracted translations (in-progress decomposition) |
| `src/styles/` | Extracted CSS (in-progress decomposition) |
| `follow-ups Workflow/*.json` | n8n workflow exports — data, not source |
| `.agents/skills/` | Agent skill definitions |
| `tests/` | Vitest tests |

---

## 5. Health findings (recorded 2026-04-23)

- ✅ Repo builds via Vite; tests run via Vitest; ESLint configured.
- ⚠️ `index.html` is 2.4 MB / 51,731 lines — every Claude read is expensive.
  See **§6** for the recommended fix path.
- ⚠️ `src/` decomposition is started but unfinished; `index.html` is still the
  single source of truth at runtime.
- ⚠️ `src/styles/main.css` (442 KB) may be a stale full concatenation — verify
  before editing vs. the modular files under `src/styles/modules/`.
- ⚠️ Hard-coded `SUPABASE_KEY` is present in `index.html` around line 24,863.
  That's an anon key (safe to ship), but rotate + move to env for the
  Vite build anyway.
- ⚠️ `.claude/settings.local.json` had ~50 stale per-run `Bash(...)` allow
  rules referencing Windows paths — pruned in this change.

## 6. Recommended next optimization (requires approval)

Biggest token win would be **physically splitting `index.html`** into Vite
entry modules. Suggested minimal-risk order (each is its own PR):

1. Extract `window.LANG_EN` + `LANG_AR` (lines 129 – 3,799) → already done to
   `src/i18n/*.json`; replace the inline blob with `<script type="module">`
   importing the loader.
2. Extract the `<style>` block (lines 3,801 – 23,163) → already partially done
   under `src/styles/`; replace with `<link rel="stylesheet">` once parity is
   verified.
3. Extract late feature IIFEs (48,640 – 51,730) — each is self-contained, so
   moving them to `src/modules/<name>.js` is low-risk.
4. Last: peel the main 24,860 – 42,720 block into `src/modules/{auth,
   dashboard, inbox, crm, tasks, billing, notifications}.js` per the targets
   in `src/README.md`.

After step 1 alone, `index.html` drops by ~3,700 lines (~7%). After step 2 it
drops another ~19,000 lines (~38%). That's a ~45% token reduction for any
Claude task that has to scan the file.
