import { describe, it, expect } from 'vitest';
import { esc, escapeHtmlAttr, getOrgMemberName, getOrgMemberInitials } from '../../src/utils/helpers.js';

describe('esc()', () => {
    it('escapes HTML special characters', () => {
        expect(esc('<script>alert("xss")</script>')).toBe(
            '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        );
    });

    it('escapes ampersands', () => {
        expect(esc('A & B')).toBe('A &amp; B');
    });

    it('escapes single quotes', () => {
        expect(esc("it's")).toBe('it&#39;s');
    });

    it('returns empty string for falsy input', () => {
        expect(esc(null)).toBe('');
        expect(esc(undefined)).toBe('');
        expect(esc('')).toBe('');
    });

    it('converts numbers to string', () => {
        expect(esc(42)).toBe('42');
    });
});

describe('escapeHtmlAttr()', () => {
    it('escapes double quotes for attribute values', () => {
        expect(escapeHtmlAttr('value with "quotes"')).toBe('value with &quot;quotes&quot;');
    });

    it('handles null/undefined', () => {
        expect(escapeHtmlAttr(null)).toBe('');
        expect(escapeHtmlAttr(undefined)).toBe('');
    });

    it('escapes angle brackets', () => {
        expect(escapeHtmlAttr('<tag>')).toBe('&lt;tag&gt;');
    });
});

describe('getOrgMemberName()', () => {
    const mockCache = [
        { user_id: 'u1', full_name: 'John Doe', email: 'john@test.com' },
        { user_id: 'u2', full_name: null, email: 'jane@test.com' },
        { user_id: 'u3', full_name: '', email: '' },
    ];

    it('returns full name when available', () => {
        expect(getOrgMemberName('u1', mockCache)).toBe('John Doe');
    });

    it('falls back to email when no full name', () => {
        expect(getOrgMemberName('u2', mockCache)).toBe('jane@test.com');
    });

    it('returns "Member" when no name or email', () => {
        expect(getOrgMemberName('u3', mockCache)).toBe('Member');
    });

    it('returns empty string for unknown user', () => {
        expect(getOrgMemberName('unknown', mockCache)).toBe('');
    });

    it('returns empty string for null/undefined userId', () => {
        expect(getOrgMemberName(null, mockCache)).toBe('');
        expect(getOrgMemberName(undefined, mockCache)).toBe('');
    });
});

describe('getOrgMemberInitials()', () => {
    const mockCache = [
        { user_id: 'u1', full_name: 'John Doe', email: 'john@test.com' },
        { user_id: 'u2', full_name: 'Alice', email: 'alice@test.com' },
    ];

    it('returns two-letter initials for two-word names', () => {
        expect(getOrgMemberInitials('u1', mockCache)).toBe('JD');
    });

    it('returns single initial for single-word names', () => {
        expect(getOrgMemberInitials('u2', mockCache)).toBe('A');
    });

    it('returns "?" for unknown user', () => {
        expect(getOrgMemberInitials('unknown', mockCache)).toBe('?');
    });
});
