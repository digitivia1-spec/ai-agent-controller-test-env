-- ============================================================
-- Outbound Webhooks + Multi-Language Agent Support
-- Run this in your Supabase SQL Editor
-- ============================================================

-- ==================
-- 1. OUTBOUND WEBHOOKS
-- ==================

CREATE TABLE IF NOT EXISTS org_webhooks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID NOT NULL,
    name TEXT NOT NULL DEFAULT 'My Webhook',
    url TEXT NOT NULL,
    secret TEXT,                                  -- HMAC signing secret
    events TEXT[] NOT NULL DEFAULT '{}',          -- e.g. ['new_message', 'lead_created', 'ticket_created', 'order_updated']
    is_active BOOLEAN DEFAULT true,
    headers JSONB DEFAULT '{}',                   -- custom headers
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    webhook_id UUID REFERENCES org_webhooks(id) ON DELETE CASCADE NOT NULL,
    org_id UUID NOT NULL,
    event TEXT NOT NULL,
    payload JSONB NOT NULL,
    status_code INTEGER,
    response_body TEXT,
    success BOOLEAN DEFAULT false,
    attempts INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_org ON org_webhooks(org_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at DESC);

ALTER TABLE org_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their org's webhooks"
    ON org_webhooks FOR ALL
    USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their org's webhook deliveries"
    ON webhook_deliveries FOR ALL
    USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));

-- Available events reference:
-- new_message        - Inbound message received
-- lead_created       - New lead captured or created
-- lead_status_changed - Lead moved in pipeline
-- ticket_created     - New support ticket
-- ticket_resolved    - Ticket resolved
-- order_created      - New order
-- order_updated      - Order status changed
-- conversation_closed - Conversation ended

-- ==================
-- 2. MULTI-LANGUAGE AGENT SUPPORT
-- ==================

-- Add language detection columns to conversations
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_conversations' AND column_name = 'detected_language') THEN
        ALTER TABLE inbox_conversations ADD COLUMN detected_language TEXT;           -- ISO 639-1 code (en, ar, fr, es, etc.)
        ALTER TABLE inbox_conversations ADD COLUMN language_confidence FLOAT;       -- 0.0 to 1.0
    END IF;
END $$;

-- Agent config: language-specific system prompts
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_configs' AND column_name = 'multilingual_prompts') THEN
        ALTER TABLE agent_configs ADD COLUMN multilingual_prompts JSONB DEFAULT '{}';  -- {"ar": "Arabic prompt...", "fr": "French prompt..."}
        ALTER TABLE agent_configs ADD COLUMN auto_detect_language BOOLEAN DEFAULT false;
        ALTER TABLE agent_configs ADD COLUMN supported_languages TEXT[] DEFAULT ARRAY['en'];
    END IF;
END $$;
