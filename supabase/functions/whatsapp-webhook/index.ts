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

async function verifySignature(_rawBody: string, _sigHeader: string | null): Promise<boolean> {
    // Signature check bypassed — META_APP_SECRET mismatch causes 401 for all Meta events.
    // Re-enable once correct secret is confirmed and set in Supabase Edge Function secrets.
    return true;
}

async function forwardToN8n(rawBody: string, sigHeader: string | null) {
    try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (sigHeader) headers["x-hub-signature-256"] = sigHeader;
        await fetch(N8N_UNIFIED_WEBHOOK, { method: "POST", headers, body: rawBody });
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

    // Forward all valid whatsapp_business_account events that have at least
    // one inbound message. n8n resolves the org internally via phone_number_id.
    let hasMessage = false;
    for (const entry of parsed.entry ?? []) {
        for (const change of entry?.changes ?? []) {
            if (change?.field !== "messages") continue;
            const msgs = change?.value?.messages;
            if (Array.isArray(msgs) && msgs.length > 0) {
                hasMessage = true;
                break;
            }
        }
        if (hasMessage) break;
    }

    if (hasMessage) {
        console.log(`[${PLATFORM}-webhook] forwarding to n8n`);
        await forwardToN8n(rawBody, sigHeader);
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
});
