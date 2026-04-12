-- ============================================================
-- Conversation Learning: Track human overrides of AI
-- Run this in your Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_overrides (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID NOT NULL,
    conversation_id UUID,
    agent_id TEXT,
    overridden_by UUID,                     -- user who took over
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overrides_org ON conversation_overrides(org_id, created_at DESC);

ALTER TABLE conversation_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their org's overrides"
    ON conversation_overrides FOR ALL
    USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));

-- API Keys table for public API
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID NOT NULL,
    name TEXT NOT NULL DEFAULT 'Default API Key',
    key_hash TEXT NOT NULL,                 -- bcrypt hash of the API key
    key_prefix TEXT NOT NULL,               -- first 8 chars for display (e.g. "dk_live_a1b2...")
    scopes TEXT[] DEFAULT ARRAY['read'],    -- 'read', 'write', 'admin'
    rate_limit INTEGER DEFAULT 100,         -- requests per minute
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their org's API keys"
    ON api_keys FOR ALL
    USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));
