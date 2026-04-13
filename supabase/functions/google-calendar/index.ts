/**
 * Edge Function: google-calendar
 *
 * Handles Google Calendar OAuth + sync for meetings.
 * Actions: authorize, callback, sync, create-event
 *
 * Env vars needed: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL
 * Deploy: supabase functions deploy google-calendar
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
const APP_URL = Deno.env.get('APP_URL') || 'https://ai-agent.digitivia.com';

const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar?action=callback`;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'authorize';

    try {
        // ========== AUTHORIZE: Redirect user to Google OAuth ==========
        if (action === 'authorize') {
            const userId = url.searchParams.get('user_id');
            const orgId = url.searchParams.get('org_id');
            if (!userId || !orgId) return json({ error: 'user_id and org_id required' }, 400);

            const state = btoa(JSON.stringify({ user_id: userId, org_id: orgId }));
            const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent&state=${state}`;

            return json({ url: authUrl });
        }

        // ========== CALLBACK: Exchange code for tokens ==========
        if (action === 'callback') {
            const code = url.searchParams.get('code');
            const stateRaw = url.searchParams.get('state');
            if (!code || !stateRaw) return json({ error: 'Missing code or state' }, 400);

            const { user_id, org_id } = JSON.parse(atob(stateRaw));
            const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

            // Exchange code for tokens
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
                    redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
                }),
            });
            const tokens = await tokenRes.json();
            if (tokens.error) return json({ error: tokens.error_description }, 400);

            // Store tokens
            await supabase.from('user_google_tokens').upsert({
                user_id, org_id,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
                updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' });

            // Redirect back to app
            return new Response(null, {
                status: 302,
                headers: { Location: `${APP_URL}?gcal=connected` },
            });
        }

        // ========== SYNC: Fetch upcoming events ==========
        if (action === 'sync') {
            const body = await req.json();
            const { user_id, org_id } = body;
            const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

            const accessToken = await getValidToken(supabase, user_id);
            if (!accessToken) return json({ error: 'Not connected to Google Calendar' }, 401);

            const now = new Date().toISOString();
            const maxTime = new Date(Date.now() + 30 * 86400000).toISOString();

            const eventsRes = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&timeMax=${maxTime}&singleEvents=true&orderBy=startTime&maxResults=50`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            const eventsData = await eventsRes.json();

            return json({ events: eventsData.items || [], count: (eventsData.items || []).length });
        }

        // ========== CREATE-EVENT: Create a calendar event from meeting ==========
        if (action === 'create-event') {
            const body = await req.json();
            const { user_id, title, description, start_time, end_time, attendee_email } = body;
            const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

            const accessToken = await getValidToken(supabase, user_id);
            if (!accessToken) return json({ error: 'Not connected to Google Calendar' }, 401);

            const event = {
                summary: title,
                description: description || '',
                start: { dateTime: start_time, timeZone: 'UTC' },
                end: { dateTime: end_time || new Date(new Date(start_time).getTime() + 3600000).toISOString(), timeZone: 'UTC' },
                attendees: attendee_email ? [{ email: attendee_email }] : [],
            };

            const createRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(event),
            });
            const created = await createRes.json();

            return json({ event: created, success: !created.error });
        }

        return json({ error: 'Unknown action' }, 400);
    } catch (err) {
        return json({ error: err.message }, 500);
    }
});

async function getValidToken(supabase: any, userId: string): Promise<string | null> {
    const { data } = await supabase.from('user_google_tokens').select('*').eq('user_id', userId).single();
    if (!data) return null;

    if (new Date(data.expires_at) > new Date()) return data.access_token;

    // Refresh token
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            refresh_token: data.refresh_token,
            client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
            grant_type: 'refresh_token',
        }),
    });
    const tokens = await res.json();
    if (tokens.error) return null;

    await supabase.from('user_google_tokens').update({
        access_token: tokens.access_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    }).eq('user_id', userId);

    return tokens.access_token;
}

function json(data: any, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: CORS });
}
