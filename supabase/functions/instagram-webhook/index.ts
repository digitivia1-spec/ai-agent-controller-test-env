// instagram-webhook Edge Function.
//
// Identical contract to messenger-webhook except:
//   - body.object must be 'instagram'
//   - org_channel_accounts.platform = 'instagram'
//   - entry.id is the Instagram Business Account ID (stored as external_account_id)
//
// Credentials are read ONLY from environment variables:
//   - META_APP_SECRET, META_VERIFY_TOKEN
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//
// The downstream n8n workflow already handles Instagram in
// "Normalize Inbound Messages" -- we just need to forward the raw event
// envelope in the shape it expects.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const META_APP_SECRET      = Deno.env.get("META_APP_SECRET")      ?? "";
const INSTAGRAM_APP_SECRET = Deno.env.get("INSTAGRAM_APP_SECRET") ?? "";
const META_VERIFY_TOKEN    = Deno.env.get("META_VERIFY_TOKEN")    ?? "";
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")         ?? "";
const SERVICE_ROLE         = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const N8N_UNIFIED_WEBHOOK =
    "https://n8n.srv1174105.hstgr.cloud/webhook/meta_unified_digitivia";

const PLATFORM = "instagram";
const EXPECTED_OBJECT = "instagram";

async function hmacHex(secret: string, body: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

async function verifySignature(rawBody: string, sigHeader: string | null): Promise<boolean> {
    if (!sigHeader || !sigHeader.startsWith("sha256=")) return false;
    const expected = sigHeader.slice("sha256=".length).trim();

    // Try each available secret — supports separate INSTAGRAM_APP_SECRET if Meta
    // uses a different signing app for Instagram vs Messenger webhooks.
    const secrets = [META_APP_SECRET, INSTAGRAM_APP_SECRET].filter(Boolean);
    console.log(`[ig-sig] secrets_available=${secrets.length} body_len=${rawBody.length} expected_prefix=${expected.slice(0, 8)}`);

    if (secrets.length === 0) {
        // No app secret configured — accept without verification (set META_APP_SECRET to enable)
        console.warn("[ig-sig] no secret configured, bypassing signature check");
        return true;
    }
    for (const secret of secrets) {
        const hex = await hmacHex(secret, rawBody);
        console.log(`[ig-sig] computed_prefix=${hex.slice(0, 8)} match=${timingSafeEqual(hex, expected)}`);
        if (timingSafeEqual(hex, expected)) return true;
    }
    return false;
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
        console.warn(`[${PLATFORM}-webhook] n8n forward failed:`, err);
    }
}

async function resolveAndUpsertContact(
    supabase: ReturnType<typeof createClient>,
    orgId: string,
    platform: string,
    senderId: string,
    pageToken: string,
): Promise<void> {
    let displayName: string | null = null;
    try {
        const r = await fetch(
            `https://graph.facebook.com/v24.0/${senderId}?fields=name,username&access_token=${pageToken}`,
        );
        if (r.ok) {
            const p = await r.json();
            displayName = p.name || p.username || null;
        }
    } catch { /* ignore — fall through to senderId */ }

    await supabase.from("inbox_contacts").upsert({
        org_id:              orgId,
        platform,
        external_contact_id: senderId,
        display_name:        displayName ?? senderId,
    }, { onConflict: "org_id,platform,external_contact_id" });
}

Deno.serve(async (req) => {
    const url = new URL(req.url);

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

    // Walk all entries; forward the full raw body to n8n exactly once if
    // any entry has at least one user-typed text event for a known active
    // org. n8n normalises the rest itself.
    let shouldForward = false;
    for (const entry of parsed.entry ?? []) {
        const igAccountId: string | undefined = entry?.id;
        if (!igAccountId) continue;

        const { data: orgRow, error } = await supabase
            .from("org_channel_accounts")
            .select("org_id, access_token")
            .eq("platform", PLATFORM)
            .eq("external_account_id", igAccountId)
            .eq("is_active", true)
            .maybeSingle();

        if (error) {
            console.warn(`[${PLATFORM}-webhook] org lookup error for ${igAccountId}:`, error.message);
            continue;
        }
        if (!orgRow) {
            console.warn(`[${PLATFORM}-webhook] no active org for IG account ${igAccountId}`);
            continue;
        }

        // Fetch the Page token for direct IG DM sends (non-expiring, stored in
        // meta_channel_tokens after the Instagram exchange fix).
        let igSendToken: string | null = (orgRow.access_token as string) || null;
        {
            const { data: tokenRow } = await supabase
                .from("meta_channel_tokens")
                .select("access_token")
                .eq("org_id", orgRow.org_id)
                .eq("platform", "instagram")
                .eq("is_active", true)
                .maybeSingle();
            if (tokenRow?.access_token) igSendToken = tokenRow.access_token as string;
        }

        // Instagram DMs: forward raw object:"instagram" payload to n8n directly.
        // n8n identifies the org via ig_recipient_id in meta_channel_tokens.
        // Also send a fixed reply directly here because n8n's send node calls
        // /me/messages (broken for IG) — remove this block once n8n is fixed.
        for (const event of entry?.messaging ?? []) {
            if (event?.message?.is_echo === true) continue;
            if (event?.delivery || event?.read) continue;
            if (!event?.message?.text) continue;
            const senderId = String(event?.sender?.id ?? "");
            if (senderId && orgRow.access_token) {
                await resolveAndUpsertContact(
                    supabase, orgRow.org_id, PLATFORM, senderId, orgRow.access_token,
                );
            }
            // Direct fixed reply — bypasses n8n's broken /me/messages send step.
            if (senderId && igSendToken) {
                try {
                    await fetch(
                        `https://graph.facebook.com/v24.0/${igAccountId}/messages`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                recipient: { id: senderId },
                                message: { text: "شكراً لتواصلك معنا! سيتواصل معك فريقنا قريباً. 🙏\nThank you for reaching out! Our team will get back to you shortly. 🙏" },
                                messaging_type: "RESPONSE",
                                access_token: igSendToken,
                            }),
                        },
                    );
                } catch { /* best-effort — n8n still processes for inbox */ }
            }
            shouldForward = true;
            break;
        }
        if (shouldForward) break;

        // IG comments: persist to social_comments and forward to n8n.
        for (const change of entry?.changes ?? []) {
            if (change?.field !== "comments") continue;
            const value = change?.value ?? {};
            const fromId = String(value.from?.id ?? "");
            if (fromId && fromId === igAccountId) continue; // skip self-comments
            if (!value.id) continue;
            await supabase.from("social_comments").upsert({
                org_id:              orgRow.org_id,
                platform:            "instagram",
                external_post_id:    value.media?.id ? String(value.media.id) : null,
                external_comment_id: String(value.id),
                parent_external_id:  value.parent_id ? String(value.parent_id) : null,
                author_external_id:  fromId || null,
                author_name:         value.from?.username ?? null,
                body:                value.text ?? "",
                permalink:           null,
                raw:                 value,
            }, { onConflict: "platform,external_comment_id", ignoreDuplicates: true });
            // Auto-reply to Instagram comment (prototype template)
            const igReplyText = "Thank you for your comment! Our team will get back to you soon. 🙏";
            try {
                const igReplyRes = await fetch(
                    `https://graph.facebook.com/v24.0/${value.id}/replies`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ message: igReplyText, access_token: orgRow.access_token }),
                    },
                );
                if (igReplyRes.ok) {
                    const igReplyData = await igReplyRes.json();
                    const igReplyId: string | undefined = igReplyData?.id;
                    if (igReplyId) {
                        await supabase.from("social_comments").upsert({
                            org_id:              orgRow.org_id,
                            platform:            "instagram",
                            external_post_id:    value.media?.id ? String(value.media.id) : null,
                            external_comment_id: igReplyId,
                            parent_external_id:  String(value.id),
                            author_external_id:  igAccountId,
                            author_name:         null,
                            body:                igReplyText,
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
