import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(
    __dirname, '..', '..',
    'supabase', 'migrations',
    '20260426_product_library_phase_a.sql'
);

// Fail-fast guard for the Product Library Phase A migration.
// If anyone removes a table, a check constraint, or the storage bucket
// from this file, this test will catch it before it ships.

describe('Product Library Phase A migration (20260426)', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    // Two normalisers because some assertions need a single-space form
    // (CHECK lists wrap across lines), others need an absolutely
    // whitespace-free form (long quoted lists wrap mid-list).
    const flat = sql.replace(/\s+/g, ' ');
    const compact = sql.replace(/\s+/g, '');

    it('creates the three product-library tables', () => {
        expect(sql).toMatch(/create table if not exists public\.products\s*\(/);
        expect(sql).toMatch(/create table if not exists public\.product_media\s*\(/);
        expect(sql).toMatch(/create table if not exists public\.product_sync_runs\s*\(/);
    });

    it('restricts source values to the 4 canonical sources', () => {
        expect(flat).toContain("source in ('shopify','woocommerce','easyorders','manual')");
    });

    it('restricts product status to active|inactive', () => {
        expect(flat).toContain("status in ('active','inactive')");
    });

    it('restricts media_type to image|video', () => {
        expect(flat).toContain("media_type in ('image','video')");
    });

    it('restricts media state to the 5 canonical states', () => {
        expect(flat).toContain("state in ('valid','missing','broken','unsupported','unverified')");
    });

    it('restricts sync_run status to the 6 canonical statuses', () => {
        expect(compact).toContain("'queued','running','completed','completed_with_warnings','failed','cancelled'");
    });

    it('restricts sync_run trigger to the 5 canonical triggers', () => {
        expect(compact).toContain("'initial_after_credentials_save','credentials_updated','scheduled_every_3_days','manual_retry_after_failure','system_retry'");
    });

    it('enables RLS on every product-library table', () => {
        expect(sql).toMatch(/alter table public\.products\s+enable row level security/);
        expect(sql).toMatch(/alter table public\.product_media\s+enable row level security/);
        expect(sql).toMatch(/alter table public\.product_sync_runs\s+enable row level security/);
    });

    it('creates the product_media private storage bucket', () => {
        expect(sql).toMatch(/insert into storage\.buckets[\s\S]*'product_media'[\s\S]*false/);
    });

    it('uses the existing public.is_org_member helper, not a new variant', () => {
        // Earlier draft tried to redefine is_org_member with a different parameter
        // name; Postgres rejected the migration. Reuse the pre-existing function.
        expect(sql).not.toMatch(/create or replace function public\.is_org_member/);
        expect(sql).toMatch(/public\.is_org_member\(org_id\)/);
    });
});
