# Prompt Assistant UI Brief — Hand-off to Fresh Session

**Context**: Paste this as the opening message of a new Claude Code session
(or share with another AI coding agent). It is self-contained — do not paste
credentials alongside it.

---

## Why this file exists

A partial Prompt Assistant feature landed on `main` before this brief was
written. The **backend is mostly done**; the **UI was never wired up**. An
earlier attempt to add inline UI code to `index.html` was dropped during a
codebase-optimization refactor (2026-04-24 merge) because it duplicated
functionality already extracted to `public/modules/prompt-assistant.js`.

Your job: build the UI layer cleanly against the extracted module structure,
calling the already-deployed Edge Function.

## State on main (what you inherit)

Already landed — do NOT rewrite these without a reason:

| Path | Purpose |
| --- | --- |
| `supabase/functions/prompt-assistant/index.ts` | Edge Function — the generation backend. Read this file first to learn the request/response contract. |
| `supabase/functions/prompt-assistant/DEPLOY_NOTES.md` | How the function is deployed and authenticated |
| `supabase/migrations/20260421_prompt_assistant_phase5.sql` | DB schema: quota table, RLS, plan limits. Read to see the real table/column names before writing any SQL. |
| `Prompt Assistant API v1.json` | n8n workflow reference for the API contract (must match what the Edge Function accepts) |
| `docs/prompt-assistant-plan.md` | The original design plan authored before the UI rebuild |
| `public/modules/prompt-assistant.js` | **Existing stub** — a drawer/sheet singleton extracted during the refactor. Currently uses a placeholder backend. Your UI work rewires this to the real Edge Function + adds the bar, data collection form, and diff view. |
| `index.html:19,780–19,867` | Inline Prompt Assistant `<style>` block (keep or move into `src/styles/main.css` — your call) |
| `index.html:19,869–19,879` | `<div id="pa-root">` drawer skeleton |

Read `CLAUDE.md` in the repo root before touching `index.html` — it enforces
token-efficient file navigation.

## Secrets policy

**Do not paste Supabase keys into chat.** The task runner / repo has:
- Supabase URL + anon key in existing code (safe to reference)
- Service role key + PAT — use environment variables or the Supabase MCP
  server; never inline them

Any credentials shared in chat must be rotated; flag this to the human
operator if you see them.

## Feature spec (verbatim from product requirements)

### 1. Feature overview
Implement a production-ready Prompt Assistant integrated across **all** AI
agent tabs (WhatsApp, Messenger, Instagram, Telegram, Website, Google Reviews)
and any prompt editor within the existing interface. Core purpose: let users
**improve, create, or keep** prompts with minimal effort. It is an extension
of the prompt editor — not a separate page or product.

### 2. Core functionality

#### 2.1 UI placement and interaction
- **Placement**: Within the existing system-prompt / role-instructions area.
  A compact "Prompt Assistant bar" sits above the editor, keeping the editor
  central.
- **Mobile-first**: bottom sheet on mobile; side drawer / compact side panel
  on desktop.
- **Primary actions**: Improve current prompt · Create new prompt · Use
  current prompt.
- **Draft management**: After generation, the prompt draft shows in the same
  editor area. Include a compare view — desktop: current vs suggested side
  by side; mobile: tabs or stacked cards. Draft actions: Apply · Replace
  current · Copy · Regenerate · Cancel.
- **Locked prompts**: allow draft generation, prevent silent overwrites.
  Direct Apply/Replace is blocked when the prompt is locked; the assistant
  still generates a preview the user can copy.

#### 2.2 Data collection
Keep it light — no long briefing forms. Prefer chips/pills/segmented
controls over typing.

- **Required**: What should this agent do? · What is your business? · How
  should it speak? · What language should it use?
- **Optional**: What information should it collect? · What should it avoid?
  · Important note.
- **Excluded**: No channel selection.

### 3. Architecture

#### 3.1 Workflow / Edge Function role — stateless generator
- Receive clean structured input
- Process by mode (`improve_existing` | `create_new` | `use_current`)
- Return clean structured output

The workflow is **not** the source of truth. It does not do ownership checks,
persistence, plan enforcement, or DB orchestration.

#### 3.2 App + DB role — source of truth
- **Schema inspection**: inspect real Supabase tables/columns before
  writing any code (prompt storage, plans, usage, memberships, ownership).
  Never guess schema names.
- **Plan & usage enforcement**: trusted stored values drive daily quotas,
  not client counters.
  - Starter: 15/day
  - Growth: 25/day
  - Pro: 40/day
- **Ownership validation**: workspace/tenant/user checks happen **before**
  calling the Edge Function.
- **Save/Apply behaviour**: the app code owns applying/saving the chosen
  prompt to the real DB.
- **Request contract normalisation**: UI sends a stable canonical payload;
  field names and data structures normalised on the client side.
- **Response handling**: UI decides how to display, compare, apply, copy,
  cancel, save.
- **Secure endpoint calling**: webhook URL via env / config, auth headers,
  retry policy, error handling — all on the client side.
- **Cross-tab compatibility**: use an adapter layer if underlying tab data
  models differ.

### 4. Design & UX
- Mobile-first, mobile-responsive
- RTL (Arabic) and LTR (English) — see `public/i18n/{en,ar}.json`
- Dark dashboard aesthetic (reuse existing CSS vars in `src/styles/main.css`)
- Premium, low-friction, lightweight
- Results appear immediately
- Principle: **generate early, refine later** — ask only the simplest useful
  fields first, allow refinement after an initial result

### 5. Acceptance criteria

- [ ] Feature present on all 6 AI agent tabs
- [ ] No channel chooser
- [ ] Supabase schema inspected before implementation; no schema assumptions
- [ ] Assistant embedded in the current prompt card
- [ ] Mobile and desktop responsive layouts work
- [ ] Arabic RTL and English LTR both supported
- [ ] Edge Function treated as receive/respond-only
- [ ] Plans, usage, ownership, save behaviour owned by app+DB
- [ ] Plan limits enforced via DB (Starter 15/Growth 25/Pro 40 per day)
- [ ] UI sends canonical structured data to the Edge Function
- [ ] Edge Function response renders immediately in the same editor area
- [ ] Apply · Replace · Copy · Regenerate · Cancel all work
- [ ] Locked prompts allow draft generation but block silent overwrites
- [ ] Production-ready; no placeholder schema calls

## Suggested execution plan

### Phase 0 — Discovery (launch 3 `Explore` agents in parallel)
1. Read `supabase/functions/prompt-assistant/index.ts`. Report: endpoint
   URL/path, expected auth header, request schema by mode, response schema,
   error codes, any rate limiting.
2. Read `supabase/migrations/20260421_prompt_assistant_phase5.sql`. Report:
   tables, columns, RLS policies, plan-limit enforcement logic, quota
   counter mechanism.
3. Grep `index.html` for every prompt-editor integration point. Report
   which agent tabs already have a `#pa-bar-<agentId>` stub and which are
   missing.

### Phase 1 — Design (1 `Plan` agent)
Given Phase 0 output + current `public/modules/prompt-assistant.js`, design:
- Single state machine (`idle` → `collecting` → `loading` → `draft` →
  `applied` | `error`).
- Per-tab adapter interface: how each agent tab's prompt editor plugs into
  the shared drawer.
- Data-collection form (chip-heavy, minimal typing).
- Diff view component (desktop side-by-side, mobile tabs).
- Client-side quota gate + locked-prompt guard.
- File layout: keep logic in `public/modules/prompt-assistant.js`; styles in
  `src/styles/main.css` (add new `.pa-*` rules near existing ones); new
  `prompt_assistant.*` i18n keys in `public/i18n/{en,ar}.json`.

### Phase 2 — Build (sequential)
Do these yourself (not parallel agents — file conflicts):
1. Update `public/modules/prompt-assistant.js` — wire to real Edge Function,
   add state machine, data-collection form, diff view.
2. Add CSS rules to `src/styles/main.css` for the new UI pieces.
3. Add `prompt_assistant.*` keys to `public/i18n/{en,ar}.json`.
4. Wire the bar into each agent tab's prompt card (use the adapter).
5. Add client-side quota check + locked-prompt guard.
6. `npm run build` + `npm run lint` + `npm test` all green.

### Phase 3 — Verify (1 `Explore` agent)
Walk the acceptance criteria against the final diff. Report each as ✅ or ❌
with file/line evidence.

Then commit with a smoke-test checklist for the human operator, push,
hand back.

## Rules of engagement

1. **Do not rewrite the Edge Function or migration** unless you can prove
   they have a specific bug — they are already deployed.
2. **Do not guess Supabase schema** — inspect via the MCP Supabase server or
   by reading the migration file.
3. **Do not skip the i18n work** — RTL + EN support is a hard acceptance
   criterion.
4. **Keep the UI inside the existing prompt card** — no new pages, no
   separate menu items.
5. **The Edge Function is stateless**. Quota, ownership, save — all on the
   client + DB.
6. **Confirm the plan with the human** after Phase 1, before starting
   Phase 2.

Good luck.
