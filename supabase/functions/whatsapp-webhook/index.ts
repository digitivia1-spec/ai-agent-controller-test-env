// whatsapp-webhook Edge Function.
//
// Identical contract to messenger-webhook / instagram-webhook except:
//   - body.object must be 'whatsapp_business_account'
//   - org_channel_accounts.platform = 'whatsapp'
//   - entry.id is the WhatsApp Business Account (WABA) ID, stored as
//     external_account_id when the wizard runs Embedded Signup.
//   - WhatsApp events live under entry.changes[].value.messages[] (and
//     entry.changes[].value.statuses[] for delivery/read receipts).
//
// Credentials are read ONLY from environment variables:
//   - META_APP_SECRET, META_VERIFY_TOKEN
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//
// The downstream n8n workflow already normalises WhatsApp events into
// inbox_contacts / inbox_conversations / inbox_messages -- see the row
// counts under platform='whatsapp' in inbox_messages. We just forward
// the raw envelope in the same shape Messenger and Instagram use.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const META_APP_SECRET   = Deno.env.get("META_APP_SECRET")   ?? "";
const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")      ?? "";
const SERVICE_ROLE      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const N8N_UNIFIED_WEBHOOK =
    "https://n8n.srv1174105.hstgr.cloud/webhook/meta_unified_digitivia";

const PLATFORM = "whatsapp";
const EXPECTED_OBJECT = "whatsapp_business_account";

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
        console.warn(`[${PLATFORM}-webhook] n8n forward failed:`, err);
    }
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
    // any entry has at least one inbound user message for a known active
    // org. Status-only callbacks (sent/delivered/read) are ignored here --
    // n8n normalises the rest itself.
    let shouldForward = false;
    for (const entry of parsed.entry ?? []) {
        const wabaId: string | undefined = entry?.id;
        if (!wabaId) continue;

        const { data: orgRow, error } = await supabase
            .from("org_channel_accounts")
            .select("org_id")
            .eq("platform", PLATFORM)
            .eq("external_account_id", wabaId)
            .eq("is_active", true)
            .maybeSingle();

        if (error) {
            console.warn(`[${PLATFORM}-webhook] org lookup error for WABA ${wabaId}:`, error.message);
            continue;
        }
        if (!orgRow) {
            console.warn(`[${PLATFORM}-webhook] no active org for WABA ${wabaId}`);
            continue;
        }

        for (const change of entry?.changes ?? []) {
            if (change?.field !== "messages") continue;
            const value = change?.value ?? {};
            const messages = Array.isArray(value.messages) ? value.messages : [];
            if (messages.length === 0) continue;
            shouldForward = true;
            break;
        }
        if (shouldForward) break;
    }

    if (shouldForward) {
        await forwardToN8n(rawBody, parsed, sigHeader);
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
});
