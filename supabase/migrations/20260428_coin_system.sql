-- ============================================================
-- Coin System Migration
-- Adds coin tracking columns to org_usage, settings columns
-- to organizations, and the get_coin_status() RPC used by
-- the AI Usage UI tab.
-- ============================================================

-- ── 1. org_usage: coin tracking columns ─────────────────────
-- Note: prompt_tokens_used / completion_tokens_used / total_tokens_used /
-- audio_seconds_used / usd_spent already exist in the DB (added by earlier
-- migrations). The ADD COLUMN IF NOT EXISTS guards make this idempotent.
ALTER TABLE public.org_usage
  ADD COLUMN IF NOT EXISTS coins_used          integer        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coins_total         integer        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coins_used_text     integer        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coins_used_image    integer        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coins_used_audio    integer        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_balance_finished boolean        NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_low_balance      boolean        NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS usd_spent           numeric(12,6)  NOT NULL DEFAULT 0;

-- ── 2. organizations: per-org coin settings ──────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS low_balance_warning_pct  integer  NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS balance_finished_message text              DEFAULT NULL;

-- Guard: warning pct must be 1–99
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_low_balance_warning_pct'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT chk_low_balance_warning_pct
        CHECK (low_balance_warning_pct >= 1 AND low_balance_warning_pct <= 99);
  END IF;
END;
$$;

-- ── 3. get_coin_status(p_org_id) ─────────────────────────────
-- Returns a single JSON-compatible row consumed by the AI Usage
-- UI tab (public/modules/ai-usage.js → supabaseClient.rpc).
--
-- The function:
--   • Reads org_usage for coin numbers + balance flags
--   • Reads organizations for warning_pct + finished_message
--   • Reads the best active/trialing subscription → billing_plan
--     to surface plan_name, plan_slug, and conversations_limit
--   • Computes coins_pct for the progress bar
--   • Returns a single row (or a zeroed-out row if none exists)

CREATE OR REPLACE FUNCTION public.get_coin_status(p_org_id uuid)
RETURNS TABLE (
  coins_used               integer,
  coins_total              integer,
  coins_pct                integer,
  coins_used_text          integer,
  coins_used_image         integer,
  coins_used_audio         integer,
  is_balance_finished      boolean,
  is_low_balance           boolean,
  usd_spent                numeric,
  prompt_tokens_used       bigint,
  completion_tokens_used   bigint,
  total_tokens_used        bigint,
  conversations_used       integer,
  plan_name                text,
  plan_slug                text,
  conversations_limit      integer,
  low_balance_warning_pct  integer,
  balance_finished_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage     public.org_usage%ROWTYPE;
  v_org       public.organizations%ROWTYPE;
  v_sub       public.org_subscriptions%ROWTYPE;
  v_plan      public.billing_plans%ROWTYPE;
  v_pct       integer := 0;
  v_plan_name text    := '—';
  v_plan_slug text    := '';
  v_conv_lim  integer := 0;
BEGIN
  -- Verify caller belongs to this org (RLS safety check)
  IF NOT public.is_org_member(p_org_id) THEN
    RETURN;
  END IF;

  -- org_usage row (may not exist yet)
  SELECT * INTO v_usage
    FROM public.org_usage
   WHERE org_id = p_org_id
   LIMIT 1;

  -- organizations row
  SELECT * INTO v_org
    FROM public.organizations
   WHERE id = p_org_id
   LIMIT 1;

  -- Best subscription (active > trialing, latest period end wins)
  SELECT * INTO v_sub
    FROM public.org_subscriptions
   WHERE org_id = p_org_id
     AND status IN ('active', 'trialing')
   ORDER BY
     CASE WHEN status = 'active' THEN 0 ELSE 1 END ASC,
     current_period_end DESC NULLS LAST
   LIMIT 1;

  -- Billing plan details
  IF v_sub.plan_id IS NOT NULL THEN
    SELECT * INTO v_plan
      FROM public.billing_plans
     WHERE id = v_sub.plan_id
     LIMIT 1;

    v_plan_name := COALESCE(v_plan.plan_name, '—');

    -- Derive slug from plan name for badge colouring
    v_plan_slug := lower(regexp_replace(
      COALESCE(v_plan.plan_name, ''), '\s+', '_', 'g'
    ));

    -- Extract conversations_limit from limits JSONB
    BEGIN
      v_conv_lim := COALESCE(
        (v_plan.limits->>'conversations_limit')::integer,
        (v_plan.limits->>'conversationsLimit')::integer,
        0
      );
    EXCEPTION WHEN others THEN
      v_conv_lim := 0;
    END;
  END IF;

  -- Compute percentage used (0 when no coins configured)
  IF COALESCE(v_usage.coins_total, 0) > 0 THEN
    v_pct := LEAST(100,
      ROUND(
        (COALESCE(v_usage.coins_used, 0)::numeric
         / v_usage.coins_total::numeric) * 100
      )::integer
    );
  END IF;

  -- Return the single result row
  RETURN QUERY SELECT
    COALESCE(v_usage.coins_used,          0)::integer,
    COALESCE(v_usage.coins_total,         0)::integer,
    v_pct,
    COALESCE(v_usage.coins_used_text,     0)::integer,
    COALESCE(v_usage.coins_used_image,    0)::integer,
    COALESCE(v_usage.coins_used_audio,    0)::integer,
    COALESCE(v_usage.is_balance_finished,      false),
    COALESCE(v_usage.is_low_balance,           false),
    COALESCE(v_usage.usd_spent,                0::numeric),
    COALESCE(v_usage.prompt_tokens_used,       0::bigint),
    COALESCE(v_usage.completion_tokens_used,   0::bigint),
    COALESCE(v_usage.total_tokens_used,        0::bigint),
    COALESCE(v_usage.conversations_used,       0)::integer,
    v_plan_name,
    v_plan_slug,
    v_conv_lim,
    COALESCE(v_org.low_balance_warning_pct,  80)::integer,
    COALESCE(v_org.balance_finished_message, NULL);
END;
$$;

-- Grant execute to authenticated role (used by frontend via supabaseClient.rpc)
GRANT EXECUTE ON FUNCTION public.get_coin_status(uuid) TO authenticated;

-- ── 4. check_ai_gate ─────────────────────────────────────────
-- NOTE: check_ai_gate already exists in the DB with the full production
-- implementation (atomic coin delta application, period resets, plan limit
-- sync, fair-gate policy, JSONB result object).  We intentionally do NOT
-- redefine it here to avoid downgrading that function.
-- The full signature is:
--   check_ai_gate(p_org_id uuid, p_coins_text int, p_coins_image int,
--                 p_coins_audio int, p_is_new_conversation boolean)
-- RETURNS jsonb
-- Ensure the authenticated role can execute it (idempotent):
DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.check_ai_gate(uuid, integer, integer, integer, boolean) TO authenticated';
EXCEPTION WHEN undefined_function THEN
  -- Function doesn't exist yet — skip grant; it will be granted when created
  NULL;
END;
$$;
