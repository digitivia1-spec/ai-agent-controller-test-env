-- Phase 3 Database Migration for Digitivia AI Agent Platform
-- Custom Roles & Per-Member Permission Overrides
-- SAFE: All operations use IF NOT EXISTS / IF EXISTS patterns
-- Already applied via Supabase MCP

-- ============================================================
-- 1. Create org_custom_roles table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.org_custom_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  permissions  jsonb NOT NULL DEFAULT '{}',
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

-- ============================================================
-- 2. Add columns to organization_members
-- ============================================================
ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES public.org_custom_roles(id) ON DELETE SET NULL;
ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS permission_overrides jsonb NOT NULL DEFAULT '{}';

-- ============================================================
-- 3. Add custom_role_id to org_invitations
-- ============================================================
ALTER TABLE public.org_invitations
  ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES public.org_custom_roles(id) ON DELETE SET NULL;

-- ============================================================
-- 4. RLS on org_custom_roles
-- ============================================================
-- (Applied via migration)

-- ============================================================
-- 5. Updated RPCs
-- ============================================================
-- get_my_permissions: now resolves custom_role → base role → per-member overrides
-- list_org_members: now returns custom_role_id, custom_role_name, override_count
-- send_org_invitation: accepts p_custom_role_id
-- accept_org_invitation: sets custom_role_id on org_members insert

-- ============================================================
-- 6. New RPCs
-- ============================================================
-- list_org_custom_roles(p_org_id)
-- upsert_org_custom_role(p_org_id, p_name, p_description, p_permissions, p_id?)
-- delete_org_custom_role(p_org_id, p_role_id)
-- set_member_custom_role(p_org_id, p_member_user_id, p_custom_role_id?)
-- set_member_permission_override(p_org_id, p_member_user_id, p_permission, p_value?)
-- clear_member_permission_overrides(p_org_id, p_member_user_id)
-- get_member_permissions(p_org_id, p_member_user_id)
