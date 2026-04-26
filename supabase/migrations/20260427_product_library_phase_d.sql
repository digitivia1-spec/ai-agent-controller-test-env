-- =====================================================================
-- 20260427_product_library_phase_d.sql
--
-- Product Library + Auto Product Sync -- Phase D scheduled sync.
--
-- Adds two SQL functions and two cron jobs:
--   1) enqueue_scheduled_product_syncs()
--      Scans every org that has at least one verified integration in
--      organizations.external_onboarding_data.integrations.* and
--      fires one async pg_net.http_post per (org, source) at the
--      product-sync Edge Function with trigger='scheduled_every_3_days'.
--
--   2) reap_stuck_product_sync_runs()
--      Marks any product_sync_runs row that has been in 'running' for
--      more than 30 minutes as 'failed' with error_code='ERR_REAPER_TIMEOUT'.
--      Mirrors the existing reap_stuck_followup_claims() pattern.
--
-- Both functions are SECURITY DEFINER so they can read service-only
-- data (Vault, organizations.external_onboarding_data) and write to
-- product_sync_runs even with RLS on.
--
-- Cron schedule:
--   product-sync-every-3-days  -> 03:00 every 3 days  ('0 3 */3 * *')
--   product-sync-reaper        -> every 5 minutes     ('*/5 * * * *')
--
-- REQUIREMENTS (set BEFORE running scheduled jobs):
--   1. A Vault secret named 'product_sync_internal_secret'
--      whose value matches the PRODUCT_SYNC_INTERNAL_SECRET env var
--      on the product-sync Edge Function (see Edge Function dashboard).
--   2. A Vault secret named 'project_url' with the project URL
--      (e.g. https://xrycghxaxqzvkmzqzzkx.supabase.co). Falls back to
--      a hard-coded constant inside the function if the secret is missing.
--
-- Rollback (manual, if needed):
--   select cron.unschedule('product-sync-every-3-days');
--   select cron.unschedule('product-sync-reaper');
--   drop function if exists public.enqueue_scheduled_product_syncs();
--   drop function if exists public.reap_stuck_product_sync_runs();
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: fetch the project URL + internal secret from Vault.
-- Returns NULL if not yet configured (function will then no-op safely).
-- ---------------------------------------------------------------------
create or replace function public._product_sync_endpoint()
returns text
language sql
security definer
set search_path = public, vault
as $$
    select coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1),
        'https://xrycghxaxqzvkmzqzzkx.supabase.co'
    ) || '/functions/v1/product-sync';
$$;

create or replace function public._product_sync_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
    select decrypted_secret from vault.decrypted_secrets where name = 'product_sync_internal_secret' limit 1;
$$;

-- ---------------------------------------------------------------------
-- enqueue_scheduled_product_syncs()
-- ---------------------------------------------------------------------
create or replace function public.enqueue_scheduled_product_syncs()
returns table (org_id uuid, source text, request_id bigint)
language plpgsql
security definer
set search_path = public, net
as $$
declare
    r record;
    secret text;
    endpoint text;
    rid bigint;
begin
    secret := public._product_sync_secret();
    endpoint := public._product_sync_endpoint();
    if secret is null or endpoint is null then
        raise notice 'enqueue_scheduled_product_syncs: missing vault secret(s); skipping';
        return;
    end if;

    for r in
        select
            o.id as org_id,
            unnest(array_remove(array[
                case when (o.external_onboarding_data->'integrations'->'shopify'->>'storefront_token') is not null
                     and  (o.external_onboarding_data->'integrations'->'shopify'->>'shop_domain') is not null
                     and  (o.external_onboarding_data->'integrations'->'shopify'->>'verified_at') is not null
                  then 'shopify' end,
                case when (o.external_onboarding_data->'integrations'->'woocommerce'->>'consumer_key') is not null
                     and  (o.external_onboarding_data->'integrations'->'woocommerce'->>'consumer_secret') is not null
                     and  (o.external_onboarding_data->'integrations'->'woocommerce'->>'website_url') is not null
                     and  (o.external_onboarding_data->'integrations'->'woocommerce'->>'verified_at') is not null
                  then 'woocommerce' end,
                case when (o.external_onboarding_data->'integrations'->'easy_order'->>'api_key') is not null
                     and  (o.external_onboarding_data->'integrations'->'easy_order'->>'verified_at') is not null
                  then 'easyorders' end
            ], null)) as src
        from organizations o
        where o.external_onboarding_data ? 'integrations'
    loop
        select net.http_post(
            url := endpoint,
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-product-sync-secret', secret
            ),
            body := jsonb_build_object(
                'org_id',  r.org_id::text,
                'source',  r.src,
                'trigger', 'scheduled_every_3_days'
            ),
            timeout_milliseconds := 60000
        ) into rid;

        org_id := r.org_id;
        source := r.src;
        request_id := rid;
        return next;
    end loop;
    return;
end;
$$;

-- ---------------------------------------------------------------------
-- reap_stuck_product_sync_runs()
-- ---------------------------------------------------------------------
create or replace function public.reap_stuck_product_sync_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    reaped integer := 0;
begin
    update product_sync_runs
    set status = 'failed',
        error_code = coalesce(error_code, 'ERR_REAPER_TIMEOUT'),
        error_message = coalesce(error_message, 'reaper: run stuck in running > 30 min'),
        finished_at = now(),
        duration_ms = extract(milliseconds from (now() - started_at))::integer
    where status = 'running'
      and started_at < now() - interval '30 minutes';
    get diagnostics reaped = row_count;
    return reaped;
end;
$$;

-- ---------------------------------------------------------------------
-- Schedule the cron jobs (idempotent: unschedule any existing first)
-- ---------------------------------------------------------------------
do $$
declare
    j record;
begin
    for j in select jobid, jobname from cron.job
             where jobname in ('product-sync-every-3-days', 'product-sync-reaper')
    loop
        perform cron.unschedule(j.jobname);
    end loop;
end $$;

select cron.schedule(
    'product-sync-every-3-days',
    '0 3 */3 * *',
    $$ select public.enqueue_scheduled_product_syncs(); $$
);

select cron.schedule(
    'product-sync-reaper',
    '*/5 * * * *',
    $$ select public.reap_stuck_product_sync_runs(); $$
);

comment on function public.enqueue_scheduled_product_syncs() is
    'Scheduled every 3 days at 03:00. Calls the product-sync Edge Function once per (org, source) for orgs with verified credentials.';
comment on function public.reap_stuck_product_sync_runs() is
    'Scheduled every 5 minutes. Marks product_sync_runs rows stuck in running > 30 min as failed with ERR_REAPER_TIMEOUT.';
