// messenger-webhook Edge Function.
//
// Handles Meta Messenger webhooks (Facebook Page messages).
//   GET  -> hub challenge verification (uses META_VERIFY_TOKEN env)
//   POST -> HMAC-SHA256 verify against META_APP_SECRET, then forward
//           inbound message events to the existing n8n unified webhook.
//
// All Meta credentials are read ONLY from environment variables:
//   - META_APP_SECRET     (required)
//   - META_VERIFY_TOKEN   (required)
//   - SUPABASE_URL                  (auto-injected by Supabase)
//   - SUPABASE_SERVICE_ROLE_KEY     (auto-injected by Supabase)
//
// Deploy with `verify_jwt=true` (default). Meta does not send a JWT, but
// the function is invoked by Meta directly via the public function URL,
// which accepts the request because the function performs its own
// signature check.
//
// We never modify any other Edge Function. This file only forwards events.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const META_APP_SECRET   = Deno.env.get("META_APP_SECRET")   ?? "";
const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")      ?? "";
const SERVICE_ROLE      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const N8N_UNIFIED_WEBHOOK =
    "https://n8n.srv1174105.hstgr.cloud/webhook/digitivia_meta_unified";

const PLATFORM = "page";        // org_channel_accounts.platform value for Messenger
const EXPECTED_OBJECT = "page"; // Meta payload's `object` field for Page events

// ---------- helpers ----------

async function verifySignature(rawBody: string, sigHeader: string | null): Promise<boolean> {
    if (!sigHeader || !sigHeader.startsWith("sha256=")) return false;
    if (!META_APP_SECRET) return false;
    const expected = sigHeader.slice("sha256=".length);
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(META_APP_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const hex = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    // constant-time-ish comparison
    if (hex.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
}

async function forwardToN8n(rawBody: string, parsed: unknown, sigHeader: string | null) {
    try {
        await fetch(N8N_UNIFIED_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                headers: { "x-hub-signature-256": sigHeader ?? "" },
                body: parsed,
                rawBodyString: rawBody,
            }),
        });
    } catch (err) {
        // We never fail the request to Meta because n8n forwarding hiccupped.
        console.warn(`[${PLATFORM}-webhook] n8n forward failed:`, err);
    }
}

// ---------- helpers ----------

async function resolveAndUpsertContact(
    supabase: ReturnType<typeof createClient>,
    orgId: string,
    platform: string,
    senderId: string,
    pageToken: string,
    pageId: string,
): Promise<void> {
    let displayName: string | null = null;
    // Primary: conversations endpoint returns real participant name for PSIDs
    try {
        const r = await fetch(
            `https://graph.facebook.com/v24.0/${pageId}/conversations?user_id=${senderId}&fields=participants&access_token=${pageToken}`,
        );
        if (r.ok) {
            const d = await r.json();
            const participants: any[] = d.data?.[0]?.participants?.data ?? [];
            const user = participants.find((p: any) => p.id !== pageId);
            if (user?.name) displayName = user.name;
        }
    } catch { /* ignore */ }
    // Fallback: direct profile lookup
    if (!displayName) {
        try {
            const r = await fetch(
                `https://graph.facebook.com/v24.0/${senderId}?fields=name,username&access_token=${pageToken}`,
            );
            if (r.ok) {
                const p = await r.json();
                displayName = p.name || p.username || null;
            }
        } catch { /* ignore — fall through to senderId */ }
    }

    await supabase.from("inbox_contacts").upsert({
        org_id:              orgId,
        platform,
        external_contact_id: senderId,
        display_name:        displayName ?? senderId,
    }, { onConflict: "org_id,platform,external_contact_id" });
}

// ---------- entrypoint ----------

Deno.serve(async (req) => {
    const url = new URL(req.url);

    // GET: Meta hub challenge verification
    if (req.method === "GET") {
        const mode      = url.searchParams.get("hub.mode");
        const token     = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        if (mode === "subscribe" && token === META_VERIFY_TOKEN && challenge) {
            return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
        }
        return new Response("forbidden", { status: 403 });
    }

    if (req.method !== "POST") {
        return new Response("method not allowed", { status: 405 });
    }

    const rawBody = await req.text();
    const sigHeader = req.headers.get("x-hub-signature-256");

    const ok = await verifySignature(rawBody, sigHeader);
    if (!ok) return new Response("invalid signature", { status: 401 });

    let parsed: any;
    try {
        parsed = JSON.parse(rawBody);
    } catch {
        return new Response("EVENT_RECEIVED", { status: 200 });
    }

    if (!parsed || parsed.object !== EXPECTED_OBJECT) {
        return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    // Walk all entries to (a) confirm at least one event maps to a known
    // active org, and (b) confirm at least one event has user-typed text
    // (i.e. not an echo / read / delivery receipt). If both are true we
    // forward the FULL raw body to n8n exactly once -- n8n normalises the
    // entries itself. If neither is true we drop the request silently.
    let shouldForward = false;
    for (const entry of parsed.entry ?? []) {
        const pageId: string | undefined = entry?.id;
        if (!pageId) continue;

        const { data: orgRow, error } = await supabase
            .from("org_channel_accounts")
            .select("org_id, access_token")
            .eq("platform", PLATFORM)
            .eq("external_account_id", pageId)
            .eq("is_active", true)
            .maybeSingle();

        if (error) {
            console.warn(`[${PLATFORM}-webhook] org lookup error for ${pageId}:`, error.message);
            continue;
        }
        if (!orgRow) {
            console.warn(`[${PLATFORM}-webhook] no active org for page ${pageId}`);
            continue;
        }

        for (const event of entry?.messaging ?? []) {
            if (event?.message?.is_echo === true) continue;
            if (event?.delivery || event?.read) continue;
            if (!event?.message?.text) continue;
            // Resolve and persist contact name before n8n creates the contact row
            const senderId = String(event?.sender?.id ?? "");
            if (senderId && orgRow.access_token) {
                await resolveAndUpsertContact(
                    supabase, orgRow.org_id, PLATFORM, senderId, orgRow.access_token, pageId,
                );
            }
            shouldForward = true;
            break;
        }
        if (shouldForward) break;

        // Page comments: persist to social_comments and forward to n8n.
        for (const change of entry?.changes ?? []) {
            if (change?.field !== "feed") continue;
            const value = change?.value ?? {};
            if (value.item !== "comment") continue;
            if (value.verb && value.verb !== "add") continue;
            const fromId = String(value.from?.id ?? "");
            if (fromId && fromId === pageId) continue; // skip self-comments
            if (!value.comment_id) continue;
            await supabase.from("social_comments").upsert({
                org_id:              orgRow.org_id,
                platform:            "facebook",
                external_post_id:    value.post_id ? String(value.post_id) : null,
                external_comment_id: String(value.comment_id),
                parent_external_id:  value.parent_id ? String(value.parent_id) : null,
                author_external_id:  fromId || null,
                author_name:         value.from?.name ?? null,
                body:                value.message ?? "",
                permalink:           value.post_id
                    ? `https://www.facebook.com/${value.post_id}?comment_id=${value.comment_id}`
                    : null,
                raw:                 value,
            }, { onConflict: "platform,external_comment_id", ignoreDuplicates: true });
            // Auto-reply to customer comment (prototype template)
            const fbReplyText = "Thank you for your comment! Our team will get back to you soon. 🙏";
            try {
                const fbReplyRes = await fetch(
                    `https://graph.facebook.com/v24.0/${value.comment_id}/comments`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ message: fbReplyText, access_token: orgRow.access_token }),
                    },
                );
                if (fbReplyRes.ok) {
                    const fbReplyData = await fbReplyRes.json();
                    const fbReplyId: string | undefined = fbReplyData?.id;
                    if (fbReplyId) {
                        await supabase.from("social_comments").upsert({
                            org_id:              orgRow.org_id,
                            platform:            "facebook",
                            external_post_id:    value.post_id ? String(value.post_id) : null,
                            external_comment_id: fbReplyId,
                            parent_external_id:  String(value.comment_id),
                            author_external_id:  pageId,
                            author_name:         null,
                            body:                fbReplyText,
                            permalink:           null,
                            is_page_reply:       true,
                            raw:                 {},
                        }, { onConflict: "platform,external_comment_id", ignoreDuplicates: true });
                    }
                }
            } catch { /* ignore — reply is best-effort */ }
            shouldForward = true;
        }
        if (shouldForward) break;
    }

    if (shouldForward) {
        await forwardToN8n(rawBody, parsed, sigHeader);
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
});
