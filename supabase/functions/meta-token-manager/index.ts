// meta-token-manager Edge Function.
//
// Single POST endpoint for all Meta token operations. Body must include
// `action`, one of: "exchange" | "validate" | "refresh" | "disconnect".
//
// Credentials are read ONLY from environment variables:
//   - META_APP_ID, META_APP_SECRET
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//
// Auth: callers must include a valid Supabase user JWT for org-scoped
// actions ("exchange", "validate", "disconnect"). The "refresh" action is
// intended to be triggered server-side (cron / admin) and verifies an
// internal secret instead. We deploy with verify_jwt=false because
// "refresh" carries no user JWT, but every other branch verifies the JWT
// in code via supabase.auth.getUser().

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const META_APP_ID     = Deno.env.get("META_APP_ID")     ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")    ?? "";
const SERVICE_ROLE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("META_TOKEN_INTERNAL_SECRET") ?? "";

const GRAPH = "https://graph.facebook.com/v24.0";

const corsHeaders: HeadersInit = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-meta-token-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function appProof(): string {
    // The "app access token" form: APP_ID|APP_SECRET. Used for debug_token.
    return `${META_APP_ID}|${META_APP_SECRET}`;
}

async function exchangeShortToken(shortToken: string): Promise<{ token: string; expires_in: number }> {
    const u = new URL(`${GRAPH}/oauth/access_token`);
    u.searchParams.set("grant_type", "fb_exchange_token");
    u.searchParams.set("client_id", META_APP_ID);
    u.searchParams.set("client_secret", META_APP_SECRET);
    u.searchParams.set("fb_exchange_token", shortToken);
    const r = await fetch(u.toString());
    if (!r.ok) throw new Error(`fb_exchange_token failed: ${r.status} ${await r.text()}`);
    const j = await r.json();
    if (!j.access_token) throw new Error("fb_exchange_token returned no access_token");
    return { token: j.access_token, expires_in: Number(j.expires_in ?? 0) };
}

async function fetchPageToken(pageId: string, userToken: string): Promise<string> {
    const u = new URL(`${GRAPH}/${pageId}`);
    u.searchParams.set("fields", "access_token");
    u.searchParams.set("access_token", userToken);
    const r = await fetch(u.toString());
    if (!r.ok) throw new Error(`fetch page token failed: ${r.status} ${await r.text()}`);
    const j = await r.json();
    if (!j.access_token) throw new Error("page response missing access_token");
    return j.access_token as string;
}

interface DebugInfo {
    is_valid: boolean;
    expires_at: number;          // unix seconds, 0 means non-expiring
    data_access_expires_at: number;
    scopes: string[];
}

async function debugToken(token: string): Promise<DebugInfo> {
    const u = new URL(`${GRAPH}/debug_token`);
    u.searchParams.set("input_token", token);
    u.searchParams.set("access_token", appProof());
    const r = await fetch(u.toString());
    if (!r.ok) throw new Error(`debug_token failed: ${r.status} ${await r.text()}`);
    const j = await r.json();
    const d = j?.data ?? {};
    return {
        is_valid: !!d.is_valid,
        expires_at: Number(d.expires_at ?? 0),
        data_access_expires_at: Number(d.data_access_expires_at ?? 0),
        scopes: Array.isArray(d.scopes) ? d.scopes : [],
    };
}

function expiresAtFromUnix(unix: number): string | null {
    if (!unix || unix === 0) return null; // non-expiring
    return new Date(unix * 1000).toISOString();
}

function classifyTokenStatus(expiresAt: string | null): "non_expiring" | "valid" | "expiring_soon" | "expired" {
    if (!expiresAt) return "non_expiring";
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return "expired";
    if (ms < 7 * 24 * 60 * 60 * 1000) return "expiring_soon";
    return "valid";
}

// ---------- handlers ----------

interface ExchangeBody {
    action: "exchange";
    org_id: string;
    short_token: string;
    platform: "page" | "instagram" | "whatsapp";
    account_id: string;
    account_name?: string;
    meta_user_id?: string;
    ig_account_id?: string;
}

async function handleExchange(supabase: ReturnType<typeof createClient>, body: ExchangeBody) {
    const { org_id, short_token, platform, account_id, account_name } = body;
    if (!org_id || !short_token || !platform || !account_id) {
        return jsonResponse({ error: "missing required fields" }, 400);
    }

    // 1. short -> long-lived user token (60 days)
    const longLived = await exchangeShortToken(short_token);

    // 2. For Pages, swap to the page token (non-expiring)
    let finalToken = longLived.token;
    let tokenType: "page" | "user" = "user";
    let expiresAt: string | null = expiresAtFromUnix(Date.now() / 1000 + longLived.expires_in);

    if (platform === "page") {
        finalToken = await fetchPageToken(account_id, longLived.token);
        tokenType = "page";
        expiresAt = null; // page tokens are non-expiring
    }

    // 3. Validate
    const debug = await debugToken(finalToken);
    if (!debug.is_valid) {
        return jsonResponse({ error: "token failed validation" }, 400);
    }
    if (debug.expires_at > 0) {
        expiresAt = expiresAtFromUnix(debug.expires_at);
    }

    const now = new Date().toISOString();

    // 4. meta_channel_tokens upsert
    const tokenRow = {
        org_id,
        platform,
        account_id,
        account_name: account_name ?? null,
        access_token: finalToken,
        token_type: tokenType,
        expires_at: expiresAt,
        scopes: debug.scopes,
        meta_user_id: body.meta_user_id ?? null,
        ig_account_id: body.ig_account_id ?? null,
        is_active: true,
        last_validated_at: now,
        last_error: null,
        updated_at: now,
    };
    const tokenUpsert = await supabase
        .from("meta_channel_tokens")
        .upsert(tokenRow, { onConflict: "org_id,platform,account_id" });
    if (tokenUpsert.error) {
        return jsonResponse({ error: `meta_channel_tokens upsert: ${tokenUpsert.error.message}` }, 500);
    }

    // 5. org_channel_accounts upsert (one row per org+platform)
    const ocaRow: Record<string, unknown> = {
        org_id,
        platform,
        external_account_id: account_id,
        account_name: account_name ?? null,
        access_token: finalToken,
        is_active: true,
        connected_at: now,
        updated_at: now,
    };
    const ocaUpsert = await supabase
        .from("org_channel_accounts")
        .upsert(ocaRow, { onConflict: "org_id,platform,external_account_id" });
    if (ocaUpsert.error) {
        return jsonResponse({ error: `org_channel_accounts upsert: ${ocaUpsert.error.message}` }, 500);
    }

    return jsonResponse({
        success: true,
        token_type: tokenType,
        expires_at: expiresAt,
        is_non_expiring: expiresAt === null,
        scopes: debug.scopes,
    });
}

interface ValidateBody {
    action: "validate";
    org_id: string;
    platform: "page" | "instagram" | "whatsapp";
}

async function handleValidate(supabase: ReturnType<typeof createClient>, body: ValidateBody) {
    const { org_id, platform } = body;
    if (!org_id || !platform) return jsonResponse({ error: "missing required fields" }, 400);

    const { data: row, error } = await supabase
        .from("meta_channel_tokens")
        .select("access_token, account_id, account_name, expires_at, scopes")
        .eq("org_id", org_id)
        .eq("platform", platform)
        .eq("is_active", true)
        .maybeSingle();

    if (error) return jsonResponse({ error: error.message }, 500);
    if (!row) {
        return jsonResponse({
            connected: false,
            expires_at: null,
            account_id: null,
            account_name: null,
            scopes: [],
            token_status: "expired",
        });
    }

    const debug = await debugToken(row.access_token as string);
    const expiresAt = debug.expires_at > 0 ? expiresAtFromUnix(debug.expires_at) : (row.expires_at as string | null);
    const status = !debug.is_valid ? "expired" : classifyTokenStatus(expiresAt);

    // Cache last_validated_at; do not cache last_error here (we'd need a write).
    return jsonResponse({
        connected: !!debug.is_valid,
        expires_at: expiresAt,
        account_id: row.account_id,
        account_name: row.account_name,
        scopes: debug.scopes.length ? debug.scopes : (row.scopes ?? []),
        token_status: status,
    });
}

interface RefreshBody { action: "refresh"; }

async function handleRefresh(supabase: ReturnType<typeof createClient>) {
    const cutoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    // Page tokens are non-expiring -- they should never appear here, but
    // we filter them out explicitly so a stray row with token_type='page'
    // and a non-null expires_at can't poison the cron.
    const { data: rows, error } = await supabase
        .from("meta_channel_tokens")
        .select("id, org_id, platform, token_type, account_id, access_token")
        .eq("is_active", true)
        .neq("token_type", "page")
        .not("expires_at", "is", null)
        .lt("expires_at", cutoff);

    if (error) return jsonResponse({ error: error.message }, 500);

    let refreshed = 0;
    const total = rows?.length ?? 0;

    for (const r of rows ?? []) {
        try {
            // Defensive double-check -- the SQL filter above already
            // excludes page tokens, but if the platform is 'page' we
            // still don't want to re-exchange.
            if (r.platform === "page" || r.token_type === "page") {
                continue;
            }

            // Re-exchange existing token (it acts as input to fb_exchange_token).
            const longLived = await exchangeShortToken(r.access_token as string);
            let finalToken = longLived.token;
            let expiresAt: string | null = expiresAtFromUnix(Date.now() / 1000 + longLived.expires_in);

            const now = new Date().toISOString();
            await supabase.from("meta_channel_tokens")
                .update({ access_token: finalToken, expires_at: expiresAt, last_validated_at: now, last_error: null, updated_at: now })
                .eq("id", r.id as string);
            await supabase.from("org_channel_accounts")
                .update({ access_token: finalToken, updated_at: now })
                .eq("org_id", r.org_id as string)
                .eq("platform", r.platform as string);
            refreshed++;
        } catch (e) {
            const now = new Date().toISOString();
            await supabase.from("meta_channel_tokens")
                .update({ last_error: String(e), last_validated_at: now, updated_at: now })
                .eq("id", r.id as string);
        }
    }

    return jsonResponse({ refreshed, total });
}

interface DisconnectBody {
    action: "disconnect";
    org_id: string;
    platform: "page" | "instagram" | "whatsapp";
}

async function handleDisconnect(supabase: ReturnType<typeof createClient>, body: DisconnectBody) {
    const { org_id, platform } = body;
    if (!org_id || !platform) return jsonResponse({ error: "missing required fields" }, 400);

    const now = new Date().toISOString();
    const a = await supabase.from("meta_channel_tokens")
        .update({ is_active: false, updated_at: now })
        .eq("org_id", org_id)
        .eq("platform", platform);
    if (a.error) return jsonResponse({ error: a.error.message }, 500);

    const b = await supabase.from("org_channel_accounts")
        .update({ is_active: false, updated_at: now })
        .eq("org_id", org_id)
        .eq("platform", platform);
    if (b.error) return jsonResponse({ error: b.error.message }, 500);

    return jsonResponse({ success: true });
}

// ---------- entrypoint ----------

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);
    if (!META_APP_ID || !META_APP_SECRET) return jsonResponse({ error: "meta credentials not configured" }, 500);

    let body: any;
    try { body = await req.json(); } catch { return jsonResponse({ error: "invalid json" }, 400); }
    const action = body?.action as string;
    if (!action) return jsonResponse({ error: "missing action" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    // refresh: server-only (cron). Auth via internal secret header.
    if (action === "refresh") {
        const secret = req.headers.get("x-meta-token-secret");
        if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
            return jsonResponse({ error: "unauthorized" }, 401);
        }
        return await handleRefresh(supabase);
    }

    // All other actions require a Supabase user JWT and the user must be in the org.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!jwt) return jsonResponse({ error: "unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonResponse({ error: "unauthorized" }, 401);

    const orgId = body?.org_id as string | undefined;
    if (orgId) {
        const member = await supabase
            .from("organization_members")
            .select("org_id")
            .eq("org_id", orgId)
            .eq("user_id", userData.user.id)
            .maybeSingle();
        if (member.error || !member.data) return jsonResponse({ error: "forbidden" }, 403);
    }

    switch (action) {
        case "exchange":   return await handleExchange(supabase, body as ExchangeBody);
        case "validate":   return await handleValidate(supabase, body as ValidateBody);
        case "disconnect": return await handleDisconnect(supabase, body as DisconnectBody);
        default:           return jsonResponse({ error: `unknown action: ${action}` }, 400);
    }
});
