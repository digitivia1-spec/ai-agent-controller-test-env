-- ============================================================
-- Coin System Fixes  2026-04-29
-- 1. Correct GRANT for check_ai_gate (live fn has 6-arg signature;
--    20260428 migration targeted the old 5-arg stub and silently failed)
-- 2. Add reset_coin_balance(p_org_id) — called after plan upgrade /
--    mid-period recharge so is_balance_finished resets immediately
-- 3. Idempotent seed for ai_model_rates (was live-only; now in a migration)
-- 4. Idempotent seed for billing_plans.limits.coins_limit (was live-only)
-- ============================================================

-- ── 1. GRANT on the real check_ai_gate signature ─────────────
GRANT EXECUTE
  ON FUNCTION public.check_ai_gate(uuid, text, bigint, bigint, numeric, boolean)
  TO authenticated;

-- ── 2. reset_coin_balance ────────────────────────────────────
-- Reset balance flags and sync coins_total from the current active plan.
-- Call this from your Stripe webhook handler immediately after a successful
-- subscription upgrade or coin top-up.
CREATE OR REPLACE FUNCTION public.reset_coin_balance(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coins_limit  numeric     := 0;
  v_period_start timestamptz;
  v_period_end   timestamptz;
BEGIN
  -- Caller must belong to the org (safety check matches check_ai_gate)
  IF NOT public.is_org_member(p_org_id) THEN
    RETURN;
  END IF;

  -- Pull the current active/trialing plan's coin limit + period bounds
  SELECT
    COALESCE((bp.limits->>'coins_limit')::numeric, 0),
    os.current_period_start,
    os.current_period_end
  INTO v_coins_limit, v_period_start, v_period_end
  FROM public.org_subscriptions os
  JOIN public.billing_plans     bp ON bp.id = os.plan_id
  WHERE os.org_id = p_org_id
    AND os.status IN ('active', 'trialing')
  ORDER BY os.created_at DESC
  LIMIT 1;

  -- Reset balance flags; sync coins_total from plan
  UPDATE public.org_usage SET
    is_balance_finished = false,
    is_low_balance      = false,
    coins_total         = COALESCE(v_coins_limit, coins_total),
    period_start        = COALESCE(v_period_start, period_start),
    period_end          = COALESCE(v_period_end,   period_end),
    updated_at          = now()
  WHERE org_id = p_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_coin_balance(uuid) TO authenticated;

-- ── 3. Seed ai_model_rates (idempotent UPSERT) ───────────────
INSERT INTO public.ai_model_rates
  (model_id, usage_type, input_usd_per_1m, output_usd_per_1m,
   audio_usd_per_minute, coins_per_usd, notes)
VALUES
  ('gpt-5-mini',  'text',  1.100000, 4.400000, 0.000000, 100,
   'OpenAI GPT-5 mini – text replies (Ai Gate)'),
  ('gpt-5.2',     'text', 10.000000, 40.000000, 0.000000, 100,
   'OpenAI GPT-5.2 – text replies (Comments Gate)'),
  ('gpt-4o-mini', 'image', 0.150000,  0.600000, 0.000000, 100,
   'OpenAI GPT-4o mini – vision/image analysis (Ai Gate)'),
  ('whisper-1',   'audio', 0.000000,  0.000000, 0.006000, 100,
   'OpenAI Whisper v1 – audio transcription (Ai Gate)')
ON CONFLICT (model_id) DO UPDATE SET
  usage_type           = EXCLUDED.usage_type,
  input_usd_per_1m     = EXCLUDED.input_usd_per_1m,
  output_usd_per_1m    = EXCLUDED.output_usd_per_1m,
  audio_usd_per_minute = EXCLUDED.audio_usd_per_minute,
  coins_per_usd        = EXCLUDED.coins_per_usd,
  notes                = EXCLUDED.notes,
  updated_at           = now();

-- ── 4. Seed billing_plans.limits.coins_limit (idempotent) ────
-- Only updates rows that are missing the key — safe on a live DB.
UPDATE public.billing_plans
SET limits = jsonb_set(COALESCE(limits, '{}'), '{coins_limit}', '1500')
WHERE plan_slug = 'starter'
  AND (limits->>'coins_limit') IS NULL;

UPDATE public.billing_plans
SET limits = jsonb_set(COALESCE(limits, '{}'), '{coins_limit}', '3000')
WHERE plan_slug = 'growth'
  AND (limits->>'coins_limit') IS NULL;

UPDATE public.billing_plans
SET limits = jsonb_set(COALESCE(limits, '{}'), '{coins_limit}', '8000')
WHERE plan_slug IN ('pro', 'pro_sim')
  AND (limits->>'coins_limit') IS NULL;
