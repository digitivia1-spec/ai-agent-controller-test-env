// EasyOrders source adapter.
// Reads creds from external_onboarding_data.integrations.easy_order.{store_url, api_key}.
// Defensive response-wrapper parsing per doc 02.

import type { NormalizedMedia, NormalizedProduct, SyncSummary } from "../normalize.ts";
import { pickPrimary } from "../normalize.ts";
import { classify } from "../media.ts";

const ENDPOINT = "https://api.easy-orders.net/api/v1/external-apps/products";

interface EOCreds {
    store_url?: string;
    api_key?: string;
}

function unwrap(json: unknown): any[] {
    if (Array.isArray(json)) return json;
    if (json && typeof json === "object") {
        const j = json as Record<string, unknown>;
        for (const key of ["data", "products", "items"]) {
            const v = j[key];
            if (Array.isArray(v)) return v;
        }
        const dataObj = j.data as any;
        if (dataObj && Array.isArray(dataObj.products)) return dataObj.products;
    }
    return [];
}

export async function fetchEasyOrdersProducts(
    creds: EOCreds, summary: SyncSummary,
): Promise<NormalizedProduct[]> {
    const apiKey = (creds.api_key || "").trim();
    if (!apiKey) {
        throw new Error("ERR_EASYORDERS_INVALID_API_KEY: missing api_key");
    }

    const resp = await fetch(ENDPOINT, {
        method: "GET",
        headers: { "Api-Key": apiKey, "Accept": "application/json" },
    });
    if (resp.status === 401 || resp.status === 403) {
        throw new Error(`ERR_EASYORDERS_INVALID_API_KEY: ${resp.status} from EasyOrders API`);
    }
    if (!resp.ok) {
        throw new Error(`ERR_EASYORDERS_PRODUCTS_READ_MISSING: status ${resp.status}`);
    }

    let json: unknown;
    try { json = await resp.json(); } catch {
        throw new Error("ERR_EASYORDERS_RESPONSE_UNSUPPORTED: non-JSON response");
    }
    const items = unwrap(json);

    const products: NormalizedProduct[] = [];
    for (const item of items) {
        const np = mapEasyOrdersProduct(item, summary);
        if (np) products.push(np);
    }

    summary.products_found += products.length;
    return products;
}

function mapEasyOrdersProduct(item: any, summary: SyncSummary): NormalizedProduct | null {
    if (!item?.name) return null;

    // Identity fallback chain: id -> sku -> slug
    const externalId = item.id != null ? String(item.id)
        : item.sku ? String(item.sku)
        : item.slug ? String(item.slug)
        : null;
    if (!externalId) return null;

    const media: NormalizedMedia[] = [];
    if (item?.thumb) {
        media.push({
            type: "image", url: item.thumb, thumbnailUrl: item.thumb,
            altText: item.name || null, sourceMediaId: null,
            state: classify("image", item.thumb), isPrimary: false,
        });
        summary.images_found += 1;
    }
    for (const url of (item?.images ?? [])) {
        if (typeof url !== "string" || !url) continue;
        if (media.some((m) => m.url === url)) continue;
        media.push({
            type: "image", url, thumbnailUrl: url, altText: item.name || null,
            sourceMediaId: null, state: classify("image", url), isPrimary: false,
        });
        summary.images_found += 1;
    }

    // Defensive video detection (per doc 02 "Video: Do not assume video fields ...").
    for (const f of ["video", "video_url", "videoUrl", "videos"]) {
        const v = item?.[f];
        const urls: string[] = Array.isArray(v) ? v.filter((x) => typeof x === "string") : (typeof v === "string" ? [v] : []);
        for (const url of urls) {
            const state = classify("video", url);
            if (state === "unsupported") continue;
            media.push({
                type: "video", url, thumbnailUrl: null, altText: null,
                sourceMediaId: null, state, isPrimary: false,
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
    const sale = item?.sale_price != null ? Number(item.sale_price) : null;

    return {
        source: "easyorders",
        externalId,
        title: String(item.name),
        description: item?.description || null,
        descriptionHtml: item?.description || null,
        productUrl: null, // doc 03: do not hardcode until confirmed
        price: Number.isFinite(price) ? price : null,
        salePrice: sale && Number.isFinite(sale) ? sale : null,
        currency: null,
        sku: item?.sku || null,
        quantity: typeof item?.quantity === "number" ? item.quantity : null,
        availability: null,
        status: "active",
        primaryMedia: pickPrimary(media),
        media, raw: item,
    };
}
