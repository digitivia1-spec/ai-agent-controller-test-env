-- Phase 1 Database Migration for Digitivia AI Agent Platform
-- SAFE: All operations use IF NOT EXISTS / IF EXISTS patterns
-- Run this via Supabase MCP execute_sql or the Supabase SQL Editor

-- ============================================================
-- 1. Add new enum values to lead_status
-- ============================================================
DO $$ BEGIN
    ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'negotiation' AFTER 'qualified';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'proposal' AFTER 'negotiation';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'follow_up' AFTER 'proposal';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. Add new columns to leads table
-- ============================================================
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS persona text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS service_required text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS priority text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_to_user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_call_at date;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS subscription_date date;

-- ============================================================
-- 3. Create index for assigned_to_user_id lookups
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON public.leads(assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks(assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
