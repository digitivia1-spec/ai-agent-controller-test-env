/**
 * General helper utilities.
 *
 * Extracted from index.html for reuse and testing.
 * Original locations: esc (~line 45207), escapeHtmlAttr (~line 35828),
 * getOrgMemberName (~line 28551), getOrgMemberInitials (~line 28556)
 */

/**
 * Escape a string for safe HTML insertion (prevents XSS).
 * @param {string} str
 * @returns {string}
 */
export function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escape a value for use inside an HTML attribute.
 * @param {string} value
 * @returns {string}
 */
export function escapeHtmlAttr(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Get an org member's display name from the cached members list.
 * @param {string} userId
 * @param {Array} [membersCache] - Array of org members (defaults to window.orgMembersCache)
 * @returns {string}
 */
export function getOrgMemberName(userId, membersCache = null) {
    if (!userId) return '';
    const cache = membersCache || (typeof window !== 'undefined' ? window.orgMembersCache : []) || [];
    const m = cache.find((member) => member.user_id === userId);
    return m ? m.full_name || m.email || 'Member' : '';
}

/**
 * Get initials from an org member's name (for avatar chips).
 * @param {string} userId
 * @param {Array} [membersCache]
 * @returns {string} e.g. "JD" for "John Doe"
 */
export function getOrgMemberInitials(userId, membersCache = null) {
    const name = getOrgMemberName(userId, membersCache);
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}
