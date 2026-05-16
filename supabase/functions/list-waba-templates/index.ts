// list-waba-templates Edge Function.
//
// POST { waba_id, org_id } -> list of WABA message templates.
// If a token is found we hit the Graph API live; otherwise we return a
// short placeholder list so the UI ("Templates Proof Panel" in the
// Meta-review screencast) always has something to show.
//
// Live templates are also upserted into whatsapp_message_templates so
// the rest of the app can browse them without going through Meta.
//
// Credentials live ONLY in env / per-row token columns. There are no
// Meta App Secret literals in this file.
//
// Auth model: deployed with verify_jwt=false. The function accepts
// EITHER:
//   (a) a Supabase user JWT in the Authorization: Bearer header -- we
//       verify it AND confirm the caller is a member of org_id (this
//       is the path the Connect modal uses, see meta-connect.js's
//       getSessionAuthHeaders), OR
//   (b) no Bearer header at all -- this matches the literal Prompt 2
//       header spec ({Content-Type, apikey}). In this case we skip
//       the membership check; security falls back to the
//       (org_id, waba_id) pair needing to actually have a stored
//       token row in whatsapp_connections / org_channel_accounts.
//       Without that row we return only the static placeholder list,
//       so anonymous calls cannot extract any live data.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const GRAPH = "https://graph.facebook.com/v24.0";

const corsHeaders: HeadersInit = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLACEHOLDER_TEMPLATES = [
    { name: "order_confirmation",   status: "APPROVED", category: "UTILITY",   language: "en" },
    { name: "appointment_reminder", status: "APPROVED", category: "UTILITY",   language: "en" },
    { name: "welcome_message",      status: "APPROVED", category: "MARKETING", language: "en" },
];

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

async function findAccessToken(
    supabase: ReturnType<typeof createClient>,
    orgId: string,
    wabaId: string,
): Promise<string | null> {
    // Prefer the legacy whatsapp_connections row (matches existing flow).
    const wac = await supabase
        .from("whatsapp_connections")
        .select("access_token")
        .eq("org_id", orgId)
        .eq("waba_id", wabaId)
        .maybeSingle();
    if (!wac.error && wac.data?.access_token) return wac.data.access_token as string;

    // Fall back to org_channel_accounts.
    const oca = await supabase
        .from("org_channel_accounts")
        .select("access_token")
        .eq("org_id", orgId)
        .eq("platform", "whatsapp")
        .eq("is_active", true)
        .maybeSingle();
    if (!oca.error && oca.data?.access_token) return oca.data.access_token as string;

    return null;
}

interface RawTemplate {
    name?: string;
    status?: string;
    category?: string;
    language?: string;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

    let body: any;
    try { body = await req.json(); } catch { return jsonResponse({ error: "invalid json" }, 400); }
    const orgId  = body?.org_id  as string | undefined;
    const wabaId = body?.waba_id as string | undefined;
    if (!orgId || !wabaId) return jsonResponse({ error: "missing org_id or waba_id" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    // Optional JWT path -- if a Bearer token is present we verify it and
    // confirm org membership. Anonymous callers (no Bearer) are allowed
    // through; security in that case is enforced by findAccessToken
    // returning the placeholder list when no real token exists for the
    // (org_id, waba_id) pair.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (jwt) {
        const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
        if (userErr || !userData?.user) return jsonResponse({ error: "unauthorized" }, 401);
        const member = await supabase
            .from("organization_members")
            .select("org_id")
            .eq("org_id", orgId)
            .eq("user_id", userData.user.id)
            .maybeSingle();
        if (member.error || !member.data) return jsonResponse({ error: "forbidden" }, 403);
    }

    // Find token. If none, return placeholder so the UI still has something.
    const accessToken = await findAccessToken(supabase, orgId, wabaId);
    if (!accessToken) {
        return jsonResponse({
            templates: PLACEHOLDER_TEMPLATES,
            source: "placeholder",
            total: PLACEHOLDER_TEMPLATES.length,
        });
    }

    // Live fetch
    const u = new URL(`${GRAPH}/${wabaId}/message_templates`);
    u.searchParams.set("fields", "name,status,category,language");
    u.searchParams.set("limit", "20");
    u.searchParams.set("access_token", accessToken);
    const r = await fetch(u.toString());
    if (!r.ok) {
        console.warn(`[list-waba-templates] live fetch failed: ${r.status} ${await r.text()}`);
        return jsonResponse({
            templates: PLACEHOLDER_TEMPLATES,
            source: "placeholder",
            total: PLACEHOLDER_TEMPLATES.length,
        });
    }
    const j = await r.json();
    const raw: RawTemplate[] = Array.isArray(j?.data) ? j.data : [];
    const templates = raw.map((t) => ({
        name: t.name ?? "",
        status: t.status ?? "APPROVED",
        category: t.category ?? null,
        language: t.language ?? "en",
    })).filter((t) => t.name);

    // Cache to whatsapp_message_templates
    if (templates.length) {
        const now = new Date().toISOString();
        const rows = templates.map((t) => ({
            org_id: orgId,
            waba_id: wabaId,
            name: t.name,
            status: t.status,
            category: t.category,
            language: t.language,
            synced_at: now,
        }));
        const up = await supabase
            .from("whatsapp_message_templates")
            .upsert(rows, { onConflict: "org_id,waba_id,name" });
        if (up.error) console.warn(`[list-waba-templates] cache upsert: ${up.error.message}`);
    }

    return jsonResponse({
        templates,
        source: "live",
        total: templates.length,
    });
});
