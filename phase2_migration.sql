-- Phase 2 Database Migration for Digitivia AI Agent Platform
-- Team Invitations System
-- SAFE: All operations use IF NOT EXISTS / IF EXISTS patterns
-- Already applied via Supabase MCP

-- ============================================================
-- 1. Add domain column to organizations
-- ============================================================
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS domain text;

-- ============================================================
-- 2. Add phone column to profiles
-- ============================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;

-- ============================================================
-- 3. Create invitation_status enum
-- ============================================================
DO $$ BEGIN
    CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 4. Create org_invitations table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.org_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    invited_by uuid NOT NULL REFERENCES auth.users(id),
    email text NOT NULL,
    full_name text,
    phone text,
    role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'moderator', 'manager', 'user')),
    token uuid NOT NULL DEFAULT gen_random_uuid(),
    status invitation_status NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    accepted_at timestamptz,
    revoked_at timestamptz,
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    UNIQUE(org_id, email, status)
);

-- ============================================================
-- 5. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON public.org_invitations(token) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_org_invitations_org_id ON public.org_invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON public.org_invitations(email);

-- ============================================================
-- 6. RLS
-- ============================================================
ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. RPC Functions: send_org_invitation, accept_org_invitation,
--    get_invitation_by_token, list_org_invitations,
--    revoke_org_invitation, resend_org_invitation
-- ============================================================
-- (Applied via separate migrations - see Supabase dashboard)
