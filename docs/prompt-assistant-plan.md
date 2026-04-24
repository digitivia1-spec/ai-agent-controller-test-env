# Prompt Assistant — Phases 1 / 2 / 3 Grounded Plan

> Source of truth: the live Supabase project **Digitivia Agent Controller** (`xrycghxaxqzvkmzqzzkx`, eu-west-1) and the single-file app `index.html` in this repo (50,802 lines, 2.37 MB). Every table, column, enum value, DOM id, and function referenced below was read directly from the DB or the file — nothing is guessed.
>
> Credential note for the team: the `SUPABASE_URL` in the brief (`xrycghxaxqzvkmzqzzkx.supabase.co`) matches *Digitivia Agent Controller*, but the `anon` / `service_role` JWTs in the brief have `ref: neepgsppcemzwapcexys`, which is a different project (*Digitivia HR*). Those JWTs will not work against the Agent Controller REST endpoint. Rotate or re-issue keys from the Agent Controller project before any client-side code tries to use them. Inspection for this document was done via the pre-authenticated MCP/PAT, so the wrong-project JWT did not block the read-only audit.

---

## 1. Phase 1 — Verified schema-to-feature mapping

### 1.1 AI agent tabs (the 5 surfaces the assistant must work in)

Defined in `index.html` line 25192–25198:

| Tab id (DOM & `agent_type`) | Name key   | UI rendered by                                  |
|-----------------------------|------------|-------------------------------------------------|
| `website`                   | agents.website   | `AGENTS.forEach(agent => …)` at line 27768 |
| `whatsapp`                  | agents.whatsapp  | same                                       |
| `page` (Messenger)          | agents.page      | same                                       |
| `instagram`                 | agents.instagram | same                                       |
| `telegram`                  | agents.telegram  | same                                       |

The DB confirms the same five values via the Postgres enum `agent_type` (`website`, `whatsapp`, `page`, `instagram`, `telegram`) and current row counts in `agent_configs` (`whatsapp:127`, `page:127`, `instagram:127`, `website:127`, `telegram:4`).

**Consequence for the Prompt Assistant:** all five tabs are rendered by the *same* JS template; the editor DOM is generated with identical ids per tab (`#prompt-<agentId>`, `#tone-<agentId>`, `#status-<agentId>`, `#lock-btn-<agentId>`, `#<agentId>-prompt-sec`). A single reusable component mounted once per agent card is the correct abstraction — no per-tab forks.

### 1.2 Prompt storage — single uniform shape, not per-tab

All five tabs read from and write to **one** table: `public.agent_configs`. Upsert key is the composite `(org_id, agent)` (see `index.html` line 31767: `{ onConflict: 'org_id, agent' }`).

| Column                  | Type            | Notes                                                                 |
|-------------------------|------------------|-----------------------------------------------------------------------|
| `id`                    | uuid            | `gen_random_uuid()`                                                   |
| `org_id`                | uuid            | tenant; required                                                      |
| `agent`                 | `agent_type` enum | one of the five tabs                                                 |
| `is_active`             | boolean         | drives the LIVE toggle                                                |
| `tone`                  | text (default `'Balanced'`) | enumerated only client-side in `TONE_OPTIONS` (line 25213) |
| `system_prompt`         | text            | **the field the assistant reads/writes**                              |
| `multilingual_prompts`  | jsonb `{}`      | keyed by ISO lang (`ar`, `en`, …); see `saveMultilingualPrompts` (line 50063) |
| `auto_detect_language`  | boolean         | toggled via `saveLanguageSetting` (line 50052)                        |
| `supported_languages`   | text[] `{en}`   |                                                                       |
| `persona`               | jsonb `{}`      | observed keys in live data: `age`, `gender`, `dialect`                |
| `created_by/updated_by` | uuid            | must be set to `auth.uid()` on writes                                 |
| `created_at/updated_at` | timestamptz     |                                                                       |

**Not per-tab storage.** There is **no** per-tab prompt table, per-tab JSON blob, or nested tab record. The same row shape serves all five tabs — the `agent` column discriminates. This is the single fact that lets the Prompt Assistant be a true reusable component.

**Version history:** `agent_config_versions` exists (same fields plus `config_id`, `changed_by`, `is_active`, `created_at`) but is empty (0 rows). It is the right home for "Undo" / "Revert" after an Apply, and should be populated whenever the assistant replaces a prompt.

**Non-agent-tab prompt holders (NOT in scope for the 5-tab assistant but worth knowing):**

- `shopify_agent_configs` (1 row) — a separate Shopify storefront widget product. Has its own `system_prompt`, `tone`, plus branding (`brand_name`, `greeting_text`, `primary_color`, `position`, `widget_title`). If the assistant is ever extended here, it is a *different* write target; do not fold it into `agent_configs`.
- `agent_ab_tests` — `variant_a_prompt` / `variant_b_prompt` pair per A/B test. The assistant could later feed a generated draft into variant B, but not the main editor today.
- `agent_templates` (8 rows, `rls_enabled=false`) — global read-only starting points. `slug`, `name`, `category`, `system_prompt`, `tone`, `sample_messages jsonb`, `tags text[]`, `popularity`, `is_featured`. Use this as the source for "Browse templates" if we surface that.
- `website_widget_settings` / `storefront_widget_settings` — appearance/branding only; **no `system_prompt` column**. Do not write prompts here.

### 1.3 Plans, subscriptions, and usage (for daily-limit enforcement of the assistant)

Plans (`billing_plans`, 5 rows):

| `plan_slug` | `limits` JSON                                                   |
|-------------|-----------------------------------------------------------------|
| `starter`   | `{ conversations_limit: 5000, coins_limit: 1500 }`              |
| `growth`    | `{ conversations_limit: 12000, coins_limit: 3000 }`             |
| `pro`       | `{ conversations_limit: 30000, lead_limit: 5000, reports: true }` |
| `pro_sim`   | `{ conversations_limit: 2, coins_limit: 8000 }` (simulation plan) |
| `free_trial`| `{ conversations_limit: 500 }` (`is_active: false`)             |

Subscriptions: `org_subscriptions` (one per org, 128 rows). `status` uses the `subscription_status` enum: `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `paused`. Supports both Stripe (`stripe_subscription_id`, `stripe_customer_id`) and Shopify (`shopify_subscription_id`, `shopify_status`, `shop_domain`) providers via `provider` column (default `stripe`).

Usage counters actually present:

- `org_usage` — 30-day period counters (`period_start`, `period_end`): `conversations_used`, `coins_used`, `usd_spent`, `prompt_tokens_used`, `completion_tokens_used`, `total_tokens_used`, `audio_seconds_used`.
- `org_usage_monthly` — monthly rollup (`period text`, `conversations_used`).
- **No daily counter currently exists** for per-feature quotas.
- `rate_limits` (76,514 rows) — generic `(key text, count int, window_start, updated_at)`. This is the existing rate-limit primitive.

**Decision for the Prompt Assistant daily limit:** enforce from backend using `rate_limits` with a convention like `key = 'prompt_assistant:' || org_id || ':' || to_char(now() at time zone 'utc','YYYY-MM-DD')`, plus optional plan-scoped overrides pulled from `billing_plans.limits` (e.g., add `prompt_assistant_daily_limit` to the `limits` jsonb per plan). The workflow (n8n `webhook/ai-helper`) must **not** be the authority — it remains only a stateless generator. A thin Supabase edge function (e.g. `prompt-assistant`) in `supabase/functions/` should: (1) resolve `org_id` + user's role, (2) check / increment `rate_limits`, (3) forward to n8n, (4) log to `dcc_audit_logs`, (5) write a `agent_config_versions` row when the user applies. This aligns with the "workflow is not the source of truth" rule.

### 1.4 Ownership and membership

- Tenant boundary is `organizations.id`. Every agent/prompt/billing/usage row carries `org_id`. RLS is enabled on every relevant table (`agent_configs`, `agent_config_versions`, `agent_templates` is the only one with `rls_enabled=false`, since it's global read-only).
- `organization_members(org_id, user_id, role member_role, custom_role_id, permission_overrides jsonb)`. The `member_role` enum values are `owner`, `admin`, `member`, `moderator`, `manager`, `user`.
- `org_role_permissions(org_id, role, permission, granted)` — granular overrides. Observed permission keys in live data: `agents.configure`, `integrations.manage`, `integrations.read`, `org.billing`, `org.members`, `org.roles`, `org.settings`. Other permissions referenced in `index.html`: `inbox.toggle_ai`.
- `profiles(user_id, org_id, email, full_name, meta_data jsonb, dashboard_layout jsonb)`. Runtime caches in `index.html`: `window.currentUserOrgId`, `window.currentUserProfile`.
- `org_custom_roles` (1 row) — org-defined roles that can be attached via `organization_members.custom_role_id`.

**Assistant permission binding:**

| Action                              | Required permission   |
|-------------------------------------|-----------------------|
| Open assistant, type inputs, Generate | none (read-only assist) |
| Copy / Download draft               | none                  |
| Replace current / Apply to editor   | `agents.configure`    |
| Save (upsert `agent_configs`)       | `agents.configure`    |
| Unlock a locked prompt              | `agents.configure` (matches existing `lock-btn-${agentId}` flow at line 27806) |

This mirrors the gating used by the existing Save button (line 31746), the Unlock modal (`requestUnlock`, line 29717), and the LIVE toggle (line 27787). Reuse `window.hasPermission('agents.configure')` — do not introduce a new permission unless we want a finer split like `agents.assist`.

### 1.5 Locked-prompt reality in the current code

- `textarea#prompt-<agentId>` is rendered with class `textarea-locked` and the `readonly` attribute (line 27812).
- Sibling `<div class="edit-lock-btn" id="lock-btn-<agentId>">` with `onclick="requestUnlock('<agentId>')"` (line 27806–27808).
- `applySuggestion(agentId, type)` already respects this (line 29756): if `readonly`, it calls `requestUnlock` and aborts.
- `checkDirty(agentId)` (line 26576) and `initialStates[agentId]` / `isDirtyState[agentId]` (see `fetchCurrentConfigurations`, line 31717) track dirty/save state.

The assistant must reuse this exact pattern: it can **generate** into a draft zone while the editor is locked, but **Apply / Replace current** must call `requestUnlock` (or block with a tooltip) until unlocked, rather than silently mutating the textarea.

### 1.6 Existing styling / i18n hooks to reuse

- Dark dashboard CSS tokens used throughout the agent card: `var(--text-primary)`, `var(--text-secondary)`, `var(--bg-input, rgba(255,255,255,0.06))`, `rgba(255,255,255,0.03 / 0.06 / 0.08)`.
- Pill UI pattern already used: `.pill-btn`, `.pill-btn.primary` (see language chips, line 50022).
- i18n: `src/i18n/{en,ar}.json`, loaded via `src/i18n/loader.js`; translation function `t(...)`; `data-i18n` / `data-i18n-placeholder` attributes in DOM.
- RTL/LTR: `detectLangDir()` (line 35807) reads `<html lang>` + `<html dir>`; Arabic textarea uses `direction:rtl;` inline (line 50040). The assistant's bottom-sheet/drawer must flip via `dir` attribute (no hardcoded `left/right`).
- Existing bottom-sheet/side-panel precedent: the AI Helper floating widget (`AI_HELPER_WEBHOOK`, line 35791) already splits mobile vs desktop at media query `AIW_MOBILE_MEDIA_QUERY = '(max-width: 900px), (hover: none) and (pointer: coarse)'` (line 35792). Mirror this breakpoint.

### 1.7 Workflow endpoint (generation only, not source of truth)

`POST https://n8n.srv1174105.hstgr.cloud/webhook/ai-helper` is already CSP-allowlisted (line 7). It is currently used by the floating AI Helper widget. For the Prompt Assistant it will be called through a new Supabase edge function (e.g., `supabase/functions/prompt-assistant/index.ts`) so that rate limiting, auth, audit, and versioning stay on the DB side. Request/response shape should be defined in that edge function, not inferred from the n8n node.

---

## 2. Phase 2 — Reusable embedded Prompt Assistant UI

### 2.1 Where it mounts (the same place on all 5 tabs)

Inside the existing `#<agentId>-prompt-sec` section wrapper (rendered by `AGENTS.forEach`, line 27798), add one compact bar **immediately above** `textarea#prompt-<agentId>` and above the existing `.suggestions` row. No new page. No channel chooser (the tab *is* the channel — confirmed by the 5-element `AGENTS` array).

```
┌─ Agent Role (System Prompt) ──────────────┐
│  ⚠ caution banner (existing)              │
│  🔒 lock button (existing)                │
│  ▸▸ PROMPT ASSISTANT BAR  (new)           │   ← reusable component
│  ───────────────────────────────────────  │
│  <textarea#prompt-${agentId}> (existing)  │
│  pill suggestions row (existing)          │
└───────────────────────────────────────────┘
```

The bar is rendered once per agent card by a single render function, e.g. `renderPromptAssistantBar(agentId)` called from inside the existing `AGENTS.forEach` template string. Each instance scopes its DOM ids by `agentId` (`#pa-bar-${agentId}`, `#pa-sheet-${agentId}`, `#pa-draft-${agentId}`) so state never leaks across tabs.

### 2.2 The compact bar — three primary actions

Only three CTAs in the bar, as specified:

1. **Improve current prompt** — disabled if `textarea.value.trim() === ''`
2. **Create new prompt**
3. **Use current prompt** — converts the current textarea text into a draft-preview block so the user can copy / re-save / version without regenerating

A small usage hint on the right shows `today's remaining generations` from `rate_limits` (populated once the edge function returns `X-Pa-Remaining`). Permission gate: if `!hasPermission('agents.configure')`, the bar is rendered in read-only mode — "Use current prompt" still works (view/copy), but "Improve" and "Create new" open a tooltip that says Configure permission is required.

### 2.3 Opening surface — platform split

- **Desktop** (`min-width: 901px` OR `pointer: fine`): compact right-anchored **side drawer** that slides over the right edge of the viewport (width ~420 px, 100vh). On narrower desktop windows (< 1280 px) it becomes an inline side panel docked to the agent card to avoid covering the editor.
- **Mobile** (matches the existing `AIW_MOBILE_MEDIA_QUERY`): **bottom sheet**, 85vh max, rounded top, swipe-down-to-close.

The content inside is identical; only the chrome differs. The shell component listens to `matchMedia(AIW_MOBILE_MEDIA_QUERY)` (same as the AI Helper) and swaps chrome on resize.

### 2.4 Editor state machine (required five states)

All five states live **in the same card** — the existing textarea area is the "center of gravity". No popup-only results, no redirects.

| State     | DOM treatment                                                                                                                    | User actions available                                |
|-----------|-----------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------|
| normal    | textarea visible and editable (or readonly + lock), bar shows 3 CTAs.                                                             | Type, Save (existing), open Assistant                  |
| loading   | Skeleton shimmer over a read-only overlay of the textarea; spinner + "Generating…" and a Cancel button in the bar. No navigation.| Cancel                                                 |
| draft     | **Desktop:** two-column "Current vs Suggested" diff view inside the card; left column is the current prompt (still original), right column is the generated suggestion with chunk-level additions highlighted. **Mobile:** stacked cards OR tabs `[Current] [Suggested]`. | Apply, Replace current, Copy, Regenerate, Cancel      |
| applied   | Textarea shows the new value; "Applied" chip (auto-dismiss ~3 s); Undo link uses `agent_config_versions` (last row). Dirty flag set via existing `checkDirty(agentId)` if user keeps editing. | Save (existing), Undo, open Assistant again           |
| error     | Inline error strip above the bar (not a popup), with machine-readable `code` mapped to i18n keys: `rate_limited`, `quota_exceeded`, `permission_denied`, `network`, `generation_failed`. Retry button. | Retry, Close                                           |

### 2.5 Diff / compare view rules

- Built with a dependency-free word-level diff (LCS on tokenized input). Additions: green-tinted underlay. Removals: strikethrough with subtle red. Contextual headings unchanged. No external `diff` library — the project is a single HTML file with no bundler for runtime deps beyond Supabase JS + XLSX + Sentry.
- "Apply" = merges cleanly (accept all additions, drop the deletions from current). "Replace current" = hard replace with the generated text. "Copy" = copies suggested text to clipboard (RTL-safe). "Regenerate" = re-runs with the same inputs; "Cancel" = discards the draft, restores normal state without touching the textarea.

### 2.6 Locked-prompt behaviour (product rule preserved)

- Generating a draft while locked is always allowed.
- "Replace current" and "Apply" check `textarea.hasAttribute('readonly')` first. If locked, they call the existing `requestUnlock(agentId)` flow (opens `#unlock-modal`), and after success re-apply the pending action. Draft is preserved through the unlock round-trip.
- "Copy" is always allowed regardless of lock.

### 2.7 Save + versioning on Apply

When Apply or Replace is confirmed, the edge function performs:

1. `INSERT INTO agent_config_versions (config_id, org_id, agent, system_prompt, tone, is_active, changed_by)` — snapshots the *previous* value so Undo has something to revert to.
2. `UPDATE agent_configs SET system_prompt = $new, updated_by = auth.uid(), updated_at = now() WHERE org_id = $o AND agent = $a`.
3. `INSERT INTO dcc_audit_logs (...)` (27 rows already exist — reuse the existing audit shape).

Client-side, reuse `checkDirty(agentId)` and the existing `saveRole(agentId)` path's post-save UX (toast, clear dirty state) so the behavior is familiar.

### 2.8 Mobile-first, RTL/LTR, Arabic + English

- CSS sizing in `rem`/`%`/`vw`; bar collapses icons-only below 380 px wide.
- The component reads `detectLangDir()` on open and sets `dir` on both the bar and the drawer/sheet.
- All strings go through `t(...)` with new keys under `prompt_assistant.*` in both `src/i18n/en.json` and `src/i18n/ar.json`. Mirrored keys include: `pa.improve`, `pa.create`, `pa.use_current`, `pa.generating`, `pa.apply`, `pa.replace`, `pa.regenerate`, `pa.copy`, `pa.cancel`, `pa.err.rate_limited`, etc.
- When the target agent language includes Arabic (from `agent_configs.supported_languages` or the multilingual textarea at line 50040), the "Suggested" column renders with `direction: rtl` and a Noto Arabic font stack; English renders LTR. Bidirectional mixed-script prompts get `unicode-bidi: plaintext`.

### 2.9 Accessibility / polish

- All bar buttons have `aria-label`; drawer is a dialog with focus trap and `aria-labelledby`.
- Keyboard: `Ctrl/Cmd + J` opens the assistant on the current tab; `Esc` closes; `Tab` cycles CTAs; `Enter` on "Apply" confirms with a 2-second undoable toast.
- Generated content is rendered as plain text, never `innerHTML`.

---

## 3. Phase 3 — Minimal input collection and generate-early flow

### 3.1 First-pass form (only four required fields, pre-filled from context)

On open, the drawer/sheet shows a *one-screen* form. Defaults are pulled from the current agent state so the user can click "Generate" with zero typing in many cases.

| Field (required)            | Control         | Options / default                                                                                             | Sourced from                                         |
|-----------------------------|-----------------|---------------------------------------------------------------------------------------------------------------|------------------------------------------------------|
| What should this agent do?  | segmented chips | Answer customers · Sell / convert leads · Collect customer info · Book appointments · Reply on social media · General assistant | new `pa.goal.*` i18n keys; default inferred from `agent` (`page`/`instagram` → Reply on social media; `whatsapp` → Answer customers; `website` → Answer customers; `telegram` → General assistant) |
| What is your business?      | short single-line input (<= 120 chars) | empty                                                                                                         | optional prefill from `organizations.name` (`currentUserOrgId`) |
| How should it speak?        | segmented chips | Professional · Friendly · Sales-focused · Short and direct · Premium                                           | default mapped from `agent_configs.tone` (`Professional & Formal` → Professional, `Friendly & Casual` → Friendly, `Sales-Oriented & Persuasive` → Sales-focused, `Empathetic & Helpful` → Friendly, `Witty & Humorous` → Friendly) |
| What language should it use?| segmented chips | Arabic · English · Same as customer · Arabic + English                                                        | default from `agent_configs.supported_languages` + `auto_detect_language`: `["en"]` → English; `["ar"]` → Arabic; `["ar","en"]` → Arabic + English; `auto_detect_language=true` → Same as customer |

No channel chooser. The `agentId` from the host card is the channel.

### 3.2 Optional fields (collapsed under "Add details" — do not block first generation)

| Field (optional)                | Control                     | Options / shape                                                                                                                     |
|---------------------------------|-----------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| What information should it collect? | multi-select pills      | Name · Phone · Location · Budget · Service needed · Preferred time (stored as the array that will map to `persona.collect` on Save, reusing `agent_configs.persona jsonb`) |
| What should it avoid?           | multi-select pills          | No prices unless asked · No promises · No long replies · No discounts without approval · No medical/legal advice                     |
| Important note                  | small textarea (2–3 lines)  | free text; 500 char limit; stored into `persona.note`                                                                                |

Optional fields are visually separated and collapsed. Submitting without expanding them is the expected path.

### 3.3 Generate-early, refine-later flow

1. User opens the assistant from the bar. Form is pre-filled as described. Primary CTA is **Generate** (full-width).
2. On Generate: client posts to the Supabase edge function with `{ agent, orgId, action: 'improve' | 'create' | 'use', goal, business, tone, language, collect, avoid, note, current_prompt }`. Action is `improve` if the user clicked the Improve CTA, `create` otherwise. `use` skips generation and just renders the current prompt as a draft for copy/version.
3. Loading state (see 2.4). On first result the drawer **collapses the form into a compact header** ("For WhatsApp · Answer customers · Friendly · Arabic + English ✎") and shows the draft below; any of those chips is tappable to tweak that one input — *this is the "refine after first result" guarantee*, no re-typing required.
4. Refinement controls next to the draft: `Shorter`, `Longer`, `More formal`, `Add emojis`, `Translate to Arabic`, `Translate to English`. Each dispatches an `action: 'refine'` call with `{ draft_id, hint }` — keeping the first generation fast and unburdened.
5. The result is streamed into the draft area (if the edge function supports SSE) or appended on complete; either way, the user never leaves the agent card.
6. Apply / Replace / Copy / Regenerate / Cancel behave as in 2.4 – 2.7.

### 3.4 Persistence of the advanced inputs

When Apply is confirmed, the edge function persists both the prompt text **and** the structured inputs:

- `agent_configs.system_prompt` ← generated text.
- `agent_configs.tone` ← mapped to the nearest `TONE_OPTIONS` entry (line 25213) so the existing dropdown stays in sync.
- `agent_configs.supported_languages` / `auto_detect_language` ← derived from the language chip:
  - English → `supported_languages = ['en']`, `auto_detect_language = false`
  - Arabic → `['ar']`, `false`
  - Arabic + English → `['ar','en']`, `false`
  - Same as customer → existing array (or seed `['ar','en']`), `auto_detect_language = true`
- `agent_configs.persona` ← `{ goal, business, collect, avoid, note, assistant_version: 1 }` (jsonb merge; preserves the existing `age`/`gender`/`dialect` keys observed in live data).
- `agent_configs.multilingual_prompts.ar` ← if language is Arabic or Arabic + English AND the generator returned an Arabic variant; otherwise untouched.
- `agent_config_versions` ← snapshot of the *previous* row (see 2.7).

### 3.5 Rate limiting and plan gating of the feature itself

The edge function, before forwarding to n8n:

```sql
-- Pseudo-check, executed server-side (service role):
INSERT INTO rate_limits(key, count, window_start)
VALUES (
  'prompt_assistant:' || :org_id || ':' || to_char(now() at time zone 'utc','YYYY-MM-DD'),
  1, now()
)
ON CONFLICT (key) DO UPDATE
   SET count = rate_limits.count + 1,
       updated_at = now()
RETURNING count;

-- Reject if count > plan_limit (read from billing_plans.limits->>'prompt_assistant_daily_limit', default 30)
```

Plan mapping (proposed defaults — to be added to `billing_plans.limits`):

| plan_slug   | `prompt_assistant_daily_limit` |
|-------------|-------------------------------|
| starter     | 10                            |
| growth      | 30                            |
| pro         | 100                           |
| pro_sim     | 30                            |
| free_trial  | 5                             |

If `org_subscriptions.status` is not in (`active`, `trialing`), the assistant returns `error.code = 'subscription_inactive'` and the client shows an inline upgrade nudge (no popup).

---

## 4. Implementation breakdown (so Phases 2/3 can ship small)

1. **Edge function** `supabase/functions/prompt-assistant/index.ts` — auth (resolves `auth.uid()` → `organization_members` → `org_id` + permissions), `rate_limits` check, plan-limit check from `billing_plans.limits`, forwards to `https://n8n.srv1174105.hstgr.cloud/webhook/ai-helper`, returns `{ draft_id, text, remaining, code? }`. Writes `dcc_audit_logs` + `agent_config_versions` on Apply.
2. **DB migrations** — add `prompt_assistant_daily_limit` default to each row in `billing_plans.limits`; optionally add a functional unique index on `rate_limits.key` if absent (confirm before migrating).
3. **Client** — new JS section inside `index.html` near existing "Sprint 21" block: `renderPromptAssistantBar(agentId)`, `openPromptAssistant(agentId, action)`, `applyPromptAssistantDraft(agentId)` — all dispatched from the existing `AGENTS.forEach` template at line 27768. Reuse `window.hasPermission`, `requestUnlock`, `showToast`, `checkDirty`, `supabaseClient.functions.invoke`.
4. **i18n** — append `prompt_assistant.*` keys to `src/i18n/en.json` and `src/i18n/ar.json`.
5. **Styles** — add scoped classes (`.pa-bar`, `.pa-sheet`, `.pa-drawer`, `.pa-diff`) to `src/styles/components/` using existing CSS tokens.
6. **Tests** — `tests/` uses Vitest; add unit tests for the tone-string mapper, language-chip-to-config mapper, and the diff tokenizer.

---

## 5. Open items that need a product decision before coding

- Daily-limit numbers per plan (section 3.5 is a proposal).
- Whether "Use current prompt" should also snapshot into `agent_config_versions` (recommended: yes, so users can diff their own history).
- Whether A/B tests (`agent_ab_tests`) should receive a "Send draft to Variant B" action in a follow-up phase.
- The Shopify-widget prompt (`shopify_agent_configs.system_prompt`) is a separate surface — confirm it is out of scope for the first release.
- Credential mismatch flagged at the top of this document — product needs fresh `anon` / `service_role` keys for project `xrycghxaxqzvkmzqzzkx` before any client talks to the DB.
