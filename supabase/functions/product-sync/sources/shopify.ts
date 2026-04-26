// Shopify Storefront API source adapter.
// Reads creds from external_onboarding_data.integrations.shopify.{shop_domain, storefront_token}.

import type { NormalizedMedia, NormalizedProduct, SyncSummary } from "../normalize.ts";
import { pickPrimary } from "../normalize.ts";
import { classify } from "../media.ts";

const STOREFRONT_API_VERSION = "2026-04";
const PAGE_SIZE = 50;

const PRODUCTS_QUERY = `
query ProductsPage($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    edges {
      cursor
      node {
        id
        title
        handle
        description
        descriptionHtml
        onlineStoreUrl
        availableForSale
        productType
        vendor
        featuredImage { id url altText }
        images(first: 10) { edges { node { id url altText } } }
        media(first: 20) {
          edges {
            node {
              mediaContentType
              alt
              ... on MediaImage {
                id
                image { id url altText }
              }
              ... on Video {
                id
                previewImage { url altText }
                sources { url mimeType format }
              }
              ... on ExternalVideo {
                id
                originUrl
                embeddedUrl
                previewImage { url altText }
              }
            }
          }
        }
        priceRange {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

interface ShopifyCreds {
    shop_domain?: string;
    storefront_token?: string;
}

export async function fetchShopifyProducts(
    creds: ShopifyCreds,
    summary: SyncSummary,
): Promise<NormalizedProduct[]> {
    const shopDomain = (creds.shop_domain || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const token = (creds.storefront_token || "").trim();
    if (!shopDomain || !token) {
        throw new Error("ERR_SHOPIFY_INVALID_TOKEN: missing shop_domain or storefront_token");
    }

    const endpoint = `https://${shopDomain}/api/${STOREFRONT_API_VERSION}/graphql.json`;
    const products: NormalizedProduct[] = [];
    let cursor: string | null = null;
    let safety = 100;

    while (safety-- > 0) {
        const resp = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Storefront-Access-Token": token,
                "Accept": "application/json",
            },
            body: JSON.stringify({ query: PRODUCTS_QUERY, variables: { first: PAGE_SIZE, after: cursor } }),
        });

        if (resp.status === 401 || resp.status === 403) {
            throw new Error(`ERR_SHOPIFY_INVALID_TOKEN: ${resp.status} from Storefront API`);
        }
        if (resp.status === 429) {
            throw new Error("ERR_SHOPIFY_RATE_LIMITED");
        }
        if (!resp.ok) {
            throw new Error(`ERR_SHOPIFY_GRAPHQL_ERROR: status ${resp.status}`);
        }

        const json = await resp.json();
        if (json.errors) {
            throw new Error(`ERR_SHOPIFY_GRAPHQL_ERROR: ${JSON.stringify(json.errors).slice(0, 240)}`);
        }

        const edges = json?.data?.products?.edges ?? [];
        for (const edge of edges) {
            const node = edge.node;
            const np = mapShopifyProduct(node, summary);
            if (np) products.push(np);
        }

        const pageInfo = json?.data?.products?.pageInfo;
        if (!pageInfo?.hasNextPage) break;
        cursor = pageInfo.endCursor;
    }

    summary.products_found += products.length;
    return products;
}

function mapShopifyProduct(node: any, summary: SyncSummary): NormalizedProduct | null {
    if (!node?.id || !node?.title) return null;

    const media: NormalizedMedia[] = [];

    // First, try the media[] connection (images + Video + ExternalVideo)
    const mediaEdges = node?.media?.edges ?? [];
    for (const me of mediaEdges) {
        const n = me.node;
        const contentType: string = n?.mediaContentType || "";
        const alt: string | null = n?.alt || null;
        if (contentType === "IMAGE" && n?.image?.url) {
            const url = n.image.url;
            media.push({
                type: "image",
                url,
                thumbnailUrl: url,
                altText: alt || n.image.altText || null,
                sourceMediaId: n.id,
                state: classify("image", url),
                isPrimary: false,
            });
            summary.images_found += 1;
        } else if (contentType === "VIDEO") {
            const sources: any[] = n?.sources ?? [];
            const mp4 = sources.find((s) => /mp4/i.test(s?.mimeType || s?.format || "")) ?? sources[0];
            if (mp4?.url) {
                media.push({
                    type: "video",
                    url: mp4.url,
                    thumbnailUrl: n?.previewImage?.url || null,
                    altText: alt || n?.previewImage?.altText || null,
                    sourceMediaId: n.id,
                    state: classify("video", mp4.url),
                    isPrimary: false,
                });
                summary.videos_found += 1;
            }
        } else if (contentType === "EXTERNAL_VIDEO") {
            const url = n?.originUrl || n?.embeddedUrl;
            if (url) {
                media.push({
                    type: "video",
                    url,
                    thumbnailUrl: n?.previewImage?.url || null,
                    altText: alt || n?.previewImage?.altText || null,
                    sourceMediaId: n.id,
                    state: classify("video", url),
                    isPrimary: false,
                });
                summary.videos_found += 1;
            }
        }
    }

    // Fallback to images[] / featuredImage if media[] empty (older API or restricted scopes).
    if (!media.length) {
        const featured = node?.featuredImage?.url;
        if (featured) {
            media.push({
                type: "image",
                url: featured,
                thumbnailUrl: featured,
                altText: node.featuredImage?.altText || null,
                sourceMediaId: node.featuredImage?.id || null,
                state: classify("image", featured),
                isPrimary: false,
            });
            summary.images_found += 1;
        }
        for (const ie of (node?.images?.edges ?? [])) {
            const url = ie?.node?.url;
            if (!url) continue;
            media.push({
                type: "image",
                url,
                thumbnailUrl: url,
                altText: ie.node.altText || null,
                sourceMediaId: ie.node.id || null,
                state: classify("image", url),
                isPrimary: false,
            });
            summary.images_found += 1;
        }
    }

    // Tally media states
    for (const m of media) {
        if (m.state === "broken") summary.broken_media_count += 1;
        else if (m.state === "unsupported") summary.unsupported_media_count += 1;
    }
    if (!media.length) summary.missing_media_count += 1;

    const minPrice = Number(node?.priceRange?.minVariantPrice?.amount);
    const currency = node?.priceRange?.minVariantPrice?.currencyCode || null;
    const productUrl = node?.onlineStoreUrl || null;

    return {
        source: "shopify",
        externalId: node.id,
        title: node.title,
        description: node?.description || null,
        descriptionHtml: node?.descriptionHtml || null,
        productUrl,
        price: Number.isFinite(minPrice) ? minPrice : null,
        salePrice: null,
        currency,
        sku: null,
        quantity: null,
        availability: node?.availableForSale === false ? "unavailable" : "available",
        status: "active",
        primaryMedia: pickPrimary(media),
        media,
        raw: node,
    };
}
