// Lightweight URL classification. We do NOT do a HEAD fetch in this
// phase (it would balloon sync time on large catalogues); instead we
// classify based on URL shape + extension. The Edge Function callers
// can layer real HEAD validation later without changing the schema.

import type { MediaState, MediaType } from "./normalize.ts";

const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg"];
const VIDEO_EXTS = ["mp4", "webm", "mov", "m4v", "ogv"];
// Hosts whose URLs we accept as valid video even without a direct
// extension (external video / embed-style URLs):
const KNOWN_EXTERNAL_VIDEO_HOSTS = ["youtube.com", "youtu.be", "vimeo.com", "wistia.com"];

function ext(url: string): string {
    try {
        const u = new URL(url);
        const last = u.pathname.split("/").pop() || "";
        const dot = last.lastIndexOf(".");
        if (dot < 0) return "";
        return last.slice(dot + 1).toLowerCase();
    } catch {
        return "";
    }
}

function host(url: string): string {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return "";
    }
}

export function classifyImage(url: string | null | undefined): MediaState {
    if (!url) return "missing";
    if (!/^https?:\/\//i.test(url)) return "unsupported";
    const e = ext(url);
    if (e && !IMAGE_EXTS.includes(e)) return "unsupported";
    return "unverified";
}

export function classifyVideo(url: string | null | undefined): MediaState {
    if (!url) return "missing";
    if (!/^https?:\/\//i.test(url)) return "unsupported";
    const e = ext(url);
    if (e && VIDEO_EXTS.includes(e)) return "unverified";
    if (KNOWN_EXTERNAL_VIDEO_HOSTS.includes(host(url))) return "unverified";
    if (e) return "unsupported";
    return "unverified";
}

export function classify(type: MediaType, url: string | null | undefined): MediaState {
    return type === "video" ? classifyVideo(url) : classifyImage(url);
}

// ----- Gap 3: opt-in HEAD validation --------------------------------------
// Best-effort URL liveness check. Resolves each `unverified` media URL into
// 'valid' / 'broken' / 'unsupported' based on the HEAD response. Limited
// concurrency + per-URL timeout so big catalogues don't drag.

const HEAD_TIMEOUT_MS = 3000;
const HEAD_CONCURRENCY = 5;
const HEAD_MAX_PER_RUN = 200; // hard cap to keep run-time bounded

async function headOne(url: string, expectVideo: boolean): Promise<MediaState> {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), HEAD_TIMEOUT_MS);
        const resp = await fetch(url, { method: "HEAD", signal: ctrl.signal });
        clearTimeout(t);
        if (resp.status === 404 || resp.status === 410 || resp.status >= 500) return "broken";
        if (resp.status === 401 || resp.status === 403) return "broken";
        if (!resp.ok) return "broken";
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        if (expectVideo) {
            if (ct.startsWith("video/")) return "valid";
            // External video hosts (youtube/vimeo) often return text/html on HEAD;
            // we still consider those valid because classifyVideo() already vetted them.
            return ct ? (ct.startsWith("text/") ? "valid" : "unsupported") : "valid";
        }
        if (ct.startsWith("image/")) return "valid";
        if (!ct) return "valid";
        return "unsupported";
    } catch {
        return "broken";
    }
}

interface HeadValidatable {
    type: MediaType;
    url: string | null | undefined;
    state: MediaState;
}

export async function headValidateBatch<T extends HeadValidatable>(items: T[]): Promise<void> {
    const todo: number[] = [];
    for (let i = 0; i < items.length && todo.length < HEAD_MAX_PER_RUN; i++) {
        const it = items[i];
        if (!it.url) continue;
        if (it.state !== "unverified") continue;
        todo.push(i);
    }
    let cursor = 0;
    async function worker() {
        while (cursor < todo.length) {
            const myIdx = cursor++;
            if (myIdx >= todo.length) break;
            const i = todo[myIdx];
            const item = items[i];
            const state = await headOne(item.url!, item.type === "video");
            item.state = state;
        }
    }
    const workers = Array.from({ length: Math.min(HEAD_CONCURRENCY, todo.length) }, () => worker());
    await Promise.all(workers);
}
