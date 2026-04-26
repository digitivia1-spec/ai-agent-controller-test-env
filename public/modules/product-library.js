/* Product Library tab.
 *
 * Pattern: classic-script IIFE, same as the other 14 modules under /modules/.
 * Reads window.* globals (supabaseClient, currentUserOrgId, t, currentLang).
 * Renders into #product-library-root when window.initProductLibraryTab() fires
 * from index.html switchTab('product-library', ...).
 *
 * Phase E scope: status card, filter bar, product grid (image+video aware),
 * empty/partial/failure states. Phase F adds the Add/Edit Manual Product modal.
 */
(function () {
    'use strict';

    let mounted = false;
    let products = [];
    let runs = [];
    let filters = {
        search: '',
        source: 'all',     // all | shopify | woocommerce | easyorders | manual
        status: 'all',     // all | active | inactive
        media: 'all',      // all | has_image | has_video | missing_media | broken_media | unsupported_media
    };

    // ---- i18n shim (uses the project-wide t() via tPL) -----------------
    function tPL(key, replacements) {
        if (typeof window.t !== 'function') return key;
        return window.t(key, replacements || {});
    }

    function rtl() {
        return (window.currentLang === 'ar') || document.documentElement.getAttribute('dir') === 'rtl';
    }

    // ---- Public entry point -------------------------------------------
    window.initProductLibraryTab = async function initProductLibraryTab() {
        const root = document.getElementById('product-library-root');
        if (!root) return;
        if (!mounted) {
            root.innerHTML = renderShell();
            wireFilterEvents(root);
            mounted = true;
        }
        await refresh();
    };

    // ---- Data load -----------------------------------------------------
    async function refresh() {
        const root = document.getElementById('product-library-root');
        if (!root || !window.supabaseClient || !window.currentUserOrgId) return;
        showLoading(root);
        try {
            const [productsRes, runsRes] = await Promise.all([
                window.supabaseClient
                    .from('products')
                    .select('id, source, external_id, title, description, product_url, price, sale_price, currency, status, last_synced_at, product_media(id, media_type, url, thumbnail_url, alt_text, is_primary, state, position)')
                    .eq('org_id', window.currentUserOrgId)
                    .order('last_synced_at', { ascending: false, nullsFirst: false })
                    .limit(500),
                window.supabaseClient
                    .from('product_sync_runs')
                    .select('id, source, status, trigger, summary, error_code, error_message, started_at, finished_at')
                    .eq('org_id', window.currentUserOrgId)
                    .order('started_at', { ascending: false })
                    .limit(20),
            ]);
            products = productsRes.data || [];
            runs = runsRes.data || [];
            renderBody(root);
        } catch (e) {
            console.warn('Product Library refresh failed', e);
            renderErrorState(root, e?.message || String(e));
        }
    }
    window.refreshProductLibrary = refresh;

    // ---- Render: shell (only once) ------------------------------------
    function renderShell() {
        return [
            '<div class="card glass product-library__card">',
            '  <div class="product-library__header">',
            '    <div class="product-library__heading">',
            '      <h2 data-i18n="productLibrary.title">' + esc(tPL('productLibrary.title')) + '</h2>',
            '      <p class="product-library__sub">' + esc(tPL('productLibrary.subtitle')) + '</p>',
            '    </div>',
            '    <div class="product-library__actions">',
            '      <button class="pill-btn primary" id="pl-add-manual" type="button">+ ' + esc(tPL('productLibrary.actions.addManualProduct')) + '</button>',
            '      <button class="pill-btn secondary" id="pl-refresh" type="button">' + esc(tPL('productLibrary.actions.refresh')) + '</button>',
            '    </div>',
            '  </div>',
            '  <div class="product-library__status" id="pl-status"></div>',
            '  <div class="product-library__filters">',
            '    <input type="search" class="product-library__search" id="pl-search" placeholder="' + esc(tPL('productLibrary.filters.searchPlaceholder')) + '" />',
            '    <select id="pl-filter-source" class="product-library__select">',
            '      <option value="all">' + esc(tPL('productLibrary.filters.source.all')) + '</option>',
            '      <option value="shopify">Shopify</option>',
            '      <option value="woocommerce">WooCommerce</option>',
            '      <option value="easyorders">EasyOrders</option>',
            '      <option value="manual">' + esc(tPL('productLibrary.filters.source.manual')) + '</option>',
            '    </select>',
            '    <select id="pl-filter-status" class="product-library__select">',
            '      <option value="all">' + esc(tPL('productLibrary.filters.status.all')) + '</option>',
            '      <option value="active">' + esc(tPL('productLibrary.status.active')) + '</option>',
            '      <option value="inactive">' + esc(tPL('productLibrary.status.inactive')) + '</option>',
            '    </select>',
            '    <select id="pl-filter-media" class="product-library__select">',
            '      <option value="all">' + esc(tPL('productLibrary.filters.media.all')) + '</option>',
            '      <option value="has_image">' + esc(tPL('productLibrary.filters.media.has_image')) + '</option>',
            '      <option value="has_video">' + esc(tPL('productLibrary.filters.media.has_video')) + '</option>',
            '      <option value="missing_media">' + esc(tPL('productLibrary.filters.media.missing_media')) + '</option>',
            '      <option value="broken_media">' + esc(tPL('productLibrary.filters.media.broken_media')) + '</option>',
            '      <option value="unsupported_media">' + esc(tPL('productLibrary.filters.media.unsupported_media')) + '</option>',
            '    </select>',
            '  </div>',
            '  <div class="product-library__grid" id="pl-grid"></div>',
            '</div>',
        ].join('\n');
    }

    function wireFilterEvents(root) {
        root.querySelector('#pl-search').addEventListener('input', (e) => {
            filters.search = e.target.value.trim().toLowerCase();
            renderGrid(root);
        });
        ['source', 'status', 'media'].forEach((kind) => {
            root.querySelector('#pl-filter-' + kind).addEventListener('change', (e) => {
                filters[kind] = e.target.value;
                renderGrid(root);
            });
        });
        root.querySelector('#pl-refresh').addEventListener('click', () => refresh());
        root.querySelector('#pl-add-manual').addEventListener('click', () => {
            // Phase F. Until then, fall back to a friendly notice.
            if (typeof window.openManualProductModal === 'function') {
                window.openManualProductModal(null);
            } else {
                if (typeof window.showToast === 'function') {
                    window.showToast(tPL('manualProduct.coming_soon'), 'info');
                } else {
                    alert(tPL('manualProduct.coming_soon'));
                }
            }
        });
    }

    function showLoading(root) {
        const grid = root.querySelector('#pl-grid');
        if (grid) grid.innerHTML = '<div class="product-library__loading">' + esc(tPL('productLibrary.loading')) + '</div>';
    }

    function renderBody(root) {
        renderStatus(root);
        renderGrid(root);
    }

    function renderErrorState(root, msg) {
        const grid = root.querySelector('#pl-grid');
        if (grid) grid.innerHTML = '<div class="product-library__error">' + esc(tPL('productLibrary.errors.load_failed')) + '<br><small>' + esc(msg) + '</small></div>';
    }

    // ---- Status card ---------------------------------------------------
    function renderStatus(root) {
        const statusEl = root.querySelector('#pl-status');
        if (!statusEl) return;
        if (!runs.length) {
            statusEl.innerHTML = '<div class="product-library__status-card product-library__status-card--neutral">' + esc(tPL('productLibrary.status.no_runs_yet')) + '</div>';
            return;
        }
        // Most recent run per source:
        const latestBySource = {};
        for (const r of runs) {
            if (!latestBySource[r.source]) latestBySource[r.source] = r;
        }
        const cards = Object.values(latestBySource).map((r) => {
            const cls = ({
                completed: 'product-library__status-card--ok',
                completed_with_warnings: 'product-library__status-card--warn',
                failed: 'product-library__status-card--error',
                running: 'product-library__status-card--info',
                queued: 'product-library__status-card--info',
                cancelled: 'product-library__status-card--neutral',
            })[r.status] || 'product-library__status-card--neutral';
            const label = tPL('productLibrary.runStatus.' + r.status) || r.status;
            const summary = r.summary || {};
            const detail = (r.status === 'failed')
                ? esc(r.error_message || r.error_code || '')
                : esc(tPL('productLibrary.summary.detail', {
                    found:   summary.products_found ?? 0,
                    saved:   summary.products_saved ?? 0,
                    images:  summary.images_found ?? 0,
                    videos:  summary.videos_found ?? 0,
                    missing: summary.missing_media_count ?? 0,
                    broken:  summary.broken_media_count ?? 0,
                }));
            const when = r.finished_at || r.started_at;
            const ago = when ? new Date(when).toLocaleString() : '';
            const retryBtn = (r.status === 'failed')
                ? '  <button type="button" class="product-library__retry pill-btn secondary" data-pl-retry="' + esc(r.source) + '">' + esc(tPL('productLibrary.actions.retry')) + '</button>'
                : '';
            return [
                '<div class="product-library__status-card ' + cls + '">',
                '  <div class="product-library__status-source">' + esc(sourceLabel(r.source)) + '</div>',
                '  <div class="product-library__status-state">' + esc(label) + '</div>',
                '  <div class="product-library__status-detail">' + detail + '</div>',
                '  <div class="product-library__status-when">' + esc(ago) + '</div>',
                retryBtn,
                '</div>',
            ].join('');
        });
        statusEl.innerHTML = cards.join('');
        // Gap 4: wire per-source Retry on failed status cards.
        statusEl.querySelectorAll('[data-pl-retry]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const src = btn.getAttribute('data-pl-retry');
                retrySync(src);
            });
        });
    }

    async function retrySync(source) {
        if (!window.supabaseClient || !window.currentUserOrgId) return;
        try {
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            const token = session?.access_token;
            if (!token) return;
            const url = (window.SUPABASE_URL || '') + '/functions/v1/product-sync';
            if (typeof window.showToast === 'function') window.showToast(tPL('productSync.toast.starting'), 'info');
            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token,
                    'apikey': window.SUPABASE_KEY || ''
                },
                body: JSON.stringify({
                    org_id: window.currentUserOrgId,
                    source,
                    trigger: 'manual_retry_after_failure'
                })
            });
            if (!resp.ok) console.warn('retrySync HTTP', resp.status);
            // Refresh after a short pause so the new run row appears.
            setTimeout(refresh, 2500);
        } catch (e) {
            console.warn('retrySync failed', e);
            if (typeof window.showToast === 'function') window.showToast(tPL('productSync.toast.failed'), 'error');
        }
    }

    // ---- Grid ---------------------------------------------------------
    function renderGrid(root) {
        const grid = root.querySelector('#pl-grid');
        if (!grid) return;
        const filtered = applyFilters(products);
        if (!filtered.length) {
            grid.innerHTML = renderEmptyState();
            return;
        }
        grid.innerHTML = filtered.map(renderCard).join('');
        hydrateSignedUrls(grid);
        // Gap 1: wire Edit/Delete on manual product cards.
        grid.querySelectorAll('[data-pl-edit]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-pl-edit');
                const product = products.find((x) => x.id === id);
                if (product) window.openManualProductModal(product);
            });
        });
        grid.querySelectorAll('[data-pl-delete]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.deleteManualProduct(btn.getAttribute('data-pl-delete'));
            });
        });
    }

    function applyFilters(list) {
        return list.filter((p) => {
            if (filters.source !== 'all' && p.source !== filters.source) return false;
            if (filters.status !== 'all' && p.status !== filters.status) return false;
            if (filters.media !== 'all') {
                const hasImage = (p.product_media || []).some((m) => m.media_type === 'image');
                const hasVideo = (p.product_media || []).some((m) => m.media_type === 'video');
                const states  = (p.product_media || []).map((m) => m.state);
                if (filters.media === 'has_image' && !hasImage) return false;
                if (filters.media === 'has_video' && !hasVideo) return false;
                if (filters.media === 'missing_media' && (hasImage || hasVideo)) return false;
                if (filters.media === 'broken_media' && !states.includes('broken')) return false;
                if (filters.media === 'unsupported_media' && !states.includes('unsupported')) return false;
            }
            if (filters.search) {
                const blob = ((p.title || '') + ' ' + (p.description || '')).toLowerCase();
                if (!blob.includes(filters.search)) return false;
            }
            return true;
        });
    }

    function renderEmptyState() {
        // Distinguish "no products at all" vs "filters returned nothing"
        if (!products.length) {
            return [
                '<div class="product-library__empty">',
                '  <h3>' + esc(tPL('productLibrary.empty.title')) + '</h3>',
                '  <p>' + esc(tPL('productLibrary.empty.subtitle')) + '</p>',
                '</div>',
            ].join('');
        }
        return '<div class="product-library__empty">' + esc(tPL('productLibrary.empty.no_match')) + '</div>';
    }

    function renderCard(p) {
        const media = (p.product_media || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
        const primary = media.find((m) => m.is_primary) || media[0] || null;
        const isVideoPrimary = primary && primary.media_type === 'video';
        let preview;
        if (!primary) {
            preview = '<div class="product-card__media product-card__media--missing">' + esc(tPL('productMedia.missing_short')) + '</div>';
        } else if (isVideoPrimary) {
            const thumbAttrs = imgAttrs(primary.thumbnail_url, null, primary.alt_text || p.title);
            preview = thumbAttrs
                ? '<div class="product-card__media"><img ' + thumbAttrs + ' loading="lazy"><span class="product-card__play"></span><span class="product-card__badge">' + esc(tPL('productMedia.type.video')) + '</span></div>'
                : '<div class="product-card__media product-card__media--video-placeholder"><span class="product-card__play"></span><span class="product-card__badge">' + esc(tPL('productMedia.type.video')) + '</span></div>';
        } else {
            const attrs = imgAttrs(primary.url || primary.thumbnail_url, primary.storage_path, primary.alt_text || p.title);
            preview = '<div class="product-card__media"><img ' + (attrs || 'src="" alt=""') + ' loading="lazy"></div>';
        }
        const priceText = formatPrice(p.price, p.currency, p.sale_price);
        const lastSyncTxt = p.last_synced_at
            ? esc(tPL('productLibrary.last_synced', { when: new Date(p.last_synced_at).toLocaleString() }))
            : '';
        const stateBadges = [];
        const allStates = (p.product_media || []).map((m) => m.state);
        if (allStates.includes('broken')) stateBadges.push('<span class="product-card__media-state product-card__media-state--broken">' + esc(tPL('productMedia.state.broken')) + '</span>');
        if (allStates.includes('unsupported')) stateBadges.push('<span class="product-card__media-state product-card__media-state--unsupported">' + esc(tPL('productMedia.state.unsupported')) + '</span>');
        if (!media.length) stateBadges.push('<span class="product-card__media-state product-card__media-state--missing">' + esc(tPL('productMedia.state.missing')) + '</span>');

        return [
            '<article class="product-card" data-product-id="' + esc(p.id) + '">',
            '  ' + preview,
            '  <div class="product-card__body">',
            '    <h4 class="product-card__title" dir="auto">' + esc(p.title || '') + '</h4>',
            '    <div class="product-card__row">',
            '      <span class="product-card__source">' + esc(sourceLabel(p.source)) + '</span>',
            '      <span class="product-card__price">' + esc(priceText) + '</span>',
            '    </div>',
            '    <div class="product-card__row">',
            '      <span class="product-card__status product-card__status--' + esc(p.status) + '">' + esc(tPL('productLibrary.status.' + p.status)) + '</span>',
            '      ' + stateBadges.join(' '),
            '    </div>',
            lastSyncTxt ? '    <div class="product-card__sync">' + lastSyncTxt + '</div>' : '',
            (p.source === 'manual') ? (
                '    <div class="product-card__actions">' +
                '      <button type="button" class="product-card__btn" data-pl-edit="' + esc(p.id) + '">' + esc(tPL('manualProduct.actions.edit')) + '</button>' +
                '      <button type="button" class="product-card__btn product-card__btn--danger" data-pl-delete="' + esc(p.id) + '">' + esc(tPL('manualProduct.actions.delete')) + '</button>' +
                '    </div>'
            ) : '',
            '  </div>',
            '</article>',
        ].filter(Boolean).join('\n');
    }

    // ---- Helpers ------------------------------------------------------
    function sourceLabel(s) {
        if (s === 'shopify') return 'Shopify';
        if (s === 'woocommerce') return 'WooCommerce';
        if (s === 'easyorders') return 'EasyOrders';
        if (s === 'manual') return tPL('productLibrary.filters.source.manual');
        return s || '';
    }

    function formatPrice(price, currency, salePrice) {
        if (price == null) return '';
        const display = salePrice != null && Number(salePrice) > 0 ? salePrice : price;
        try {
            return new Intl.NumberFormat(window.currentLang === 'ar' ? 'ar-EG' : 'en-US', {
                style: currency ? 'currency' : 'decimal',
                currency: currency || undefined,
                maximumFractionDigits: 2,
            }).format(Number(display));
        } catch {
            return String(display) + (currency ? ' ' + currency : '');
        }
    }


    // Build src/data-storage-path/alt attrs for an <img>.
    // - If we have a remote URL, use it directly.
    // - If we only have a storage_path (private bucket upload), defer src and let
    //   hydrateSignedUrls() fetch a short-lived signed URL after render.
    function imgAttrs(url, storagePath, alt) {
        const altAttr = ' alt="' + esc(alt || '') + '"';
        if (url) return 'src="' + esc(url) + '"' + altAttr;
        if (storagePath) return 'src="" data-storage-path="' + esc(storagePath) + '"' + altAttr;
        return '';
    }

    // After grid render, replace placeholder src on any <img data-storage-path>
    // with a signed URL from the product_media bucket. Best-effort, errors ignored.
    async function hydrateSignedUrls(root) {
        if (!window.supabaseClient) return;
        const placeholders = root.querySelectorAll('img[data-storage-path]');
        await Promise.all(Array.from(placeholders).map(async (img) => {
            const path = img.getAttribute('data-storage-path');
            if (!path) return;
            try {
                const { data } = await window.supabaseClient.storage
                    .from('product_media')
                    .createSignedUrl(path, 60 * 60);
                if (data && data.signedUrl) img.src = data.signedUrl;
            } catch (e) {
                console.warn('signed url failed for', path, e?.message || e);
            } finally {
                img.removeAttribute('data-storage-path');
            }
        }));
    }

    function esc(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    // ===== Phase F: Manual Product modal ===========================================
    // Mounts on demand; one modal node lives at the bottom of <body>.
    // Fields: title (required), price (required), status (active|inactive),
    // description, product_url, plus a four-button media chooser
    // (upload image / image URL / upload video / video URL).
    let modalRoot = null;
    let manualMedia = []; // [{ type, mode:'upload'|'url', file?, url?, previewUrl? }]

    // ---- Gap 1: edit support --------------------------------------------
    // editingProduct is null for "Add" mode, or a product row (with product_media)
    // when the modal is opened in edit mode. saveManualProduct() branches on it.
    let editingProduct = null;

    window.openManualProductModal = function openManualProductModal(product) {
        ensureModalDom();
        editingProduct = product || null;
        manualMedia = [];
        resetManualForm();
        if (editingProduct) prefillFromProduct(editingProduct);
        // Title swap: Add vs Edit
        const titleEl = modalRoot.querySelector('#mp-modal-title');
        if (titleEl) titleEl.textContent = editingProduct
            ? tPL('manualProduct.modal.editTitle')
            : tPL('manualProduct.modal.title');
        modalRoot.style.display = 'flex';
        const focusEl = modalRoot.querySelector('#mp-title');
        if (focusEl) focusEl.focus();
    };

    function prefillFromProduct(p) {
        modalRoot.querySelector('#mp-title').value = p.title || '';
        modalRoot.querySelector('#mp-price').value = p.price != null ? p.price : '';
        modalRoot.querySelector('#mp-currency').value = p.currency || defaultCurrency() || '';
        modalRoot.querySelector('#mp-description').value = p.description || '';
        modalRoot.querySelector('#mp-product-url').value = p.product_url || '';
        const status = p.status === 'inactive' ? 'inactive' : 'active';
        const radio = modalRoot.querySelector('input[name="mp-status"][value="' + status + '"]');
        if (radio) radio.checked = true;
        // Pre-populate manualMedia from existing product_media (URL-mode only;
        // existing storage_path uploads aren't re-editable, just visible).
        manualMedia = (p.product_media || []).map((m) => ({
            type: m.media_type,
            mode: m.storage_path ? 'existing' : 'url',
            url: m.url || '',
            existing_id: m.id,
            storage_path: m.storage_path || null,
        }));
        renderMediaList();
    }

    // Read default currency from the org's onboarding business profile.
    // Falls back to USD per plan section 6 question 1.
    function defaultCurrency() {
        try {
            return window.currentOrgData?.external_onboarding_data?.business?.currency
                || window.currentOrgData?.external_onboarding_data?.business?.preferred_currency
                || '';
        } catch { return ''; }
    }

    function closeManualModal() {
        if (modalRoot) modalRoot.style.display = 'none';
    }

    function ensureModalDom() {
        if (modalRoot) return;
        modalRoot = document.createElement('div');
        modalRoot.id = 'manual-product-modal';
        modalRoot.className = 'mp-modal';
        modalRoot.setAttribute('role', 'dialog');
        modalRoot.setAttribute('aria-modal', 'true');
        modalRoot.setAttribute('aria-labelledby', 'mp-modal-title');
        modalRoot.style.display = 'none';
        modalRoot.innerHTML = renderManualModal();
        document.body.appendChild(modalRoot);
        wireManualModalEvents();
    }

    function renderManualModal() {
        return [
            '<div class="mp-modal__backdrop" data-mp-close></div>',
            '<div class="mp-modal__panel">',
            '  <header class="mp-modal__head">',
            '    <h3 id="mp-modal-title">' + esc(tPL('manualProduct.modal.title')) + '</h3>',
            '    <button type="button" class="mp-modal__close" data-mp-close aria-label="' + esc(tPL('manualProduct.modal.close')) + '">&times;</button>',
            '  </header>',
            '  <form class="mp-modal__form" id="mp-form" novalidate>',
            '    <label class="mp-field">',
            '      <span class="mp-field__label">' + esc(tPL('manualProduct.field.title')) + ' <span class="mp-required">*</span></span>',
            '      <input type="text" id="mp-title" maxlength="240" required dir="auto" />',
            '      <span class="mp-err" data-mp-err="title"></span>',
            '    </label>',
            '    <div class="mp-row">',
            '      <label class="mp-field">',
            '        <span class="mp-field__label">' + esc(tPL('manualProduct.field.price')) + ' <span class="mp-required">*</span></span>',
            '        <input type="number" id="mp-price" min="0" step="0.01" required />',
            '        <span class="mp-err" data-mp-err="price"></span>',
            '      </label>',
            '      <label class="mp-field">',
            '        <span class="mp-field__label">' + esc(tPL('manualProduct.field.currency')) + '</span>',
            '        <input type="text" id="mp-currency" maxlength="6" placeholder="USD" />',
            '      </label>',
            '    </div>',
            '    <fieldset class="mp-field mp-status">',
            '      <legend class="mp-field__label">' + esc(tPL('manualProduct.field.status')) + '</legend>',
            '      <label class="mp-radio"><input type="radio" name="mp-status" value="active" checked> ' + esc(tPL('productLibrary.status.active')) + '</label>',
            '      <label class="mp-radio"><input type="radio" name="mp-status" value="inactive"> ' + esc(tPL('productLibrary.status.inactive')) + '</label>',
            '    </fieldset>',
            '    <label class="mp-field">',
            '      <span class="mp-field__label">' + esc(tPL('manualProduct.field.description')) + '</span>',
            '      <textarea id="mp-description" maxlength="2000" rows="3" dir="auto"></textarea>',
            '    </label>',
            '    <label class="mp-field">',
            '      <span class="mp-field__label">' + esc(tPL('manualProduct.field.product_url')) + '</span>',
            '      <input type="url" id="mp-product-url" placeholder="https://..." />',
            '    </label>',
            '    <fieldset class="mp-field mp-media">',
            '      <legend class="mp-field__label">' + esc(tPL('manualProduct.field.media')) + ' <span class="mp-required">*</span></legend>',
            '      <div class="mp-media-actions">',
            '        <button type="button" class="pill-btn secondary" data-mp-add="image-upload">' + esc(tPL('manualProduct.media.upload_image')) + '</button>',
            '        <button type="button" class="pill-btn secondary" data-mp-add="image-url">' + esc(tPL('manualProduct.media.url_image')) + '</button>',
            '        <button type="button" class="pill-btn secondary" data-mp-add="video-upload">' + esc(tPL('manualProduct.media.upload_video')) + '</button>',
            '        <button type="button" class="pill-btn secondary" data-mp-add="video-url">' + esc(tPL('manualProduct.media.url_video')) + '</button>',
            '      </div>',
            '      <p class="mp-help">' + esc(tPL('manualProduct.media.helper_image')) + '</p>',
            '      <p class="mp-help">' + esc(tPL('manualProduct.media.helper_video')) + '</p>',
            '      <div id="mp-media-list" class="mp-media-list"></div>',
            '      <input type="file" id="mp-file-input" accept="image/*,video/*" hidden />',
            '      <span class="mp-err" data-mp-err="media"></span>',
            '    </fieldset>',
            '    <footer class="mp-modal__foot">',
            '      <button type="button" class="pill-btn secondary" data-mp-close>' + esc(tPL('manualProduct.modal.cancel')) + '</button>',
            '      <button type="submit" class="pill-btn primary" id="mp-save">' + esc(tPL('manualProduct.modal.save')) + '</button>',
            '    </footer>',
            '  </form>',
            '</div>',
        ].join('\n');
    }

    function wireManualModalEvents() {
        modalRoot.addEventListener('click', (e) => {
            if (e.target.matches('[data-mp-close]')) closeManualModal();
        });
        modalRoot.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeManualModal();
        });
        // Media chooser buttons
        modalRoot.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-mp-add]');
            if (!btn) return;
            const choice = btn.getAttribute('data-mp-add');
            handleMediaChoice(choice);
        });
        // File input -> upload entry
        const fileInput = modalRoot.querySelector('#mp-file-input');
        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            const expectVideo = fileInput.dataset.expect === 'video';
            const isVideo = (file.type || '').startsWith('video/') || expectVideo;
            const previewUrl = URL.createObjectURL(file);
            manualMedia.push({ type: isVideo ? 'video' : 'image', mode: 'upload', file, previewUrl });
            renderMediaList();
            fileInput.value = '';
        });
        modalRoot.querySelector('#mp-form').addEventListener('submit', (e) => {
            e.preventDefault();
            saveManualProduct().catch((err) => {
                console.error('saveManualProduct failed', err);
                if (typeof window.showToast === 'function') window.showToast(tPL('manualProduct.error.save_failed'), 'error');
            });
        });
    }

    function handleMediaChoice(choice) {
        const fileInput = modalRoot.querySelector('#mp-file-input');
        if (choice === 'image-upload') {
            fileInput.dataset.expect = 'image';
            fileInput.accept = 'image/*';
            fileInput.click();
        } else if (choice === 'video-upload') {
            fileInput.dataset.expect = 'video';
            fileInput.accept = 'video/*';
            fileInput.click();
        } else if (choice === 'image-url' || choice === 'video-url') {
            const isVideo = choice === 'video-url';
            const promptMsg = isVideo ? tPL('manualProduct.media.prompt_video_url') : tPL('manualProduct.media.prompt_image_url');
            const url = window.prompt(promptMsg);
            if (!url || !/^https?:\/\//i.test(url)) return;
            manualMedia.push({ type: isVideo ? 'video' : 'image', mode: 'url', url });
            renderMediaList();
        }
    }

    function renderMediaList() {
        const list = modalRoot.querySelector('#mp-media-list');
        if (!manualMedia.length) {
            list.innerHTML = '<div class="mp-media-empty">' + esc(tPL('manualProduct.media.none_yet')) + '</div>';
            return;
        }
        list.innerHTML = manualMedia.map((m, idx) => {
            const label = m.mode === 'upload' ? esc(m.file.name) : esc(m.url);
            const typeBadge = esc(tPL('productMedia.type.' + m.type));
            return [
                '<div class="mp-media-item">',
                '  <span class="mp-media-item__type">' + typeBadge + '</span>',
                '  <span class="mp-media-item__label" dir="ltr">' + label + '</span>',
                '  <button type="button" class="mp-media-item__remove" data-mp-remove="' + idx + '" aria-label="' + esc(tPL('manualProduct.media.remove')) + '">&times;</button>',
                '</div>',
            ].join('');
        }).join('');
        list.querySelectorAll('[data-mp-remove]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const i = Number(btn.dataset.mpRemove);
                const removed = manualMedia.splice(i, 1)[0];
                if (removed && removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
                renderMediaList();
            });
        });
    }

    function resetManualForm() {
        if (!modalRoot) return;
        const f = modalRoot.querySelector('#mp-form');
        if (f) f.reset();
        modalRoot.querySelectorAll('[data-mp-err]').forEach((el) => { el.textContent = ''; });
        // Gap 5: currency auto-default
        const ccyEl = modalRoot.querySelector('#mp-currency');
        if (ccyEl && !editingProduct) ccyEl.value = defaultCurrency() || '';
        renderMediaList();
    }

    async function saveManualProduct() {
        if (!window.supabaseClient || !window.currentUserOrgId) {
            if (typeof window.showToast === 'function') window.showToast(tPL('manualProduct.error.not_signed_in'), 'error');
            return;
        }
        const title       = modalRoot.querySelector('#mp-title').value.trim();
        const priceRaw    = modalRoot.querySelector('#mp-price').value.trim();
        const currency    = modalRoot.querySelector('#mp-currency').value.trim().toUpperCase() || null;
        const status      = (modalRoot.querySelector('input[name="mp-status"]:checked') || {}).value || 'active';
        const description = modalRoot.querySelector('#mp-description').value.trim() || null;
        const productUrl  = modalRoot.querySelector('#mp-product-url').value.trim() || null;

        // ---- Validate ----
        let ok = true;
        const setErr = (key, msg) => {
            const el = modalRoot.querySelector('[data-mp-err="' + key + '"]');
            if (el) el.textContent = msg || '';
            if (msg) ok = false;
        };
        setErr('title', null); setErr('price', null); setErr('media', null);
        if (!title) setErr('title', tPL('manualProduct.validation.titleRequired'));
        const price = Number(priceRaw);
        if (!priceRaw || !Number.isFinite(price) || price < 0) setErr('price', tPL('manualProduct.validation.priceRequired'));
        if (!manualMedia.length) setErr('media', tPL('manualProduct.validation.mediaRequired'));
        if (!ok) return;

        const saveBtn = modalRoot.querySelector('#mp-save');
        saveBtn.disabled = true;
        saveBtn.textContent = tPL('manualProduct.modal.saving');

        try {
            const productPayload = {
                org_id: window.currentUserOrgId,
                source: 'manual',
                external_id: null,
                title,
                description,
                description_html: null,
                product_url: productUrl,
                price,
                currency,
                status,
                last_synced_at: null,
            };

            let productId;
            if (editingProduct?.id) {
                // ---- UPDATE path (Gap 1) ----
                const { error: updErr } = await window.supabaseClient
                    .from('products')
                    .update(productPayload)
                    .eq('id', editingProduct.id);
                if (updErr) throw updErr;
                productId = editingProduct.id;
                // Replace media: drop existing rows, then insert fresh ones below.
                const { error: delErr } = await window.supabaseClient
                    .from('product_media').delete().eq('product_id', productId);
                if (delErr) throw delErr;
            } else {
                const { data: insertedProduct, error: prodErr } = await window.supabaseClient
                    .from('products').insert(productPayload).select('id').single();
                if (prodErr) throw prodErr;
                productId = insertedProduct.id;
            }

            // 2) For each media entry: upload (if file) + insert product_media row.
            //    'existing' entries (storage_path from prior uploads) are preserved by
            //    re-inserting their storage_path; url-mode entries write the URL; upload-mode
            //    uploads then writes the path.
            const rows = [];
            for (let i = 0; i < manualMedia.length; i++) {
                const m = manualMedia[i];
                let url = m.url || null;
                let storagePath = m.storage_path || null;
                if (m.mode === 'upload' && m.file) {
                    const safeName = m.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                    const ts = Date.now();
                    storagePath = window.currentUserOrgId + '/manual/' + ts + '_' + i + '_' + safeName;
                    const { error: upErr } = await window.supabaseClient.storage
                        .from('product_media')
                        .upload(storagePath, m.file, { upsert: false, contentType: m.file.type });
                    if (upErr) throw upErr;
                    url = null; // private bucket -> hydrate via signed URL at render time
                }
                rows.push({
                    product_id: productId,
                    org_id: window.currentUserOrgId,
                    media_type: m.type,
                    url,
                    thumbnail_url: null,
                    storage_path: storagePath,
                    alt_text: title,
                    source_media_id: null,
                    is_primary: i === 0,
                    state: 'unverified',
                    position: i,
                });
            }
            if (rows.length) {
                const { error: mediaErr } = await window.supabaseClient.from('product_media').insert(rows);
                if (mediaErr) throw mediaErr;
            }

            // Free preview blobs
            manualMedia.forEach((m) => { if (m.previewUrl) URL.revokeObjectURL(m.previewUrl); });
            manualMedia = [];

            closeManualModal();
            const successKey = editingProduct ? 'manualProduct.success_updated' : 'manualProduct.success';
            if (typeof window.showToast === 'function') window.showToast(tPL(successKey), 'success');
            await refresh();
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = tPL('manualProduct.modal.save');
        }
    }

    // ---- Gap 1: deleteManualProduct -------------------------------------
    window.deleteManualProduct = async function deleteManualProduct(productId) {
        if (!productId || !window.supabaseClient) return;
        if (!window.confirm(tPL('manualProduct.delete_confirm'))) return;
        try {
            const { error } = await window.supabaseClient
                .from('products').delete().eq('id', productId);
            if (error) throw error;
            if (typeof window.showToast === 'function') window.showToast(tPL('manualProduct.success_deleted'), 'success');
            await refresh();
        } catch (e) {
            console.warn('deleteManualProduct failed', e);
            if (typeof window.showToast === 'function') window.showToast(tPL('manualProduct.error.delete_failed'), 'error');
        }
    };

})();
