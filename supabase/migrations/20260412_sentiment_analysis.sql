-- ============================================================
-- Sentiment Analysis: Message classification and tracking
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Add sentiment columns to inbox_messages
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_messages' AND column_name = 'sentiment') THEN
        ALTER TABLE inbox_messages ADD COLUMN sentiment TEXT;           -- 'positive', 'neutral', 'negative', 'urgent'
        ALTER TABLE inbox_messages ADD COLUMN sentiment_score FLOAT;    -- -1.0 to 1.0
        ALTER TABLE inbox_messages ADD COLUMN sentiment_analyzed_at TIMESTAMPTZ;
    END IF;
END $$;

-- 2. Add sentiment summary to inbox_conversations
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_conversations' AND column_name = 'avg_sentiment') THEN
        ALTER TABLE inbox_conversations ADD COLUMN avg_sentiment FLOAT;          -- running average
        ALTER TABLE inbox_conversations ADD COLUMN last_sentiment TEXT;          -- most recent message sentiment
        ALTER TABLE inbox_conversations ADD COLUMN sentiment_updated_at TIMESTAMPTZ;
    END IF;
END $$;

-- 3. Add sentiment to leads for CRM insights
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'sentiment') THEN
        ALTER TABLE leads ADD COLUMN sentiment TEXT;
        ALTER TABLE leads ADD COLUMN sentiment_score FLOAT;
    END IF;
END $$;

-- 4. Sentiment analytics aggregation table
CREATE TABLE IF NOT EXISTS sentiment_daily_stats (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID NOT NULL,
    date DATE NOT NULL,
    platform TEXT,                           -- 'whatsapp', 'messenger', 'instagram', 'telegram', 'website', NULL for all
    total_messages INTEGER DEFAULT 0,
    positive_count INTEGER DEFAULT 0,
    neutral_count INTEGER DEFAULT 0,
    negative_count INTEGER DEFAULT 0,
    urgent_count INTEGER DEFAULT 0,
    avg_score FLOAT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(org_id, date, platform)
);

CREATE INDEX IF NOT EXISTS idx_sentiment_stats_org_date ON sentiment_daily_stats(org_id, date);

-- 5. RLS for sentiment stats
ALTER TABLE sentiment_daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org's sentiment stats"
    ON sentiment_daily_stats FOR SELECT
    USING (org_id IN (
        SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    ));

-- 6. Function to get sentiment summary for dashboard
CREATE OR REPLACE FUNCTION get_sentiment_summary(
    p_org_id UUID,
    p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
    total_messages BIGINT,
    positive_pct FLOAT,
    neutral_pct FLOAT,
    negative_pct FLOAT,
    urgent_count BIGINT,
    avg_score FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(s.total_messages), 0)::BIGINT,
        CASE WHEN SUM(s.total_messages) > 0
            THEN ROUND((SUM(s.positive_count)::FLOAT / SUM(s.total_messages)) * 100, 1)
            ELSE 0 END,
        CASE WHEN SUM(s.total_messages) > 0
            THEN ROUND((SUM(s.neutral_count)::FLOAT / SUM(s.total_messages)) * 100, 1)
            ELSE 0 END,
        CASE WHEN SUM(s.total_messages) > 0
            THEN ROUND((SUM(s.negative_count)::FLOAT / SUM(s.total_messages)) * 100, 1)
            ELSE 0 END,
        COALESCE(SUM(s.urgent_count), 0)::BIGINT,
        ROUND(AVG(s.avg_score)::NUMERIC, 2)::FLOAT
    FROM sentiment_daily_stats s
    WHERE s.org_id = p_org_id
      AND s.date >= CURRENT_DATE - (p_days || ' days')::INTERVAL;
END;
$$;
