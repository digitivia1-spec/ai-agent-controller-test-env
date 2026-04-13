-- ============================================================
-- Saved Filters + Team Presence + Dashboard Preferences
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Saved Filters (reusable across CRM, tickets, inbox)
CREATE TABLE IF NOT EXISTS saved_filters (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID NOT NULL,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    module TEXT NOT NULL,                    -- 'crm', 'tickets', 'inbox', 'tasks'
    filters JSONB NOT NULL DEFAULT '{}',    -- { status: 'open', priority: 'high', dateFrom: '...', ... }
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_filters_user ON saved_filters(user_id, module);

ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own saved filters"
    ON saved_filters FOR ALL
    USING (user_id = auth.uid());

-- 2. Team Presence (who's online, what they're viewing)
CREATE TABLE IF NOT EXISTS team_presence (
    user_id UUID PRIMARY KEY,
    org_id UUID NOT NULL,
    status TEXT DEFAULT 'online',           -- 'online', 'away', 'offline'
    current_tab TEXT,                       -- 'dashboard', 'inbox', 'crm', etc.
    current_entity_id UUID,                 -- conversation_id, lead_id, etc.
    last_seen_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presence_org ON team_presence(org_id);

ALTER TABLE team_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can see their org's presence"
    ON team_presence FOR SELECT
    USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));
CREATE POLICY "Users can update their own presence"
    ON team_presence FOR ALL
    USING (user_id = auth.uid());

-- 3. Dashboard widget preferences (order + visibility per user)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'dashboard_layout') THEN
        ALTER TABLE profiles ADD COLUMN dashboard_layout JSONB DEFAULT '{}';
    END IF;
END $$;
