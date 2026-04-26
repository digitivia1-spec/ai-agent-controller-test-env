// product-sync Edge Function.
//
// Triggers a Product Library sync for one org / one source (or "all").
// Reads creds from organizations.external_onboarding_data.integrations.{shopify|woocommerce|easy_order}.
// Writes one product_sync_runs row per source attempted.
// Upserts into public.products + public.product_media.
//
// Auth model:
//   - User JWT (from the wizard / Product Library page): we verify the
//     caller is a member of org_id via organization_members.
//   - Service role (from pg_cron in Phase D): no user check, but the
//     request must include x-product-sync-secret matching PRODUCT_SYNC_INTERNAL_SECRET.
//
// Deployed with verify_jwt=false because we accept *either* a user JWT
// or the internal secret. JWT verification is done in code.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

import type { NormalizedProduct, Source, SyncSummary } from "./normalize.ts";
import { emptySummary } from "./normalize.ts";
import { fetchShopifyProducts } from "./sources/shopify.ts";
import { fetchWooProducts } from "./sources/woocommerce.ts";
import { fetchEasyOrdersProducts } from "./sources/easyorders.ts";
import { headValidateBatch } from "./media.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("PRODUCT_SYNC_INTERNAL_SECRET") ?? "";

const VALID_TRIGGERS = new Set([
    "initial_after_credentials_save",
    "credentials_updated",
    "scheduled_every_3_days",
    "manual_retry_after_failure",
    "system_retry",
]);
const VALID_SOURCES = new Set<Source | "all">(["shopify", "woocommerce", "easyorders", "all"]);

const corsHeaders: HeadersInit = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-product-sync-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

interface RequestBody {
    org_id?: string;
    source?: Source | "all";
    trigger?: string;
    head_validate?: boolean;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });

    let body: RequestBody;
    try { body = await req.json(); } catch {
        return jsonResponse(400, { error: "invalid_json" });
    }

    const { org_id, source = "all", trigger, head_validate = false } = body;
    if (!org_id || typeof org_id !== "string") {
        return jsonResponse(400, { error: "missing_org_id" });
    }
    if (!trigger || !VALID_TRIGGERS.has(trigger)) {
        return jsonResponse(400, { error: "invalid_trigger" });
    }
    if (!VALID_SOURCES.has(source)) {
        return jsonResponse(400, { error: "invalid_source" });
    }

    // ---- Auth ----
    const internalSecret = req.headers.get("x-product-sync-secret");
    const isInternalCall = INTERNAL_SECRET && internalSecret === INTERNAL_SECRET;

    const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    if (!isInternalCall) {
        // Verify the caller's JWT and check membership in org_id.
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        if (!token) return jsonResponse(401, { error: "missing_authorization" });
        const { data: userResult, error: userErr } = await admin.auth.getUser(token);
        if (userErr || !userResult?.user) return jsonResponse(401, { error: "invalid_token" });

        const { data: member } = await admin
            .from("organization_members")
            .select("user_id")
            .eq("org_id", org_id)
            .eq("user_id", userResult.user.id)
            .maybeSingle();
        if (!member) return jsonResponse(403, { error: "not_a_member_of_org" });
    }

    // ---- Load creds ----
    const { data: orgRow, error: orgErr } = await admin
        .from("organizations")
        .select("external_onboarding_data")
        .eq("id", org_id)
        .single();
    if (orgErr || !orgRow) return jsonResponse(404, { error: "org_not_found" });

    const integrations = orgRow.external_onboarding_data?.integrations ?? {};

    const requestedSources: Source[] = source === "all"
        ? (["shopify", "woocommerce", "easyorders"] as Source[]).filter((s) => sourceEnabled(integrations, s))
        : (sourceEnabled(integrations, source as Source) ? [source as Source] : []);

    if (requestedSources.length === 0) {
        return jsonResponse(200, { ok: true, runs: [], note: "no_enabled_sources" });
    }

    // ---- Run each source independently; collect results ----
    const runs: Array<{ source: Source; run_id: string | null; status: string; summary: SyncSummary; error?: string }> = [];
    for (const src of requestedSources) {
        const result = await runOneSource(admin, org_id, src, trigger as string, integrations, head_validate);
        runs.push(result);
    }

    return jsonResponse(200, { ok: true, runs });
});

function sourceEnabled(integrations: any, src: Source): boolean {
    if (src === "shopify") {
        const s = integrations?.shopify ?? {};
        return Boolean(s.shop_domain && s.storefront_token);
    }
    if (src === "woocommerce") {
        const w = integrations?.woocommerce ?? {};
        return Boolean(w.website_url && w.consumer_key && w.consumer_secret);
    }
    if (src === "easyorders") {
        const e = integrations?.easy_order ?? {};
        return Boolean(e.api_key);
    }
    return false;
}

async function runOneSource(
    admin: SupabaseClient,
    orgId: string,
    source: Source,
    trigger: string,
    integrations: any,
    headValidate: boolean = false,
) {
    const summary = emptySummary();
    let runId: string | null = null;
    let errorMessage: string | undefined;

    try {
        const { data: insertRun, error: insertErr } = await admin
            .from("product_sync_runs")
            .insert({ org_id: orgId, source, status: "running", trigger, summary })
            .select("id")
            .single();
        if (insertErr) throw new Error(`run_insert_failed: ${insertErr.message}`);
        runId = insertRun.id;

        let products: NormalizedProduct[] = [];
        if (source === "shopify") products = await fetchShopifyProducts(integrations.shopify ?? {}, summary);
        else if (source === "woocommerce") products = await fetchWooProducts(integrations.woocommerce ?? {}, summary);
        else if (source === "easyorders") products = await fetchEasyOrdersProducts(integrations.easy_order ?? {}, summary);

        // Gap 3: opt-in HEAD validation -- promote 'unverified' media to 'valid'/'broken'/'unsupported'.
        if (headValidate) {
            for (const p of products) {
                if (p.media?.length) {
                    await headValidateBatch(p.media as any);
                    if (p.primaryMedia) {
                        const match = p.media.find((m) => m.url === p.primaryMedia!.url && m.type === p.primaryMedia!.type);
                        if (match) p.primaryMedia.state = match.state;
                    }
                    for (const m of p.media) {
                        if (m.state === "broken") summary.broken_media_count += 1;
                        else if (m.state === "unsupported") summary.unsupported_media_count += 1;
                    }
                }
            }
        }

        await upsertProducts(admin, orgId, source, runId!, products, summary);

        summary.finished_at = new Date().toISOString();
        summary.duration_ms = Date.now() - new Date(summary.started_at).getTime();

        const finalStatus = summary.errors_count > 0 || summary.broken_media_count > 0 || summary.unsupported_media_count > 0
            ? "completed_with_warnings"
            : "completed";

        await admin.from("product_sync_runs").update({
            status: finalStatus,
            summary,
            finished_at: summary.finished_at,
            duration_ms: summary.duration_ms,
        }).eq("id", runId);

        return { source, run_id: runId, status: finalStatus, summary };
    } catch (e) {
        errorMessage = e instanceof Error ? e.message : String(e);
        summary.errors_count += 1;
        summary.finished_at = new Date().toISOString();
        summary.duration_ms = Date.now() - new Date(summary.started_at).getTime();
        // Map error_code from the message prefix if present (we throw "ERR_*: detail").
        const errorCode = errorMessage.match(/^ERR_[A-Z_]+/)?.[0] || "ERR_UNKNOWN";

        if (runId) {
            await admin.from("product_sync_runs").update({
                status: "failed",
                summary,
                error_code: errorCode,
                error_message: errorMessage.slice(0, 500),
                finished_at: summary.finished_at,
                duration_ms: summary.duration_ms,
            }).eq("id", runId);
        }
        return { source, run_id: runId, status: "failed", summary, error: errorMessage };
    }
}

async function upsertProducts(
    admin: SupabaseClient,
    orgId: string,
    source: Source,
    runId: string,
    products: NormalizedProduct[],
    summary: SyncSummary,
): Promise<void> {
    const now = new Date().toISOString();
    for (const p of products) {
        try {
            const { data: existing } = await admin
                .from("products")
                .select("id, status")
                .eq("org_id", orgId)
                .eq("source", source)
                .eq("external_id", p.externalId)
                .maybeSingle();

            const productRow = {
                org_id: orgId,
                source,
                external_id: p.externalId,
                title: p.title,
                description: p.description ?? null,
                description_html: p.descriptionHtml ?? null,
                product_url: p.productUrl ?? null,
                price: p.price ?? null,
                sale_price: p.salePrice ?? null,
                currency: p.currency ?? null,
                sku: p.sku ?? null,
                quantity: p.quantity ?? null,
                availability: p.availability ?? null,
                status: p.status,
                last_synced_at: now,
                last_sync_run_id: runId,
                last_seen_at: now,
                raw: p.raw ?? {},
            };

            let productId: string;
            if (existing?.id) {
                productId = existing.id;
                await admin.from("products").update(productRow).eq("id", productId);
                summary.products_updated += 1;
            } else {
                const { data: inserted, error: insErr } = await admin
                    .from("products").insert(productRow).select("id").single();
                if (insErr) throw insErr;
                productId = inserted.id;
                summary.products_created += 1;
            }
            summary.products_saved += 1;

            // Replace media for this product (simpler than diffing in v1).
            await admin.from("product_media").delete().eq("product_id", productId);
            if (p.media.length) {
                const rows = p.media.map((m, idx) => ({
                    product_id: productId,
                    org_id: orgId,
                    media_type: m.type,
                    url: m.url,
                    thumbnail_url: m.thumbnailUrl ?? null,
                    storage_path: null,
                    alt_text: m.altText ?? null,
                    source_media_id: m.sourceMediaId ?? null,
                    is_primary: Boolean(p.primaryMedia && p.primaryMedia.url === m.url && p.primaryMedia.type === m.type) && idx === p.media.findIndex((mm) => mm.url === p.primaryMedia!.url && mm.type === p.primaryMedia!.type),
                    state: m.state,
                    position: idx,
                }));
                const { error: mediaErr } = await admin.from("product_media").insert(rows);
                if (mediaErr) {
                    summary.warnings_count += 1;
                    console.warn("product_media insert failed", mediaErr.message);
                }
            }
        } catch (e) {
            summary.products_skipped += 1;
            summary.errors_count += 1;
            console.warn("upsert failed for", p.externalId, e instanceof Error ? e.message : e);
        }
    }
}
