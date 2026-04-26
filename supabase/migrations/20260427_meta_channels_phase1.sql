-- 20260427_meta_channels_phase1.sql
--
-- Backing schema for the Meta channels (Messenger + Instagram) connection
-- flow and the `list-waba-templates` Edge Function. All statements are
-- idempotent so this migration is safe to re-apply.
--
-- New tables:
--   meta_channel_tokens          -- per-org/per-platform/per-account Meta tokens
--   whatsapp_message_templates   -- WABA templates cached from Graph API
--
-- ALTER on existing tables:
--   org_channel_accounts  -- add account_name, instagram_username, connected_at, updated_at
--   inbox_conversations   -- add meta jsonb
--   inbox_contacts        -- add external_contact_id (+ index)
--   inbox_messages        -- add meta jsonb
--
-- Backfill:
--   org_channel_accounts.external_account_id := account_id where null

-- ──────────────────────────────────────────────────────────────────────────
-- meta_channel_tokens
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta_channel_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform          text NOT NULL CHECK (platform IN ('page','instagram','whatsapp')),
  account_id        text NOT NULL,
  account_name      text,
  access_token      text NOT NULL,
  token_type        text NOT NULL DEFAULT 'page' CHECK (token_type IN ('page','user','system')),
  expires_at        timestamptz,
  scopes            text[] DEFAULT '{}',
  meta_user_id      text,
  ig_account_id     text,
  is_active         boolean DEFAULT true,
  last_validated_at timestamptz,
  last_error        text,
  connected_at      timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (org_id, platform, account_id)
);

CREATE INDEX IF NOT EXISTS idx_mct_org_platform
  ON meta_channel_tokens(org_id, platform) WHERE is_active = true;

ALTER TABLE meta_channel_tokens ENABLE ROW LEVEL SECURITY;

-- Service role only. End users never read this table directly; the
-- meta-token-manager Edge Function uses the service role.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'meta_channel_tokens'
      AND policyname = 'service_role_only'
  ) THEN
    CREATE POLICY "service_role_only" ON meta_channel_tokens
      FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- whatsapp_message_templates
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  waba_id   text NOT NULL,
  name      text NOT NULL,
  status    text DEFAULT 'APPROVED',
  category  text,
  language  text DEFAULT 'en',
  synced_at timestamptz DEFAULT now(),
  UNIQUE (org_id, waba_id, name)
);

CREATE INDEX IF NOT EXISTS idx_waba_templates
  ON whatsapp_message_templates(org_id, waba_id);

ALTER TABLE whatsapp_message_templates ENABLE ROW LEVEL SECURITY;

-- Org members read-only; writes go through the Edge Function (service role).
-- The policy depends on the public.is_org_member(uuid) helper that ships
-- with the product-library migrations. If, for any reason, the helper is
-- missing on this database, we no-op rather than failing the whole
-- migration -- the table will just be unreadable from end-user clients
-- (service role still has full access).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_org_member'
  ) THEN
    RAISE NOTICE 'public.is_org_member(uuid) not found -- skipping org_members_can_read policy on whatsapp_message_templates';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'whatsapp_message_templates'
      AND policyname = 'org_members_can_read'
  ) THEN
    CREATE POLICY "org_members_can_read" ON whatsapp_message_templates
      FOR SELECT USING (public.is_org_member(org_id));
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- org_channel_accounts: extra columns
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE org_channel_accounts
  ADD COLUMN IF NOT EXISTS account_name        text,
  ADD COLUMN IF NOT EXISTS instagram_username  text,
  ADD COLUMN IF NOT EXISTS connected_at        timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz DEFAULT now();

UPDATE org_channel_accounts
   SET external_account_id = account_id
 WHERE external_account_id IS NULL
   AND account_id          IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oca_org_platform
  ON org_channel_accounts(org_id, platform) WHERE is_active = true;

-- One active row per (org, platform). The exchange action assumes this
-- shape (upsert onConflict 'org_id,platform').
CREATE UNIQUE INDEX IF NOT EXISTS uq_oca_org_platform_active
  ON org_channel_accounts(org_id, platform) WHERE is_active = true;

-- ──────────────────────────────────────────────────────────────────────────
-- inbox_conversations: meta column
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE inbox_conversations
  ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}';

-- ──────────────────────────────────────────────────────────────────────────
-- inbox_contacts: external_contact_id
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE inbox_contacts
  ADD COLUMN IF NOT EXISTS external_contact_id text;

CREATE INDEX IF NOT EXISTS idx_ic_org_external
  ON inbox_contacts(org_id, external_contact_id)
  WHERE external_contact_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- inbox_messages: meta column
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE inbox_messages
  ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}';
