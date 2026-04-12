/**
 * Date formatting utilities.
 *
 * These are extracted from the monolithic index.html for reuse and testing.
 * Original locations: formatDate (~line 44127), formatLeadDate (~line 28445)
 */

/**
 * Format a Date object as a relative time string.
 * @param {Date} date
 * @returns {string} e.g. "3 min ago", "2 hrs ago", "Yesterday", "3 days ago", or locale date
 */
export function formatDate(date) {
    if (!date) return '--';
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        if (hours < 1) {
            const mins = Math.floor(diff / (1000 * 60));
            return mins + ' min ago';
        }
        return hours + ' hrs ago';
    } else if (days === 1) {
        return 'Yesterday';
    } else if (days < 7) {
        return days + ' days ago';
    }

    return date.toLocaleDateString();
}

/**
 * Format a date value for lead display (locale-aware).
 * @param {string|Date} value - Date string or Date object
 * @param {string} [lang='en'] - Language code ('en' or 'ar')
 * @returns {string} Formatted date string e.g. "12/31/2024, 03:45 PM"
 */
export function formatLeadDate(value, lang = 'en') {
    if (!value) return '';
    try {
        const date = new Date(value);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (_e) {
        return '';
    }
}
