(function() {
    'use strict';
    // ============================================================
    //   META CONNECT MODULE
    //   Created 2026-04-27 from the "Meta Preview Prompts" set:
    //     - Prompt 2: WhatsApp Embedded Signup connect-modal polish
    //                 (step indicator, tooltip captions, access-granted
    //                  card, template proof panel, screencast banner).
    //     - Prompt 3: Messenger + Instagram channel connect cards inside
    //                 their existing agent tabs.
    //
    //   Self-contained classic script. Does NOT modify any existing
    //   render function in index.html; instead it observes the DOM and
    //   wraps `window.startWhatsAppEmbeddedSignup` to inject cosmetic
    //   pieces. Reads window.SUPABASE_URL / window.SUPABASE_KEY /
    //   window.supabaseClient / window.currentUserOrgId / window.t /
    //   window.showToast / window.FB - all already in scope by the time
    //   this script runs (loaded after the main app script).
    // ============================================================

    const SUPA = () => window.SUPABASE_URL || '';
    const KEY  = () => window.SUPABASE_KEY || '';
    const META_TOKEN_URL = () => `${SUPA()}/functions/v1/meta-token-manager`;
    const TEMPLATES_URL  = () => `${SUPA()}/functions/v1/list-waba-templates`;
    const t = (k) => (typeof window.t === 'function' ? window.t(k) : k);
    const tr = (k, fallback) => {
        const v = t(k);
        return (!v || v === k) ? fallback : v;
    };
    const toast = (msg, kind) => (typeof window.showToast === 'function'
        ? window.showToast(msg, kind)
        : console.log(`[toast:${kind || 'info'}] ${msg}`));

    // ----- shared FB token helper (Prompt 3) -----
    window.getOrRefreshMetaToken = async function(requiredScopes) {
        // Wait for the FB SDK if it's still loading -- the SDK is loaded
        // by initWhatsAppEmbeddedSignup in index.html, exposed globally
        // as window.ensureFbSdk. Without this await, clicking Connect
        // Facebook Page or Connect Instagram before the WhatsApp modal
        // is ever opened reliably hits "Facebook SDK not ready".
        if (typeof window.ensureFbSdk === 'function') {
            try { await window.ensureFbSdk(); } catch (_) { /* fall through */ }
        }
        const existing = window.FB && window.FB.getAuthResponse && window.FB.getAuthResponse();
        if (existing && existing.accessToken && existing.expiresIn > 0) return existing.accessToken;
        return new Promise((resolve, reject) => {
            if (!window.FB) return reject(new Error(tr('meta_connect.fb_sdk_not_ready', 'Facebook SDK not ready. Please try again.')));
            window.FB.login(function(response) {
                if (response && response.authResponse && response.authResponse.accessToken) {
                    resolve(response.authResponse.accessToken);
                } else {
                    reject(new Error(tr('meta_connect.fb_login_cancelled', 'Facebook login was cancelled or failed.')));
                }
            }, { scope: (requiredScopes || []).join(',') });
        });
    };

    async function getSessionAuthHeaders() {
        const headers = { 'Content-Type': 'application/json', 'apikey': KEY() };
        try {
            const session = (await window.supabaseClient.auth.getSession()).data.session;
            if (session && session.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
        } catch (e) {
            console.warn('[meta-connect] no session', e);
        }
        return headers;
    }

    // ============================================================
    //   WHATSAPP CONNECT MODAL POLISH (Prompt 2)
    // ============================================================

    function detectWaState(body) {
        const badge = body.querySelector('.wa-connect-status-badge');
        if (!badge || !badge.classList) return 'disconnected';
        // Use exact classList tokens so a future class like 'not-connected'
        // or 'half-connected' does not get misclassified.
        if (badge.classList.contains('connected'))               return 'connected';
        if (badge.classList.contains('onboarding_complete'))     return 'onboarding_complete';
        if (badge.classList.contains('onboarding_in_progress'))  return 'onboarding_in_progress';
        if (badge.classList.contains('disconnected'))            return 'disconnected';
        return 'disconnected';
    }

    // ADDITION 1 — STEP INDICATOR
    function injectStepIndicator(body, vState) {
        if (body.querySelector('.wa-step-indicator')) return;
        const activeIdx = vState === 'connected' ? 2 : (vState === 'onboarding_complete' ? 1 : 0);
        const labels = [
            tr('whatsapp_connect.step_login',   'Meta Login'),
            tr('whatsapp_connect.step_grant',   'Grant Access'),
            tr('whatsapp_connect.step_confirm', 'Confirm Connection'),
        ];
        const segs = labels.map((label, i) => {
            const isActive = i === activeIdx;
            const isDone = i < activeIdx;
            const bg = isActive ? 'var(--theme-color, #57b078)'
                     : isDone   ? 'rgba(87,176,120,0.55)'
                                : 'rgba(255,255,255,0.15)';
            const color = (isActive || isDone) ? '#fff' : 'rgba(255,255,255,0.6)';
            return `<div style="flex:1;display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;font-size:0.72rem;font-weight:600;color:${color};background:${bg};">
                <span style="opacity:.8;">${i + 1}</span><span>${label}</span>
            </div>`;
        }).join('<div style="flex:0 0 14px;height:1px;background:rgba(255,255,255,0.15);"></div>');
        const html = `<div class="wa-step-indicator" style="display:flex;align-items:center;gap:6px;margin-bottom:14px;">${segs}</div>`;
        body.insertAdjacentHTML('afterbegin', html);
    }

    // ADDITION 2 — TOOLTIP CAPTIONS
    // Match buttons by either inline onclick (current state of the file)
    // or visible text (future-proof: if buttons migrate to addEventListener
    // the tooltips still attach).
    function injectTooltips(body) {
        const tipContinue   = tr('whatsapp_connect.tip_continue',  'Opens Meta login. You will be asked to grant WhatsApp Business access to Digitivia.');
        const tipReconnect  = tr('whatsapp_connect.tip_reconnect', 'Re-opens Meta login to refresh your WhatsApp Business connection.');
        const tipClear      = tr('whatsapp_connect.tip_clear',     'Resets stored connection data. Use only if you want to start over from scratch.');
        const tipCopy       = tr('whatsapp_connect.tip_copy',      'Copies the raw connection payload to clipboard for debugging.');
        const tipSettings   = tr('whatsapp_connect.tip_settings',  'View or update your connected WhatsApp Business Account settings.');

        const matchers = [
            { onclick: /startWhatsAppEmbeddedSignup/,         text: /continue with facebook|reconnect|run onboarding/i, getTitle: (t) => /reconnect|onboarding/i.test(t) ? tipReconnect : tipContinue },
            { onclick: /clearSavedWhatsAppConnectionState/,   text: /clear state|clear saved/i,                          getTitle: () => tipClear },
            { onclick: /copyWhatsAppConnectionJson/,          text: /copy json/i,                                         getTitle: () => tipCopy },
        ];

        body.querySelectorAll('button').forEach((btn) => {
            if (btn.title) return;
            const onclickAttr = btn.getAttribute('onclick') || '';
            const txt = (btn.textContent || '').trim();
            for (const m of matchers) {
                if (m.onclick.test(onclickAttr) || m.text.test(txt)) {
                    btn.title = m.getTitle(txt);
                    break;
                }
            }
        });
        body.querySelectorAll('.wa-header-btn-secondary').forEach((b) => {
            if (!b.title) b.title = tipSettings;
        });
    }

    // ADDITION 4 — TEMPLATE PROOF PANEL
    function injectTemplatesPanel(body, vState) {
        if (vState !== 'connected') return;
        if (body.querySelector('#wa-templates-panel')) return;
        // Pull the WABA / phone proofs straight from the rendered DOM
        const proofRow = body.querySelector('.wa-connect-proof, .wa-proof-cards, .wa-connect-meta-grid');
        const wabaText = (() => {
            const m = body.innerText.match(/WABA ID[\s\S]{0,40}?([0-9]{6,})/);
            return m ? m[1] : '';
        })();
        const phoneText = (() => {
            const m = body.innerText.match(/(\+\d[\d \-]{6,})/);
            return m ? m[1].trim() : '';
        })();

        const safeWaba = String(wabaText || '').replace(/"/g, '&quot;');
        const html = `
          <div id="wa-templates-panel" data-waba-id="${safeWaba}" style="margin-top:16px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);padding:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px;">
              <div>
                <div style="font-size:0.82rem;color:var(--text-secondary);">${tr('whatsapp_connect.label_waba_id', 'WABA ID')}</div>
                <div style="font-size:0.88rem;font-weight:600;color:var(--text-primary);">${wabaText || '—'}</div>
              </div>
              <div>
                <div style="font-size:0.82rem;color:var(--text-secondary);">${tr('whatsapp_connect.label_phone', 'Phone Number')}</div>
                <div style="font-size:0.88rem;font-weight:600;color:var(--text-primary);">${phoneText || '—'}</div>
              </div>
            </div>
            <button id="wa-view-templates-btn" class="lp-btn lp-btn-outline"
              title="${tr('whatsapp_connect.tip_templates', 'Fetches your approved WhatsApp message templates from Meta to confirm business management access.')}">
              ${tr('whatsapp_connect.btn_view_templates', 'View Message Templates')} <span class="beta-badge">BETA</span>
            </button>
            <div id="wa-templates-list" style="margin-top:12px;display:none;"></div>
          </div>`;
        body.insertAdjacentHTML('beforeend', html);
        body.querySelector('#wa-view-templates-btn').addEventListener('click', loadWabaTemplates);
        loadWabaTemplates(); // auto-load on connect
    }

    async function loadWabaTemplates() {
        const btn  = document.getElementById('wa-view-templates-btn');
        const list = document.getElementById('wa-templates-list');
        const panel = document.getElementById('wa-templates-panel');
        if (!btn || !list || !panel) return;

        // Read the WABA ID from the data attribute we stamped when
        // building the panel. No DOM-scraping fallback -- if it's
        // missing, the panel was built with no detectable WABA ID and
        // the user should reconnect.
        const wabaId = panel.dataset.wabaId || '';
        if (!wabaId) {
            toast(tr('whatsapp_connect.no_waba_id', 'No WABA ID detected in this connection.'), 'error');
            return;
        }

        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = tr('whatsapp_connect.loading', 'Loading…');

        try {
            const headers = await getSessionAuthHeaders();
            const r = await fetch(TEMPLATES_URL(), {
                method: 'POST',
                headers,
                body: JSON.stringify({ waba_id: wabaId, org_id: window.currentUserOrgId })
            });
            const j = await r.json();
            const tpls = Array.isArray(j && j.templates) ? j.templates : [];
            const placeholder = j && j.source === 'placeholder';
            list.style.display = '';
            list.innerHTML = (placeholder
                ? `<div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px;">${tr('whatsapp_connect.placeholder_note', 'Connect your WABA to see live templates.')}</div>`
                : ''
            ) + (tpls.length ? tpls.map((tpl) => {
                const c = tpl.status === 'PENDING' ? '#f59e0b' : '#10b981';
                return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.03);margin-bottom:6px;">
                    <div style="font-weight:600;color:var(--text-primary);font-size:0.86rem;">${tpl.name}</div>
                    <span style="font-size:0.68rem;font-weight:700;color:${c};text-transform:uppercase;letter-spacing:.05em;">${tpl.status}</span>
                    <span style="margin-left:auto;font-size:0.72rem;color:var(--text-secondary);">${tpl.category || ''} · ${tpl.language || ''}</span>
                  </div>`;
            }).join('') : `<div style="font-size:0.78rem;color:var(--text-secondary);">${tr('whatsapp_connect.no_templates', 'No templates yet.')}</div>`);
        } catch (e) {
            toast(tr('whatsapp_connect.templates_failed', 'Could not load templates.'), 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }

    function postProcessWhatsAppConnectBody() {
        const body = document.getElementById('whatsapp-connect-body');
        if (!body || !body.firstChild) return;
        const vState = detectWaState(body);
        injectStepIndicator(body, vState);
        injectTooltips(body);
        injectTemplatesPanel(body, vState);
    }

    function setupWhatsAppModalObserver() {
        const body = document.getElementById('whatsapp-connect-body');
        if (!body) return setTimeout(setupWhatsAppModalObserver, 600);
        const obs = new MutationObserver(() => {
            // Defer to after the existing render finishes its synchronous DOM writes
            requestAnimationFrame(postProcessWhatsAppConnectBody);
        });
        obs.observe(body, { childList: true });
        postProcessWhatsAppConnectBody();
    }

    // ADDITION 3 — ACCESS GRANTED CARD
    function wrapStartWhatsApp() {
        const orig = window.startWhatsAppEmbeddedSignup;
        if (typeof orig !== 'function' || orig.__meta_wrapped) return false;
        const wrapped = async function() {
            const realLogin = window.FB && window.FB.login;
            if (typeof realLogin === 'function') {
                window.FB.login = function(cb, opts) {
                    return realLogin.call(window.FB, function(response) {
                        if (response && response.authResponse && response.authResponse.accessToken) {
                            const body = document.getElementById('whatsapp-connect-body');
                            if (body && !body.querySelector('#wa-access-granted-card')) {
                                const card = document.createElement('div');
                                card.id = 'wa-access-granted-card';
                                card.style.cssText = 'display:flex;align-items:center;gap:12px;padding:16px 20px;border-radius:14px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);margin-bottom:16px;animation:fadeIn 0.3s ease;';
                                card.innerHTML = `
                                  <span style="font-size:1.8rem;">✅</span>
                                  <div>
                                    <div style="font-weight:700;color:#10b981;font-size:0.9rem;">${tr('whatsapp_connect.granted_title', 'Access Granted')}</div>
                                    <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">${tr('whatsapp_connect.granted_body', 'WhatsApp Business access granted to Digitivia. Setting up your connection now…')}</div>
                                  </div>`;
                                body.insertBefore(card, body.firstChild);
                                setTimeout(() => card.remove(), 1500);
                            }
                        }
                        window.FB.login = realLogin;
                        return cb(response);
                    }, opts);
                };
            }
            try { return await orig.apply(this, arguments); }
            finally { if (typeof realLogin === 'function') window.FB.login = realLogin; }
        };
        wrapped.__meta_wrapped = true;
        window.startWhatsAppEmbeddedSignup = wrapped;
        return true;
    }

    // ADDITION 5 — SCREENCAST BANNER
    function renderScreencastBanner() {
        const on = localStorage.getItem('digitivia_screencast_mode') === '1';
        const existing = document.getElementById('digitivia-screencast-banner');
        if (!on) { if (existing) existing.remove(); return; }
        const slot = document.getElementById('whatsapp-agent-connect-slot');
        if (!slot) return;
        if (existing) return;
        const banner = document.createElement('div');
        banner.id = 'digitivia-screencast-banner';
        banner.style.cssText = 'margin-bottom:12px;padding:12px 16px;border-radius:10px;background:rgba(245,158,11,0.08);border-left:3px solid #f59e0b;display:flex;align-items:flex-start;gap:10px;';
        banner.innerHTML = `
          <span style="font-size:1.1rem;flex-shrink:0;">🎬</span>
          <div style="flex:1;">
            <div style="font-size:0.82rem;font-weight:600;color:#f59e0b;margin-bottom:4px;">${tr('whatsapp_connect.screencast_title', 'Screencast Mode Active')}</div>
            <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.5;">${tr('whatsapp_connect.screencast_steps', 'Steps: 1) Click "Continue with Facebook"  2) Log in and grant WhatsApp Business access  3) Confirm connection below')}</div>
          </div>
          <button id="digitivia-screencast-dismiss" style="background:none;border:none;color:var(--text-secondary);font-size:1rem;cursor:pointer;flex-shrink:0;padding:0;" title="${tr('whatsapp_connect.screencast_dismiss', 'Dismiss screencast mode')}">✕</button>`;
        slot.parentNode.insertBefore(banner, slot);
        document.getElementById('digitivia-screencast-dismiss').addEventListener('click', () => {
            localStorage.removeItem('digitivia_screencast_mode');
            banner.remove();
        });
    }

    // ============================================================
    //   MESSENGER + INSTAGRAM CONNECT CARDS (Prompt 3)
    // ============================================================

    async function fetchActiveChannelRow(platform) {
        // Guard: do not query before the user/org is resolved. The tab
        // observer can fire during early app boot when currentUserOrgId
        // is still undefined, which would issue org_id=eq.undefined and
        // 400 from PostgREST.
        if (!window.currentUserOrgId || !window.supabaseClient) return null;
        if (typeof window.currentUserOrgId !== 'string' || window.currentUserOrgId === 'undefined') return null;

        try {
            // Phase-1 schema may not be applied yet on this DB. Select
            // only the universally-present columns; the optional fields
            // (account_name, instagram_username) get hydrated below if
            // the columns exist.
            const base = await window.supabaseClient
                .from('org_channel_accounts')
                .select('external_account_id, is_active')
                .eq('org_id', window.currentUserOrgId)
                .eq('platform', platform)
                .eq('is_active', true)
                .order('connected_at', { ascending: false })
                .limit(1)
                .single();
            if (base.error) {
                if (base.error.code !== 'PGRST116') {
                    console.warn('[meta-connect] fetch row', platform, base.error.message);
                }
                return null;
            }
            if (!base.data) return null;

            const row = { ...base.data, account_name: null, instagram_username: null };

            // Try to hydrate the optional phase-1 columns. We do this in
            // a separate query so a missing column on one platform does
            // not poison the whole call.
            const optionalCols = platform === 'instagram'
                ? 'account_name, instagram_username'
                : 'account_name';
            const enrich = await window.supabaseClient
                .from('org_channel_accounts')
                .select(optionalCols)
                .eq('org_id', window.currentUserOrgId)
                .eq('platform', platform)
                .eq('is_active', true)
                .order('connected_at', { ascending: false })
                .limit(1)
                .single();
            if (!enrich.error && enrich.data) {
                Object.assign(row, enrich.data);
            }
            return row;
        } catch (e) {
            console.warn('[meta-connect] fetch row threw', e);
            return null;
        }
    }

    async function ensureFB() {
        if (window.FB) return true;
        await new Promise((r) => setTimeout(r, 1000));
        if (window.FB) return true;
        toast(tr('meta_connect.fb_sdk_not_ready', 'Facebook SDK not ready. Please try again.'), 'error');
        return false;
    }

    function buildCard(platform) {
        const isIG = platform === 'instagram';
        const card = document.createElement('div');
        card.id = `${platform}-connect-card`;
        card.className = 'card glass meta-connect-card';
        card.dataset.platform = platform;
        card.style.cssText = 'margin-top:18px;padding:18px;';
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="font-size:0.95rem;font-weight:600;color:var(--text-primary);">
              ${isIG ? tr('instagram_connect.card_title', 'Instagram Channel Connection')
                     : tr('messenger_connect.card_title',  'Messenger Channel Connection')}
            </div>
            <span class="beta-badge">BETA</span>
          </div>
          <div class="${platform}-card-status" style="font-size:0.85rem;margin-bottom:8px;">…</div>
          <div class="${platform}-card-desc"   style="font-size:0.82rem;color:var(--text-secondary);line-height:1.5;margin-bottom:6px;"></div>
          <div class="${platform}-card-helper" style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:12px;"></div>
          <div class="${platform}-card-body"></div>`;
        return card;
    }

    function platformCopy(platform) {
        if (platform === 'instagram') {
            return {
                desc:   tr('instagram_connect.description',
                    'Connect your Instagram Professional account to manage DMs inside Omnio. Your Instagram account must be linked to a Facebook Page you manage.'),
                helper: tr('instagram_connect.helper_pro',
                    "Don't have a Professional account? Go to Instagram Settings → Account → Switch to Professional Account."),
            };
        }
        return {
            desc:   tr('messenger_connect.description',
                'Connect your Facebook Page to receive and reply to Messenger conversations inside Omnio.'),
            helper: '',
        };
    }

    async function renderCardStatus(card, platform) {
        const isIG = platform === 'instagram';
        const row = await fetchActiveChannelRow(platform);
        const status = card.querySelector(`.${platform}-card-status`);
        const desc   = card.querySelector(`.${platform}-card-desc`);
        const helper = card.querySelector(`.${platform}-card-helper`);
        const body   = card.querySelector(`.${platform}-card-body`);
        const copy = platformCopy(platform);
        desc.textContent   = copy.desc;
        helper.textContent = copy.helper;

        if (row) {
            const label = isIG
                ? `@${row.instagram_username || row.account_name || row.external_account_id}`
                : (row.account_name || row.external_account_id);
            status.innerHTML = `
              <span style="color:#10b981;font-size:1rem;">●</span>
              ${isIG ? tr('instagram_connect.status_connected_prefix', 'Connected — ')
                     : tr('messenger_connect.status_connected_prefix', 'Connected — Page: ')}<b></b>
              <a href="#" class="${platform}-disconnect-link" style="margin-left:10px;color:var(--text-secondary);font-size:0.78rem;text-decoration:underline;">${tr('meta_connect.disconnect', 'Disconnect')}</a>`;
            status.querySelector('b').textContent = label;
            body.innerHTML = '';
            card.querySelector(`.${platform}-disconnect-link`).addEventListener('click', (ev) => {
                ev.preventDefault();
                handleDisconnect(card, platform);
            });
        } else {
            status.innerHTML = `<span style="color:#ef4444;font-size:1rem;">●</span> ${tr('meta_connect.not_connected', 'Not Connected')}`;
            body.innerHTML = `
              <button class="lp-btn lp-btn-primary ${platform}-connect-btn"
                title="${isIG ? tr('instagram_connect.tip_connect', 'Opens Facebook login to discover your linked Instagram Professional account.')
                              : tr('messenger_connect.tip_connect',  'Opens Facebook login. You will select which Page to connect to Messenger.')}">
                ${isIG ? tr('instagram_connect.btn_connect', 'Connect Instagram')
                       : tr('messenger_connect.btn_connect',  'Connect Facebook Page')}
              </button>`;
            card.querySelector(`.${platform}-connect-btn`).addEventListener('click', () => handleConnect(card, platform));
        }
    }

    async function handleConnect(card, platform) {
        if (!(await ensureFB())) return;
        const scopes = platform === 'instagram'
            ? ['pages_show_list','instagram_basic','instagram_manage_messages','pages_messaging']
            : ['pages_show_list','pages_messaging','pages_read_engagement'];
        let token;
        try { token = await window.getOrRefreshMetaToken(scopes); }
        catch (e) { toast(e.message || tr('meta_connect.fb_login_cancelled', 'Facebook login was cancelled or failed.'), 'error'); return; }

        let pages = [];
        try {
            const fields = platform === 'instagram'
                ? 'id,name,access_token,instagram_business_account{id,name,username,profile_picture_url}'
                : 'id,name,access_token,picture{url}';
            const url = `https://graph.facebook.com/v24.0/me/accounts?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
            const r = await fetch(url);
            const j = await r.json();
            pages = Array.isArray(j && j.data) ? j.data : [];
        } catch (e) {
            toast(tr('meta_connect.pages_failed', 'Could not load your Pages. Please try again.'), 'error');
            return;
        }
        if (platform === 'instagram') {
            pages = pages.filter((p) => p.instagram_business_account && p.instagram_business_account.id);
        }

        const body = card.querySelector(`.${platform}-card-body`);
        if (pages.length === 0) {
            body.innerHTML = `<div style="padding:10px;border-radius:8px;background:rgba(245,158,11,0.08);color:var(--text-secondary);font-size:0.82rem;">${platform === 'instagram'
                ? tr('instagram_connect.no_ig_account', 'No Instagram Professional account found linked to your Pages. Go to Instagram Settings → Account → Switch to Professional Account, then try again.')
                : tr('messenger_connect.no_pages',     'No Facebook Pages found. Create a Page or make sure you manage one.')}</div>`;
            return;
        }
        if (pages.length === 1) {
            renderConfirmation(card, platform, pages[0], token);
            return;
        }

        body.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px;">
          ${pages.map((p, idx) => {
            const pic = platform === 'instagram'
                ? (p.instagram_business_account.profile_picture_url || '')
                : ((p.picture && p.picture.data && p.picture.data.url) || '');
            const name = platform === 'instagram'
                ? `@${p.instagram_business_account.username}`
                : p.name;
            const sub = platform === 'instagram'
                ? `<span style="margin-left:8px;font-size:0.75rem;color:var(--text-secondary);">${p.name}</span>`
                : '';
            return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.03);">
                ${pic ? `<img src="${pic}" alt="" style="width:24px;height:24px;border-radius:999px;object-fit:cover;">`
                      : `<span style="width:24px;height:24px;border-radius:999px;background:rgba(255,255,255,0.08);display:inline-block;"></span>`}
                <span style="font-size:0.86rem;color:var(--text-primary);">${name}</span>${sub}
                <button data-page-idx="${idx}" class="lp-btn lp-btn-outline" style="margin-left:auto;font-size:0.78rem;padding:4px 10px;"
                  title="${platform === 'instagram'
                    ? tr('instagram_connect.tip_select', 'Connect this Instagram account to your Omnio inbox.')
                    : tr('messenger_connect.tip_select',  'Connect this Facebook Page to your Omnio Messenger channel.')}">
                  ${tr('meta_connect.btn_select', 'Select')}
                </button>
              </div>`;
          }).join('')}
        </div>`;
        body.querySelectorAll('button[data-page-idx]').forEach((b) => {
            b.addEventListener('click', () => {
                const idx = Number(b.dataset.pageIdx);
                renderConfirmation(card, platform, pages[idx], token);
            });
        });
    }

    function renderConfirmation(card, platform, page, token) {
        const isIG = platform === 'instagram';
        const body = card.querySelector(`.${platform}-card-body`);
        const ig = page.instagram_business_account;
        const displayName = isIG ? `@${ig.username}` : page.name;
        const subId = isIG ? ig.id : page.id;
        const linkedPage = isIG
            ? `<div style="font-size:0.78rem;color:var(--text-secondary);">${tr('instagram_connect.linked_page', 'Linked Page:')} ${page.name}</div>`
            : '';
        body.innerHTML = `
          <div style="padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);margin-bottom:10px;">
            <div style="font-weight:600;color:var(--text-primary);">${displayName}</div>
            <div style="font-size:0.78rem;color:var(--text-secondary);">ID: ${subId}</div>
            ${linkedPage}
            <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:6px;">${isIG
              ? tr('instagram_connect.confirm_msg', 'Digitivia will receive Instagram DMs from this account.')
              : tr('messenger_connect.confirm_msg',  'Digitivia will receive Messenger conversations from this Page.')}</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="lp-btn lp-btn-primary meta-confirm-btn"
              title="${isIG ? tr('instagram_connect.tip_confirm', 'Saves this Instagram account as your DM channel in Omnio.')
                            : tr('messenger_connect.tip_confirm',  'Saves this Facebook Page as your Messenger channel in Omnio.')}">
              ${tr('meta_connect.btn_confirm_save', 'Confirm & Save')}
            </button>
            <button class="lp-btn lp-btn-outline meta-cancel-btn">${tr('meta_connect.btn_cancel', 'Cancel')}</button>
          </div>`;
        body.querySelector('.meta-cancel-btn').addEventListener('click', () => renderCardStatus(card, platform));
        body.querySelector('.meta-confirm-btn').addEventListener('click', () => handleConfirm(card, platform, page, token));
    }

    async function handleConfirm(card, platform, page, token) {
        const isIG = platform === 'instagram';
        const existing = await fetchActiveChannelRow(platform);
        if (existing) {
            const replaceMsg = isIG
                ? `Replace existing Instagram connection with @${page.instagram_business_account.username}?`
                : `A Page is already connected. Replace it with ${page.name}?`;
            if (!window.confirm(replaceMsg)) return;
        }
        const headers = await getSessionAuthHeaders();
        const reqBody = isIG ? {
            action: 'exchange',
            org_id: window.currentUserOrgId,
            short_token: token,
            platform: 'instagram',
            account_id: page.instagram_business_account.id,
            account_name: page.instagram_business_account.username,
            ig_account_id: page.instagram_business_account.id,
            meta_user_id: '',
        } : {
            action: 'exchange',
            org_id: window.currentUserOrgId,
            short_token: token,
            platform: 'page',
            account_id: page.id,
            account_name: page.name,
        };
        try {
            const r = await fetch(META_TOKEN_URL(), { method: 'POST', headers, body: JSON.stringify(reqBody) });
            const j = await r.json();
            if (!r.ok || (j && j.error)) throw new Error((j && j.error) || `HTTP ${r.status}`);
        } catch (e) {
            toast(`${tr('meta_connect.connect_failed', 'Connection failed:')} ${e.message}`, 'error');
            return;
        }
        if (isIG) {
            try {
                await window.supabaseClient.from('org_channel_accounts')
                    .update({ instagram_username: page.instagram_business_account.username })
                    .eq('org_id', window.currentUserOrgId)
                    .eq('platform', 'instagram');
            } catch (e) { console.warn('[meta-connect] ig_username update', e); }
            toast(tr('instagram_connect.connect_success', 'Instagram connected! DMs will now appear in your Omnio inbox.'), 'success');
        } else {
            toast(tr('messenger_connect.connect_success', 'Messenger connected! Your Page is now linked to Omnio.'), 'success');
        }
        renderCardStatus(card, platform);
    }

    async function handleDisconnect(card, platform) {
        const isIG = platform === 'instagram';
        const msg = isIG
            ? tr('instagram_connect.disconnect_confirm', 'Disconnect Instagram? DMs will stop being received in Omnio.')
            : tr('messenger_connect.disconnect_confirm',  'Disconnect this Facebook Page? Messenger conversations will stop being received.');
        if (!window.confirm(msg)) return;
        const headers = await getSessionAuthHeaders();
        try {
            const r = await fetch(META_TOKEN_URL(), {
                method: 'POST', headers,
                body: JSON.stringify({ action: 'disconnect', org_id: window.currentUserOrgId, platform })
            });
            const j = await r.json();
            if (!r.ok || (j && j.error)) throw new Error((j && j.error) || `HTTP ${r.status}`);
        } catch (e) {
            toast(`${tr('meta_connect.disconnect_failed', 'Disconnect failed:')} ${e.message}`, 'error');
            return;
        }
        toast(isIG ? tr('instagram_connect.disconnect_success', 'Instagram disconnected.')
                   : tr('messenger_connect.disconnect_success', 'Messenger disconnected.'), 'info');
        renderCardStatus(card, platform);
    }

    function mountIfNeeded(platform) {
        const tab = document.getElementById(platform);
        if (!tab) return;
        if (tab.querySelector(`#${platform}-connect-card`)) return;
        const card = buildCard(platform);
        tab.appendChild(card);
        renderCardStatus(card, platform);
    }

    function watchTabs() {
        let scheduled = false;
        const runOnce = () => {
            scheduled = false;
            mountIfNeeded('page');
            mountIfNeeded('instagram');
            renderScreencastBanner();
        };
        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            (window.requestIdleCallback || requestAnimationFrame)(runOnce);
        };
        const attach = () => {
            // Watch only the two tab-content nodes we care about, plus
            // the WhatsApp connect slot's parent (for the screencast
            // banner). This avoids a global observer that fires on every
            // DOM mutation in the 19k-line app.
            const targets = [
                document.getElementById('page'),
                document.getElementById('instagram'),
                document.getElementById('whatsapp-agent-connect-slot'),
            ].filter(Boolean);
            if (!targets.length) return setTimeout(attach, 400);
            const obs = new MutationObserver(schedule);
            for (const t of targets) {
                obs.observe(t, { attributes: true, attributeFilter: ['class'], childList: true });
            }
            // Also listen for class flips on the active tab from outside
            // (switchTab toggles .active on .tab-content elements).
            const activeObs = new MutationObserver(schedule);
            document.querySelectorAll('.tab-content').forEach((el) => {
                if (el.id === 'page' || el.id === 'instagram') {
                    activeObs.observe(el, { attributes: true, attributeFilter: ['class'] });
                }
            });
            schedule();
        };
        attach();
    }

    // ============================================================
    //   BOOT
    // ============================================================
    function boot() {
        try { setupWhatsAppModalObserver(); } catch (e) { console.warn('[meta-connect] modal observer', e); }
        let attempts = 0;
        (function tryWrap() {
            if (wrapStartWhatsApp()) return;
            if (attempts++ > 50) return;
            setTimeout(tryWrap, 200);
        })();
        try { watchTabs(); } catch (e) { console.warn('[meta-connect] tab watcher', e); }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
