-- Google Calendar OAuth tokens per user
CREATE TABLE IF NOT EXISTS user_google_tokens (
    user_id UUID PRIMARY KEY,
    org_id UUID NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_google_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own Google tokens"
    ON user_google_tokens FOR ALL
    USING (user_id = auth.uid());

-- Add google_event_id to meetings table
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'meetings' AND column_name = 'google_event_id') THEN
        ALTER TABLE meetings ADD COLUMN google_event_id TEXT;
        ALTER TABLE meetings ADD COLUMN google_event_link TEXT;
    END IF;
END $$;
