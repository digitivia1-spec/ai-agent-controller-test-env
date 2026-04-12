/**
 * i18n Loader — loads language JSON files and exposes them as window.LANG_EN / window.LANG_AR.
 *
 * Usage (after migrating off inline dictionaries):
 *   import { loadLanguages } from './src/i18n/loader.js';
 *   await loadLanguages();
 *
 * For now, the inline dictionaries in index.html still take precedence.
 * This module is ready to replace them when the migration is complete.
 */

export async function loadLanguages() {
    const [enModule, arModule] = await Promise.all([
        import('./en.json', { assert: { type: 'json' } }),
        import('./ar.json', { assert: { type: 'json' } }),
    ]);
    window.LANG_EN = enModule.default;
    window.LANG_AR = arModule.default;
}
