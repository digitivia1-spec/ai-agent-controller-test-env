-- ---------------------------------------------------------------------
-- 20260506_social_comments.sql
--
-- Minimal table to capture Facebook Page `feed` comments and Instagram
-- `comments` events that arrive via the unified n8n webhook
-- (`meta_unified_digitivia`). Used by the read-only Comments tab in the
-- frontend to demonstrate live receipt of these events for Meta App
-- Review.
--
-- Writes are service-role only (n8n uses the service key). Reads are
-- restricted to org members via the existing public.is_org_member(uuid)
-- helper (see CLAUDE.md §4 -- DO NOT redeclare it).
-- ---------------------------------------------------------------------

create table if not exists public.social_comments (
    id                  uuid primary key default gen_random_uuid(),
    org_id              uuid not null references public.organizations(id) on delete cascade,
    platform            text not null check (platform in ('facebook','instagram')),
    external_post_id    text,
    external_comment_id text not null,
    parent_external_id  text,
    author_external_id  text,
    author_name         text,
    body                text,
    permalink           text,
    raw                 jsonb default '{}'::jsonb,
    created_at          timestamptz not null default now(),
    unique (platform, external_comment_id)
);

create index if not exists idx_social_comments_org_created
    on public.social_comments (org_id, created_at desc);

alter table public.social_comments enable row level security;

drop policy if exists social_comments_select_org_member on public.social_comments;
create policy social_comments_select_org_member
    on public.social_comments
    for select
    using (public.is_org_member(org_id));

-- Writes happen exclusively from n8n via the service role key.
drop policy if exists social_comments_service_write on public.social_comments;
create policy social_comments_service_write
    on public.social_comments
    for insert
    to service_role
    with check (true);
