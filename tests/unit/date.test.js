import { describe, it, expect, vi } from 'vitest';
import { formatDate, formatLeadDate } from '../../src/utils/date.js';

describe('formatDate()', () => {
    it('returns "--" for null/undefined', () => {
        expect(formatDate(null)).toBe('--');
        expect(formatDate(undefined)).toBe('--');
    });

    it('returns "X min ago" for recent dates', () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        expect(formatDate(fiveMinAgo)).toMatch(/5 min ago/);
    });

    it('returns "X hrs ago" for hours-old dates', () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        expect(formatDate(twoHoursAgo)).toBe('2 hrs ago');
    });

    it('returns "Yesterday" for 1-day-old dates', () => {
        const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
        expect(formatDate(yesterday)).toBe('Yesterday');
    });

    it('returns "X days ago" for 2-6 day old dates', () => {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        expect(formatDate(threeDaysAgo)).toBe('3 days ago');
    });

    it('returns locale date string for older dates', () => {
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        const result = formatDate(twoWeeksAgo);
        // Should be a date string, not a relative time
        expect(result).not.toContain('ago');
        expect(result).not.toBe('--');
    });
});

describe('formatLeadDate()', () => {
    it('returns empty string for falsy input', () => {
        expect(formatLeadDate(null)).toBe('');
        expect(formatLeadDate('')).toBe('');
        expect(formatLeadDate(undefined)).toBe('');
    });

    it('returns empty string for invalid date', () => {
        expect(formatLeadDate('not-a-date')).toBe('');
    });

    it('formats a valid date in English', () => {
        const result = formatLeadDate('2024-06-15T14:30:00Z', 'en');
        expect(result).toMatch(/06/);
        expect(result).toMatch(/15/);
        expect(result).toMatch(/2024/);
    });

    it('formats a valid date in Arabic', () => {
        const result = formatLeadDate('2024-06-15T14:30:00Z', 'ar');
        expect(result).toBeTruthy();
        expect(result.length).toBeGreaterThan(0);
    });

    it('defaults to English when no lang specified', () => {
        const result = formatLeadDate('2024-01-01T00:00:00Z');
        expect(result).toMatch(/01/);
        expect(result).toMatch(/2024/);
    });
});
