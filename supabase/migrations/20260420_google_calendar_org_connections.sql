-- Google Calendar OAuth — org-level connections (backend-owned)
-- Each org has at most one connected Google Calendar.
-- Tokens are stored server-side; the refresh token never leaves the backend.

CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
    org_id        UUID PRIMARY KEY,
    provider      TEXT NOT NULL DEFAULT 'google',
    google_email  TEXT,
    calendar_id   TEXT NOT NULL DEFAULT 'primary',
    access_token  TEXT NOT NULL,
    refresh_token TEXT,
    expires_at    TIMESTAMPTZ NOT NULL,
    scope         TEXT,
    token_type    TEXT DEFAULT 'Bearer',
    status        TEXT NOT NULL DEFAULT 'connected',
    connected_by_user_id UUID REFERENCES auth.users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gcal_conn_provider ON public.google_calendar_connections(provider);
CREATE INDEX IF NOT EXISTS idx_gcal_conn_status   ON public.google_calendar_connections(status);

-- RLS: only members of the org can read connection status.
-- Token exchange / refresh / event creation runs in the edge function with the
-- service role key, so writes are never performed by client-side requests.
ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can read their gcal connection"
    ON public.google_calendar_connections;
CREATE POLICY "Org members can read their gcal connection"
    ON public.google_calendar_connections
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.org_members om
            WHERE om.org_id = google_calendar_connections.org_id
              AND om.user_id = auth.uid()
        )
    );

-- Audit log of OAuth events for debugging the verification demo
CREATE TABLE IF NOT EXISTS public.google_calendar_events_log (
    id           BIGSERIAL PRIMARY KEY,
    org_id       UUID,
    user_id      UUID,
    event_kind   TEXT NOT NULL,             -- 'connect_started' | 'connected' | 'event_created' | 'token_refreshed' | 'error'
    detail       JSONB DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gcal_log_org_created
    ON public.google_calendar_events_log(org_id, created_at DESC);
