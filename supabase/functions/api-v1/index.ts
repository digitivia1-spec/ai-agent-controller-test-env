/**
 * Public REST API v1 — Digitivia AI Agent
 *
 * Endpoints:
 *   GET    /api-v1/agents         List agents
 *   GET    /api-v1/leads          List leads
 *   POST   /api-v1/leads          Create lead
 *   GET    /api-v1/conversations  List conversations
 *   POST   /api-v1/messages       Send message
 *   GET    /api-v1/tickets        List tickets
 *   POST   /api-v1/tickets        Create ticket
 *
 * Auth: Bearer token via API key (X-API-Key header)
 * Deploy: supabase functions deploy api-v1
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
    'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

        // Authenticate via API key
        const apiKey = req.headers.get('X-API-Key');
        if (!apiKey) {
            return jsonResponse({ error: 'Missing X-API-Key header' }, 401);
        }

        const orgId = await authenticateApiKey(supabase, apiKey);
        if (!orgId) {
            return jsonResponse({ error: 'Invalid or expired API key' }, 403);
        }

        // Route request
        const url = new URL(req.url);
        const path = url.pathname.replace(/^\/api-v1\/?/, '').replace(/\/$/, '');

        // GET /agents
        if (req.method === 'GET' && path === 'agents') {
            const { data, error } = await supabase.from('agent_configs').select('agent, system_prompt, tone, is_active').eq('org_id', orgId);
            if (error) throw error;
            return jsonResponse({ data });
        }

        // GET /leads
        if (req.method === 'GET' && path === 'leads') {
            const limit = parseInt(url.searchParams.get('limit') || '50');
            const offset = parseInt(url.searchParams.get('offset') || '0');
            const status = url.searchParams.get('status');

            let query = supabase.from('leads').select('*', { count: 'exact' }).eq('org_id', orgId).range(offset, offset + limit - 1).order('created_at', { ascending: false });
            if (status) query = query.eq('status', status);

            const { data, error, count } = await query;
            if (error) throw error;
            return jsonResponse({ data, total: count, limit, offset });
        }

        // POST /leads
        if (req.method === 'POST' && path === 'leads') {
            const body = await req.json();
            const { data, error } = await supabase.from('leads').insert({
                org_id: orgId,
                full_name: body.name || body.full_name,
                phone: body.phone,
                email: body.email,
                status: body.status || 'new',
                source: body.source || 'api',
                category: body.category,
                notes: body.notes,
                priority: body.priority || 'medium',
            }).select().single();
            if (error) throw error;
            return jsonResponse({ data }, 201);
        }

        // GET /conversations
        if (req.method === 'GET' && path === 'conversations') {
            const limit = parseInt(url.searchParams.get('limit') || '50');
            const platform = url.searchParams.get('platform');

            let query = supabase.from('inbox_conversations').select('*, inbox_contacts(phone, display_name, platform)').eq('org_id', orgId).order('updated_at', { ascending: false }).limit(limit);
            if (platform) query = query.eq('platform', platform);

            const { data, error } = await query;
            if (error) throw error;
            return jsonResponse({ data });
        }

        // POST /messages
        if (req.method === 'POST' && path === 'messages') {
            const body = await req.json();
            if (!body.conversation_id || !body.content) {
                return jsonResponse({ error: 'conversation_id and content required' }, 400);
            }
            const { data, error } = await supabase.rpc('send_human_message', {
                p_conversation_id: body.conversation_id,
                p_message: body.content,
                p_user_id: null, // API-initiated
            });
            if (error) throw error;
            return jsonResponse({ data, sent: true }, 201);
        }

        // GET /tickets
        if (req.method === 'GET' && path === 'tickets') {
            const limit = parseInt(url.searchParams.get('limit') || '50');
            const status = url.searchParams.get('status');

            let query = supabase.from('tickets').select('*', { count: 'exact' }).eq('org_id', orgId).order('created_at', { ascending: false }).limit(limit);
            if (status) query = query.eq('status', status);

            const { data, error, count } = await query;
            if (error) throw error;
            return jsonResponse({ data, total: count });
        }

        // POST /tickets
        if (req.method === 'POST' && path === 'tickets') {
            const body = await req.json();
            if (!body.subject) {
                return jsonResponse({ error: 'subject required' }, 400);
            }
            const { data, error } = await supabase.from('tickets').insert({
                org_id: orgId,
                subject: body.subject,
                description: body.description,
                priority: body.priority || 'medium',
                category: body.category,
                customer_name: body.customer_name,
                customer_email: body.customer_email,
                customer_phone: body.customer_phone,
                source: 'api',
                created_by: '00000000-0000-0000-0000-000000000000', // system
            }).select().single();
            if (error) throw error;
            return jsonResponse({ data }, 201);
        }

        return jsonResponse({ error: `Unknown endpoint: ${req.method} /${path}`, docs: 'See /api-v1 for available endpoints' }, 404);

    } catch (err) {
        console.error('API error:', err);
        return jsonResponse({ error: err.message || 'Internal server error' }, 500);
    }
});

async function authenticateApiKey(supabase: any, apiKey: string): Promise<string | null> {
    const prefix = apiKey.substring(0, 12);

    const { data, error } = await supabase
        .from('api_keys')
        .select('org_id, key_hash, is_active, expires_at')
        .eq('key_prefix', prefix)
        .eq('is_active', true)
        .single();

    if (error || !data) return null;
    if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

    // Update last_used_at
    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('key_prefix', prefix);

    return data.org_id;
}

function jsonResponse(data: any, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}
