-- ============================================================
-- CSAT Ratings + Audit Log Enhancements
-- Run this in your Supabase SQL Editor
-- ============================================================

-- ==================
-- 1. CSAT RATINGS TABLE (unified for tickets + conversations)
-- ==================

CREATE TABLE IF NOT EXISTS csat_ratings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID NOT NULL,
    entity_type TEXT NOT NULL,                     -- 'ticket' or 'conversation'
    entity_id UUID NOT NULL,                       -- ticket_id or conversation_id
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csat_org ON csat_ratings(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csat_entity ON csat_ratings(entity_type, entity_id);

ALTER TABLE csat_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their org's CSAT ratings"
    ON csat_ratings FOR ALL
    USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));

-- CSAT summary function
CREATE OR REPLACE FUNCTION get_csat_summary(
    p_org_id UUID,
    p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    total_ratings BIGINT,
    avg_rating FLOAT,
    five_star BIGINT,
    four_star BIGINT,
    three_star BIGINT,
    two_star BIGINT,
    one_star BIGINT,
    satisfaction_pct FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT,
        ROUND(AVG(r.rating)::NUMERIC, 1)::FLOAT,
        COUNT(*) FILTER (WHERE r.rating = 5)::BIGINT,
        COUNT(*) FILTER (WHERE r.rating = 4)::BIGINT,
        COUNT(*) FILTER (WHERE r.rating = 3)::BIGINT,
        COUNT(*) FILTER (WHERE r.rating = 2)::BIGINT,
        COUNT(*) FILTER (WHERE r.rating = 1)::BIGINT,
        CASE WHEN COUNT(*) > 0
            THEN ROUND((COUNT(*) FILTER (WHERE r.rating >= 4)::FLOAT / COUNT(*)) * 100, 1)
            ELSE 0 END
    FROM csat_ratings r
    WHERE r.org_id = p_org_id
      AND r.created_at >= CURRENT_DATE - (p_days || ' days')::INTERVAL;
END;
$$;

-- ==================
-- 2. AUDIT LOG ENHANCEMENTS
-- ==================

-- The dcc_audit_logs table already exists. Add an index for dashboard queries.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_logs_org_date') THEN
        CREATE INDEX idx_audit_logs_org_date ON dcc_audit_logs(org_id, created_at DESC);
    END IF;
EXCEPTION WHEN undefined_table THEN
    -- Table doesn't exist yet, skip
    NULL;
END $$;
