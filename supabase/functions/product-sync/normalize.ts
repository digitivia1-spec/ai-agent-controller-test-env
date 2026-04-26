// Shared types + the normalised importer contract from
// docs/product_sync_full_ready_reference_pack/09 section 16.
// Importer-side type only -- DO NOT assume these are DB column names.

export type Source = "shopify" | "woocommerce" | "easyorders";
export type MediaType = "image" | "video";
export type MediaState = "valid" | "missing" | "broken" | "unsupported" | "unverified";
export type ProductStatus = "active" | "inactive";

export interface NormalizedMedia {
    type: MediaType;
    url: string | null;
    thumbnailUrl?: string | null;
    altText?: string | null;
    sourceMediaId?: string | null;
    state: MediaState;
    isPrimary: boolean;
}

export interface NormalizedProduct {
    source: Source | "manual";
    externalId: string;
    title: string;
    description?: string | null;
    descriptionHtml?: string | null;
    productUrl?: string | null;
    price?: number | null;
    salePrice?: number | null;
    currency?: string | null;
    sku?: string | null;
    quantity?: number | null;
    availability?: string | null;
    status: ProductStatus;
    primaryMedia?: NormalizedMedia | null;
    media: NormalizedMedia[];
    raw?: unknown;
}

export interface SyncSummary {
    products_found: number;
    products_created: number;
    products_updated: number;
    products_saved: number;
    products_skipped: number;
    images_found: number;
    videos_found: number;
    missing_media_count: number;
    broken_media_count: number;
    unsupported_media_count: number;
    errors_count: number;
    warnings_count: number;
    started_at: string;
    finished_at?: string;
    duration_ms?: number;
}

export function emptySummary(): SyncSummary {
    return {
        products_found: 0,
        products_created: 0,
        products_updated: 0,
        products_saved: 0,
        products_skipped: 0,
        images_found: 0,
        videos_found: 0,
        missing_media_count: 0,
        broken_media_count: 0,
        unsupported_media_count: 0,
        errors_count: 0,
        warnings_count: 0,
        started_at: new Date().toISOString(),
    };
}

// Pick the primary media item using the rule from doc 08:
//   1. Existing primary (caller-side concern; we don't preserve here)
//   2. Source featured image -> first image
//   3. Source video if no image
//   4. First valid media item
//   5. null (caller marks missing)
export function pickPrimary(media: NormalizedMedia[]): NormalizedMedia | null {
    if (!media.length) return null;
    const firstImage = media.find((m) => m.type === "image" && (m.state === "valid" || m.state === "unverified"));
    if (firstImage) return { ...firstImage, isPrimary: true };
    const firstVideo = media.find((m) => m.type === "video" && (m.state === "valid" || m.state === "unverified"));
    if (firstVideo) return { ...firstVideo, isPrimary: true };
    return { ...media[0], isPrimary: true };
}
