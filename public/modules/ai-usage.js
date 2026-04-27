/**
 * AI Usage & Coins Module
 * Tab: #ai-usage  |  Sidebar entry: switchTab('ai-usage', ...)
 *
 * Permissions:
 *   view   → all authenticated members (default)
 *   edit   → requires hasPermission('org.billing')
 *   Both can be overridden by custom roles.
 *
 * Data source: single RPC call to get_coin_status(org_id)
 * Settings save: UPDATE organizations SET low_balance_warning_pct, balance_finished_message
 */
(function () {
  'use strict';

  /* ── constants ─────────────────────────────────────────── */
  const TAB_ID   = 'ai-usage';
  const DRAWER_ID = 'aiu-breakdown-drawer';

  /* ── state ──────────────────────────────────────────────── */
  let _status       = null;   // last fetched get_coin_status result
  let _canEdit      = false;
  let _drawerOpen   = false;

  /* ══════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════ */
  window.loadAiUsageTab = async function () {
    _canEdit = window.hasPermission ? window.hasPermission('org.billing') : false;
    await _fetchAndRender();
    _bindEvents();
  };

  /* ══════════════════════════════════════════════════════════
     DATA
  ══════════════════════════════════════════════════════════ */
  async function _fetchAndRender () {
    const root = document.getElementById('ai-usage-root');
    if (!root || !window.currentUserOrgId) return;

    root.innerHTML = _skeletonHTML();

    try {
      const { data, error } = await supabaseClient.rpc('get_coin_status', {
        p_org_id: window.currentUserOrgId,
      });
      if (error) throw error;
      _status = data || {};
    } catch (e) {
      console.warn('[ai-usage] fetch error', e);
      root.innerHTML = _errorHTML();
      return;
    }

    root.innerHTML = _buildHTML(_status, _canEdit);
    _attachDrawerListeners();
  }

  /* ══════════════════════════════════════════════════════════
     SAVE SETTINGS  (org.billing only)
  ══════════════════════════════════════════════════════════ */
  window.aiuSaveSettings = async function () {
    if (!_canEdit) return;

    const pctInput = document.getElementById('aiu-warning-pct');
    const msgInput = document.getElementById('aiu-finished-msg');
    const btn      = document.getElementById('aiu-save-btn');

    const pct = parseFloat(pctInput?.value ?? 80);
    if (isNaN(pct) || pct < 1 || pct > 99) {
      _showToast(window.t ? window.t('aiUsage.toast_pct_invalid') : 'Warning % must be between 1 and 99.', 'error');
      return;
    }

    btn && (btn.disabled = true);
    btn && (btn.textContent = '…');

    try {
      const { error } = await supabaseClient
        .from('organizations')
        .update({
          low_balance_warning_pct:  pct,
          balance_finished_message: (msgInput?.value ?? '').trim(),
        })
        .eq('id', window.currentUserOrgId);

      if (error) throw error;
      _showToast(window.t ? window.t('aiUsage.toast_saved') : 'Settings saved.', 'success');
      await _fetchAndRender();   // re-render with fresh data
    } catch (e) {
      console.error('[ai-usage] save error', e);
      _showToast(window.t ? window.t('aiUsage.toast_save_error') : 'Could not save. Please try again.', 'error');
    } finally {
      btn && (btn.disabled = false);
      btn && (btn.textContent = window.t ? window.t('aiUsage.btn_save') : 'Save Settings');
    }
  };

  /* ══════════════════════════════════════════════════════════
     DRAWER OPEN / CLOSE
  ══════════════════════════════════════════════════════════ */
  window.aiuToggleBreakdown = function () {
    _drawerOpen = !_drawerOpen;
    const drawer  = document.getElementById(DRAWER_ID);
    const overlay = document.getElementById('aiu-drawer-overlay');
    if (!drawer) return;
    drawer.classList.toggle('open', _drawerOpen);
    overlay && overlay.classList.toggle('active', _drawerOpen);
    document.body.classList.toggle('aiu-drawer-open', _drawerOpen);
  };

  window.aiuCloseBreakdown = function () {
    _drawerOpen = false;
    const drawer  = document.getElementById(DRAWER_ID);
    const overlay = document.getElementById('aiu-drawer-overlay');
    drawer && drawer.classList.remove('open');
    overlay && overlay.classList.remove('active');
    document.body.classList.remove('aiu-drawer-open');
  };

  /* ══════════════════════════════════════════════════════════
     HTML BUILDERS
  ══════════════════════════════════════════════════════════ */
  function _buildHTML (s, canEdit) {
    const used  = +(s.coins_used  ?? 0);
    const total = +(s.coins_total ?? 0);
    const pct   = +(s.coins_pct   ?? 0);
    const isLow      = !!s.is_low_balance;
    const isFinished = !!s.is_balance_finished;
    const planName   = s.plan_name  ?? '—';
    const planSlug   = s.plan_slug  ?? '';
    const convUsed   = +(s.conversations_used ?? 0);
    const warnPct    = +(s.low_balance_warning_pct ?? 80);
    const finMsg     = s.balance_finished_message ?? '';

    const usedText  = +(s.coins_used_text  ?? 0);
    const usedImage = +(s.coins_used_image ?? 0);
    const usedAudio = +(s.coins_used_audio ?? 0);

    /* bar colour */
    const barColor = isFinished
      ? 'var(--error)'
      : isLow
        ? '#f59e0b'
        : 'var(--theme-color)';

    /* plan badge colour */
    const badgeClass = {
      starter: 'aiu-badge--starter',
      growth:  'aiu-badge--growth',
      pro:     'aiu-badge--pro',
      pro_sim: 'aiu-badge--pro',
    }[planSlug] ?? 'aiu-badge--default';

    /* status banner */
    let bannerHTML = '';
    if (isFinished) {
      bannerHTML = `
        <div class="aiu-banner aiu-banner--danger" role="alert">
          <svg class="aiu-banner-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          <div class="aiu-banner-body">
            <strong data-i18n="aiUsage.banner_finished_title">AI Balance Exhausted</strong>
            <span data-i18n="aiUsage.banner_finished_text">Your AI coins are fully used. Replies are paused until you add more coins.</span>
          </div>
          <div class="aiu-banner-actions">
            <button class="aiu-cta-btn aiu-cta-btn--primary" onclick="openPricingModal()" data-i18n="aiUsage.btn_upgrade">Upgrade Plan</button>
          </div>
        </div>`;
    } else if (isLow) {
      bannerHTML = `
        <div class="aiu-banner aiu-banner--warning" role="alert">
          <svg class="aiu-banner-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
          <div class="aiu-banner-body">
            <strong data-i18n="aiUsage.banner_low_title">Low Balance</strong>
            <span data-i18n="aiUsage.banner_low_text">Your AI coins are running low. Consider topping up soon.</span>
          </div>
          <div class="aiu-banner-actions">
            <button class="aiu-cta-btn aiu-cta-btn--warning" onclick="openPricingModal()" data-i18n="aiUsage.btn_buy_coins">Buy More Coins</button>
          </div>
        </div>`;
    }

    /* breakdown bar segments (only show if total > 0) */
    const breakdownBar = total > 0 ? `
      <div class="aiu-type-bar">
        <div class="aiu-type-segment aiu-seg--text"   style="width:${_safePct(usedText,  total)}%" title="Text"></div>
        <div class="aiu-type-segment aiu-seg--image"  style="width:${_safePct(usedImage, total)}%" title="Image"></div>
        <div class="aiu-type-segment aiu-seg--audio"  style="width:${_safePct(usedAudio, total)}%" title="Audio"></div>
      </div>` : '';

    /* settings section — editable or read-only */
    const settingsHTML = canEdit ? `
      <section class="aiu-section" aria-label="AI coin settings">
        <div class="aiu-section-header">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.08-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          <h3 data-i18n="aiUsage.section_settings">AI Coin Settings</h3>
        </div>

        <div class="aiu-field-group">
          <label class="aiu-label" for="aiu-warning-pct" data-i18n="aiUsage.label_warning_pct">Low-balance warning threshold</label>
          <p class="aiu-field-hint" data-i18n="aiUsage.hint_warning_pct">You will be notified when coin usage reaches this percentage. Choose any value between 1 and 99.</p>
          <div class="aiu-pct-row">
            <input
              type="number" id="aiu-warning-pct"
              class="aiu-input aiu-input--short"
              min="1" max="99" step="1"
              value="${_esc(warnPct)}"
              aria-label="Warning percentage"
            >
            <span class="aiu-pct-symbol">%</span>
          </div>
        </div>

        <div class="aiu-field-group">
          <label class="aiu-label" for="aiu-finished-msg" data-i18n="aiUsage.label_finished_msg">Balance-finished message</label>
          <p class="aiu-field-hint" data-i18n="aiUsage.hint_finished_msg">This message is sent to the customer exactly as written when your AI coins run out. Leave empty to send nothing.</p>
          <textarea
            id="aiu-finished-msg"
            class="aiu-input aiu-input--textarea"
            rows="3"
            placeholder="${_esc(window.t ? window.t('aiUsage.placeholder_finished_msg') : 'e.g. Our AI assistant is temporarily unavailable. We will be back shortly.')}"
            aria-label="Balance finished message"
          >${_esc(finMsg)}</textarea>
        </div>

        <div class="aiu-actions-row">
          <button id="aiu-save-btn" class="aiu-save-btn" onclick="aiuSaveSettings()" data-i18n="aiUsage.btn_save">
            Save Settings
          </button>
        </div>
      </section>` : `
      <section class="aiu-section aiu-section--readonly" aria-label="AI coin settings (read only)">
        <div class="aiu-section-header">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.08-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          <h3 data-i18n="aiUsage.section_settings">AI Coin Settings</h3>
        </div>
        <div class="aiu-readonly-note">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
          <span data-i18n="aiUsage.readonly_note">Only organization owners can change these settings.</span>
        </div>
        <div class="aiu-readonly-row">
          <span class="aiu-readonly-label" data-i18n="aiUsage.label_warning_pct">Warning threshold</span>
          <span class="aiu-readonly-value">${_esc(warnPct)}%</span>
        </div>
        <div class="aiu-readonly-row">
          <span class="aiu-readonly-label" data-i18n="aiUsage.label_finished_msg">Finished message</span>
          <span class="aiu-readonly-value">${finMsg ? _esc(finMsg) : `<em style="opacity:.5">${window.t ? window.t('aiUsage.empty_no_message') : 'None — no message will be sent'}</em>`}</span>
        </div>
      </section>`;

    return `
      ${bannerHTML}

      <!-- ── OVERVIEW CARD ─────────────────────────── -->
      <div class="aiu-card glass">
        <div class="aiu-card-header">
          <div class="aiu-plan-info">
            <span class="aiu-badge ${_esc(badgeClass)}">${_esc(planName)}</span>
            <span class="aiu-conv-pill" title="${window.t ? window.t('aiUsage.conversations_tooltip') : 'Conversations used this period'}">
              <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
              ${_fmt(convUsed)}
            </span>
          </div>
          <button class="aiu-refresh-btn" onclick="loadAiUsageTab()" aria-label="Refresh" title="Refresh">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
          </button>
        </div>

        <!-- Coin usage summary -->
        <div class="aiu-summary">
          <div class="aiu-summary-numbers">
            <span class="aiu-used-num">${_fmt(used)}</span>
            <span class="aiu-total-sep">/</span>
            <span class="aiu-total-num">${total > 0 ? _fmt(total) : '—'}</span>
            <span class="aiu-coins-label" data-i18n="aiUsage.label_coins">coins</span>
          </div>
          <span class="aiu-pct-badge ${isFinished ? 'aiu-pct--danger' : isLow ? 'aiu-pct--warn' : ''}">${pct}%</span>
        </div>

        <!-- Progress bar -->
        <div class="aiu-bar-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="aiu-bar-fill" style="width:${Math.min(pct,100)}%; background:${barColor};"></div>
        </div>

        <!-- Stacked type breakdown mini-bar -->
        ${breakdownBar}

        <!-- Breakdown toggle -->
        <button class="aiu-breakdown-toggle" onclick="aiuToggleBreakdown()" aria-expanded="${_drawerOpen}" aria-controls="${DRAWER_ID}">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
          <span data-i18n="aiUsage.btn_breakdown">View usage breakdown</span>
          <svg class="aiu-chevron" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
        </button>
      </div>

      <!-- ── SETTINGS CARD ──────────────────────────── -->
      ${settingsHTML}

      <!-- ── BREAKDOWN DRAWER ───────────────────────── -->
      <div id="aiu-drawer-overlay" class="aiu-drawer-overlay" onclick="aiuCloseBreakdown()"></div>
      <aside id="${DRAWER_ID}" class="aiu-breakdown-drawer glass" role="dialog" aria-label="Usage breakdown" aria-modal="true">
        <div class="aiu-drawer-header">
          <h3 data-i18n="aiUsage.drawer_title">Usage Breakdown</h3>
          <button class="aiu-drawer-close" onclick="aiuCloseBreakdown()" aria-label="Close breakdown">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="aiu-drawer-body">
          <p class="aiu-drawer-hint" data-i18n="aiUsage.drawer_hint">Coins used per AI activity type this billing period.</p>
          ${_buildBreakdownRow('text',  usedText,  used, total, '💬', window.t ? window.t('aiUsage.type_text')  : 'Text replies')}
          ${_buildBreakdownRow('image', usedImage, used, total, '🖼️', window.t ? window.t('aiUsage.type_image') : 'Image understanding')}
          ${_buildBreakdownRow('audio', usedAudio, used, total, '🎙️', window.t ? window.t('aiUsage.type_audio') : 'Audio transcription')}
        </div>
      </aside>
    `;
  }

  function _buildBreakdownRow (type, typeUsed, totalUsed, totalAlloc, icon, label) {
    const pctOfUsed  = totalUsed  > 0 ? Math.round((typeUsed / totalUsed)  * 100) : 0;
    const pctOfTotal = totalAlloc > 0 ? Math.round((typeUsed / totalAlloc) * 100) : 0;
    const colorMap   = { text: 'var(--theme-color)', image: '#a78bfa', audio: '#f59e0b' };
    return `
      <div class="aiu-breakdown-row">
        <div class="aiu-bdr-top">
          <span class="aiu-bdr-icon">${icon}</span>
          <span class="aiu-bdr-label">${_esc(label)}</span>
          <span class="aiu-bdr-coins">${_fmt(typeUsed)} <em data-i18n="aiUsage.label_coins">coins</em></span>
          <span class="aiu-bdr-pct">${pctOfUsed}%</span>
        </div>
        <div class="aiu-bar-track aiu-bar-track--sm">
          <div class="aiu-bar-fill" style="width:${pctOfTotal}%; background:${colorMap[type] ?? 'var(--theme-color)'};"></div>
        </div>
      </div>`;
  }

  function _skeletonHTML () {
    return `<div class="aiu-skeleton">
      <div class="aiu-skel-card glass">
        <div class="aiu-skel-line aiu-skel-line--short"></div>
        <div class="aiu-skel-line aiu-skel-line--tall"></div>
        <div class="aiu-skel-line aiu-skel-line--bar"></div>
      </div>
    </div>`;
  }

  function _errorHTML () {
    return `<div class="aiu-error">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      <p data-i18n="aiUsage.error_load">Could not load usage data. Please refresh.</p>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     HELPERS
  ══════════════════════════════════════════════════════════ */
  function _attachDrawerListeners () {
    /* close drawer on Escape */
    document.addEventListener('keydown', function _esc (e) {
      if (e.key === 'Escape' && _drawerOpen) {
        window.aiuCloseBreakdown();
        document.removeEventListener('keydown', _esc);
      }
    });
  }

  function _bindEvents () {
    /* re-render if tab becomes visible again */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && document.getElementById('ai-usage')?.classList.contains('active')) {
        _fetchAndRender();
      }
    });
  }

  function _safePct (part, total) {
    if (!total || !part) return 0;
    return Math.min(100, Math.round((part / total) * 100));
  }

  function _fmt (n) {
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function _esc (str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _showToast (msg, type = 'info') {
    /* reuse app's existing toast if available */
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
      return;
    }
    /* fallback minimal toast */
    const el = document.createElement('div');
    el.className = `aiu-toast aiu-toast--${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('aiu-toast--visible'));
    setTimeout(() => { el.classList.remove('aiu-toast--visible'); setTimeout(() => el.remove(), 300); }, 3000);
  }

  /* ══════════════════════════════════════════════════════════
     AUTO-LOAD hook  (called by switchTab infrastructure)
  ══════════════════════════════════════════════════════════ */
  const _origSwitchTab = window.switchTab;
  if (typeof _origSwitchTab === 'function') {
    window.switchTab = function (tabId, ...rest) {
      const result = _origSwitchTab(tabId, ...rest);
      if (tabId === TAB_ID) window.loadAiUsageTab();
      return result;
    };
  }

})();
