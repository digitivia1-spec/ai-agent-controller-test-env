import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = join(__dirname, '..', '..', 'index.html');

// Parses an HTTP CSP header / meta `content` value into a directive map.
function parseCsp(value) {
    const map = Object.create(null);
    const parts = value.split(';');
    for (let i = 0; i < parts.length; i++) {
        const trimmed = parts[i].trim();
        if (!trimmed) continue;
        const tokens = trimmed.split(/\s+/);
        const directive = tokens.shift().toLowerCase();
        map[directive] = tokens;
    }
    return map;
}

// Pulls the CSP `content` value out of the meta tag in index.html.
// Anchors on a double-quoted content="..." because the policy value contains
// single-quoted source expressions like 'self' and 'unsafe-inline'.
function extractCspFromIndexHtml() {
    const head = readFileSync(INDEX_HTML, 'utf8').slice(0, 8192);
    const match = head.match(
        /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i
    );
    if (!match) {
        throw new Error('Could not find CSP meta tag in index.html');
    }
    return match[1];
}

describe('Content Security Policy (index.html meta tag)', () => {
    let csp;

    beforeAll(() => {
        csp = parseCsp(extractCspFromIndexHtml());
    });

    it('declares a default-src baseline', () => {
        expect(csp['default-src']).toBeDefined();
        expect(csp['default-src']).toContain("'self'");
    });

    it('allows Supabase Storage signed media URLs (media-src)', () => {
        expect(csp['media-src']).toBeDefined();
        expect(csp['media-src']).toContain('https://*.supabase.co');
    });

    it('allows the notification sound origin (media-src)', () => {
        expect(csp['media-src']).toContain('https://assets.mixkit.co');
    });

    it('allows blob and data media so recorded voice notes can play', () => {
        expect(csp['media-src']).toContain('blob:');
        expect(csp['media-src']).toContain('data:');
    });

    it('allows Supabase REST and Realtime (connect-src http + wss)', () => {
        expect(csp['connect-src']).toContain('https://*.supabase.co');
        expect(csp['connect-src']).toContain('wss://*.supabase.co');
    });

    it('allows Supabase-hosted images (img-src)', () => {
        expect(csp['img-src']).toContain('https://*.supabase.co');
        expect(csp['img-src']).toContain('data:');
        expect(csp['img-src']).toContain('blob:');
    });

    it('allows the Supabase JS client over CDN (script-src)', () => {
        expect(csp['script-src']).toContain('https://cdn.jsdelivr.net');
        expect(csp['script-src']).toContain('https://*.supabase.co');
    });

    it('allows Sentry and PostHog telemetry endpoints (connect-src)', () => {
        expect(csp['connect-src']).toContain('https://*.sentry.io');
        expect(csp['connect-src']).toContain('https://*.ingest.sentry.io');
        expect(csp['connect-src']).toContain('https://*.posthog.com');
    });

    it('allows web workers from blob URLs (worker-src)', () => {
        expect(csp['worker-src']).toContain('blob:');
    });
});
