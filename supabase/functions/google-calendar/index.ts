/**
 * Edge Function: google-calendar
 *
 * Backend-owned Google Calendar OAuth + event creation, scoped per `org_id`.
 *
 * Endpoints (selected via ?action=... query param):
 *   GET  ?action=connect&org_id=...        Returns Google OAuth authorize URL with signed state.
 *   GET  ?action=token-exchange&code=...&state=...
 *                                          Called by the static `/api/google-calendar/callback`
 *                                          relay after Google redirects the user back.
 *                                          Validates state, exchanges code for tokens,
 *                                          stores them server-side, and returns success.
 *   GET  ?action=status&org_id=...         Returns whether the org has a live connection.
 *   POST ?action=create-event              Body: { org_id, summary, description, start, end,
 *                                                   timeZone, attendees? }. Creates a Google
 *                                                   Calendar event in the connected org's
 *                                                   primary calendar. Refreshes the access token
 *                                                   automatically when expired.
 *   POST ?action=disconnect                Body: { org_id }. Removes the stored connection.
 *
 * Env vars (set via `supabase secrets set ...`):
 *   GOOGLE_CLIENT_ID           OAuth client ID
 *   GOOGLE_CLIENT_SECRET       OAuth client secret
 *   GOOGLE_REDIRECT_URI        e.g. https://ai-agent.digitivia.com/api/google-calendar/callback
 *   GOOGLE_OAUTH_STATE_SECRET  HMAC secret used to sign/verify the OAuth `state` parameter
 *   APP_BASE_URL               Where to redirect after a successful connect
 *                              (e.g. https://ai-agent.digitivia.com)
 *
 * Deploy: supabase functions deploy google-calendar
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
// Both production and staging callbacks are registered in Google Cloud Console.
// The edge function can receive traffic from either, and each half of the flow
// (authorize URL + token exchange) must use the SAME redirect_uri string that
// Google sees first, so we thread the chosen origin through the signed state.
const DEFAULT_REDIRECT_URI = Deno.env.get('GOOGLE_REDIRECT_URI')
    || 'https://ai-agent.digitivia.com/api/google-calendar/callback';
const ALLOWED_REDIRECT_URIS = (Deno.env.get('GOOGLE_REDIRECT_URIS')
    || [
        'https://ai-agent.digitivia.com/api/google-calendar/callback',
        'https://testaienv.digitivia.com/api/google-calendar/callback',
    ].join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const DEFAULT_APP_BASE_URL = Deno.env.get('APP_BASE_URL')
    || 'https://ai-agent.digitivia.com';
const ALLOWED_APP_BASE_URLS = (Deno.env.get('APP_BASE_URLS')
    || [
        'https://ai-agent.digitivia.com',
        'https://testaienv.digitivia.com',
    ].join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function pickRedirectUri(candidate: string | null | undefined): string {
    if (!candidate) return DEFAULT_REDIRECT_URI;
    return ALLOWED_REDIRECT_URIS.includes(candidate) ? candidate : DEFAULT_REDIRECT_URI;
}
function pickAppBaseUrl(candidate: string | null | undefined): string {
    if (!candidate) return DEFAULT_APP_BASE_URL;
    return ALLOWED_APP_BASE_URLS.includes(candidate) ? candidate : DEFAULT_APP_BASE_URL;
}
function deriveRedirectFromAppBase(appBase: string): string {
    return `${appBase.replace(/\/+$/, '')}/api/google-calendar/callback`;
}
const STATE_SECRET = Deno.env.get('GOOGLE_OAUTH_STATE_SECRET')
    || Deno.env.get('SUPABASE_JWT_SECRET')
    || 'change-me-in-production';

// Calendar event scope only — minimum required for the demo.
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';
const STATE_TTL_SECONDS = 10 * 60; // 10 minutes to complete the consent flow

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
    return new Response(JSON.stringify(data), { status, headers: { ...CORS, ...extraHeaders } });
}

function getSupabase() {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

// --- HMAC-signed OAuth `state` --------------------------------------------------
// Format: base64url(payloadJson) + '.' + base64url(hmacSha256(payloadJson))
async function hmac(secret: string, message: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    return base64UrlEncode(new Uint8Array(sig));
}

function base64UrlEncode(input: Uint8Array | string): string {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
    return atob(padded);
}

async function signState(payload: Record<string, unknown>): Promise<string> {
    const json = JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), nonce: crypto.randomUUID() });
    const encoded = base64UrlEncode(json);
    const sig = await hmac(STATE_SECRET, encoded);
    return `${encoded}.${sig}`;
}

async function verifyState(state: string): Promise<Record<string, unknown> | null> {
    if (!state || typeof state !== 'string') return null;
    const [encoded, sig] = state.split('.');
    if (!encoded || !sig) return null;
    const expected = await hmac(STATE_SECRET, encoded);
    if (expected !== sig) return null;
    try {
        const payload = JSON.parse(base64UrlDecode(encoded)) as Record<string, unknown>;
        const iat = typeof payload.iat === 'number' ? payload.iat : 0;
        if (Math.floor(Date.now() / 1000) - iat > STATE_TTL_SECONDS) return null;
        return payload;
    } catch {
        return null;
    }
}

// --- Audit log helper -----------------------------------------------------------
async function logEvent(orgId: string | null, userId: string | null, eventKind: string, detail: unknown = {}) {
    try {
        const supabase = getSupabase();
        await supabase.from('google_calendar_events_log').insert({
            org_id: orgId,
            user_id: userId,
            event_kind: eventKind,
            detail: detail ?? {},
        });
    } catch (_err) {
        // Logging failures must not break the OAuth flow.
    }
}

// --- Token storage / refresh ----------------------------------------------------
async function storeConnection(opts: {
    orgId: string;
    userId?: string | null;
    googleEmail?: string | null;
    accessToken: string;
    refreshToken?: string | null;
    expiresInSeconds: number;
    scope?: string | null;
    tokenType?: string | null;
}) {
    const supabase = getSupabase();
    const expiresAt = new Date(Date.now() + opts.expiresInSeconds * 1000).toISOString();
    const upsertPayload: Record<string, unknown> = {
        org_id: opts.orgId,
        provider: 'google',
        google_email: opts.googleEmail || null,
        access_token: opts.accessToken,
        expires_at: expiresAt,
        scope: opts.scope || SCOPES,
        token_type: opts.tokenType || 'Bearer',
        status: 'connected',
        connected_by_user_id: opts.userId || null,
        updated_at: new Date().toISOString(),
    };
    // Only overwrite the refresh_token when Google returned one (it does on the
    // first consent and any time `prompt=consent` is forced).
    if (opts.refreshToken) upsertPayload.refresh_token = opts.refreshToken;
    const { error } = await supabase
        .from('google_calendar_connections')
        .upsert(upsertPayload, { onConflict: 'org_id' });
    if (error) throw new Error(`storeConnection: ${error.message}`);
}

async function getValidAccessToken(orgId: string): Promise<{ token: string; email: string | null } | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from('google_calendar_connections')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle();
    if (error || !data) return null;

    // Refresh ~60s before expiry to absorb clock skew.
    const expiresAt = new Date(data.expires_at).getTime();
    if (expiresAt - Date.now() > 60_000) {
        return { token: data.access_token, email: data.google_email };
    }
    if (!data.refresh_token) return null;

    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            refresh_token: data.refresh_token,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            grant_type: 'refresh_token',
        }),
    });
    const refreshed = await refreshRes.json();
    if (!refreshRes.ok || refreshed.error) {
        await logEvent(orgId, null, 'error', { stage: 'refresh', body: refreshed });
        return null;
    }

    await storeConnection({
        orgId,
        accessToken: refreshed.access_token,
        expiresInSeconds: refreshed.expires_in,
        scope: refreshed.scope,
        tokenType: refreshed.token_type,
    });
    await logEvent(orgId, null, 'token_refreshed', {});
    return { token: refreshed.access_token, email: data.google_email };
}

// --- Request handler ------------------------------------------------------------
Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || '';

    try {
        // ------------------------------------------------------------------
        // 1. Begin connect flow → return Google authorize URL with signed state
        // ------------------------------------------------------------------
        if (action === 'connect') {
            const orgId = url.searchParams.get('org_id');
            const userId = url.searchParams.get('user_id') || null;
            if (!orgId) return json({ error: 'org_id is required' }, 400);

            // Let the caller pick which approved origin should be used. Accept
            // either an explicit redirect_uri/app_base_url, or the Origin header
            // (the demo page and in-app button both arrive with one).
            const explicitRedirect = url.searchParams.get('redirect_uri');
            const explicitAppBase = url.searchParams.get('app_base_url');
            const originHeader = req.headers.get('origin');
            const redirectUri = explicitRedirect
                ? pickRedirectUri(explicitRedirect)
                : explicitAppBase
                    ? pickRedirectUri(deriveRedirectFromAppBase(pickAppBaseUrl(explicitAppBase)))
                    : originHeader
                        ? pickRedirectUri(deriveRedirectFromAppBase(pickAppBaseUrl(originHeader)))
                        : DEFAULT_REDIRECT_URI;
            const appBaseUrl = pickAppBaseUrl(
                explicitAppBase || originHeader || new URL(redirectUri).origin,
            );

            const state = await signState({
                org_id: orgId,
                user_id: userId,
                redirect_uri: redirectUri,
                app_base_url: appBaseUrl,
            });
            const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
            authUrl.searchParams.set('redirect_uri', redirectUri);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('scope', SCOPES);
            authUrl.searchParams.set('access_type', 'offline');
            authUrl.searchParams.set('prompt', 'consent');
            authUrl.searchParams.set('include_granted_scopes', 'true');
            authUrl.searchParams.set('state', state);

            await logEvent(orgId, userId, 'connect_started', { redirect_uri: redirectUri });
            return json({ authorize_url: authUrl.toString(), redirect_uri: redirectUri });
        }

        // ------------------------------------------------------------------
        // 2. Exchange the authorization code (called from the static callback page)
        // ------------------------------------------------------------------
        if (action === 'token-exchange') {
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            if (!code || !state) return json({ error: 'code and state are required' }, 400);

            const payload = await verifyState(state);
            if (!payload) return json({ error: 'Invalid or expired state' }, 400);

            const orgId = String(payload.org_id || '');
            const userId = (payload.user_id as string | null) || null;
            if (!orgId) return json({ error: 'state missing org_id' }, 400);

            // Use the exact redirect_uri that was sent to Google in the authorize
            // step — Google rejects the token exchange otherwise. Fall back to the
            // default only if the state was minted before this change rolled out.
            const redirectUri = pickRedirectUri(
                (payload.redirect_uri as string | null) || null,
            );
            const appBaseUrl = pickAppBaseUrl(
                (payload.app_base_url as string | null) || null,
            );

            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code,
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code',
                }),
            });
            const tokens = await tokenRes.json();
            if (!tokenRes.ok || tokens.error) {
                await logEvent(orgId, userId, 'error', { stage: 'token_exchange', body: tokens });
                return json({ error: tokens.error_description || tokens.error || 'token exchange failed' }, 400);
            }

            // Best-effort: read the connected Google account email so the UI
            // can show "Connected as foo@example.com".
            let googleEmail: string | null = null;
            try {
                const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                    headers: { Authorization: `Bearer ${tokens.access_token}` },
                });
                if (profileRes.ok) {
                    const profile = await profileRes.json();
                    googleEmail = profile.email || null;
                }
            } catch (_err) {
                // Ignore — email is decorative.
            }

            await storeConnection({
                orgId,
                userId,
                googleEmail,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresInSeconds: tokens.expires_in,
                scope: tokens.scope,
                tokenType: tokens.token_type,
            });
            await logEvent(orgId, userId, 'connected', { google_email: googleEmail });

            return json({
                ok: true,
                org_id: orgId,
                google_email: googleEmail,
                redirect: `${appBaseUrl.replace(/\/+$/, '')}/?gcal=connected`,
            });
        }

        // ------------------------------------------------------------------
        // 3. Status — does this org have a live connection?
        // ------------------------------------------------------------------
        if (action === 'status') {
            const orgId = url.searchParams.get('org_id');
            if (!orgId) return json({ error: 'org_id is required' }, 400);

            const supabase = getSupabase();
            const { data } = await supabase
                .from('google_calendar_connections')
                .select('org_id, google_email, status, expires_at, calendar_id, updated_at')
                .eq('org_id', orgId)
                .maybeSingle();
            return json({
                connected: !!data && data.status === 'connected',
                google_email: data?.google_email || null,
                calendar_id: data?.calendar_id || 'primary',
                updated_at: data?.updated_at || null,
            });
        }

        // ------------------------------------------------------------------
        // 4. Create a calendar event in the connected org's primary calendar
        // ------------------------------------------------------------------
        if (action === 'create-event') {
            if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
            const body = await req.json().catch(() => ({}));
            const {
                org_id: orgId,
                summary,
                description = '',
                start,
                end,
                timeZone = 'UTC',
                attendees,
            } = body || {};
            if (!orgId || !summary || !start || !end) {
                return json({ error: 'org_id, summary, start, end are required' }, 400);
            }

            const tokenInfo = await getValidAccessToken(orgId);
            if (!tokenInfo) {
                return json({ error: 'This organization is not connected to Google Calendar.' }, 401);
            }

            const event: Record<string, unknown> = {
                summary,
                description,
                start: { dateTime: start, timeZone },
                end: { dateTime: end, timeZone },
            };
            if (Array.isArray(attendees) && attendees.length) {
                event.attendees = attendees
                    .filter((email: unknown) => typeof email === 'string' && email.includes('@'))
                    .map((email: string) => ({ email }));
            }

            const createRes = await fetch(
                'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${tokenInfo.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(event),
                },
            );
            const created = await createRes.json();
            if (!createRes.ok || created.error) {
                await logEvent(orgId, null, 'error', { stage: 'create_event', body: created });
                return json({ error: created.error?.message || 'Failed to create event' }, 400);
            }

            await logEvent(orgId, null, 'event_created', {
                event_id: created.id,
                html_link: created.htmlLink,
                summary,
            });
            return json({
                ok: true,
                event: {
                    id: created.id,
                    summary: created.summary,
                    start: created.start,
                    end: created.end,
                    htmlLink: created.htmlLink,
                    hangoutLink: created.hangoutLink,
                    attendees: created.attendees,
                },
            });
        }

        // ------------------------------------------------------------------
        // 5. Disconnect — remove stored credentials for the org
        // ------------------------------------------------------------------
        if (action === 'disconnect') {
            if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
            const body = await req.json().catch(() => ({}));
            const orgId = body?.org_id;
            if (!orgId) return json({ error: 'org_id is required' }, 400);
            const supabase = getSupabase();
            const { error } = await supabase
                .from('google_calendar_connections')
                .delete()
                .eq('org_id', orgId);
            if (error) return json({ error: error.message }, 500);
            await logEvent(orgId, null, 'disconnected', {});
            return json({ ok: true });
        }

        // ------------------------------------------------------------------
        // Legacy compatibility: keep the old `authorize` action working so the
        // existing index.html buttons that haven't been migrated still work.
        // It reuses the new connect path under the hood.
        // ------------------------------------------------------------------
        if (action === 'authorize') {
            const orgId = url.searchParams.get('org_id');
            const userId = url.searchParams.get('user_id') || null;
            if (!orgId) return json({ error: 'org_id is required' }, 400);
            const originHeader = req.headers.get('origin');
            const redirectUri = pickRedirectUri(
                url.searchParams.get('redirect_uri')
                    || (originHeader ? deriveRedirectFromAppBase(pickAppBaseUrl(originHeader)) : null),
            );
            const appBaseUrl = pickAppBaseUrl(originHeader || new URL(redirectUri).origin);
            const state = await signState({
                org_id: orgId,
                user_id: userId,
                redirect_uri: redirectUri,
                app_base_url: appBaseUrl,
            });
            const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
            authUrl.searchParams.set('redirect_uri', redirectUri);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('scope', SCOPES);
            authUrl.searchParams.set('access_type', 'offline');
            authUrl.searchParams.set('prompt', 'consent');
            authUrl.searchParams.set('state', state);
            return new Response(null, { status: 302, headers: { Location: authUrl.toString() } });
        }

        return json({ error: `Unknown action: ${action}` }, 400);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await logEvent(null, null, 'error', { stage: 'unhandled', message });
        return json({ error: message }, 500);
    }
});
