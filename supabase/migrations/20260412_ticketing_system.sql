-- ============================================================
-- Ticketing System for Service Businesses
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Tickets table
CREATE TABLE IF NOT EXISTS tickets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID NOT NULL,
    ticket_number SERIAL,                           -- human-readable ticket #
    subject TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'open',                     -- open, in_progress, waiting, resolved, closed
    priority TEXT DEFAULT 'medium',                 -- low, medium, high, urgent
    category TEXT,                                  -- e.g. 'billing', 'technical', 'general', 'complaint'

    -- Source
    source TEXT DEFAULT 'manual',                   -- manual, conversation, email, form
    conversation_id UUID,                           -- link to inbox_conversations if created from chat
    contact_id UUID,                                -- link to inbox_contacts

    -- Assignment
    assigned_to UUID,                               -- user_id of assignee
    created_by UUID NOT NULL,                       -- user_id of creator

    -- Customer info (denormalized for quick access)
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    customer_platform TEXT,                         -- whatsapp, messenger, etc.

    -- SLA
    sla_response_due_at TIMESTAMPTZ,               -- first response deadline
    sla_resolution_due_at TIMESTAMPTZ,             -- resolution deadline
    first_responded_at TIMESTAMPTZ,                -- when first response was sent
    resolved_at TIMESTAMPTZ,                       -- when marked as resolved

    -- Satisfaction
    csat_rating INTEGER,                           -- 1-5 stars
    csat_comment TEXT,

    -- Metadata
    tags TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Ticket comments / replies
CREATE TABLE IF NOT EXISTS ticket_comments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE NOT NULL,
    org_id UUID NOT NULL,
    author_id UUID NOT NULL,
    body TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT false,             -- internal note vs customer-facing reply
    attachments JSONB DEFAULT '[]',                -- [{name, url, size}]
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Ticket activity log
CREATE TABLE IF NOT EXISTS ticket_activity (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE NOT NULL,
    org_id UUID NOT NULL,
    user_id UUID,
    action TEXT NOT NULL,                          -- created, assigned, status_changed, priority_changed, commented, resolved, reopened, rated
    old_value TEXT,
    new_value TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. SLA configurations per org
CREATE TABLE IF NOT EXISTS sla_policies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID NOT NULL,
    name TEXT NOT NULL DEFAULT 'Default',
    priority TEXT NOT NULL,                        -- low, medium, high, urgent
    response_time_minutes INTEGER NOT NULL,        -- SLA for first response
    resolution_time_minutes INTEGER NOT NULL,      -- SLA for resolution
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(org_id, priority)
);

-- Seed default SLA policies (will be created per-org on first use)
-- These serve as system defaults

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_tickets_org ON tickets(org_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(org_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_activity_ticket ON ticket_activity(ticket_id);

-- 6. RLS
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their org's tickets"
    ON tickets FOR ALL
    USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage their org's ticket comments"
    ON ticket_comments FOR ALL
    USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their org's ticket activity"
    ON ticket_activity FOR ALL
    USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage their org's SLA policies"
    ON sla_policies FOR ALL
    USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));

-- 7. Function to create ticket from conversation
CREATE OR REPLACE FUNCTION create_ticket_from_conversation(
    p_org_id UUID,
    p_conversation_id UUID,
    p_subject TEXT,
    p_created_by UUID,
    p_priority TEXT DEFAULT 'medium'
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_ticket_id UUID;
    v_contact RECORD;
    v_sla RECORD;
BEGIN
    -- Get contact info from conversation
    SELECT ic.phone, ic.display_name, ic.platform, ic.external_contact_id
    INTO v_contact
    FROM inbox_conversations conv
    JOIN inbox_contacts ic ON ic.id = conv.contact_id
    WHERE conv.id = p_conversation_id AND conv.org_id = p_org_id;

    -- Get SLA policy for priority
    SELECT response_time_minutes, resolution_time_minutes
    INTO v_sla
    FROM sla_policies
    WHERE org_id = p_org_id AND priority = p_priority AND is_active = true;

    -- Create ticket
    INSERT INTO tickets (
        org_id, subject, status, priority, source, conversation_id,
        customer_name, customer_phone, customer_platform,
        created_by,
        sla_response_due_at,
        sla_resolution_due_at
    ) VALUES (
        p_org_id, p_subject, 'open', p_priority, 'conversation', p_conversation_id,
        v_contact.display_name, v_contact.phone, v_contact.platform,
        p_created_by,
        CASE WHEN v_sla.response_time_minutes IS NOT NULL THEN now() + (v_sla.response_time_minutes || ' minutes')::INTERVAL ELSE NULL END,
        CASE WHEN v_sla.resolution_time_minutes IS NOT NULL THEN now() + (v_sla.resolution_time_minutes || ' minutes')::INTERVAL ELSE NULL END
    ) RETURNING id INTO v_ticket_id;

    -- Log creation
    INSERT INTO ticket_activity (ticket_id, org_id, user_id, action, new_value)
    VALUES (v_ticket_id, p_org_id, p_created_by, 'created', 'From conversation');

    RETURN v_ticket_id;
END;
$$;

-- 8. Dashboard stats function
CREATE OR REPLACE FUNCTION get_ticket_stats(p_org_id UUID)
RETURNS TABLE (
    total_open BIGINT,
    total_in_progress BIGINT,
    total_waiting BIGINT,
    total_resolved_today BIGINT,
    avg_resolution_hours FLOAT,
    sla_breach_count BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) FILTER (WHERE status = 'open'),
        COUNT(*) FILTER (WHERE status = 'in_progress'),
        COUNT(*) FILTER (WHERE status = 'waiting'),
        COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at >= CURRENT_DATE),
        ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) FILTER (WHERE resolved_at IS NOT NULL)::NUMERIC, 1)::FLOAT,
        COUNT(*) FILTER (WHERE sla_resolution_due_at < now() AND status NOT IN ('resolved', 'closed'))
    FROM tickets
    WHERE org_id = p_org_id;
END;
$$;
