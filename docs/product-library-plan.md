# Product Library + Auto Product Sync — Implementation Plan

**Status:** Draft for review
**Authored:** 2026-04-26
**Source pack:** `product_sync_full_ready_reference_pack` (8 docs read end-to-end)
**Target repo:** `ai-agent-controller-test-env` (Omnio by Digitivia)

---

## 1. Audit findings (what already exists)

### Supabase project (`xrycghxaxqzvkmzqzzkx`)

**Storage buckets — pattern: per-feature, private, signed URLs**
- `inbox_media` (private, 5 377 files) — WhatsApp/Messenger media. Signed URLs via `createSignedUrl(path, 3600)`.
- `knowledge_base` (private, 3 files) — KB docs.
- `task_attachments` (private, 0 files) — CRM task attachments.

**Existing integration credential storage — pattern reused as-is**
- Source: `organizations.external_onboarding_data` (jsonb) under
  `integrations.{shopify|woocommerce|easy_order}`.
- Saved by `public/modules/onboarding-wizard.js → saveOnbProgress()`
  (`index.html` already has the input UI at ~line 2593–2747).
- Server-side validation goes through Edge Function `integration-proxy`
  (already deployed; called from the wizard, never from the browser
  directly because of CORS/CSP). This is the security boundary the
  runner prompt requires.

**Pre-existing Shopify schema (specialised — leave alone for this phase)**
- `shopify_stores`, `shopify_products` (17 rows), `shopify_variants`,
  `shopify_collections`, `shopify_sync_runs`, `shopify_sync_events`,
  `shopify_product_overrides` — all keyed on `shop_domain` + Admin API
  `bigint` IDs. This belongs to the Shopify-as-a-platform install
  (Shopify Admin app), **not** the Storefront-Token integration the
  wizard collects. We will not migrate or modify these.

**`org_channel_accounts` is messaging-only** — `instagram, page, telegram, whatsapp`. We will NOT overload it for ecommerce.

**Scheduling — pattern: pg_cron calling PG functions**
- `pg_cron 1.6.4` + `pg_net 0.19.5` are installed.
- Current jobs: `expire-trials`, `crm-due-soon-check`, `crm-overdue-check`,
  `task-overdue-check`, `reap_stuck_followup_claims` — all use
  `SELECT some_pg_function()` (NOT direct Edge Function invocations).
- We will follow the same pattern: a SQL function that reads enabled
  integrations and uses `pg_net.http_post` to invoke our sync Edge
  Function per integration, asynchronously.

### Frontend
- Wizard already has Shopify / WooCommerce / EasyOrders credential forms,
  validation, and "Test connection" buttons going through `integration-proxy`.
- No Product Library page exists yet.
- No manual products UI exists yet.
- No post-credential-save sync trigger exists yet (today the wizard
  saves and validates but does not import products).

---

## 2. Decision summary

| Concern | Decision | Why |
|---|---|---|
| Credentials store | `organizations.external_onboarding_data` | Existing pattern, runner prompt forbids inventing new credential system |
| Server-side fetch | Reuse `integration-proxy` Edge Function pattern; add a new `product-sync` Edge Function | Existing CORS-safe boundary, separation of concerns |
| Cron host | `pg_cron` + `pg_net.http_post` calling the Edge Function | Matches all 5 existing cron jobs; no n8n workflow needed for this |
| Product schema | New unified `products` + `product_media` tables (org-scoped, RLS-protected) | Existing `shopify_products` is Admin-API-bigint; we need a multi-source store |
| Storage bucket | New private bucket `product_media`; signed-URL access | Mirrors `inbox_media`/`task_attachments` exactly |
| i18n | Append keys to `public/i18n/{en,ar}.json`; reuse `t()` helper and `dir="rtl"` switching | Existing pattern; CLAUDE.md §1 rule 7 |
| CSS | Add new `.product-library*` classes to `src/styles/main.css` | Existing pattern; CLAUDE.md §1 rule 8 |
| New JS module | `public/modules/product-library.js` (classic-script IIFE) registered via `<script src>` near the other 14 modules at `index.html:19,736–19,881` | Existing pattern; CLAUDE.md §1 rule 9 |
| CSP | `connect-src` already allows `*.myshopify.com`; will need to add `*.easy-orders.net` and the configured WooCommerce domain wildcard ONLY if any browser-side calls remain — but per the runner all external calls are server-side, so **no CSP change required**. The Edge Function calls go through `*.supabase.co` (already allowed). | Defensive |

---

## 3. Phased implementation

Each phase ends at a natural review checkpoint. **No phase begins until you approve the prior one.**

---

### Phase A — DB schema + storage bucket *(foundation)*

**Goal:** new tables + bucket + RLS, no behaviour change.

**Files**
- New: `supabase/migrations/20260426_product_library_phase_a.sql`

**Schema (conceptual — exact column names finalised in the migration draft)**
- `products` — `id uuid pk`, `org_id uuid`, `source text` (CHECK in
  `'shopify'|'woocommerce'|'easyorders'|'manual'`), `external_id text`,
  `title text NOT NULL`, `description text`, `description_html text`,
  `product_url text`, `price numeric`, `sale_price numeric`,
  `currency text`, `sku text`, `quantity integer`,
  `availability text`, `status text DEFAULT 'active'` (CHECK
  `'active'|'inactive'`), `last_synced_at timestamptz`,
  `last_sync_run_id uuid`, `raw jsonb DEFAULT '{}'::jsonb`,
  `created_at`, `updated_at`. **Unique:** `(org_id, source, external_id)`.
- `product_media` — `id uuid pk`, `product_id uuid fk`, `org_id uuid`,
  `media_type text` (CHECK `'image'|'video'`), `url text`,
  `thumbnail_url text`, `storage_path text`, `alt_text text`,
  `source_media_id text`, `is_primary boolean DEFAULT false`,
  `state text DEFAULT 'unverified'` (CHECK
  `'valid'|'missing'|'broken'|'unsupported'|'unverified'`),
  `position int`, `created_at`, `updated_at`.
- `product_sync_runs` — `id uuid pk`, `org_id uuid`, `source text`,
  `status text` (CHECK `'queued'|'running'|'completed'|'completed_with_warnings'|'failed'|'cancelled'`),
  `trigger text` (CHECK `'initial_after_credentials_save'|'credentials_updated'|'scheduled_every_3_days'|'manual_retry_after_failure'|'system_retry'`),
  `summary jsonb DEFAULT '{}'::jsonb` (products_found / saved /
  updated / skipped / images_found / videos_found / missing_media /
  broken_media / unsupported_media / errors / warnings),
  `error_code text`, `error_message text`,
  `started_at`, `finished_at`, `duration_ms`.
- RLS: org-scoped, mirrors `inbox_messages` policy (org membership read
  + writer role for mutations).
- Storage bucket: `product_media` (private, no public read; RLS via
  `storage.objects` policy keyed on `${org_id}/...` path).

**Migration safety**
- All `IF NOT EXISTS`.
- Indexes: `(org_id, source)`, `(org_id, status)`, `(org_id, last_synced_at desc)`, full-text on `title`.

**Test:** A Vitest unit asserting the migration file declares all four
tables and the bucket creation, plus a small sanity SQL run via the
MCP `execute_sql` to confirm the tables exist with expected columns.

**Rollback:** drop tables + bucket (documented in migration footer).

---

### Phase B — Sync Edge Function *(server-side ingestion)*

**Goal:** an Edge Function that, given `(org_id, source, trigger)`,
fetches products from the source's API, normalises to the importer
contract from doc 09 §16, and upserts into `products` + `product_media`.

**Files**
- New: `supabase/functions/product-sync/index.ts`
- New: `supabase/functions/product-sync/sources/shopify.ts`
- New: `supabase/functions/product-sync/sources/woocommerce.ts`
- New: `supabase/functions/product-sync/sources/easyorders.ts`
- New: `supabase/functions/product-sync/normalize.ts` (importer contract)
- New: `supabase/functions/product-sync/media.ts` (HEAD-validate URLs → state mapping)

**Behaviour**
- Reads credentials from `organizations.external_onboarding_data.integrations.{source}`.
- Inserts a `product_sync_runs` row at `queued` → `running` →
  `completed`/`failed`/`completed_with_warnings`.
- Per-source pagination (Shopify cursor; WC `per_page=100&page=N`;
  EasyOrders defensive wrapper).
- Includes Shopify `media` GraphQL fragment (images + Video + ExternalVideo).
- WooCommerce + EasyOrders: defensive video field detection only.
- One source failing must not abort others (caller-driven).
- Sets `verify_jwt: false` (called from Postgres via service-role) +
  validates a shared-secret header so it can't be hit publicly.

**Test:** Local invocation against the existing Storefront credentials
on the test org (we can use the wizard's saved data). Inspect the
`product_sync_runs.summary` jsonb and the `products` rows.

**Rollback:** undeploy function + delete the row in the source-specific
sync_runs.

---

### Phase C — Auto-sync trigger after credentials save *(integration glue)*

**Goal:** when the wizard's `saveOnbProgress()` persists a *new or
changed* credential set, immediately fire a sync.

**Files**
- Edit: `public/modules/onboarding-wizard.js` — after a successful
  `integration-proxy` validation pass, POST to `product-sync` with
  `trigger='initial_after_credentials_save'` (or `'credentials_updated'`).
- Show the non-blocking copy from doc 06 §"Sync copy" via the existing
  `showToast()` helper (already used throughout the wizard).

**No DB changes.**

**Test:** Wire a temporary debug log; smoke-test by editing a
WooCommerce credential and confirming a `product_sync_runs` row appears
with `trigger='credentials_updated'`.

---

### Phase D — Scheduled sync every 3 days *(recurring sync)*

**Goal:** the cron job from doc 05 (`0 3 */3 * *`).

**Files**
- New: `supabase/migrations/20260427_product_library_phase_d.sql`
- Adds: SQL function `enqueue_scheduled_product_syncs()` that scans
  every org with at least one credential set in
  `organizations.external_onboarding_data.integrations.*.verified_at`
  and calls the Edge Function via `pg_net.http_post(...)` per source.
- Adds: `cron.schedule('product-sync-every-3-days', '0 3 */3 * *',
  'SELECT enqueue_scheduled_product_syncs()')`.

**Test:** manually `SELECT enqueue_scheduled_product_syncs()`,
verify rows in `product_sync_runs` with `trigger='scheduled_every_3_days'`.

---

### Phase E — Product Library page *(UI)*

**Goal:** the new page from docs 04 + 06.

**Files**
- New: `public/modules/product-library.js` (classic-script IIFE,
  pattern matching `add-lead.js`/`support-tickets.js`).
- Edit: `index.html` — add a 15th `<script src>` tag in the existing
  range at line 19,736–19,881; add a sidebar nav entry; add an empty
  `<section id="product-library-tab">` placeholder near the other tab
  containers.
- Edit: `src/styles/main.css` — add `.product-library*` block (logical
  CSS properties only; supports RTL).
- Edit: `public/i18n/en.json` + `public/i18n/ar.json` — add `productLibrary.*`,
  `productSync.*`, `manualProduct.*`, `productMedia.*` namespaces from
  doc 09 §20.

**Render targets**
- Status card (connection status + sync state).
- Filter bar (Search · Source · Status · Media).
- Product grid (cards: media preview + video badge + title + price +
  source + status + media-state badge + last-synced).
- Empty / partial / failure / no-products states with the exact bilingual
  copy from docs 06 + 08.
- Mobile-first, no horizontal scroll, logical `inline-start/end`.

**Test:** Vitest snapshot of the rendered HTML against fixture data;
manual responsive check at 380 px / 768 px / 1280 px in both `dir`s.

---

### Phase F — Manual product CRUD *(media-aware)*

**Goal:** the manual product flow from docs 04 + 07 + 08.

**Files**
- Edit: `public/modules/product-library.js` — add Add/Edit modal with:
  Title, Price, Status, Description (optional), Product link (optional),
  and a media chooser supporting **Upload Image · Paste Image URL ·
  Upload Video · Paste Video URL** (the four-button pattern from doc 08).
- Edit: same — uploaded files go to `product_media/${org_id}/manual/${ts}_${safeName}`,
  inserted via the existing Supabase JS client (mirroring the
  `task_attachments` upload pattern at `onboarding-wizard.js:3800`).
- Helper copy (en/ar) added to i18n JSON.

**Validation rules** from docs 07 + 08 (HTTPS preference, content-type
check on the server-side validator if/when added; for now just
client-side regex + length).

**Test:** Add manual product with each of the four media options; verify
`products` + `product_media` rows + signed URL playback.

---

### Phase G — Polish + acceptance pass

- Run the doc-09 §25 acceptance checklist top to bottom.
- Confirm CSP regression test still green (the test we wrote earlier
  protects `*.supabase.co` — including signed URLs from the new
  `product_media` bucket).
- Add a couple of new CSP assertions for `media-src` covering the
  product_media URL path if needed.
- Run `npm test`, `npm run lint`, `npm run build`.
- Update `CLAUDE.md` §3 navigation map: add the new module,
  the new sidebar entry, and the new SQL migrations.

---

## 4. What's *not* in this plan (deferred — runner prompt §"Do not implement")

- Meta/WhatsApp image or video sending.
- n8n AI product search.
- Order sync.
- Shopify Admin API sync (the existing `shopify_products` rows came in
  via that path; we leave it alone).
- WooCommerce page scraping for video.
- Video transcoding / compression / thumbnail generation.
- Sending media to chat platforms.

---

## 5. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Two parallel Shopify product surfaces (`shopify_products` Admin path + new `products` Storefront path) confuse downstream consumers | Document the distinction in the migration header + add a SQL view `products_unified` later if needed. Out of scope for this phase. |
| Credentials sit unencrypted in `organizations.external_onboarding_data` | Pre-existing project decision per the runner ("do not invent a new credential system"). Flag as a follow-up item, do not block the feature. |
| EasyOrders product URL format unknown | Don't store `product_url` for EasyOrders unless the API response contains one (defensive — doc 03 §EasyOrders). |
| Shopify Storefront API hides products if not on Online Store sales channel | Map this to error code `ERR_SHOPIFY_PRODUCTS_HIDDEN_OR_UNPUBLISHED` per doc 09 §18; surface in the partial-sync warning copy. |
| `pg_net.http_post` is async / fire-and-forget | OK for our use — the Edge Function writes its own `product_sync_runs` row, so we don't need a synchronous response. We add a "stuck-run reaper" SQL job in Phase D mirroring `reap_stuck_followup_claims`. |
| `index.html` token budget (CLAUDE.md §1) | Phase E only adds ~20 lines to `index.html` (one `<script>` tag + a nav entry + an empty `<section>`); the heavy module lives in `public/modules/product-library.js`. |

---

## 6. Open questions for you (none blocking — sensible defaults shown)

1. **Currency** — should the manual product form support the user picking
   any currency, or auto-default from the org? *Default: auto-default
   from the org's `external_onboarding_data.business.currency` if set,
   otherwise USD.*
2. **Variant-level pricing** — sync skips Shopify variants for this
   phase (only product-level price). OK? *Default: yes — variants are
   already in `shopify_variants` for the Admin path; we can add later.*
3. **Bucket name** — `product_media` vs `product_library`? *Default:
   `product_media` (matches `inbox_media`).*
4. **Soft-delete vs hard-delete** for products no longer in the source.
   *Default: soft-delete via `status='inactive'` + a per-row
   `last_seen_at` so users can reactivate. Cleaner UX.*

---

## 7. Where you can stop me / steer

Approve or steer at any of these checkpoints:

1. **End of Phase A** — schema looks right? RLS policies match what you'd expect?
2. **End of Phase B** — try the sync against your real Shopify Storefront token; does the data look right?
3. **End of Phase D** — confirm the cron job is firing.
4. **End of Phase E** — visual review of the Product Library page in en + ar.
5. **End of Phase F** — first manual product end-to-end.
6. **End of Phase G** — full acceptance checklist sign-off.
