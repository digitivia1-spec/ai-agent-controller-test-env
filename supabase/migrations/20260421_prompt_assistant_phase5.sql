-- Prompt Assistant — Phase 5: trusted limits, atomic usage counter,
-- ownership + lock enforcement.
--
-- Runs once. All statements are idempotent so a re-run is safe.

-- 1. Lock state on agent_configs --------------------------------------------
-- A locked prompt can still drive a draft generation (read-only reference),
-- but cannot be silently overwritten. The app-side edge function rejects
-- apply/replace on a locked row unless the caller sends an explicit
-- override AND has owner/admin role.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'agent_configs'
          AND column_name = 'is_locked'
    ) THEN
        ALTER TABLE public.agent_configs
            ADD COLUMN is_locked BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN lock_reason TEXT,
            ADD COLUMN locked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
            ADD COLUMN locked_at TIMESTAMPTZ;
    END IF;
END $$;

-- 2. Atomic daily-usage counter ---------------------------------------------
-- Replaces the read-then-upsert pattern in the edge function with a single
-- SQL statement. Returns allowed + new count + remaining. Counts are stored
-- in `rate_limits` keyed by `prompt_assistant:<org_id>:<YYYY-MM-DD>` (UTC).
CREATE OR REPLACE FUNCTION public.prompt_assistant_bump_daily(
    p_org_id UUID,
    p_limit  INTEGER
)
RETURNS TABLE (allowed BOOLEAN, new_count INTEGER, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_key          TEXT;
    v_window_start TIMESTAMPTZ;
    v_current      INTEGER;
BEGIN
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'p_org_id is required';
    END IF;
    IF p_limit IS NULL OR p_limit <= 0 THEN
        RAISE EXCEPTION 'p_limit must be a positive integer';
    END IF;

    v_key          := 'prompt_assistant:' || p_org_id::text || ':' || to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD');
    v_window_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';

    -- Lock row if present, else insert fresh.
    INSERT INTO public.rate_limits (key, count, window_start, updated_at)
    VALUES (v_key, 0, v_window_start, now())
    ON CONFLICT (key) DO NOTHING;

    SELECT rl.count INTO v_current
    FROM public.rate_limits rl
    WHERE rl.key = v_key
    FOR UPDATE;

    IF v_current >= p_limit THEN
        allowed   := FALSE;
        new_count := v_current;
        remaining := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    UPDATE public.rate_limits
       SET count       = rate_limits.count + 1,
           updated_at  = now()
     WHERE key = v_key
     RETURNING count INTO v_current;

    allowed   := TRUE;
    new_count := v_current;
    remaining := GREATEST(0, p_limit - v_current);
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.prompt_assistant_bump_daily(UUID, INTEGER) FROM PUBLIC;
-- The edge function invokes this via the service-role client, which bypasses
-- anon/authenticated grants. Do not expose to authenticated directly.

-- 3. Plan resolver RPC ------------------------------------------------------
-- org_subscriptions.plan_id joins billing_plans.id -> plan_slug. Used by the
-- edge function to decide the daily limit bucket (starter / growth / pro).
CREATE OR REPLACE FUNCTION public.prompt_assistant_resolve_plan(
    p_org_id UUID
)
RETURNS TABLE (plan_slug TEXT, daily_limit_override INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        bp.plan_slug,
        CASE
            WHEN (bp.limits ? 'prompt_assistant_daily_limit')
             AND (bp.limits ->> 'prompt_assistant_daily_limit') ~ '^[0-9]+$'
            THEN (bp.limits ->> 'prompt_assistant_daily_limit')::integer
            ELSE NULL
        END AS daily_limit_override
    FROM public.org_subscriptions s
    JOIN public.billing_plans bp ON bp.id = s.plan_id
    WHERE s.org_id = p_org_id
      AND s.status IN ('trialing', 'active', 'past_due')
    ORDER BY s.updated_at DESC NULLS LAST
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.prompt_assistant_resolve_plan(UUID) FROM PUBLIC;

-- 4. Safety: index the rate_limits scan key --------------------------------
-- UNIQUE already exists on (key); keep an explicit CREATE INDEX IF NOT EXISTS
-- in case earlier environments lack it.
CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON public.rate_limits (key);

-- 5. RLS: allow the row-owner to read their own lock state -----------------
-- (Write remains gated by the existing agent_configs policies.)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'agent_configs'
          AND policyname = 'agent_configs_select_own_org_lock_info'
    ) THEN
        -- Intentionally omitted: policies on agent_configs already exist and
        -- cover SELECT for org members. Adding a lock-specific policy would
        -- shadow them. This block is a no-op placeholder for future tweaks.
        NULL;
    END IF;
END $$;
