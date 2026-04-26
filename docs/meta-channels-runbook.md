# Meta Channels — Phase 1 deploy runbook

Created 2026-04-27 from the "Meta Preview Prompts" set (Prompts 1, 2, 3).
This runbook tells you, step-by-step, how to ship the four new Edge
Functions, the database migration, the BETA badge CSS, and the new
`public/modules/meta-connect.js` UI module — without modifying any
existing function in `index.html`.

> **No secrets are committed.** Every Meta credential lives behind
> `Deno.env.get(...)` and is set via `supabase secrets set` (Step 2).
> Rotate the App Secret if it has been pasted into prompts, chats, or
> any unencrypted storage.

---

## What's in this PR

```
supabase/functions/messenger-webhook/index.ts        (new)
supabase/functions/instagram-webhook/index.ts        (new)
supabase/functions/meta-token-manager/index.ts       (new)
supabase/functions/list-waba-templates/index.ts      (new)
supabase/migrations/20260427_meta_channels_phase1.sql (new)
public/modules/meta-connect.js                       (new)
src/styles/main.css                                  (+1 rule: .beta-badge)
public/i18n/en.json                                  (+meta_connect/messenger_connect/instagram_connect groups + 22 whatsapp_connect keys)
public/i18n/ar.json                                  (+same)
index.html                                           (+1 <script src> line, +inline `enableScreencastMode` shim)
docs/meta-channels-runbook.md                        (this file)
```

No existing function in `index.html` was modified. All polish for the
WhatsApp connect modal is applied by `meta-connect.js` via a
MutationObserver on `#whatsapp-connect-body` and a one-shot wrap of
`window.startWhatsAppEmbeddedSignup`.

---

## Step 1 — Apply the migration

The migration is idempotent. Run it once against the production project:

```bash
# Option A: Supabase CLI (recommended)
supabase db push --project-ref xrycghxaxqzvkmzqzzkx

# Option B: Dashboard → SQL Editor → paste the file's contents and run
```

What it does:

* Creates `meta_channel_tokens` (org/platform/account-scoped Meta tokens).
* Creates `whatsapp_message_templates` (cache of WABA templates from
  Meta's Graph API).
* Adds `account_name`, `instagram_username`, `connected_at`, `updated_at`
  to `org_channel_accounts` and a partial unique index on
  `(org_id, platform) WHERE is_active`.
* Adds a `meta jsonb` column to `inbox_conversations` and `inbox_messages`.
* Adds `external_contact_id` (and an index) to `inbox_contacts`.
* Backfills `org_channel_accounts.external_account_id` from `account_id`
  where missing.

Rollback: every CREATE / ALTER uses IF NOT EXISTS, so you can rerun
safely; to rollback, drop the new tables and the new columns.

---

## Step 2 — Set the Edge Function secrets

```bash
supabase secrets set \
  META_APP_ID="<your META_APP_ID>" \
  META_APP_SECRET="<your META_APP_SECRET>" \
  META_VERIFY_TOKEN="<your META_VERIFY_TOKEN>" \
  META_TOKEN_INTERNAL_SECRET="$(openssl rand -hex 32)" \
  --project-ref xrycghxaxqzvkmzqzzkx
```

`META_TOKEN_INTERNAL_SECRET` is used only for the `refresh` action of
`meta-token-manager` (called by the future cron job). End-user calls
go through a Supabase user JWT and don't need it.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by
Supabase, you don't set them.

---

## Step 3 — Deploy the four Edge Functions

```bash
supabase functions deploy messenger-webhook    --project-ref xrycghxaxqzvkmzqzzkx
supabase functions deploy instagram-webhook    --project-ref xrycghxaxqzvkmzqzzkx
supabase functions deploy meta-token-manager   --project-ref xrycghxaxqzvkmzqzzkx
supabase functions deploy list-waba-templates  --project-ref xrycghxaxqzvkmzqzzkx
```

Public URLs after deploy:

```
https://xrycghxaxqzvkmzqzzkx.supabase.co/functions/v1/messenger-webhook
https://xrycghxaxqzvkmzqzzkx.supabase.co/functions/v1/instagram-webhook
https://xrycghxaxqzvkmzqzzkx.supabase.co/functions/v1/meta-token-manager
https://xrycghxaxqzvkmzqzzkx.supabase.co/functions/v1/list-waba-templates
```

Webhook subscriptions in the Meta App dashboard:

* Page subscriptions → Callback URL = `…/messenger-webhook`,
  Verify Token = `META_VERIFY_TOKEN`, fields = `messages`.
* Instagram subscriptions → Callback URL = `…/instagram-webhook`,
  Verify Token = `META_VERIFY_TOKEN`, fields = `messages`.

---

## Step 4 — Frontend smoke tests

After `npm run build && npm run dev` (or your usual flow):

1. Open the WhatsApp tab → click **Connect Channel** → the modal should
   show a 3-step pill indicator above the existing content; tooltips
   should appear on hover for *Continue with Facebook*, *Reconnect*,
   *Clear Saved State*, *Copy JSON*, and the settings cog.
2. In the JS console, run `enableScreencastMode()` → page reloads,
   amber screencast banner appears above the WhatsApp connect slot.
   Dismiss with ✕ → flag clears, banner disappears.
3. Switch to the Messenger (Page) agent tab → a new card with the title
   *Messenger Channel Connection* and a BETA pill should render below
   the existing config sections. Status should read *Not Connected* if
   no row exists in `org_channel_accounts` for `platform='page'`.
4. Same check for the Instagram tab (helper line about Professional
   accounts shown beneath the description).
5. Connect a real Page → confirm a row appears in
   `meta_channel_tokens` and `org_channel_accounts`.
6. Click *View Message Templates* on a connected WhatsApp connection →
   the function should return either the live list (with status badges)
   or the placeholder list with the "Connect your WABA…" note.
7. Disconnect → both the meta_channel_tokens row and the
   org_channel_accounts row flip to `is_active=false`.

---

## Step 5 — Meta App Review (screencast)

* Owner enters screencast mode by running `enableScreencastMode()` in
  the JS console.
* Banner stays only for the WhatsApp connect slot, only for that
  browser, only while the localStorage flag is present.
* Live customers never see the banner because the module checks
  `localStorage.getItem('digitivia_screencast_mode') === '1'` on every
  render.

---

## Rollback

* **Frontend:** revert the `<script src="/modules/meta-connect.js">`
  tag in `index.html` and the file `public/modules/meta-connect.js`.
  Everything else (BETA CSS, i18n) is additive and harmless.
* **Edge Functions:** `supabase functions delete <name>` for any of
  the four, or unsubscribe the Meta webhook callback URL — Meta will
  stop sending events.
* **Migration:** the new tables can be dropped and the new columns
  removed; nothing in the existing app reads them yet.

---

## Auth notes for `list-waba-templates`

The function accepts EITHER `{ Content-Type, apikey, Authorization: Bearer <user_jwt> }`
OR `{ Content-Type, apikey }` (no Bearer). With Bearer, we verify the JWT
and confirm the caller is a member of `org_id`. Without Bearer, we skip
the membership check; security falls back to the `(org_id, waba_id)`
pair needing to actually have a stored Meta token row -- without that,
the function returns the static placeholder list, so anonymous callers
cannot extract live data. The Connect modal's UI path in
`meta-connect.js` always sends the Bearer.

## Owner notes

* This phase only delivers the *connection* surface. It does not
  change how messages are processed downstream — the n8n unified
  webhook remains the single point of normalisation for WhatsApp,
  Messenger, and Instagram.
* The schema's `whatsapp_message_templates` cache supports the
  Templates Proof Panel and gives the rest of the app a
  Meta-rate-limit-friendly source of truth.
* `meta_channel_tokens` and `org_channel_accounts` deliberately
  duplicate `access_token`. The former is the "vault" (RLS-locked,
  service-role only), the latter is the row the existing app code
  already reads from. We update both atomically inside the
  `exchange` action so the app keeps working without further changes.
