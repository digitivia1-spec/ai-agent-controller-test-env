import { describe, it, expect } from 'vitest';
import { SUPABASE_URL, SUPABASE_KEY, PUSH_VAPID_PUBLIC_KEY, WEBHOOKS } from '../../src/config.js';

describe('Config', () => {
    it('has a valid Supabase URL', () => {
        expect(SUPABASE_URL).toMatch(/^https:\/\/.*\.supabase\.co$/);
    });

    it('has a Supabase anon key (JWT format)', () => {
        expect(SUPABASE_KEY).toMatch(/^eyJ/); // JWT starts with base64-encoded header
        expect(SUPABASE_KEY.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('has a VAPID public key', () => {
        expect(PUSH_VAPID_PUBLIC_KEY).toBeTruthy();
        expect(PUSH_VAPID_PUBLIC_KEY.length).toBeGreaterThan(20);
    });

    it('has all required webhook URLs', () => {
        expect(WEBHOOKS.INSIGHTS).toMatch(/^https:\/\//);
        expect(WEBHOOKS.AI_HELPER).toMatch(/^https:\/\//);
        expect(WEBHOOKS.WEBSITE_CHAT).toMatch(/^https:\/\//);
    });
});
