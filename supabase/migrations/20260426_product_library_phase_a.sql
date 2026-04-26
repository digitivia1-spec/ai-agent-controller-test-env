-- =====================================================================
-- 20260426_product_library_phase_a.sql
--
-- Product Library + Auto Product Sync — Phase A foundation.
--
-- Adds the unified multi-source product schema, the org-scoped RLS
-- policies, the per-feature private storage bucket (product_media),
-- and the supporting indexes.
--
-- Sources are restricted to: shopify | woocommerce | easyorders | manual
-- Statuses are restricted to: active | inactive
-- Sync run statuses follow doc 09 (queued | running | completed |
--   completed_with_warnings | failed | cancelled)
-- Sync run triggers follow doc 09 (initial_after_credentials_save |
--   credentials_updated | scheduled_every_3_days |
--   manual_retry_after_failure | system_retry)
-- Media types: image | video
-- Media states: valid | missing | broken | unsupported | unverified
--
-- IMPORTANT: This phase deliberately does NOT touch the pre-existing
-- shopify_* tables (Admin API path). The new `products` table holds
-- multi-source data captured by the wizard's Storefront-Token /
-- WooCommerce REST / EasyOrders API integrations and manual products.
--
-- Rollback (manual, if needed):
--   drop table if exists public.product_sync_runs cascade;
--   drop table if exists public.product_media cascade;
--   drop table if exists public.products cascade;
--   delete from storage.buckets where id = 'product_media';
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) products
-- ---------------------------------------------------------------------
create table if not exists public.products (
    id                  uuid primary key default gen_random_uuid(),
    org_id              uuid not null references public.organizations(id) on delete cascade,
    source              text not null check (source in ('shopify','woocommerce','easyorders','manual')),
    external_id         text,                       -- null only for manual products
    title               text not null,
    description         text,
    description_html    text,
    product_url         text,
    price               numeric(12,2),
    sale_price          numeric(12,2),
    currency            text,
    sku                 text,
    quantity            integer,
    availability        text,                       -- raw availability flag from source
    status              text not null default 'active' check (status in ('active','inactive')),
    last_synced_at      timestamptz,
    last_sync_run_id    uuid,                       -- FK added below (forward ref)
    last_seen_at        timestamptz,                -- updated each sync; basis for soft-delete
    raw                 jsonb not null default '{}'::jsonb,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

-- A given source's product is unique per org. Manual products have no
-- external_id, so the unique index is partial.
create unique index if not exists products_org_source_external_unique
    on public.products(org_id, source, external_id)
    where external_id is not null;

create index if not exists products_org_source_idx
    on public.products(org_id, source);

create index if not exists products_org_status_idx
    on public.products(org_id, status);

create index if not exists products_org_last_synced_idx
    on public.products(org_id, last_synced_at desc nulls last);

-- Lightweight full-text-ish helper for the search filter (Postgres
-- defaults; we'll use ILIKE in Phase E to keep things stack-consistent
-- with the rest of the app rather than introducing tsvector).
create index if not exists products_title_trgm_idx
    on public.products using gin (title gin_trgm_ops)
    where title is not null;

-- pg_trgm is used by inbox_messages already; safe to require here.
do $$ begin
    create extension if not exists pg_trgm;
exception when others then null;
end $$;

-- updated_at maintainer
create or replace function public.touch_products_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end $$;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
    before update on public.products
    for each row execute procedure public.touch_products_updated_at();

-- ---------------------------------------------------------------------
-- 2) product_media
-- ---------------------------------------------------------------------
create table if not exists public.product_media (
    id                  uuid primary key default gen_random_uuid(),
    product_id          uuid not null references public.products(id) on delete cascade,
    org_id              uuid not null references public.organizations(id) on delete cascade,
    media_type          text not null check (media_type in ('image','video')),
    url                 text,                       -- direct URL (sync) OR signed-URL target (upload)
    thumbnail_url       text,
    storage_path        text,                       -- only set when uploaded to product_media bucket
    alt_text            text,
    source_media_id     text,                       -- platform media ID if synced
    is_primary          boolean not null default false,
    state               text not null default 'unverified' check (state in ('valid','missing','broken','unsupported','unverified')),
    position            integer not null default 0,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists product_media_product_idx
    on public.product_media(product_id);

create index if not exists product_media_org_state_idx
    on public.product_media(org_id, state);

-- At most one is_primary=true per product (enforced as a partial unique index).
create unique index if not exists product_media_one_primary_per_product
    on public.product_media(product_id)
    where is_primary;

create or replace function public.touch_product_media_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end $$;

drop trigger if exists product_media_touch_updated_at on public.product_media;
create trigger product_media_touch_updated_at
    before update on public.product_media
    for each row execute procedure public.touch_product_media_updated_at();

-- ---------------------------------------------------------------------
-- 3) product_sync_runs
-- ---------------------------------------------------------------------
create table if not exists public.product_sync_runs (
    id              uuid primary key default gen_random_uuid(),
    org_id          uuid not null references public.organizations(id) on delete cascade,
    source          text not null check (source in ('shopify','woocommerce','easyorders')),
    status          text not null default 'queued' check (status in (
                        'queued','running','completed','completed_with_warnings',
                        'failed','cancelled')),
    trigger         text not null check (trigger in (
                        'initial_after_credentials_save','credentials_updated',
                        'scheduled_every_3_days','manual_retry_after_failure',
                        'system_retry')),
    summary         jsonb not null default '{}'::jsonb,
    error_code      text,
    error_message   text,
    started_at      timestamptz not null default now(),
    finished_at     timestamptz,
    duration_ms     integer,
    created_at      timestamptz not null default now()
);

create index if not exists product_sync_runs_org_started_idx
    on public.product_sync_runs(org_id, started_at desc);

create index if not exists product_sync_runs_org_source_started_idx
    on public.product_sync_runs(org_id, source, started_at desc);

-- Forward-ref FK from products.last_sync_run_id (deferred so this file
-- can be replayed independently)
do $$ begin
    alter table public.products
        add constraint products_last_sync_run_fk
        foreign key (last_sync_run_id)
        references public.product_sync_runs(id)
        on delete set null;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- 4) RLS — org membership read/write, mirroring the inbox_messages policy
-- ---------------------------------------------------------------------
alter table public.products            enable row level security;
alter table public.product_media       enable row level security;
alter table public.product_sync_runs   enable row level security;

-- We reuse the existing public.is_org_member(p_org_id uuid) function shipped
-- by an earlier migration (it returns true if auth.uid() is in
-- organization_members for the given org). Do NOT redeclare it here with a
-- different parameter name -- Postgres rejects parameter renames.

-- products policies
drop policy if exists products_select on public.products;
create policy products_select on public.products
    for select using (public.is_org_member(org_id));

drop policy if exists products_insert on public.products;
create policy products_insert on public.products
    for insert with check (public.is_org_member(org_id));

drop policy if exists products_update on public.products;
create policy products_update on public.products
    for update using (public.is_org_member(org_id))
    with check (public.is_org_member(org_id));

drop policy if exists products_delete on public.products;
create policy products_delete on public.products
    for delete using (public.is_org_member(org_id));

-- product_media policies
drop policy if exists product_media_select on public.product_media;
create policy product_media_select on public.product_media
    for select using (public.is_org_member(org_id));

drop policy if exists product_media_insert on public.product_media;
create policy product_media_insert on public.product_media
    for insert with check (public.is_org_member(org_id));

drop policy if exists product_media_update on public.product_media;
create policy product_media_update on public.product_media
    for update using (public.is_org_member(org_id))
    with check (public.is_org_member(org_id));

drop policy if exists product_media_delete on public.product_media;
create policy product_media_delete on public.product_media
    for delete using (public.is_org_member(org_id));

-- product_sync_runs policies (reads only; writes happen via service-role from the Edge Function)
drop policy if exists product_sync_runs_select on public.product_sync_runs;
create policy product_sync_runs_select on public.product_sync_runs
    for select using (public.is_org_member(org_id));

-- ---------------------------------------------------------------------
-- 5) Storage bucket: product_media (private, signed URLs)
--    Mirrors the inbox_media / task_attachments pattern.
--    Path convention: ${org_id}/{manual|sync}/${ts}_${safeName}
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
    values ('product_media', 'product_media', false)
    on conflict (id) do nothing;

-- storage.objects RLS — org membership inferred from path prefix
-- (same approach used implicitly in the existing inbox_media bucket).
-- The first path segment must equal an org_id the caller belongs to.
drop policy if exists product_media_storage_select on storage.objects;
create policy product_media_storage_select on storage.objects
    for select to authenticated
    using (
        bucket_id = 'product_media'
        and public.is_org_member( (string_to_array(name, '/'))[1]::uuid )
    );

drop policy if exists product_media_storage_insert on storage.objects;
create policy product_media_storage_insert on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'product_media'
        and public.is_org_member( (string_to_array(name, '/'))[1]::uuid )
    );

drop policy if exists product_media_storage_update on storage.objects;
create policy product_media_storage_update on storage.objects
    for update to authenticated
    using (
        bucket_id = 'product_media'
        and public.is_org_member( (string_to_array(name, '/'))[1]::uuid )
    );

drop policy if exists product_media_storage_delete on storage.objects;
create policy product_media_storage_delete on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'product_media'
        and public.is_org_member( (string_to_array(name, '/'))[1]::uuid )
    );

-- ---------------------------------------------------------------------
-- 6) Comments — these are the canonical descriptions, useful for the
--    Supabase dashboard and any auto-generated docs.
-- ---------------------------------------------------------------------
comment on table public.products is
    'Unified multi-source product library. Source values: shopify, woocommerce, easyorders, manual.';
comment on table public.product_media is
    'Media items for products. Image or video. URLs may be remote (sync) or stored in product_media bucket (manual upload).';
comment on table public.product_sync_runs is
    'Per-source product sync run log. Powers the Product Library status card and partial-sync warnings.';
comment on column public.products.external_id is
    'Stable platform product id; null for manual products.';
comment on column public.products.last_seen_at is
    'Updated every sync; basis for soft-delete (mark inactive when not seen).';

