// meta-token-manager Edge Function.
//
// Single POST endpoint for all Meta token operations. Body must include
// `action`, one of: "exchange" | "validate" | "refresh" | "disconnect" |
//                   "phone_details" | "subscribe" | "verify_webhook" |
//                   "request_code" | "verify_code" | "register_number" |
//                   "complete_setup".
//
// Credentials are read ONLY from environment variables:
//   - META_APP_ID, META_APP_SECRET
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//
// Auth: callers must include a valid Supabase user JWT for org-scoped
// actions ("exchange", "validate", "disconnect", "phone_details",
// "subscribe", "verify_webhook", "request_code", "verify_code",
// "register_number"). The "refresh" action is intended to be triggered
// server-side (cron / admin) and verifies an internal secret instead. We deploy with verify_jwt=false because "refresh" carries no
// user JWT, but every other branch verifies the JWT in code via
// supabase.auth.getUser().

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
    expires_at: number;
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
    if (!unix || unix === 0) return null;
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

    const longLived = await exchangeShortToken(short_token);

    let finalToken = longLived.token;
    let tokenType: "page" | "user" = "user";
    let expiresAt: string | null = expiresAtFromUnix(Date.now() / 1000 + longLived.expires_in);

    if (platform === "page") {
        finalToken = await fetchPageToken(account_id, longLived.token);
        tokenType = "page";
        expiresAt = null;
    }

    if (platform === "instagram") {
        // Instagram user tokens expire in ~60 days. Use the linked Page token instead
        // (Page tokens never expire and work for all Instagram Graph API calls).
        try {
            const r = await fetch(
                `${GRAPH}/me/accounts?fields=access_token,instagram_business_account{id}&access_token=${encodeURIComponent(longLived.token)}`
            );
            if (r.ok) {
                const d = await r.json();
                const linkedPage = (d.data ?? []).find(
                    (p: any) => p.instagram_business_account?.id === account_id
                );
                if (linkedPage?.access_token) {
                    finalToken = linkedPage.access_token as string;
                    tokenType = "page";
                    expiresAt = null;
                }
            }
        } catch { /* fall back to long-lived user token */ }
    }

    const debug = await debugToken(finalToken);
    if (!debug.is_valid) {
        return jsonResponse({ error: "token failed validation" }, 400);
    }
    if (debug.expires_at > 0) {
        expiresAt = expiresAtFromUnix(debug.expires_at);
    }

    const now = new Date().toISOString();

    // For WhatsApp: resolve phone_number_id early — it becomes the routing key in
    // meta_channel_tokens.account_id so n8n can match value.metadata.phone_number_id.
    // Also try the page token (non-expiring) so WA sends don't break after 60 days.
    let externalAccountId = account_id;
    if (platform === "whatsapp") {
        const frontendPhoneId = (body as any).phone_number_id as string | undefined;
        if (frontendPhoneId) {
            externalAccountId = frontendPhoneId;
        } else {
            try {
                const phoneRes = await fetch(
                    `${GRAPH}/${encodeURIComponent(account_id)}/phone_numbers?fields=id&access_token=${encodeURIComponent(finalToken)}`
                );
                if (phoneRes.ok) {
                    const phoneData = await phoneRes.json();
                    const firstPhone = phoneData?.data?.[0];
                    if (firstPhone?.id) externalAccountId = String(firstPhone.id);
                }
            } catch { /* fall back to WABA ID */ }
        }
        // WhatsApp keeps the long-lived user token — page tokens cannot call
        // subscribed_apps on a WABA (requires whatsapp_business_management on
        // the WABA itself, which only user tokens carry).
    }

    // Deactivate other active tokens for this org+platform.
    // For WhatsApp use phone_number_id as the key (not WABA ID) to match n8n routing.
    const tokenAccountId = platform === "whatsapp" ? externalAccountId : account_id;
    await supabase
        .from("meta_channel_tokens")
        .update({ is_active: false, updated_at: now })
        .eq("org_id", org_id)
        .eq("platform", platform)
        .eq("is_active", true)
        .neq("account_id", tokenAccountId);

    const tokenRow = {
        org_id,
        platform,
        account_id: tokenAccountId,
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

    // For page/instagram: deactivate old rows on reconnect (one account per platform).
    // For whatsapp: do NOT deactivate other phone rows — a WABA can have multiple
    // phones and n8n routes by phone_number_id, so all valid phones must stay active.
    // We only deactivate the WABA ID row (account_id) since it is not a phone_number_id
    // and causes routing mismatches when left active.
    if (platform !== "whatsapp") {
        await supabase
            .from("org_channel_accounts")
            .update({ is_active: false, updated_at: now })
            .eq("org_id", org_id)
            .eq("platform", platform)
            .eq("is_active", true)
            .neq("external_account_id", externalAccountId);
    } else {
        // Deactivate only the WABA ID row (if it exists and is active)
        await supabase
            .from("org_channel_accounts")
            .update({ is_active: false, updated_at: now })
            .eq("org_id", org_id)
            .eq("platform", "whatsapp")
            .eq("external_account_id", account_id)
            .eq("is_active", true);
    }

    const ocaRow: Record<string, unknown> = {
        org_id,
        platform,
        external_account_id: externalAccountId,
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

    // Auto-subscribe page/instagram to webhook fields so Meta delivers events
    // without requiring a manual step in the Meta App Dashboard.
    let subscribeResult: string | null = null;
    if (platform === "page") {
        try {
            const fields = "messages,feed";
            const sr = await fetch(
                `${GRAPH}/${encodeURIComponent(account_id)}/subscribed_apps`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: `access_token=${encodeURIComponent(finalToken)}&subscribed_fields=${encodeURIComponent(fields)}`,
                }
            );
            const sj = await sr.json().catch(() => ({}));
            subscribeResult = sr.ok ? "ok" : `failed:${sj?.error?.message ?? sr.status}`;
            if (!sr.ok) console.warn("[meta-token-manager] page subscribe_fields failed:", sj);
        } catch (e) {
            subscribeResult = `error:${String(e)}`;
        }
    } else if (platform === "instagram") {
        // Instagram DMs arrive via the linked Facebook Page webhook (object:'instagram').
        // Subscription must be done on the linked page using the page token, not the
        // IG account directly (POST /{ig_id}/subscribed_apps is not a valid endpoint).
        // Look up the active page token and re-subscribe messages on that page.
        try {
            const { data: pageRow } = await supabase
                .from("org_channel_accounts")
                .select("external_account_id, access_token")
                .eq("org_id", org_id)
                .eq("platform", "page")
                .eq("is_active", true)
                .maybeSingle();
            if (pageRow?.access_token && pageRow?.external_account_id) {
                const sr = await fetch(
                    `${GRAPH}/${encodeURIComponent(pageRow.external_account_id)}/subscribed_apps`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: `access_token=${encodeURIComponent(pageRow.access_token as string)}&subscribed_fields=messages%2Cfeed`,
                    }
                );
                const sj = await sr.json().catch(() => ({}));
                subscribeResult = sr.ok ? "ok" : `failed:${sj?.error?.message ?? sr.status}`;
                if (!sr.ok) console.warn("[meta-token-manager] ig page subscribe failed:", sj);
            } else {
                subscribeResult = "skipped:no_page_token";
            }
        } catch (e) {
            subscribeResult = `error:${String(e)}`;
        }
    }

    return jsonResponse({
        success: true,
        token_type: tokenType,
        expires_at: expiresAt,
        is_non_expiring: expiresAt === null,
        scopes: debug.scopes,
        subscribe_result: subscribeResult,
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

    return jsonResponse({
        connected: !!debug.is_valid,
        expires_at: expiresAt,
        account_id: row.account_id,
        account_name: row.account_name,
        scopes: debug.scopes.length ? debug.scopes : (row.scopes ?? []),
        token_status: status,
    });
}

interface PhoneDetailsBody {
    action: "phone_details";
    org_id: string;
    waba_id: string;
    phone_number_id: string;
}

async function handlePhoneDetails(supabase: ReturnType<typeof createClient>, body: PhoneDetailsBody) {
    const { org_id, phone_number_id } = body;
    if (!phone_number_id) return jsonResponse({ error: "missing phone_number_id" }, 400);

    const { data: tokenRow, error: tokenErr } = await supabase
        .from("meta_channel_tokens")
        .select("access_token")
        .eq("org_id", org_id)
        .eq("platform", "whatsapp")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (tokenErr) return jsonResponse({ error: `token lookup: ${tokenErr.message}` }, 500);
    if (!tokenRow?.access_token) {
        // Fallback: try org_channel_accounts
        const { data: ocaRow } = await supabase
            .from("org_channel_accounts")
            .select("access_token")
            .eq("org_id", org_id)
            .eq("platform", "whatsapp")
            .eq("is_active", true)
            .maybeSingle();
        if (!ocaRow?.access_token || (ocaRow.access_token as string).startsWith("pending")) {
            return jsonResponse({ error: "no valid token found for org" }, 400);
        }
    }

    const token = (tokenRow?.access_token ?? "") as string;
    if (!token || token.startsWith("pending")) {
        return jsonResponse({ error: "token not yet exchanged" }, 400);
    }

    const u = new URL(`${GRAPH}/${phone_number_id}`);
    u.searchParams.set("fields", "id,display_phone_number,verified_name,quality_rating");
    u.searchParams.set("access_token", token);
    const r = await fetch(u.toString());
    if (!r.ok) {
        const text = await r.text();
        console.error("phone_details graph error:", r.status, text);
        return jsonResponse({ error: `graph_api: ${r.status}`, detail: text }, 502);
    }
    const j = await r.json();
    return jsonResponse({
        id: j.id ?? phone_number_id,
        display_phone_number: j.display_phone_number ?? "",
        verified_name: j.verified_name ?? "",
        quality_rating: j.quality_rating ?? "",
    });
}

interface SubscribeBody {
    action: "subscribe";
    org_id: string;
    waba_id: string;
    business_id?: string;
}

async function handleSubscribe(supabase: ReturnType<typeof createClient>, body: SubscribeBody) {
    const { org_id, waba_id } = body;
    if (!waba_id) return jsonResponse({ error: "missing waba_id" }, 400);

    const { data: tokenRow, error: tokenErr } = await supabase
        .from("meta_channel_tokens")
        .select("access_token")
        .eq("org_id", org_id)
        .eq("platform", "whatsapp")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (tokenErr) return jsonResponse({ error: `token lookup: ${tokenErr.message}` }, 500);
    const token = (tokenRow?.access_token ?? "") as string;
    if (!token || token.startsWith("pending")) {
        return jsonResponse({ error: "token not yet exchanged" }, 400);
    }

    const r = await fetch(`${GRAPH}/${waba_id}/subscribed_apps`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `access_token=${encodeURIComponent(token)}`,
    });
    const j = await r.json();
    if (!r.ok) {
        const errMsg = j?.error?.message ?? `subscribe failed: ${r.status}`;
        console.error("subscribe graph error:", r.status, errMsg);
        return jsonResponse({ error: errMsg }, 502);
    }
    return jsonResponse({ success: true, result: j });
}

interface VerifyWebhookBody {
    action: "verify_webhook";
    org_id: string;
    waba_id: string;
    phone_number_id?: string;
}

async function handleVerifyWebhook(supabase: ReturnType<typeof createClient>, body: VerifyWebhookBody) {
    const { org_id, waba_id } = body;

    // Check we have a valid token stored for this org
    const { data: tokenRow } = await supabase
        .from("meta_channel_tokens")
        .select("access_token, scopes")
        .eq("org_id", org_id)
        .eq("platform", "whatsapp")
        .eq("is_active", true)
        .maybeSingle();

    if (!tokenRow?.access_token || (tokenRow.access_token as string).startsWith("pending")) {
        return jsonResponse({ ready: false, reason: "no_valid_token" });
    }

    // Verify app subscription is active by checking subscribed_apps
    const token = tokenRow.access_token as string;
    const r = await fetch(`${GRAPH}/${waba_id}/subscribed_apps?access_token=${encodeURIComponent(token)}`);
    if (!r.ok) {
        return jsonResponse({ ready: false, reason: "subscription_check_failed", status: r.status });
    }
    const j = await r.json();
    const apps: any[] = Array.isArray(j?.data) ? j.data : [];
    const subscribed = apps.some((a: any) => a.whatsapp_business_api_data?.id === META_APP_ID || apps.length > 0);

    return jsonResponse({ ready: subscribed || apps.length > 0, waba_id, app_count: apps.length });
}

// Phone-number registration: Embedded Signup hands you a phone_number_id
// but the WhatsApp Business API will not deliver phone_details, send, or
// receive messages until the number completes a 3-step registration:
//   1. request_code   POST /{phone_number_id}/request_code
//   2. verify_code    POST /{phone_number_id}/verify_code
//   3. register       POST /{phone_number_id}/register   (sets a 6-digit PIN)
// All three calls require the org's long-lived WhatsApp token.

async function loadWhatsAppToken(
    supabase: ReturnType<typeof createClient>,
    org_id: string,
): Promise<{ token: string } | { error: string; status: number }> {
    const { data: tokenRow, error } = await supabase
        .from("meta_channel_tokens")
        .select("access_token")
        .eq("org_id", org_id)
        .eq("platform", "whatsapp")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) return { error: `token lookup: ${error.message}`, status: 500 };
    const token = (tokenRow?.access_token ?? "") as string;
    if (!token || token.startsWith("pending")) {
        return { error: "token not yet exchanged", status: 400 };
    }
    return { token };
}

interface RequestCodeBody {
    action: "request_code";
    org_id: string;
    phone_number_id: string;
    code_method?: "SMS" | "VOICE";
    language?: string;
}

async function handleRequestCode(supabase: ReturnType<typeof createClient>, body: RequestCodeBody) {
    const { org_id, phone_number_id } = body;
    if (!org_id || !phone_number_id) return jsonResponse({ error: "missing required fields" }, 400);
    const t = await loadWhatsAppToken(supabase, org_id);
    if ("error" in t) return jsonResponse({ error: t.error }, t.status);

    const params = new URLSearchParams({
        code_method: body.code_method ?? "SMS",
        language:    body.language    ?? "en_US",
    });
    const r = await fetch(`${GRAPH}/${encodeURIComponent(phone_number_id)}/request_code`, {
        method: "POST",
        headers: {
            "Content-Type":  "application/x-www-form-urlencoded",
            "Authorization": `Bearer ${t.token}`,
        },
        body: params.toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
        console.error("request_code graph error:", r.status, JSON.stringify(j));
        return jsonResponse({ error: j?.error?.message ?? `graph_api: ${r.status}`, detail: j }, 502);
    }
    return jsonResponse({ success: true, result: j });
}

interface VerifyCodeBody {
    action: "verify_code";
    org_id: string;
    phone_number_id: string;
    code: string;
}

async function handleVerifyCode(supabase: ReturnType<typeof createClient>, body: VerifyCodeBody) {
    const { org_id, phone_number_id, code } = body;
    if (!org_id || !phone_number_id || !code) return jsonResponse({ error: "missing required fields" }, 400);
    const t = await loadWhatsAppToken(supabase, org_id);
    if ("error" in t) return jsonResponse({ error: t.error }, t.status);

    const params = new URLSearchParams({ code });
    const r = await fetch(`${GRAPH}/${encodeURIComponent(phone_number_id)}/verify_code`, {
        method: "POST",
        headers: {
            "Content-Type":  "application/x-www-form-urlencoded",
            "Authorization": `Bearer ${t.token}`,
        },
        body: params.toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
        console.error("verify_code graph error:", r.status, JSON.stringify(j));
        return jsonResponse({ error: j?.error?.message ?? `graph_api: ${r.status}`, detail: j }, 502);
    }
    return jsonResponse({ success: true, result: j });
}

interface RegisterNumberBody {
    action: "register_number";
    org_id: string;
    phone_number_id: string;
    pin: string;
}

async function handleRegisterNumber(supabase: ReturnType<typeof createClient>, body: RegisterNumberBody) {
    const { org_id, phone_number_id, pin } = body;
    if (!org_id || !phone_number_id || !pin) return jsonResponse({ error: "missing required fields" }, 400);
    if (!/^\d{6}$/.test(pin)) return jsonResponse({ error: "pin must be 6 digits" }, 400);
    const t = await loadWhatsAppToken(supabase, org_id);
    if ("error" in t) return jsonResponse({ error: t.error }, t.status);

    const params = new URLSearchParams({ messaging_product: "whatsapp", pin });
    const r = await fetch(`${GRAPH}/${encodeURIComponent(phone_number_id)}/register`, {
        method: "POST",
        headers: {
            "Content-Type":  "application/x-www-form-urlencoded",
            "Authorization": `Bearer ${t.token}`,
        },
        body: params.toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
        console.error("register graph error:", r.status, JSON.stringify(j));
        return jsonResponse({ error: j?.error?.message ?? `graph_api: ${r.status}`, detail: j }, 502);
    }
    return jsonResponse({ success: true, result: j });
}

// complete_setup: one-shot wiring for orgs that bypass Embedded Signup.
// Use case: the app-owning business cannot Embedded-Signup itself (Meta
// permission model), or you want to attach a number using a permanent
// System User token from Business Manager. Caller pastes:
//   - waba_id, phone_number_id, business_id, account_name
//   - system_user_token (long-lived; usually permanent for system users)
// The action validates the token, upserts both meta_channel_tokens and
// org_channel_accounts, calls subscribed_apps to attach the app to the
// WABA, fetches phone_details to populate the UI, and writes the
// connection summary into organizations.external_onboarding_data so the
// wizard renders "connected" on next reload. Each step's status is
// reported in the response so partial failures are visible.

interface CompleteSetupBody {
    action: "complete_setup";
    org_id: string;
    waba_id: string;
    phone_number_id: string;
    business_id?: string;
    account_name?: string;
    system_user_token: string;
}

async function handleCompleteSetup(supabase: ReturnType<typeof createClient>, body: CompleteSetupBody) {
    const { org_id, waba_id, phone_number_id, system_user_token } = body;
    if (!org_id || !waba_id || !phone_number_id || !system_user_token) {
        return jsonResponse({ error: "missing required fields" }, 400);
    }

    // 1. Validate token
    let debug: DebugInfo;
    try {
        debug = await debugToken(system_user_token);
    } catch (e) {
        return jsonResponse({ error: `debug_token failed: ${String(e)}` }, 400);
    }
    if (!debug.is_valid) {
        return jsonResponse({ error: "token failed validation (debug_token returned is_valid=false)" }, 400);
    }

    const now = new Date().toISOString();
    const expiresAt = debug.expires_at > 0 ? expiresAtFromUnix(debug.expires_at) : null;
    const accountName = body.account_name ?? null;

    // Deactivate any other active WhatsApp tokens for this org with a different waba_id.
    await supabase
        .from("meta_channel_tokens")
        .update({ is_active: false, updated_at: now })
        .eq("org_id", org_id)
        .eq("platform", "whatsapp")
        .eq("is_active", true)
        .neq("account_id", waba_id);

    // 2. Persist token
    const tokenUpsert = await supabase
        .from("meta_channel_tokens")
        .upsert({
            org_id,
            platform: "whatsapp",
            account_id: waba_id,
            account_name: accountName,
            access_token: system_user_token,
            token_type: "user",
            expires_at: expiresAt,
            scopes: debug.scopes,
            is_active: true,
            last_validated_at: now,
            last_error: null,
            updated_at: now,
        }, { onConflict: "org_id,platform,account_id" });
    if (tokenUpsert.error) {
        return jsonResponse({ error: `meta_channel_tokens: ${tokenUpsert.error.message}` }, 500);
    }

    const baseMeta = {
        app_id: META_APP_ID,
        waba_id,
        phone_number_id,
        business_id: body.business_id ?? "",
        verified_name: "",
        display_phone_number: "",
        quality_rating: "",
    };
    const ocaUpsert = await supabase
        .from("org_channel_accounts")
        .upsert({
            org_id,
            platform: "whatsapp",
            external_account_id: phone_number_id,
            account_name: accountName,
            access_token: system_user_token,
            is_active: true,
            connected_at: now,
            updated_at: now,
            meta: baseMeta,
        }, { onConflict: "org_id,platform,external_account_id" });
    if (ocaUpsert.error) {
        return jsonResponse({ error: `org_channel_accounts: ${ocaUpsert.error.message}` }, 500);
    }

    const steps: Record<string, unknown> = {
        token_validated: { ok: true, scopes: debug.scopes, expires_at: expiresAt },
    };

    // 3. Subscribe app to WABA (the failing step in Embedded Signup for
    //    same-business setups). With a system user token holding admin on
    //    the WABA, this should succeed.
    {
        const r = await fetch(`${GRAPH}/${encodeURIComponent(waba_id)}/subscribed_apps`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `access_token=${encodeURIComponent(system_user_token)}`,
        });
        const j = await r.json().catch(() => ({}));
        steps.subscribe_app = r.ok
            ? { ok: true, result: j }
            : { ok: false, status: r.status, error: j?.error?.message ?? `http_${r.status}`, detail: j };
    }

    // 4. Fetch phone_details and update UI fields. Don't fail if this
    //    errors -- a brand-new unregistered number returns 500 here, but
    //    that's fixable separately via request_code/verify_code/register.
    let phoneDetails: { display_phone_number: string; verified_name: string; quality_rating: string } | null = null;
    {
        const u = new URL(`${GRAPH}/${encodeURIComponent(phone_number_id)}`);
        u.searchParams.set("fields", "id,display_phone_number,verified_name,quality_rating");
        u.searchParams.set("access_token", system_user_token);
        const r = await fetch(u.toString());
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
            phoneDetails = {
                display_phone_number: j.display_phone_number ?? "",
                verified_name:        j.verified_name ?? "",
                quality_rating:       j.quality_rating ?? "",
            };
            const updatedMeta = { ...baseMeta, ...phoneDetails };
            await supabase
                .from("org_channel_accounts")
                .update({
                    account_name: phoneDetails.verified_name || accountName,
                    meta: updatedMeta,
                    updated_at: new Date().toISOString(),
                })
                .eq("org_id", org_id)
                .eq("platform", "whatsapp")
                .eq("external_account_id", phone_number_id);
            steps.phone_details = { ok: true, ...phoneDetails };
        } else {
            steps.phone_details = {
                ok: false, status: r.status,
                error: j?.error?.message ?? `http_${r.status}`,
                hint: r.status === 500 || r.status === 400
                    ? "phone number likely not registered yet; run request_code -> verify_code -> register_number"
                    : undefined,
            };
        }
    }

    // 5. Write the connection summary into organizations.external_onboarding_data
    //    so the wizard reads "connected" on next page load.
    const subscribeOk = (steps.subscribe_app as any)?.ok === true;
    const channelStatus = subscribeOk && phoneDetails ? "connected" : "partial";
    {
        const orgRes = await supabase
            .from("organizations")
            .select("external_onboarding_data")
            .eq("id", org_id)
            .maybeSingle();
        const merged: any = orgRes.data?.external_onboarding_data ?? {};
        if (!merged.channels) merged.channels = {};
        merged.channels.whatsapp_connection = {
            channel_connection_status: channelStatus,
            waba_id,
            phone_number_id,
            business_id: body.business_id ?? "",
            display_phone_number: phoneDetails?.display_phone_number ?? "",
            verified_name:        phoneDetails?.verified_name ?? "",
            quality_rating:       phoneDetails?.quality_rating ?? "",
            backend_status: {
                code_exchange:       "success",
                phone_details_fetch: phoneDetails ? "success" : "error",
                subscribe_app:       subscribeOk ? "success" : "error",
                webhook_ready:       subscribeOk ? "success" : "pending",
            },
            updated_at: new Date().toISOString(),
        };
        merged.channels.whatsapp_number = phoneDetails?.display_phone_number ?? "";
        await supabase
            .from("organizations")
            .update({ external_onboarding_data: merged })
            .eq("id", org_id);
        steps.organization_state = { ok: true, channel_connection_status: channelStatus };
    }

    return jsonResponse({
        success: subscribeOk,
        channel_connection_status: channelStatus,
        steps,
        phone_details: phoneDetails,
        next_steps: phoneDetails
            ? ["Configure webhook URL in Meta App Dashboard if not done", "Send a test message to confirm flow"]
            : [
                "Phone number not registered yet -- run actions:",
                "  1) request_code (sends SMS to the number)",
                "  2) verify_code (paste 6-digit SMS code)",
                "  3) register_number (set a 6-digit PIN)",
            ],
    });
}

interface RefreshBody { action: "refresh"; }

async function handleRefresh(supabase: ReturnType<typeof createClient>) {
    const cutoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
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
            if (r.platform === "page" || r.token_type === "page") continue;
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

    // All other actions require a Supabase user JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!jwt) {
        console.warn("meta-token-manager: missing JWT for action:", action);
        return jsonResponse({ error: "unauthorized" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userData?.user) {
        console.warn("meta-token-manager: getUser failed:", userErr?.message, "action:", action);
        return jsonResponse({ error: "unauthorized" }, 401);
    }

    const orgId = body?.org_id as string | undefined;
    if (orgId) {
        const member = await supabase
            .from("organization_members")
            .select("org_id")
            .eq("org_id", orgId)
            .eq("user_id", userData.user.id)
            .maybeSingle();
        if (member.error) {
            console.error("meta-token-manager: org membership lookup error:", member.error.message,
                "org_id:", orgId, "user_id:", userData.user.id, "action:", action);
            return jsonResponse({ error: "forbidden", detail: "membership_lookup_failed" }, 403);
        }
        if (!member.data) {
            console.warn("meta-token-manager: user not in org:", "org_id:", orgId,
                "user_id:", userData.user.id, "action:", action);
            return jsonResponse({ error: "forbidden", detail: "not_a_member" }, 403);
        }
    }

    switch (action) {
        case "exchange":      return await handleExchange(supabase, body as ExchangeBody);
        case "validate":      return await handleValidate(supabase, body as ValidateBody);
        case "phone_details": return await handlePhoneDetails(supabase, body as PhoneDetailsBody);
        case "subscribe":     return await handleSubscribe(supabase, body as SubscribeBody);
        case "verify_webhook":return await handleVerifyWebhook(supabase, body as VerifyWebhookBody);
        case "request_code":  return await handleRequestCode(supabase, body as RequestCodeBody);
        case "verify_code":   return await handleVerifyCode(supabase, body as VerifyCodeBody);
        case "register_number": return await handleRegisterNumber(supabase, body as RegisterNumberBody);
        case "complete_setup":  return await handleCompleteSetup(supabase, body as CompleteSetupBody);
        case "disconnect":    return await handleDisconnect(supabase, body as DisconnectBody);
        default:              return jsonResponse({ error: `unknown action: ${action}` }, 400);
    }
});
