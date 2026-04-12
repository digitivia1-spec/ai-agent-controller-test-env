-- ============================================================
-- RAG Pipeline: pgvector + Knowledge Base Embeddings
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Knowledge base chunks with embeddings
CREATE TABLE IF NOT EXISTS kb_chunks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID NOT NULL,
    agent_id UUID,                          -- NULL = shared across org
    source_type TEXT NOT NULL DEFAULT 'file', -- 'file', 'url', 'manual'
    source_id UUID,                          -- references agent_kb_files.id or agent_kb_links.id
    source_name TEXT,                        -- original file name or URL
    chunk_index INTEGER NOT NULL DEFAULT 0,  -- position within document
    content TEXT NOT NULL,                   -- chunk text content
    token_count INTEGER,                     -- token count for context budgeting
    embedding vector(1536),                  -- OpenAI text-embedding-3-small dimension
    metadata JSONB DEFAULT '{}',             -- extra info (page number, heading, etc.)
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Indexes for fast retrieval
CREATE INDEX IF NOT EXISTS idx_kb_chunks_org ON kb_chunks(org_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_agent ON kb_chunks(agent_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_source ON kb_chunks(source_id);

-- 4. Vector similarity search index (IVFFlat for performance)
-- Note: Create this AFTER you have at least ~1000 rows for good clustering
-- For small datasets, exact search (no index) is fine
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding ON kb_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- 5. Semantic search function
CREATE OR REPLACE FUNCTION search_kb_chunks(
    p_org_id UUID,
    p_agent_id UUID,
    p_query_embedding vector(1536),
    p_match_count INTEGER DEFAULT 5,
    p_match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    source_name TEXT,
    chunk_index INTEGER,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        kc.id,
        kc.content,
        kc.source_name,
        kc.chunk_index,
        1 - (kc.embedding <=> p_query_embedding) AS similarity
    FROM kb_chunks kc
    WHERE kc.org_id = p_org_id
      AND (kc.agent_id IS NULL OR kc.agent_id = p_agent_id)
      AND 1 - (kc.embedding <=> p_query_embedding) > p_match_threshold
    ORDER BY kc.embedding <=> p_query_embedding
    LIMIT p_match_count;
END;
$$;

-- 6. Row Level Security
ALTER TABLE kb_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org's chunks"
    ON kb_chunks FOR SELECT
    USING (org_id IN (
        SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can insert chunks for their org"
    ON kb_chunks FOR INSERT
    WITH CHECK (org_id IN (
        SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can delete chunks from their org"
    ON kb_chunks FOR DELETE
    USING (org_id IN (
        SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    ));

-- 7. Chunking status tracking (on existing kb files table)
-- Add processing status to track chunking progress
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agent_kb_files' AND column_name = 'chunking_status') THEN
        ALTER TABLE agent_kb_files ADD COLUMN chunking_status TEXT DEFAULT 'pending';  -- pending, processing, done, error
        ALTER TABLE agent_kb_files ADD COLUMN chunk_count INTEGER DEFAULT 0;
        ALTER TABLE agent_kb_files ADD COLUMN chunking_error TEXT;
    END IF;
END $$;
