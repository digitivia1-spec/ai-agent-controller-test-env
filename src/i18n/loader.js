/**
 * i18n Loader — async loader for future migration path.
 *
 * The runtime currently uses a blocking sync-XHR loader inlined in index.html
 * that fetches the same files (see §3 of CLAUDE.md). This module is the
 * async replacement to be used once all call sites that reach into
 * window.LANG_EN / window.LANG_AR are moved onto a t() function that waits
 * for the load promise.
 *
 * Usage:
 *   import { loadLanguages } from '/src/i18n/loader.js';
 *   await loadLanguages();
 */
export async function loadLanguages() {
    const [enResp, arResp] = await Promise.all([
        fetch('/i18n/en.json'),
        fetch('/i18n/ar.json'),
    ]);
    if (!enResp.ok || !arResp.ok) {
        throw new Error('i18n fetch failed: ' + enResp.status + '/' + arResp.status);
    }
    window.LANG_EN = await enResp.json();
    window.LANG_AR = await arResp.json();
}
