// WooCommerce REST API source adapter.
// Reads creds from external_onboarding_data.integrations.woocommerce.{website_url, consumer_key, consumer_secret}.
// Uses Basic auth first, falls back to query-string credentials only on auth failure (per doc 02).

import type { NormalizedMedia, NormalizedProduct, SyncSummary } from "../normalize.ts";
import { pickPrimary } from "../normalize.ts";
import { classify } from "../media.ts";

const PAGE_SIZE = 100;

interface WooCreds {
    website_url?: string;
    consumer_key?: string;
    consumer_secret?: string;
}

function origin(websiteUrl: string): string {
    try {
        const u = new URL(websiteUrl);
        return `${u.protocol}//${u.host}`;
    } catch {
        // Bare host -- assume https.
        return `https://${websiteUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "")}`;
    }
}

async function fetchPage(
    base: string, key: string, secret: string, page: number, mode: "basic" | "query",
): Promise<Response> {
    const url = mode === "basic"
        ? `${base}/wp-json/wc/v3/products?per_page=${PAGE_SIZE}&page=${page}`
        : `${base}/wp-json/wc/v3/products?per_page=${PAGE_SIZE}&page=${page}&consumer_key=${encodeURIComponent(key)}&consumer_secret=${encodeURIComponent(secret)}`;
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (mode === "basic") headers["Authorization"] = `Basic ${btoa(`${key}:${secret}`)}`;
    return fetch(url, { method: "GET", headers });
}

export async function fetchWooProducts(
    creds: WooCreds, summary: SyncSummary,
): Promise<NormalizedProduct[]> {
    const base = origin(creds.website_url || "");
    const key = (creds.consumer_key || "").trim();
    const secret = (creds.consumer_secret || "").trim();
    if (!base || !key || !secret) {
        throw new Error("ERR_WOOCOMMERCE_INVALID_KEYS: missing url/consumer_key/consumer_secret");
    }

    const products: NormalizedProduct[] = [];
    let page = 1;
    let mode: "basic" | "query" = "basic";
    let safety = 50;

    while (safety-- > 0) {
        let resp = await fetchPage(base, key, secret, page, mode);
        if ((resp.status === 401 || resp.status === 403) && mode === "basic") {
            mode = "query";
            resp = await fetchPage(base, key, secret, page, mode);
        }
        if (resp.status === 401 || resp.status === 403) {
            throw new Error(`ERR_WOOCOMMERCE_INVALID_KEYS: ${resp.status} from REST API`);
        }
        if (resp.status === 404) {
            throw new Error("ERR_WOOCOMMERCE_REST_UNAVAILABLE: /wp-json/wc/v3/products returned 404");
        }
        if (!resp.ok) {
            throw new Error(`ERR_WOOCOMMERCE_REST_UNAVAILABLE: status ${resp.status}`);
        }

        let json: unknown;
        try {
            json = await resp.json();
        } catch {
            throw new Error("ERR_PRODUCTS_RESPONSE_UNSUPPORTED: WooCommerce returned non-JSON");
        }
        if (!Array.isArray(json)) {
            throw new Error("ERR_PRODUCTS_RESPONSE_UNSUPPORTED: WooCommerce response was not an array");
        }
        if (json.length === 0) break;

        for (const item of json as any[]) {
            const np = mapWooProduct(item, summary);
            if (np) products.push(np);
        }
        if (json.length < PAGE_SIZE) break;
        page += 1;
    }

    summary.products_found += products.length;
    return products;
}

function mapWooProduct(item: any, summary: SyncSummary): NormalizedProduct | null {
    if (!item?.id || !item?.name) return null;

    const media: NormalizedMedia[] = [];
    for (const img of (item?.images ?? [])) {
        if (!img?.src) continue;
        media.push({
            type: "image",
            url: img.src,
            thumbnailUrl: img.src,
            altText: img.alt || img.name || null,
            sourceMediaId: String(img.id || ""),
            state: classify("image", img.src),
            isPrimary: false,
        });
        summary.images_found += 1;
    }

    // Defensive video detection -- only if a usable URL is present.
    const candidateVideoFields = ["video", "video_url", "videoUrl", "videos"];
    for (const f of candidateVideoFields) {
        const v = item?.[f];
        const urls: string[] = Array.isArray(v) ? v.filter((x) => typeof x === "string") : (typeof v === "string" ? [v] : []);
        for (const url of urls) {
            const state = classify("video", url);
            if (state === "unsupported") continue;
            media.push({
                type: "video", url,
                thumbnailUrl: null, altText: null, sourceMediaId: null,
                state, isPrimary: false,
            });
            summary.videos_found += 1;
        }
    }

    for (const m of media) {
        if (m.state === "broken") summary.broken_media_count += 1;
        else if (m.state === "unsupported") summary.unsupported_media_count += 1;
    }
    if (!media.length) summary.missing_media_count += 1;

    const price = Number(item?.price);
    const salePrice = item?.sale_price ? Number(item.sale_price) : null;

    return {
        source: "woocommerce",
        externalId: String(item.id),
        title: String(item.name),
        description: item?.description || item?.short_description || null,
        descriptionHtml: item?.description || null,
        productUrl: item?.permalink || null,
        price: Number.isFinite(price) ? price : null,
        salePrice: salePrice && Number.isFinite(salePrice) ? salePrice : null,
        currency: null,
        sku: item?.sku || null,
        quantity: typeof item?.stock_quantity === "number" ? item.stock_quantity : null,
        availability: item?.stock_status || null,
        status: "active",
        primaryMedia: pickPrimary(media),
        media, raw: item,
    };
}
