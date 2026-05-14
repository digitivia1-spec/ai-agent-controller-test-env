        // ==========================================
        //       ONBOARDING WIZARD (Owner-Only)
        // ==========================================
        (function () {
        const SUPABASE_URL = window.SUPABASE_URL;
        const SUPABASE_KEY = window.SUPABASE_KEY;
        const ONB_STEPS = ['profile', 'business', 'channels', 'kb', 'integrations', 'review'];
        const ONB_STEP_KEYS = ['step_profile', 'step_business', 'step_channels', 'step_kb', 'step_integrations', 'step_review'];
        const ALLOWED_KB_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
        const ALLOWED_KB_EXT = ['pdf', 'docx', 'txt', 'csv', 'xls', 'xlsx'];
        const MAX_FILE_SIZE = 3 * 1024 * 1024;
        const MAX_TOTAL_SIZE = 10 * 1024 * 1024;
        const SHOPIFY_STOREFRONT_API_VERSION = '2026-01';
        const INTEGRATION_PROXY_URL = `${SUPABASE_URL}/functions/v1/integration-proxy`;
        const PRODUCT_SYNC_URL = `${SUPABASE_URL}/functions/v1/product-sync`;

        // Trigger a product sync after a successful integration test.
        // - Pass 'initial_after_credentials_save' on first save (no prior verified_at)
        //   or 'credentials_updated' on a re-save. See doc 09 section 6.
        // - We POST fire-and-forget (the wizard keeps moving) but then poll
        //   product_sync_runs for the matching row's terminal status, so the
        //   merchant sees a completed/failed toast a few seconds later.
        async function triggerProductSync(source, trigger) {
            const t = trigger || 'credentials_updated';
            try {
                if (!currentUserOrgId) return;
                const { data: { session } } = await supabaseClient.auth.getSession();
                const token = session?.access_token;
                if (!token) { console.warn('triggerProductSync: no session token'); return; }
                if (typeof showToast === 'function') {
                    showToast(tOnb('productSync.toast.starting'), 'info');
                }
                const baseline = new Date().toISOString();
                fetch(PRODUCT_SYNC_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'apikey': SUPABASE_KEY
                    },
                    body: JSON.stringify({ org_id: currentUserOrgId, source, trigger: t })
                }).then((r) => {
                    if (!r.ok) console.warn('product-sync HTTP', r.status, source);
                }).catch((e) => console.warn('product-sync failed', source, e?.message || e));
                pollProductSyncOutcome(source, baseline);
            } catch (e) {
                console.warn('triggerProductSync wrapper failed', e?.message || e);
            }
        }

        // Poll product_sync_runs until we see a terminal status for (source, started_at >= baseline)
        // or until ~2 minutes pass. Best-effort, never throws.
        async function pollProductSyncOutcome(source, baselineIso) {
            const POLL_MS = 4000;
            const MAX_TRIES = 30;
            const TERMINAL = ['completed', 'completed_with_warnings', 'failed', 'cancelled'];
            for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
                await new Promise((r) => setTimeout(r, POLL_MS));
                try {
                    const { data, error } = await supabaseClient
                        .from('product_sync_runs')
                        .select('status, summary, error_code')
                        .eq('org_id', currentUserOrgId)
                        .eq('source', source)
                        .gte('started_at', baselineIso)
                        .order('started_at', { ascending: false })
                        .limit(1);
                    if (error) { console.warn('poll error', error.message); continue; }
                    const row = (data || [])[0];
                    if (!row || !TERMINAL.includes(row.status)) continue;
                    const tone = row.status === 'failed' ? 'error'
                        : row.status === 'completed_with_warnings' ? 'info' : 'success';
                    let key = 'productSync.toast.completed';
                    if (row.status === 'completed_with_warnings') key = 'productSync.toast.completed_with_warnings';
                    else if (row.status === 'failed') key = 'productSync.toast.failed';
                    else if (row.status === 'completed' && (row.summary?.products_found ?? 0) === 0) {
                        key = 'productSync.toast.no_products_found';
                    }
                    if (typeof showToast === 'function') showToast(tOnb(key), tone);
                    return;
                } catch (e) {
                    console.warn('poll exception', e?.message || e);
                }
            }
        }

        const PLATFORM_LOGOS = Object.freeze({
            wordpress: {
                primary: 'https://upload.wikimedia.org/wikipedia/commons/9/98/WordPress_blue_logo.svg',
                fallback: 'https://cdn.simpleicons.org/wordpress/21759B'
            },
            shopify: {
                primary: 'https://cdn.simpleicons.org/shopify/95BF47',
                fallback: 'https://cdn.simpleicons.org/shopify/95BF47'
            },
            easy_order: {
                primary: 'https://easy-orders.net/theme3/Logo.png',
                fallback: 'https://img.icons8.com/fluency/48/shopping-cart.png'
            }
        });
        const SHOPIFY_TEST_QUERY = `query WizardConnectionTest { shop { name primaryDomain { host url } } products(first: 1) { edges { node { title handle } } } }`;
        const DEFAULT_WOO_INTEGRATION = Object.freeze({
            website_url: '',
            consumer_key: '',
            consumer_secret: '',
            verified_at: '',
            verified_store: '',
            verification_method: '',
            verification_snapshot: null,
            last_test_status: ''
        });
        const DEFAULT_SHOPIFY_INTEGRATION = Object.freeze({
            shop_domain: '',
            storefront_token: '',
            token_type: 'storefront_access_token',
            verified_at: '',
            verified_store: '',
            verification_method: '',
            verification_snapshot: null,
            last_test_status: ''
        });
        const DEFAULT_EASY_ORDER_INTEGRATION = Object.freeze({
            store_url: '',
            api_key: '',
            verified_at: '',
            verified_store: '',
            verification_method: '',
            verification_snapshot: null,
            last_test_status: ''
        });

        let onbStep = 0;
        let onbData = null;
        window.onbData = null;
        let onbFiles = [];
        let onbSaveTimer = null;
        let onbFinishing = false;
        let onbIndustryOpen = false;
        let onbViewportMode = 'regular';
        let onbIntegrationDirty = false;
        let onbSavedIntegrationSignature = '';
        let onbConnectionState = defaultConnectionState();

        function createConnectionState() {
            return { status: 'idle', titleKey: '', detailKey: '', detailText: '', testing: false };
        }

        function defaultConnectionState() {
            return {
                woocommerce: createConnectionState(),
                shopify: createConnectionState(),
                easy_order: createConnectionState()
            };
        }

        function defaultOnbData() {
            return {
                profile: { full_name: '', company_name: '' },
                business: { industry: '', offer_type: '', description: '' },
                channels: { whatsapp_number: '', skipped: false, whatsapp_connection: normalizeWhatsAppConnection(null) },
                knowledge_base: { uploaded_files: [] },
                integrations: normalizeIntegrationsBlock(null),
                ui: { last_step: 0, dismissed_at: null, last_saved_at: null }
            };
        }

        function normalizeVerificationSnapshot(snapshot) {
            if (!snapshot || typeof snapshot !== 'object') return null;
            return {
                source: String(snapshot.source || '').slice(0, 100),
                method: String(snapshot.method || '').slice(0, 100),
                store: String(snapshot.store || '').slice(0, 180),
                sample: String(snapshot.sample || '').slice(0, 180),
                verified_at: String(snapshot.verified_at || '').slice(0, 100)
            };
        }

        function normalizeWooIntegration(raw) {
            const merged = Object.assign({}, DEFAULT_WOO_INTEGRATION, raw || {});
            merged.website_url = String(merged.website_url || '').trim();
            merged.consumer_key = String(merged.consumer_key || '').trim();
            merged.consumer_secret = String(merged.consumer_secret || '').trim();
            merged.verified_at = String(merged.verified_at || '').trim();
            merged.verified_store = String(merged.verified_store || '').trim();
            merged.verification_method = String(merged.verification_method || '').trim();
            merged.last_test_status = String(merged.last_test_status || '').trim();
            merged.verification_snapshot = normalizeVerificationSnapshot(merged.verification_snapshot);
            return merged;
        }

        function normalizeShopifyIntegration(raw) {
            const merged = Object.assign({}, DEFAULT_SHOPIFY_INTEGRATION, raw || {});
            const migratedToken = (merged.storefront_token || merged.client_secret || '').trim();
            merged.shop_domain = String(merged.shop_domain || '').trim();
            merged.storefront_token = migratedToken;
            merged.token_type = 'storefront_access_token';
            merged.verified_at = String(merged.verified_at || '').trim();
            merged.verified_store = String(merged.verified_store || '').trim();
            merged.verification_method = String(merged.verification_method || '').trim();
            merged.last_test_status = String(merged.last_test_status || '').trim();
            merged.verification_snapshot = normalizeVerificationSnapshot(merged.verification_snapshot);
            delete merged.client_id;
            delete merged.client_secret;
            return merged;
        }

        function normalizeEasyOrderIntegration(raw) {
            const merged = Object.assign({}, DEFAULT_EASY_ORDER_INTEGRATION, raw || {});
            merged.store_url = String(merged.store_url || '').trim();
            merged.api_key = String(merged.api_key || '').trim();
            merged.verified_at = String(merged.verified_at || '').trim();
            merged.verified_store = String(merged.verified_store || '').trim();
            merged.verification_method = String(merged.verification_method || '').trim();
            merged.last_test_status = String(merged.last_test_status || '').trim();
            merged.verification_snapshot = normalizeVerificationSnapshot(merged.verification_snapshot);
            return merged;
        }

        function normalizeIntegrationsBlock(raw) {
            return {
                woocommerce: normalizeWooIntegration(raw?.woocommerce),
                shopify: normalizeShopifyIntegration(raw?.shopify),
                easy_order: normalizeEasyOrderIntegration(raw?.easy_order)
            };
        }

        function getOnboardingMode() {
            const w = window.innerWidth || 0;
            const h = window.innerHeight || 0;
            if (w <= 820 || h <= 720) return 'tight';
            if (w <= 1180 || h <= 860) return 'compact';
            return 'regular';
        }

        function updateOnboardingViewportMode() {
            const modal = document.querySelector('.onb-modal');
            if (!modal) return false;
            const nextMode = getOnboardingMode();
            const changed = nextMode !== onbViewportMode;
            onbViewportMode = nextMode;
            modal.classList.toggle('onb-compact', nextMode !== 'regular');
            modal.classList.toggle('onb-tight', nextMode === 'tight');
            return changed;
        }

        function getIntegrationSignature(raw) {
            return JSON.stringify(normalizeIntegrationsBlock(raw));
        }

        function syncSavedIntegrationSignature() {
            onbSavedIntegrationSignature = getIntegrationSignature(onbData?.integrations || null);
            onbIntegrationDirty = false;
        }

        function markOnboardingIntegrationDirty() {
            onbIntegrationDirty = true;
        }

        function hasUnsavedOnboardingIntegrationChanges() {
            if (!onbData) return false;
            const current = getIntegrationSignature(onbData.integrations);
            return onbIntegrationDirty || current !== onbSavedIntegrationSignature;
        }

        function mergeOnbData(saved) {
            const d = defaultOnbData();
            if (!saved || typeof saved !== 'object') return d;
            try {
                if (saved.profile) Object.assign(d.profile, saved.profile);
                if (saved.business) Object.assign(d.business, saved.business);
                if (saved.channels) Object.assign(d.channels, saved.channels);
                d.channels.whatsapp_connection = normalizeWhatsAppConnection(saved?.channels?.whatsapp_connection);
                if (saved.knowledge_base) Object.assign(d.knowledge_base, saved.knowledge_base);
                d.integrations = normalizeIntegrationsBlock(saved.integrations);
                if (saved.ui) Object.assign(d.ui, saved.ui);
            } catch (e) { console.warn('onb merge error', e); }
            return d;
        }

        function getResumeStep(d) {
            if (!d) return 0;
            if (d.ui && typeof d.ui.last_step === 'number' && d.ui.last_step >= 0 && d.ui.last_step <= 5) {
                return d.ui.last_step;
            }
            if (!d.profile || !d.profile.full_name || !d.profile.company_name) return 0;
            if (!d.business || !d.business.offer_type) return 1;
            if (!d.channels || (!(d.channels.whatsapp_number || d.channels.whatsapp_connection?.display_phone_number) && !d.channels.skipped)) return 2;
            return 3;
        }

        function isOwner() {
            return window.currentUserRole === 'owner';
        }

        function tOnb(key, replacements) {
            return t(key, replacements || {});
        }

        function getOnbStepPercent() {
            return Math.round(((onbStep + 1) / ONB_STEPS.length) * 100);
        }

        function syncConnectionStateFromData() {
            onbConnectionState = defaultConnectionState();
            const woo = onbData?.integrations?.woocommerce;
            const shop = onbData?.integrations?.shopify;
            const eo = onbData?.integrations?.easy_order;
            if (woo?.verified_at) {
                onbConnectionState.woocommerce = {
                    status: 'success',
                    titleKey: 'onboarding.test_success_woo',
                    detailKey: woo.verification_method === 'query_auth' ? 'onboarding.test_detail_woo_fallback' : 'onboarding.test_detail_woo',
                    detailText: '',
                    testing: false
                };
            }
            if (shop?.verified_at) {
                onbConnectionState.shopify = {
                    status: 'success',
                    titleKey: 'onboarding.test_success_shopify',
                    detailKey: shop.verification_method === 'storefront_access_token_proxy' ? 'onboarding.test_detail_shopify_proxy' : 'onboarding.test_detail_shopify',
                    detailText: '',
                    testing: false
                };
            }
            if (eo?.verified_at) {
                onbConnectionState.easy_order = {
                    status: 'success',
                    titleKey: 'onboarding.test_success_easy_order',
                    detailKey: 'onboarding.test_detail_easy_order',
                    detailText: '',
                    testing: false
                };
            }
        }

        // --- CHECK ONBOARDING STATUS ---
        window.checkOnboardingStatus = function () {
            if (!isOwner()) return;
            // Show setup button in profile modal
            const setupBtn = document.getElementById('profile-setup-btn');
            if (setupBtn) setupBtn.style.display = 'block';

            if (typeof currentOrgData !== 'undefined' && currentOrgData && !currentOrgData.external_onboarding_completed) {
                showOnboardingBanner();
            }
        };

        function syncOnboardingBannerLayout() {
            const banner = document.getElementById('onb-banner');
            const isVisible = !!(banner && banner.style.display !== 'none');
            if (!banner || !isVisible) {
                document.body.classList.remove('has-onboarding-banner');
                document.documentElement.style.setProperty('--onb-banner-offset', '0px');
                return;
            }

            const offset = Math.ceil(banner.getBoundingClientRect().height || banner.offsetHeight || 0);
            document.body.classList.add('has-onboarding-banner');
            document.documentElement.style.setProperty('--onb-banner-offset', `${offset}px`);
        }

        window.addEventListener('resize', () => {
            if (document.body.classList.contains('has-onboarding-banner')) {
                syncOnboardingBannerLayout();
            }
        });

        function showOnboardingBanner() {
            const banner = document.getElementById('onb-banner');
            if (!banner) return;
            document.getElementById('onb-banner-text').textContent = t('onboarding.banner_text');
            document.getElementById('onb-banner-btn').textContent = t('onboarding.btn_continue');
            banner.style.display = 'flex';
            requestAnimationFrame(syncOnboardingBannerLayout);
        }

        window.dismissOnboardingBanner = function () {
            const banner = document.getElementById('onb-banner');
            if (banner) banner.style.display = 'none';
            syncOnboardingBannerLayout();
        };

        window.isOnboardingOpen = function () {
            const overlay = document.getElementById('onb-overlay');
            return !!(overlay && overlay.classList.contains('show'));
        };

        window.confirmDiscardOnboardingChanges = function () {
            if (!window.isOnboardingOpen() || !hasUnsavedOnboardingIntegrationChanges()) return true;
            return window.confirm(tOnb('onboarding.unsaved_leave_confirm'));
        };

        // --- OPEN / CLOSE ---
        window.openOnboardingWizard = function () {
            if (!isOwner()) return;
            const saved = (typeof currentOrgData !== 'undefined' && currentOrgData) ? currentOrgData.external_onboarding_data : null;
            onbData = mergeOnbData(saved);
            window.onbData = onbData;

            // Pre-fill from live data
            if (typeof currentUserProfile !== 'undefined' && currentUserProfile) {
                if (!onbData.profile.full_name && currentUserProfile.full_name) onbData.profile.full_name = currentUserProfile.full_name;
            }
            if (typeof currentOrgData !== 'undefined' && currentOrgData) {
                if (!onbData.profile.company_name && currentOrgData.name) onbData.profile.company_name = currentOrgData.name;
            }

            onbStep = getResumeStep(onbData);
            onbFiles = [];
            onbFinishing = false;
            onbIntegrationView = (onbData.integrations?.easy_order?.store_url || onbData.integrations?.easy_order?.api_key) ? 'easy_order' : (onbData.integrations?.shopify?.shop_domain || onbData.integrations?.shopify?.storefront_token) ? 'shopify' : 'woocommerce';
            syncConnectionStateFromData();
            syncSavedIntegrationSignature();
            renderWizard();
            document.getElementById('onb-overlay').classList.add('show');
            document.body.style.overflow = 'hidden';

            // Mobile popstate / swiping back support
            try {
                history.pushState({ hash: 'onboarding' }, '', window.location.pathname + '#onboarding');
            } catch (e) { }
        };

        window.closeOnboardingWizard = function (fromPopState = false, options = {}) {
            const hasUnsavedIntegrations = hasUnsavedOnboardingIntegrationChanges();
            if (!options.force && hasUnsavedIntegrations) {
                const confirmed = window.confirm(tOnb('onboarding.unsaved_leave_confirm'));
                if (!confirmed) return false;
            }
            clearTimeout(onbSaveTimer);
            onbSaveTimer = null;
            if (options.persist !== false && !hasUnsavedIntegrations) {
                saveOnbProgress();
            }
            if (hasUnsavedIntegrations) {
                onbIntegrationDirty = false;
            }
            document.getElementById('onb-overlay').classList.remove('show');
            document.body.style.overflow = '';

            // Revert hash if dismissed manually
            if (!fromPopState && !options.skipHistoryRestore && window.location.hash === '#onboarding') {
                try { history.back(); } catch (e) { }
            }
            return true;
        };

        window.addEventListener('popstate', (e) => {
            const overlay = document.getElementById('onb-overlay');
            if (overlay && overlay.classList.contains('show') && window.location.hash !== '#onboarding') {
                const closed = window.closeOnboardingWizard(true);
                if (closed === false) {
                    try {
                        history.pushState({ hash: 'onboarding' }, '', window.location.pathname + '#onboarding');
                    } catch (err) { }
                }
            }
        });

        window.refreshOnboardingWizard = function () {
            const overlay = document.getElementById('onb-overlay');
            if (overlay && overlay.classList.contains('show') && onbData) renderWizard();
        };

        window.addEventListener('resize', () => {
            const overlay = document.getElementById('onb-overlay');
            if (overlay && overlay.classList.contains('show') && onbData) {
                const modeChanged = updateOnboardingViewportMode();
                if (modeChanged || onbStep === 4) renderWizard();
            }
        });

        window.addEventListener('beforeunload', (event) => {
            if (!window.isOnboardingOpen() || !hasUnsavedOnboardingIntegrationChanges()) return;
            event.preventDefault();
            event.returnValue = '';
        });

        window.switchOnboardingLanguage = function (lang) {
            if (!lang || lang === currentLang) {
                renderWizard();
                return;
            }
            setLanguage(lang);
        };

        // --- RENDER ---
        function renderWizard() {
            updateOnboardingViewportMode();
            document.getElementById('onb-wizard-kicker').textContent = tOnb('onboarding.wizard_badge');
            document.getElementById('onb-wizard-title').textContent = tOnb('onboarding.wizard_title');
            document.getElementById('onb-wizard-subtitle').textContent = tOnb('onboarding.wizard_subtitle');
            document.getElementById('onb-language-label').textContent = tOnb('onboarding.language_label');
            document.getElementById('onb-language-switch')?.setAttribute('aria-label', tOnb('onboarding.language_label'));
            document.getElementById('onb-step-hint').textContent = tOnb('onboarding.wizard_step_hint');
            document.getElementById('onb-progress-step-label').textContent = tOnb('onboarding.wizard_progress_label', { current: onbStep + 1, total: ONB_STEPS.length });
            document.getElementById('onb-progress-percent').textContent = tOnb('onboarding.wizard_progress_done', { percent: getOnbStepPercent() });
            document.getElementById('onb-progress-fill').style.width = `${getOnbStepPercent()}%`;
            renderLanguageSwitch();
            renderStepper();
            renderStepContent();
            renderActions();
            if (typeof applyOnboardingHelp === 'function') applyOnboardingHelp();
        }

        function renderLanguageSwitch() {
            const enBtn = document.getElementById('onb-lang-en');
            const arBtn = document.getElementById('onb-lang-ar');
            if (!enBtn || !arBtn) return;
            enBtn.textContent = tOnb('onboarding.lang_english');
            arBtn.textContent = tOnb('onboarding.lang_arabic');
            enBtn.classList.toggle('active', currentLang === 'en');
            arBtn.classList.toggle('active', currentLang === 'ar');
            enBtn.setAttribute('aria-pressed', String(currentLang === 'en'));
            arBtn.setAttribute('aria-pressed', String(currentLang === 'ar'));
        }

        function renderStepper() {
            const el = document.getElementById('onb-stepper');
            let html = '';
            ONB_STEPS.forEach((s, i) => {
                const cls = i < onbStep ? 'done' : (i === onbStep ? 'active' : '');
                const icon = i < onbStep ? '&#10003;' : String(i + 1).padStart(2, '0');
                html += `<button type="button" class="onb-step ${cls}" onclick="goToOnboardingStep(${i})">
                    <span class="onb-step-circle">${icon}</span>
                    <span class="onb-step-copy">
                        <span class="onb-step-order">${String(i + 1).padStart(2, '0')}</span>
                        <span class="onb-step-label">${tOnb('onboarding.' + ONB_STEP_KEYS[i])}</span>
                    </span>
                </button>`;
            });
            el.innerHTML = html;
        }

        window.goToOnboardingStep = function (targetStep) {
            const nextStep = Number(targetStep);
            if (!Number.isInteger(nextStep) || nextStep < 0 || nextStep >= ONB_STEPS.length || !onbData) return;
            onbData.ui.last_step = Math.max(onbData.ui.last_step || 0, onbStep);
            saveOnbProgress();
            onbStep = nextStep;
            renderWizard();
        };

        function renderStepContent() {
            const body = document.getElementById('onb-body');
            const renderers = [renderStepProfile, renderStepBusiness, renderStepChannels, renderStepKB, renderStepIntegrations, renderStepReview];
            body.innerHTML = '';
            const scrollRegion = document.createElement('div');
            scrollRegion.className = 'onb-scroll-region';
            const div = document.createElement('div');
            div.className = 'onb-step-content active';
            div.innerHTML = renderWizardOverview() + renderers[onbStep]();
            scrollRegion.appendChild(div);
            body.appendChild(scrollRegion);
            scrollRegion.scrollTop = 0;
            afterStepRender();
        }

        function renderWizardOverview() {
            if (onbViewportMode !== 'regular' || onbStep === 4) return '';
            return `<div class="onb-overview-card">
                <div>
                    <h3 class="onb-overview-title">${tOnb('onboarding.overview_title')}</h3>
                    <p class="onb-overview-text">${tOnb('onboarding.overview_text')}</p>
                </div>
                <div class="onb-overview-chips">
                    <span class="onb-overview-chip">${tOnb('onboarding.overview_chip_business')}</span>
                    <span class="onb-overview-chip">${tOnb('onboarding.overview_chip_channels')}</span>
                    <span class="onb-overview-chip">${tOnb('onboarding.overview_chip_integrations')}</span>
                </div>
            </div>`;
        }

        function renderActions() {
            const el = document.getElementById('onb-actions');
            const isFirst = onbStep === 0;
            const isLast = onbStep === ONB_STEPS.length - 1;
            const isSkippable = onbStep === 2 || onbStep === 4; // channels, integrations

            let html = '';
            if (!isFirst) html += `<button class="onb-btn onb-btn-secondary" onclick="prevOnboardingStep()">` + (currentLang === 'ar' ? '→' : '←') + ` ${tOnb('onboarding.btn_back')}</button>`;
            html += `<div class="onb-spacer"></div>`;
            if (isSkippable && !isLast) html += `<button class="onb-btn onb-btn-ghost" onclick="skipOnboardingStep()">${tOnb('onboarding.btn_skip')}</button>`;
            if (isLast) {
                html += `<button class="onb-btn onb-btn-finish" id="onb-finish-btn" onclick="finishOnboarding()">${tOnb('onboarding.btn_finish')}</button>`;
            } else {
                html += `<button class="onb-btn onb-btn-primary" onclick="nextOnboardingStep()">${tOnb('onboarding.btn_next')} ` + (currentLang === 'ar' ? '←' : '→') + `</button>`;
            }
            el.innerHTML = html;
        }

        // --- STEP RENDERERS ---
        function renderStepProfile() {
            return `<div class="onb-step-card">
                <h3 class="onb-step-title">${tOnb('onboarding.profile_title')}</h3>
                <p class="onb-step-subtitle">${tOnb('onboarding.profile_subtitle')}</p>
                <div class="onb-form-grid">
                    <div class="onb-field" id="onb-f-name">
                        <label>${tOnb('onboarding.label_full_name')}</label>
                        <input type="text" id="onb-full-name" value="${esc(onbData.profile.full_name)}" placeholder="${tOnb('onboarding.placeholder_full_name')}" oninput="onbData.profile.full_name=this.value;debounceSaveOnb()">
                        <div class="onb-error">${tOnb('onboarding.validation_name_required')}</div>
                    </div>
                    <div class="onb-field" id="onb-f-company">
                        <label>${tOnb('onboarding.label_company_name')}</label>
                        <input type="text" id="onb-company" value="${esc(onbData.profile.company_name)}" placeholder="${tOnb('onboarding.placeholder_company_name')}" oninput="onbData.profile.company_name=this.value;debounceSaveOnb()">
                        <div class="onb-error">${tOnb('onboarding.validation_company_required')}</div>
                    </div>
                </div>
            </div>`;
        }

        function renderStepBusiness() {
            const descLabel = onbData.business.offer_type === 'product' ? tOnb('onboarding.label_description_product') :
                onbData.business.offer_type === 'service' ? tOnb('onboarding.label_description_service') :
                    tOnb('onboarding.label_description');
            return `<div class="onb-step-card">
                <h3 class="onb-step-title">${tOnb('onboarding.business_title')}</h3>
                <p class="onb-step-subtitle">${tOnb('onboarding.business_subtitle')}</p>
                <div class="onb-form-grid">
                    <div class="onb-field" id="onb-f-industry">
                        <label>${tOnb('onboarding.label_industry')}</label>
                        <div class="onb-industry-wrap">
                            <input type="text" id="onb-industry-input" value="${esc(onbData.business.industry)}" placeholder="${tOnb('onboarding.placeholder_industry')}" autocomplete="off" onfocus="openOnbIndustryList()" oninput="filterOnbIndustry(this.value)">
                            <div class="onb-industry-list" id="onb-industry-list"></div>
                        </div>
                        <div class="onb-error">${tOnb('onboarding.validation_industry_required')}</div>
                    </div>
                    <div class="onb-field" id="onb-f-offer">
                        <label>${tOnb('onboarding.label_offer_type')}</label>
                        <div class="onb-offer-group">
                            <button type="button" class="onb-offer-btn ${onbData.business.offer_type === 'product' ? 'selected' : ''}" onclick="selectOfferType('product', event)">
                                <span class="onb-offer-icon">📦</span>${tOnb('onboarding.offer_product')}
                            </button>
                            <button type="button" class="onb-offer-btn ${onbData.business.offer_type === 'service' ? 'selected' : ''}" onclick="selectOfferType('service', event)">
                                <span class="onb-offer-icon">🤝</span>${tOnb('onboarding.offer_service')}
                            </button>
                        </div>
                        <div class="onb-error">${tOnb('onboarding.validation_offer_required')}</div>
                    </div>
                    <div class="onb-field onb-field-full">
                        <label id="onb-desc-label">${descLabel}</label>
                        <textarea id="onb-description" placeholder="${tOnb('onboarding.placeholder_description')}" oninput="onbData.business.description=this.value;debounceSaveOnb()">${esc(onbData.business.description)}</textarea>
                    </div>
                </div>
            </div>`;
        }

        function renderStepChannels() {
            return `<div class="onb-step-card">
                <h3 class="onb-step-title">${tOnb('onboarding.channels_title')}</h3>
                <p class="onb-step-subtitle">${tOnb('onboarding.channels_subtitle')}</p>
                <div class="onb-form-grid">
                    <div class="onb-field onb-field-full">
                        <label>${tOnb('onboarding.label_whatsapp')}</label>
                        <input type="tel" id="onb-whatsapp" value="${esc(onbData.channels.whatsapp_number)}" placeholder="${tOnb('onboarding.placeholder_whatsapp')}" oninput="onbData.channels.whatsapp_number=this.value;onbData.channels.skipped=false;debounceSaveOnb()">
                        <div class="onb-hint">${tOnb('onboarding.channels_skip_note')}</div>
                    </div>
                </div>
            </div>`;
        }

        function renderStepKB() {
            let filesHtml = '';
            if (onbFiles.length === 0 && (!onbData.knowledge_base.uploaded_files || onbData.knowledge_base.uploaded_files.length === 0)) {
                filesHtml = `<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:10px 0;">${tOnb('onboarding.kb_no_files')}</p>`;
            } else {
                onbFiles.forEach((f, i) => {
                    const sizeStr = (f.file.size / 1024).toFixed(1) + ' KB';
                    let statusCls = '', statusTxt = '';
                    if (f.status === 'uploading') { statusCls = 'uploading'; statusTxt = tOnb('onboarding.kb_uploading'); }
                    else if (f.status === 'uploaded') { statusCls = 'uploaded'; statusTxt = tOnb('onboarding.kb_uploaded'); }
                    else if (f.status === 'failed') { statusCls = 'failed'; statusTxt = tOnb('onboarding.kb_failed'); }
                    filesHtml += `<div class="onb-file-item"><span class="onb-file-name">${esc(f.file.name)}</span><span class="onb-file-size">${sizeStr}</span>`;
                    if (statusTxt) filesHtml += `<span class="onb-file-status ${statusCls}">${statusTxt}</span>`;
                    if (f.status !== 'uploading' && f.status !== 'uploaded') filesHtml += `<button class="onb-file-remove" onclick="removeOnbFile(${i})" aria-label="${tOnb('onboarding.kb_remove')}">&times;</button>`;
                    filesHtml += `</div>`;
                });
                // Show previously uploaded files from saved data
                if (onbData.knowledge_base.uploaded_files) {
                    onbData.knowledge_base.uploaded_files.forEach(f => {
                        const sizeStr = f.size_bytes ? (f.size_bytes / 1024).toFixed(1) + ' KB' : '';
                        filesHtml += `<div class="onb-file-item"><span class="onb-file-name">${esc(f.filename || '')}</span><span class="onb-file-size">${sizeStr}</span><span class="onb-file-status uploaded">${tOnb('onboarding.kb_uploaded')}</span></div>`;
                    });
                }
            }
            return `<div class="onb-step-card">
                <h3 class="onb-step-title">${tOnb('onboarding.kb_title')}</h3>
                <p class="onb-step-subtitle">${tOnb('onboarding.kb_subtitle')}</p>
                <div class="help-inline-host" id="onb-kb-upload-host">
                    <div class="onb-drop-zone" id="onb-drop-zone" onclick="document.getElementById('onb-file-input').click()">
                        <div class="onb-drop-icon">📄</div>
                        <p>${tOnb('onboarding.kb_drop_text')}</p>
                        <small>${tOnb('onboarding.kb_drop_hint')}</small>
                    </div>
                </div>
                <input type="file" id="onb-file-input" multiple accept=".pdf,.docx,.txt,.csv,.xls,.xlsx" style="display:none" onchange="handleOnbFileSelect(this.files)">
                <div class="onb-file-list" id="onb-file-list">${filesHtml}</div>
            </div>`;
        }

        function renderStepIntegrations() {
            const w = onbData.integrations.woocommerce;
            const s = onbData.integrations.shopify;
            const eo = onbData.integrations.easy_order;
            const selectedProvider = onbIntegrationView === 'shopify' ? 'shopify' : onbIntegrationView === 'easy_order' ? 'easy_order' : 'woocommerce';
            const selectedConfig = selectedProvider === 'woocommerce' ? w : selectedProvider === 'shopify' ? s : eo;
            const isTesting = !!onbConnectionState[selectedProvider]?.testing;
            return `<div class="onb-step-card">
                <h3 class="onb-step-title">${tOnb('onboarding.integrations_title')}</h3>
                <p class="onb-step-subtitle">${tOnb('onboarding.integrations_subtitle')}</p>
                <div class="onb-int-switch">
                    <button type="button" class="onb-int-switch-btn ${selectedProvider === 'woocommerce' ? 'active' : ''}" onclick="setOnbIntegrationView('woocommerce')">${tOnb('onboarding.integrations_woo_title')}</button>
                    <button type="button" class="onb-int-switch-btn ${selectedProvider === 'shopify' ? 'active' : ''}" onclick="setOnbIntegrationView('shopify')">${tOnb('onboarding.integrations_shopify_title')}</button>
                    <button type="button" class="onb-int-switch-btn ${selectedProvider === 'easy_order' ? 'active' : ''}" onclick="setOnbIntegrationView('easy_order')">${tOnb('onboarding.integrations_easy_order_title')}</button>
                </div>
                <div class="onb-int-cards">
                    <div class="onb-int-card">${renderOnbIntegrationFields(selectedProvider, selectedConfig, isTesting)}</div>
                </div>
                <div class="onb-hint">${tOnb('onboarding.integrations_skip_note')}</div>
            </div>`;
        }

        window.setOnbIntegrationView = function (provider) {
            if (provider !== 'woocommerce' && provider !== 'shopify' && provider !== 'easy_order') return;
            onbIntegrationView = provider;
            renderStepContent();
        };

        function renderOnbIntegrationFields(provider, config, isTesting) {
            const canDisconnect = provider === 'woocommerce'
                ? !!(config.website_url || config.consumer_key || config.consumer_secret || config.verified_at)
                : provider === 'easy_order'
                ? !!(config.store_url || config.api_key || config.verified_at)
                : !!(config.shop_domain || config.storefront_token || config.verified_at);
            if (provider === 'woocommerce') {
                return `<div class="onb-platform-head">
                    <div class="onb-platform-brand">
                        <img class="onb-platform-logo" src="${PLATFORM_LOGOS.wordpress.primary}" onerror="this.onerror=null;this.src='${PLATFORM_LOGOS.wordpress.fallback}'" alt="WordPress" loading="lazy" decoding="async">
                        <div>
                            <h4 class="onb-platform-title">${tOnb('onboarding.integrations_woo_title')}</h4>
                            <p class="onb-platform-subtitle">${tOnb('onboarding.integrations_woo_hint')}</p>
                        </div>
                    </div>
                    <span class="onb-badge">${tOnb('onboarding.integrations_https_recommended')}</span>
                </div>
                <div class="onb-form-grid">
                    <div class="onb-field onb-field-full">
                        <label>${tOnb('onboarding.label_woo_url')}</label>
                        <input type="text" id="woo-domain" value="${esc(config.website_url)}" placeholder="${tOnb('onboarding.placeholder_woo_url')}" oninput="updateOnbIntegrationField('woocommerce','website_url',this.value)">
                    </div>
                    <div class="onb-field">
                        <label>${tOnb('onboarding.label_woo_ck')}</label>
                        <input type="text" id="woo-ck" value="${esc(config.consumer_key)}" placeholder="${tOnb('onboarding.placeholder_woo_ck')}" oninput="updateOnbIntegrationField('woocommerce','consumer_key',this.value)">
                    </div>
                    <div class="onb-field">
                        <label>${tOnb('onboarding.label_woo_cs')}</label>
                        <input type="password" id="woo-cs" value="${esc(config.consumer_secret)}" placeholder="${tOnb('onboarding.placeholder_woo_cs')}" oninput="updateOnbIntegrationField('woocommerce','consumer_secret',this.value)">
                    </div>
                </div>
                <div class="onb-conn-actions">
                    <button class="onb-test-btn" id="woo-test-btn" onclick="window.testWooConnection()" ${isTesting ? 'disabled' : ''}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        ${isTesting ? tOnb('onboarding.test_loading') : tOnb('onboarding.btn_test_connection')}
                    </button>
                    <button class="onb-disconnect-btn" onclick="disconnectOnbIntegration('woocommerce')" ${canDisconnect ? '' : 'disabled'}>${t('integrations_hub.btn_disconnect')}</button>
                </div>
                <div id="woo-test-result">${renderConnectionStatusHtml('woocommerce')}</div>`;
            }
            if (provider === 'shopify') {
            return `<div class="onb-platform-head">
                <div class="onb-platform-brand">
                    <img class="onb-platform-logo" src="${PLATFORM_LOGOS.shopify.primary}" onerror="this.onerror=null;this.src='${PLATFORM_LOGOS.shopify.fallback}'" alt="Shopify" loading="lazy" decoding="async">
                    <div>
                        <h4 class="onb-platform-title">${tOnb('onboarding.integrations_shopify_title')}</h4>
                        <p class="onb-platform-subtitle">${tOnb('onboarding.integrations_shopify_hint')}</p>
                    </div>
                </div>
                <span class="onb-badge">${tOnb('onboarding.integrations_shopify_private_note')}</span>
            </div>
            <div class="onb-form-grid">
                <div class="onb-field onb-field-full">
                    <label>${tOnb('onboarding.label_shopify_domain')}</label>
                    <div class="onb-inline-domain">
                        <input type="text" id="shop-domain" value="${esc(config.shop_domain)}" placeholder="${tOnb('onboarding.placeholder_shopify_domain')}" oninput="updateOnbIntegrationField('shopify','shop_domain',this.value)">
                        <span class="onb-domain-suffix">.myshopify.com</span>
                    </div>
                </div>
                <div class="onb-field onb-field-full">
                    <label>${tOnb('onboarding.label_shopify_token')}</label>
                    <input type="password" id="shop-token" value="${esc(config.storefront_token || '')}" placeholder="${tOnb('onboarding.placeholder_shopify_token')}" oninput="updateOnbIntegrationField('shopify','storefront_token',this.value)">
                </div>
            </div>
            <div class="onb-conn-actions">
                <button class="onb-test-btn" id="shopify-test-btn" onclick="window.testShopifyConnection()" ${isTesting ? 'disabled' : ''}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    ${isTesting ? tOnb('onboarding.test_loading') : tOnb('onboarding.btn_test_connection')}
                </button>
                <button class="onb-disconnect-btn" onclick="disconnectOnbIntegration('shopify')" ${canDisconnect ? '' : 'disabled'}>${t('integrations_hub.btn_disconnect')}</button>
            </div>
            <div id="shopify-test-result">${renderConnectionStatusHtml('shopify')}</div>`;
            }
            return `<div class="onb-platform-head">
                <div class="onb-platform-brand">
                    <img class="onb-platform-logo" src="${PLATFORM_LOGOS.easy_order.primary}" onerror="this.onerror=null;this.src='${PLATFORM_LOGOS.easy_order.fallback}'" alt="Easy Order" loading="lazy" decoding="async">
                    <div>
                        <h4 class="onb-platform-title">${tOnb('onboarding.integrations_easy_order_title')}</h4>
                        <p class="onb-platform-subtitle">${tOnb('onboarding.integrations_easy_order_hint')}</p>
                    </div>
                </div>
                <span class="onb-badge">${tOnb('onboarding.integrations_easy_order_badge')}</span>
            </div>
            <div class="onb-form-grid">
                <div class="onb-field onb-field-full">
                    <label>${tOnb('onboarding.label_easy_order_store')}</label>
                    <div class="onb-inline-domain">
                        <input type="text" id="eo-store-url" value="${esc(config.store_url)}" placeholder="${tOnb('onboarding.placeholder_easy_order_store')}" oninput="updateOnbIntegrationField('easy_order','store_url',this.value)">
                        <span class="onb-domain-suffix">.easy-orders.net</span>
                    </div>
                </div>
                <div class="onb-field onb-field-full">
                    <label>${tOnb('onboarding.label_easy_order_api_key')}</label>
                    <input type="password" id="eo-api-key" value="${esc(config.api_key)}" placeholder="${tOnb('onboarding.placeholder_easy_order_api_key')}" oninput="updateOnbIntegrationField('easy_order','api_key',this.value)">
                </div>
            </div>
            <div class="onb-conn-actions">
                <button class="onb-test-btn" id="eo-test-btn" onclick="window.testEasyOrderConnection()" ${isTesting ? 'disabled' : ''}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    ${isTesting ? tOnb('onboarding.test_loading') : tOnb('onboarding.btn_test_connection')}
                </button>
                <button class="onb-disconnect-btn" onclick="disconnectOnbIntegration('easy_order')" ${canDisconnect ? '' : 'disabled'}>${t('integrations_hub.btn_disconnect')}</button>
            </div>
            <div id="eo-test-result">${renderConnectionStatusHtml('easy_order')}</div>`;
        }

        function formatVerificationDate(isoText) {
            if (!isoText) return '';
            try {
                return new Date(isoText).toLocaleString(currentLang === 'ar' ? 'ar-EG' : 'en-US');
            } catch (e) {
                return isoText;
            }
        }

        function renderProofRows(snapshot) {
            if (!snapshot) return '';
            const rows = [];
            if (snapshot.store) rows.push({ label: tOnb('onboarding.proof_store'), value: snapshot.store });
            if (snapshot.method) rows.push({ label: tOnb('onboarding.proof_method'), value: snapshot.method });
            if (snapshot.verified_at) rows.push({ label: tOnb('onboarding.proof_verified_at'), value: formatVerificationDate(snapshot.verified_at) });
            if (snapshot.sample) rows.push({ label: tOnb('onboarding.proof_sample'), value: snapshot.sample });
            if (snapshot.source || snapshot.method) {
                const route = snapshot.source === 'integration-proxy'
                    ? tOnb('onboarding.proof_channel_proxy')
                    : tOnb('onboarding.proof_channel_direct');
                rows.push({ label: tOnb('onboarding.proof_source'), value: route });
            }
            if (!rows.length) return '';
            const helpKeyMap = {
                [tOnb('onboarding.proof_store')]: 'integrations.proof_store',
                [tOnb('onboarding.proof_method')]: 'integrations.proof_method',
                [tOnb('onboarding.proof_verified_at')]: 'integrations.proof_verified_at',
                [tOnb('onboarding.proof_sample')]: 'integrations.proof_sample',
                [tOnb('onboarding.proof_source')]: 'integrations.proof_source'
            };
            return `<div class="onb-proof-list">${rows.map((row) => `<div class="onb-proof-row"><span class="onb-proof-label" data-proof-help-key="${helpKeyMap[row.label] || ''}">${esc(row.label)}:</span><span>${esc(row.value)}</span></div>`).join('')}</div>`;
        }

        function renderConnectionStatusHtml(provider) {
            const state = onbConnectionState[provider];
            if (!state || state.status === 'idle') return '';
            const title = state.titleKey ? tOnb(state.titleKey) : '';
            const detailParts = [];
            if (state.detailKey) detailParts.push(tOnb(state.detailKey));
            if (state.detailText) detailParts.push(state.detailText);
            const detail = detailParts.join(' ').trim();
            const proofHtml = renderProofRows(onbData?.integrations?.[provider]?.verification_snapshot);
            return `<div class="onb-test-result ${state.status}">
                <div class="onb-test-result-title">${esc(title || tOnb('onboarding.test_error_unknown'))}</div>
                ${detail ? `<div class="onb-test-result-detail">${esc(detail)}</div>` : ''}
                ${proofHtml}
            </div>`;
        }

        function updateConnectionStatusDom(provider) {
            const containerId = provider === 'woocommerce' ? 'woo-test-result' : provider === 'easy_order' ? 'eo-test-result' : 'shopify-test-result';
            const el = document.getElementById(containerId);
            if (el) el.innerHTML = renderConnectionStatusHtml(provider);
            updateConnectionButtonDom(provider);
        }

        function updateConnectionButtonDom(provider) {
            const btnId = provider === 'woocommerce' ? 'woo-test-btn' : provider === 'easy_order' ? 'eo-test-btn' : 'shopify-test-btn';
            const btn = document.getElementById(btnId);
            const state = onbConnectionState[provider];
            if (!btn || !state) return;
            btn.disabled = !!state.testing;
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>${state.testing ? tOnb('onboarding.test_loading') : tOnb('onboarding.btn_test_connection')}`;
        }

        function setConnectionState(provider, nextState) {
            onbConnectionState[provider] = Object.assign(createConnectionState(), onbConnectionState[provider], nextState);
            updateConnectionStatusDom(provider);
        }

        function clearIntegrationVerification(provider) {
            const target = onbData?.integrations?.[provider];
            if (!target) return;
            target.verified_at = '';
            target.verified_store = '';
            target.verification_method = '';
            target.verification_snapshot = null;
            target.last_test_status = '';
        }

        window.updateOnbIntegrationField = function (provider, field, value) {
            if (!onbData?.integrations?.[provider]) return;
            onbData.integrations[provider][field] = value;
            if (provider === 'shopify') {
                onbData.integrations.shopify.token_type = 'storefront_access_token';
                delete onbData.integrations.shopify.client_id;
                delete onbData.integrations.shopify.client_secret;
            }
            markOnboardingIntegrationDirty();
            clearIntegrationVerification(provider);
            onbConnectionState[provider] = createConnectionState();
            updateConnectionStatusDom(provider);
            debounceSaveOnb();
        };

        window.disconnectOnbIntegration = async function (provider) {
            if (!onbData?.integrations?.[provider]) return;
            if (provider === 'woocommerce') {
                onbData.integrations.woocommerce.website_url = '';
                onbData.integrations.woocommerce.consumer_key = '';
                onbData.integrations.woocommerce.consumer_secret = '';
            } else if (provider === 'easy_order') {
                onbData.integrations.easy_order.store_url = '';
                onbData.integrations.easy_order.api_key = '';
            } else {
                onbData.integrations.shopify.shop_domain = '';
                onbData.integrations.shopify.storefront_token = '';
                onbData.integrations.shopify.token_type = 'storefront_access_token';
                delete onbData.integrations.shopify.client_id;
                delete onbData.integrations.shopify.client_secret;
            }
            clearIntegrationVerification(provider);
            onbConnectionState[provider] = createConnectionState();
            markOnboardingIntegrationDirty();
            await saveOnbProgress();
            if (onbStep === 4) renderStepContent();
            else updateConnectionStatusDom(provider);
        };

        function normalizeWooOrigin(input) {
            const raw = String(input || '').trim();
            if (!raw) return '';
            const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
            try {
                const url = new URL(withProtocol);
                return url.origin;
            } catch (e) {
                return '';
            }
        }

        function normalizeShopifyHandle(input) {
            const raw = String(input || '').trim().toLowerCase();
            if (!raw) return '';
            const cleaned = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
            if (cleaned.endsWith('.myshopify.com')) {
                return cleaned.replace(/\.myshopify\.com$/, '');
            }
            if (/^[a-z0-9][a-z0-9-]*$/i.test(cleaned)) {
                return cleaned;
            }
            return '';
        }

        async function readProxyResponse(response) {
            const text = await response.text();
            let data = null;
            if (text) {
                try { data = JSON.parse(text); } catch (e) { }
            }
            return { ok: response.ok, status: response.status, data, text };
        }

        function extractErrorDetail(payload) {
            if (!payload) return '';
            if (payload.data) {
                if (typeof payload.data === 'string') return payload.data;
                if (Array.isArray(payload.data?.errors)) {
                    return payload.data.errors.map(err => err?.message || '').filter(Boolean).join(' ');
                }
                if (payload.data?.error?.message) return payload.data.error.message;
                if (payload.data?.message) return payload.data.message;
            }
            return payload.text || '';
        }

        function sanitizeErrorDetail(detail) {
            return String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 240);
        }

        function mapConnectionError(err) {
            const detail = sanitizeErrorDetail(err?.detail || err?.message || '');
            if (err?.code === 'domain') return { titleKey: 'onboarding.test_error_domain', detailText: detail };
            if (err?.code === 'missing') return { titleKey: 'onboarding.test_error_missing', detailText: '' };
            if (err?.code === 'permission') return { titleKey: 'onboarding.test_error_permission', detailText: detail };
            if (err?.code === 'network') return { titleKey: 'onboarding.test_error_network', detailText: detail };

            const lower = detail.toLowerCase();
            if (!detail) return { titleKey: 'onboarding.test_error_unknown', detailText: '' };
            if (lower.includes('invalid') && (lower.includes('domain') || lower.includes('shop'))) {
                return { titleKey: 'onboarding.test_error_domain', detailText: detail };
            }
            if (lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('scope') || lower.includes('consumer key') || lower.includes('credential') || lower.includes('access denied') || lower.includes('signature') || lower.includes('token')) {
                return { titleKey: 'onboarding.test_error_permission', detailText: detail };
            }
            if (lower.includes('ssl') || lower.includes('certificate') || lower.includes('network') || lower.includes('timed out') || lower.includes('failed to fetch') || lower.includes('not found') || lower.includes('resolve')) {
                return { titleKey: 'onboarding.test_error_network', detailText: detail };
            }
            return { titleKey: 'onboarding.test_error_unknown', detailText: detail };
        }

        async function requestViaProxy({ targetUrl, method = 'GET', headers = {}, body }) {
            const reqHeaders = Object.assign({ 'Target-Url': targetUrl, apikey: SUPABASE_KEY }, headers);
            const hasAuthorizationHeader = Object.keys(reqHeaders).some((key) => String(key).toLowerCase() === 'authorization');
            try {
                if (!hasAuthorizationHeader) {
                    const { data: { session } } = await supabaseClient.auth.getSession();
                    if (session?.access_token) {
                        reqHeaders['Authorization'] = `Bearer ${session.access_token}`;
                    } else {
                        reqHeaders['Authorization'] = `Bearer ${SUPABASE_KEY}`;
                    }
                }
            } catch (e) {
                if (!hasAuthorizationHeader) {
                    console.warn('proxy auth session fetch failed', e);
                    reqHeaders['Authorization'] = `Bearer ${SUPABASE_KEY}`;
                }
            }
            try {
                const response = await fetch(INTEGRATION_PROXY_URL, {
                    method,
                    headers: reqHeaders,
                    body
                });
                return readProxyResponse(response);
            } catch (err) {
                throw {
                    code: 'network',
                    detail: sanitizeErrorDetail(err?.message || 'Could not reach the integration proxy.')
                };
            }
        }

        async function requestWooSiteProbe(origin) {
            return requestViaProxy({
                targetUrl: `${origin}/wp-json/`,
                method: 'GET'
            });
        }

        async function requestWooCredentials(origin, consumerKey, consumerSecret, mode = 'basic') {
            let targetUrl = `${origin}/wp-json/wc/v3/products?per_page=1&_fields=id,name,status`;
            const headers = {};
            if (mode === 'basic') {
                headers['Authorization'] = 'Basic ' + btoa(`${consumerKey}:${consumerSecret}`);
            } else {
                targetUrl += `&consumer_key=${encodeURIComponent(consumerKey)}&consumer_secret=${encodeURIComponent(consumerSecret)}`;
            }
            return requestViaProxy({ targetUrl, method: 'GET', headers });
        }

        function shouldRetryWooWithQuery(parsed) {
            const detail = extractErrorDetail(parsed).toLowerCase();
            return parsed.status === 401 || parsed.status === 403 || detail.includes('consumer key') || detail.includes('signature') || detail.includes('authorization') || detail.includes('oauth');
        }

        async function runWooConnectionTest(config) {
            const origin = normalizeWooOrigin(config.website_url);
            if (!origin) throw { code: 'domain', detail: tOnb('onboarding.test_error_domain') };
            const probe = await requestWooSiteProbe(origin);
            if (!probe.ok) throw { code: 'network', detail: extractErrorDetail(probe) || `HTTP ${probe.status}` };

            let parsed = await requestWooCredentials(origin, config.consumer_key, config.consumer_secret, 'basic');
            let verificationMethod = 'basic_auth';
            if ((!parsed.ok || !Array.isArray(parsed.data)) && shouldRetryWooWithQuery(parsed)) {
                parsed = await requestWooCredentials(origin, config.consumer_key, config.consumer_secret, 'query');
                verificationMethod = 'query_auth';
            }
            if (!parsed.ok) {
                const detail = extractErrorDetail(parsed) || `HTTP ${parsed.status}`;
                throw { code: parsed.status === 401 || parsed.status === 403 ? 'permission' : 'network', detail };
            }
            if (!Array.isArray(parsed.data)) {
                throw { code: 'permission', detail: extractErrorDetail(parsed) || 'Unexpected WooCommerce response.' };
            }

            const sampleProduct = parsed.data[0];
            const sampleText = sampleProduct?.name ? `${sampleProduct.name}${sampleProduct?.id ? ` (#${sampleProduct.id})` : ''}` : '';
            const verifiedAt = new Date().toISOString();
            return {
                verified_at: verifiedAt,
                verified_store: new URL(origin).hostname,
                verification_method: verificationMethod,
                detailKey: verificationMethod === 'query_auth' ? 'onboarding.test_detail_woo_fallback' : 'onboarding.test_detail_woo',
                verification_snapshot: {
                    source: 'integration-proxy',
                    method: verificationMethod,
                    store: new URL(origin).hostname,
                    sample: sampleText,
                    verified_at: verifiedAt
                }
            };
        }

        window.testWooConnection = async function () {
            const w = onbData.integrations.woocommerce;
            if (onbConnectionState.woocommerce.testing) return;
            if (!w.website_url || !w.consumer_key || !w.consumer_secret) {
                setConnectionState('woocommerce', { status: 'error', titleKey: 'onboarding.test_error_missing', detailKey: '', detailText: '', testing: false });
                return;
            }

            const __wooPriorVerifiedAt = w?.verified_at || '';
            setConnectionState('woocommerce', { status: 'loading', titleKey: 'onboarding.test_loading', detailKey: '', detailText: '', testing: true });

            try {
                const result = await runWooConnectionTest(w);
                w.verified_at = result.verified_at;
                w.verified_store = result.verified_store;
                w.verification_method = result.verification_method;
                w.verification_snapshot = result.verification_snapshot;
                w.last_test_status = 'success';
                markOnboardingIntegrationDirty();

                setConnectionState('woocommerce', {
                    status: 'success',
                    titleKey: 'onboarding.test_success_woo',
                    detailKey: result.detailKey,
                    detailText: '',
                    testing: false
                });
                await saveOnbProgress();
                triggerProductSync('woocommerce', __wooPriorVerifiedAt ? 'credentials_updated' : 'initial_after_credentials_save');
            } catch (err) {
                console.warn('Woo test failed:', err);
                clearIntegrationVerification('woocommerce');
                onbData.integrations.woocommerce.last_test_status = 'failed';
                markOnboardingIntegrationDirty();
                const errorState = mapConnectionError(err);
                setConnectionState('woocommerce', Object.assign({ status: 'error', detailKey: '', testing: false }, errorState));
                await saveOnbProgress();
            }
        };

        async function directShopifyCheck(handle, token) {
            const targetUrl = `https://${handle}.myshopify.com/api/${SHOPIFY_STOREFRONT_API_VERSION}/graphql.json`;
            try {
                const resp = await fetch(targetUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Shopify-Storefront-Access-Token': token
                    },
                    body: JSON.stringify({ query: SHOPIFY_TEST_QUERY })
                });
                return readProxyResponse(resp);
            } catch (e) {
                return { ok: false, status: 0, data: null, text: e?.message || 'network error' };
            }
        }

        async function proxyShopifyCheck(handle, token) {
            const targetUrl = `https://${handle}.myshopify.com/api/${SHOPIFY_STOREFRONT_API_VERSION}/graphql.json`;
            return requestViaProxy({
                targetUrl,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Storefront-Access-Token': token
                },
                body: JSON.stringify({ query: SHOPIFY_TEST_QUERY })
            });
        }

        async function runShopifyConnectionTest(config) {
            const handle = normalizeShopifyHandle(config.shop_domain);
            if (!handle) throw { code: 'domain', detail: tOnb('onboarding.test_error_domain') };

            let parsed = await directShopifyCheck(handle, config.storefront_token);
            let verificationMethod = 'storefront_access_token_direct';
            let detailKey = 'onboarding.test_detail_shopify';
            let proofSource = 'direct_storefront';

            const directDetail = extractErrorDetail(parsed).toLowerCase();
            const shouldFallbackToProxy = !parsed.ok && (!parsed.status || parsed.status === 0 || directDetail.includes('cors') || directDetail.includes('failed to fetch'));
            if (shouldFallbackToProxy) {
                parsed = await proxyShopifyCheck(handle, config.storefront_token);
                verificationMethod = 'storefront_access_token_proxy';
                detailKey = 'onboarding.test_detail_shopify_proxy';
                proofSource = 'integration-proxy';
            }

            if (!parsed.ok) {
                const detail = extractErrorDetail(parsed) || `HTTP ${parsed.status || '0'}`;
                throw {
                    code: (!parsed.status || parsed.status === 0) ? 'network' : (parsed.status === 401 || parsed.status === 403 ? 'permission' : 'network'),
                    detail
                };
            }
            if (Array.isArray(parsed.data?.errors) && parsed.data.errors.length) {
                throw { code: 'permission', detail: parsed.data.errors.map(err => err?.message || '').filter(Boolean).join(' ') };
            }

            const shop = parsed.data?.data?.shop;
            if (!shop?.name) {
                throw { code: 'permission', detail: extractErrorDetail(parsed) || 'Shopify did not return shop details.' };
            }
            const firstProduct = parsed.data?.data?.products?.edges?.[0]?.node;
            const sampleText = firstProduct?.title ? `${firstProduct.title}${firstProduct?.handle ? ` (${firstProduct.handle})` : ''}` : shop.name;
            const verifiedAt = new Date().toISOString();
            return {
                verified_at: verifiedAt,
                verified_store: shop.primaryDomain?.host || `${handle}.myshopify.com`,
                verification_method: verificationMethod,
                detailKey,
                verification_snapshot: {
                    source: proofSource,
                    method: 'storefront_access_token',
                    store: shop.primaryDomain?.host || `${handle}.myshopify.com`,
                    sample: sampleText,
                    verified_at: verifiedAt
                }
            };
        }

        window.testShopifyConnection = async function () {
            const s = onbData.integrations.shopify;
            if (onbConnectionState.shopify.testing) return;
            if (!s.shop_domain || !s.storefront_token) {
                setConnectionState('shopify', { status: 'error', titleKey: 'onboarding.test_error_missing', detailKey: '', detailText: '', testing: false });
                return;
            }

            const __shopPriorVerifiedAt = s?.verified_at || '';
            setConnectionState('shopify', { status: 'loading', titleKey: 'onboarding.test_loading', detailKey: '', detailText: '', testing: true });

            try {
                const result = await runShopifyConnectionTest(s);
                s.token_type = 'storefront_access_token';
                s.verified_at = result.verified_at;
                s.verified_store = result.verified_store;
                s.verification_method = result.verification_method;
                s.verification_snapshot = result.verification_snapshot;
                s.last_test_status = 'success';
                delete s.client_id;
                delete s.client_secret;
                markOnboardingIntegrationDirty();

                setConnectionState('shopify', {
                    status: 'success',
                    titleKey: 'onboarding.test_success_shopify',
                    detailKey: result.detailKey,
                    detailText: '',
                    testing: false
                });
                await saveOnbProgress();
                triggerProductSync('shopify', __shopPriorVerifiedAt ? 'credentials_updated' : 'initial_after_credentials_save');
            } catch (err) {
                console.warn('Shopify test failed:', err);
                clearIntegrationVerification('shopify');
                onbData.integrations.shopify.last_test_status = 'failed';
                markOnboardingIntegrationDirty();
                const errorState = mapConnectionError(err);
                setConnectionState('shopify', Object.assign({ status: 'error', detailKey: '', testing: false }, errorState));
                await saveOnbProgress();
            }
        };

        function normalizeEasyOrderHandle(input) {
            const raw = String(input || '').trim().toLowerCase();
            if (!raw) return '';
            const cleaned = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
            if (cleaned.endsWith('.easy-orders.net')) {
                return cleaned.replace(/\.easy-orders\.net$/, '');
            }
            if (/^[a-z0-9][a-z0-9-]*$/i.test(cleaned)) {
                return cleaned;
            }
            return '';
        }

        async function directEasyOrderCheck(handle, apiKey) {
            const targetUrl = `https://api.easy-orders.net/api/v1/external-apps/products`;
            try {
                const resp = await fetch(targetUrl, {
                    method: 'GET',
                    headers: { 'Api-Key': apiKey }
                });
                return readProxyResponse(resp);
            } catch (e) {
                return { ok: false, status: 0, data: null, text: e?.message || 'network error' };
            }
        }

        async function proxyEasyOrderCheck(handle, apiKey) {
            const targetUrl = `https://api.easy-orders.net/api/v1/external-apps/products`;
            return requestViaProxy({
                targetUrl,
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                // Pass Api-Key via custom target header encoding in the URL
            }).catch(() => {
                // Fallback: try with API key in URL query param
                return requestViaProxy({
                    targetUrl: `${targetUrl}?api_key=${encodeURIComponent(apiKey)}`,
                    method: 'GET'
                });
            });
        }

        async function runEasyOrderConnectionTest(config) {
            const apiKey = String(config.api_key || '').trim();
            const handle = normalizeEasyOrderHandle(config.store_url);
            if (!handle) throw { code: 'domain', detail: tOnb('onboarding.test_error_domain') };
            if (!apiKey) throw { code: 'missing', detail: '' };

            let parsed = await directEasyOrderCheck(handle, apiKey);
            let proofSource = 'direct_api';
            let detailKey = 'onboarding.test_detail_easy_order';

            const directDetail = extractErrorDetail(parsed).toLowerCase();
            const shouldFallbackToProxy = !parsed.ok && (!parsed.status || parsed.status === 0 || directDetail.includes('cors') || directDetail.includes('failed to fetch'));
            if (shouldFallbackToProxy) {
                parsed = await proxyEasyOrderCheck(handle, apiKey);
                proofSource = 'integration-proxy';
            }

            if (!parsed.ok) {
                const detail = extractErrorDetail(parsed) || `HTTP ${parsed.status || '0'}`;
                throw {
                    code: (!parsed.status || parsed.status === 0) ? 'network' : (parsed.status === 401 || parsed.status === 403 ? 'permission' : 'network'),
                    detail
                };
            }

            const products = Array.isArray(parsed.data) ? parsed.data : (Array.isArray(parsed.data?.data) ? parsed.data.data : (Array.isArray(parsed.data?.products) ? parsed.data.products : null));
            const firstProduct = products?.[0];
            const sampleText = firstProduct ? String(firstProduct.name || firstProduct.title || '').slice(0, 120) : '';
            const storeName = `${handle}.easy-orders.net`;
            const verifiedAt = new Date().toISOString();
            return {
                verified_at: verifiedAt,
                verified_store: storeName,
                verification_method: 'api_key',
                detailKey,
                verification_snapshot: {
                    source: proofSource,
                    method: 'api_key',
                    store: storeName,
                    sample: sampleText,
                    verified_at: verifiedAt
                }
            };
        }

        window.testEasyOrderConnection = async function () {
            const eo = onbData.integrations.easy_order;
            if (onbConnectionState.easy_order.testing) return;
            if (!eo.store_url || !eo.api_key) {
                setConnectionState('easy_order', { status: 'error', titleKey: 'onboarding.test_error_missing', detailKey: '', detailText: '', testing: false });
                return;
            }

            const __eoPriorVerifiedAt = eo?.verified_at || '';
            setConnectionState('easy_order', { status: 'loading', titleKey: 'onboarding.test_loading', detailKey: '', detailText: '', testing: true });

            try {
                const result = await runEasyOrderConnectionTest(eo);
                eo.verified_at = result.verified_at;
                eo.verified_store = result.verified_store;
                eo.verification_method = result.verification_method;
                eo.verification_snapshot = result.verification_snapshot;
                eo.last_test_status = 'success';
                markOnboardingIntegrationDirty();

                setConnectionState('easy_order', {
                    status: 'success',
                    titleKey: 'onboarding.test_success_easy_order',
                    detailKey: result.detailKey,
                    detailText: '',
                    testing: false
                });
                await saveOnbProgress();
                triggerProductSync('easyorders', __eoPriorVerifiedAt ? 'credentials_updated' : 'initial_after_credentials_save');
            } catch (err) {
                console.warn('Easy Order test failed:', err);
                clearIntegrationVerification('easy_order');
                onbData.integrations.easy_order.last_test_status = 'failed';
                markOnboardingIntegrationDirty();
                const errorState = mapConnectionError(err);
                setConnectionState('easy_order', Object.assign({ status: 'error', detailKey: '', testing: false }, errorState));
                await saveOnbProgress();
            }
        };

        function renderStepReview() {
            const d = onbData;
            const ns = tOnb('onboarding.review_not_set');
            const sk = tOnb('onboarding.review_skipped');
            const offerStr = d.business.offer_type === 'product' ? tOnb('onboarding.offer_product') : d.business.offer_type === 'service' ? tOnb('onboarding.offer_service') : ns;
            const waStr = d.channels.whatsapp_number || (d.channels.skipped ? sk : ns);
            const kbCount = (d.knowledge_base.uploaded_files ? d.knowledge_base.uploaded_files.length : 0) + onbFiles.filter(f => f.status === 'uploaded').length;
            const kbStr = kbCount > 0 ? tOnb('onboarding.review_files_uploaded', { count: kbCount }) : tOnb('onboarding.review_no_files');
            const woo = d.integrations.woocommerce;
            const shop = d.integrations.shopify;
            const eo = d.integrations.easy_order;
            const hasWoo = woo.website_url && woo.consumer_key;
            const hasShop = shop.shop_domain && shop.storefront_token;
            const hasEo = eo.store_url && eo.api_key;
            let intStr = '';
            if (hasWoo) intStr += buildIntegrationReviewLabel(tOnb('onboarding.review_woo_connected'), woo);
            if (hasShop) intStr += (intStr ? ', ' : '') + buildIntegrationReviewLabel(tOnb('onboarding.review_shopify_connected'), shop);
            if (hasEo) intStr += (intStr ? ', ' : '') + buildIntegrationReviewLabel(tOnb('onboarding.review_easy_order_connected'), eo);
            if (!intStr) intStr = tOnb('onboarding.review_no_integrations');

            return `<div class="onb-step-card">
                <h3 class="onb-step-title">${tOnb('onboarding.review_title')}</h3>
                <p class="onb-step-subtitle">${tOnb('onboarding.review_subtitle')}</p>
                <div class="onb-review-grid">
                    <div class="onb-review-section">
                        <h4>${tOnb('onboarding.review_profile')}</h4>
                        <div class="onb-review-row"><span class="label">${tOnb('onboarding.label_full_name')}</span><span class="value">${esc(d.profile.full_name || ns)}</span></div>
                        <div class="onb-review-row"><span class="label">${tOnb('onboarding.label_company_name')}</span><span class="value">${esc(d.profile.company_name || ns)}</span></div>
                    </div>
                    <div class="onb-review-section">
                        <h4>${tOnb('onboarding.review_business')}</h4>
                        <div class="onb-review-row"><span class="label">${tOnb('onboarding.label_industry')}</span><span class="value">${esc(d.business.industry || ns)}</span></div>
                        <div class="onb-review-row"><span class="label">${tOnb('onboarding.label_offer_type')}</span><span class="value">${offerStr}</span></div>
                        ${d.business.description ? `<div class="onb-review-row"><span class="label">${tOnb('onboarding.label_description')}</span><span class="value">${esc(d.business.description)}</span></div>` : ''}
                    </div>
                    <div class="onb-review-section">
                        <h4>${tOnb('onboarding.review_channels')}</h4>
                        <div class="onb-review-row"><span class="label">${tOnb('onboarding.label_whatsapp')}</span><span class="value">${esc(waStr)}</span></div>
                    </div>
                    <div class="onb-review-section">
                        <h4>${tOnb('onboarding.review_kb')}</h4>
                        <div class="onb-review-row"><span class="label">${tOnb('onboarding.step_kb')}</span><span class="value">${kbStr}</span></div>
                    </div>
                    <div class="onb-review-section">
                        <h4>${tOnb('onboarding.review_integrations')}</h4>
                        <div class="onb-review-row"><span class="label">${tOnb('onboarding.step_integrations')}</span><span class="value">${intStr}</span></div>
                    </div>
                </div>
            </div>`;
        }

        function buildIntegrationReviewLabel(label, config) {
            const suffix = config?.verified_at ? tOnb('onboarding.review_verified_suffix') : tOnb('onboarding.review_not_tested_suffix');
            return `${label} (${suffix})`;
        }

        // --- STEP NAVIGATION ---
        window.nextOnboardingStep = function () {
            if (!validateStep()) return;
            onbData.ui.last_step = Math.max(onbData.ui.last_step || 0, onbStep);
            saveOnbProgress();
            onbStep = Math.min(onbStep + 1, ONB_STEPS.length - 1);
            renderWizard();
        };

        window.prevOnboardingStep = function () {
            onbStep = Math.max(onbStep - 1, 0);
            renderWizard();
        };

        window.skipOnboardingStep = function () {
            if (onbStep === 2) { onbData.channels.skipped = true; }
            onbData.ui.last_step = Math.max(onbData.ui.last_step || 0, onbStep);
            saveOnbProgress();
            onbStep = Math.min(onbStep + 1, ONB_STEPS.length - 1);
            renderWizard();
        };

        // --- VALIDATION ---
        function validateStep() {
            clearErrors();
            let valid = true;
            if (onbStep === 0) {
                if (!onbData.profile.full_name.trim()) { showFieldError('onb-f-name'); valid = false; }
                if (!onbData.profile.company_name.trim()) { showFieldError('onb-f-company'); valid = false; }
            } else if (onbStep === 1) {
                if (!onbData.business.industry.trim()) { showFieldError('onb-f-industry'); valid = false; }
                if (!onbData.business.offer_type) { showFieldError('onb-f-offer'); valid = false; }
            }
            return valid;
        }

        function showFieldError(id) {
            const el = document.getElementById(id);
            if (el) el.classList.add('has-error');
        }

        function clearErrors() {
            document.querySelectorAll('.onb-field.has-error').forEach(el => el.classList.remove('has-error'));
        }

        // --- INDUSTRY DROPDOWN ---
        window.openOnbIndustryList = function () {
            filterOnbIndustry(document.getElementById('onb-industry-input')?.value || '');
            const list = document.getElementById('onb-industry-list');
            if (list) list.classList.add('open');
            onbIndustryOpen = true;
        };

        window.filterOnbIndustry = function (search) {
            const industries = tOnb('onboarding.industries');
            if (!Array.isArray(industries)) return;
            const list = document.getElementById('onb-industry-list');
            if (!list) return;
            const lower = search.toLowerCase();
            list.innerHTML = industries.filter(ind => !lower || ind.toLowerCase().includes(lower)).map(ind =>
                `<div class="onb-industry-item ${onbData.business.industry === ind ? 'selected' : ''}" onclick="selectOnbIndustry('${esc(ind)}')">${ind}</div>`
            ).join('');
            if (!list.classList.contains('open')) list.classList.add('open');
        };

        window.selectOnbIndustry = function (val) {
            onbData.business.industry = val;
            const input = document.getElementById('onb-industry-input');
            if (input) input.value = val;
            const list = document.getElementById('onb-industry-list');
            if (list) list.classList.remove('open');
            onbIndustryOpen = false;
            debounceSaveOnb();
        };

        // Close industry dropdown on outside click
        document.addEventListener('click', function (e) {
            if (onbIndustryOpen && !e.target.closest('.onb-industry-wrap')) {
                const list = document.getElementById('onb-industry-list');
                if (list) list.classList.remove('open');
                onbIndustryOpen = false;
            }
        });

        // --- OFFER TYPE ---
        window.selectOfferType = function (type, evt) {
            onbData.business.offer_type = type;
            document.querySelectorAll('.onb-offer-btn').forEach(b => b.classList.remove('selected'));
            if (evt?.currentTarget) evt.currentTarget.classList.add('selected');
            // Update description label
            const lbl = document.getElementById('onb-desc-label');
            if (lbl) lbl.textContent = type === 'product' ? tOnb('onboarding.label_description_product') : type === 'service' ? tOnb('onboarding.label_description_service') : tOnb('onboarding.label_description');
            debounceSaveOnb();
        };

        // --- FILE UPLOAD ---
        function afterStepRender() {
            if (onbStep === 3) initDropZone();
        }

        function initDropZone() {
            const zone = document.getElementById('onb-drop-zone');
            if (!zone) return;
            zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
            zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('dragover');
                handleOnbFileSelect(e.dataTransfer.files);
            });
        }

        window.handleOnbFileSelect = function (fileList) {
            if (!fileList || !fileList.length) return;
            const errors = [];
            let totalSize = onbFiles.reduce((s, f) => s + f.file.size, 0);
            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];
                const ext = file.name.split('.').pop().toLowerCase();
                if (!ALLOWED_KB_EXT.includes(ext)) {
                    errors.push(tOnb('onboarding.kb_error_type', { name: file.name }));
                    continue;
                }
                if (file.size > MAX_FILE_SIZE) {
                    errors.push(tOnb('onboarding.kb_error_size', { name: file.name }));
                    continue;
                }
                if (totalSize + file.size > MAX_TOTAL_SIZE) {
                    errors.push(tOnb('onboarding.kb_error_total'));
                    break;
                }
                totalSize += file.size;
                onbFiles.push({ file, status: 'pending' });
            }
            if (errors.length) errors.forEach(e => showToast(e, 'error'));
            renderStepContent();
            // Reset file input
            const inp = document.getElementById('onb-file-input');
            if (inp) inp.value = '';
        };

        window.removeOnbFile = function (index) {
            onbFiles.splice(index, 1);
            renderStepContent();
        };

        async function uploadOnbFiles() {
            const pending = onbFiles.filter(f => f.status === 'pending');
            if (pending.length === 0) return;
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) return;
            let successCount = 0, failCount = 0;

            for (const entry of pending) {
                entry.status = 'uploading';
                renderStepContent();
                try {
                    const ts = Date.now();
                    const safeName = entry.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                    const storagePath = `${currentUserOrgId}/onboarding/${ts}_${safeName}`;
                    const { data: uploadData, error: uploadError } = await supabaseClient.storage
                        .from('knowledge_base')
                        .upload(storagePath, entry.file, { upsert: false });

                    if (uploadError) throw uploadError;

                    // Insert single canonical entry into agent_kb_files bound to 'website' acting as the cross-agent org sentinel
                    const { error: insertError } = await window.supabaseClient.from('agent_kb_files').insert({
                        org_id: currentUserOrgId,
                        agent: 'website',
                        bucket: 'knowledge_base',
                        path: storagePath,
                        filename: entry.file.name,
                        mime_type: entry.file.type || 'application/octet-stream',
                        size_bytes: entry.file.size,
                        created_by: user.id
                    });

                    if (insertError) throw insertError;

                    entry.status = 'uploaded';
                    successCount++;
                    // Track in onbData
                    if (!onbData.knowledge_base.uploaded_files) onbData.knowledge_base.uploaded_files = [];
                    onbData.knowledge_base.uploaded_files.push({ filename: entry.file.name, path: storagePath, size_bytes: entry.file.size, mime_type: entry.file.type });
                } catch (err) {
                    console.error('KB upload error:', err);
                    entry.status = 'failed';
                    failCount++;
                }
                renderStepContent();
            }

            if (successCount > 0 && failCount === 0) {
                showToast(tOnb('onboarding.kb_upload_success', { count: successCount }), 'success');
            } else if (successCount > 0 && failCount > 0) {
                showToast(tOnb('onboarding.kb_upload_partial', { success: successCount, total: successCount + failCount, failed: failCount }), 'info');
            } else if (failCount > 0) {
                showToast(tOnb('onboarding.kb_upload_all_failed'), 'error');
            }
        }

        // --- PERSISTENCE ---
        function debounceSaveOnb() {
            clearTimeout(onbSaveTimer);
            onbSaveTimer = setTimeout(() => saveOnbProgress(), 2000);
        }
        window.debounceSaveOnb = debounceSaveOnb;

        async function saveOnbProgress() {
            if (!currentUserOrgId || !onbData) return;
            onbData.ui.last_step = onbStep;
            onbData.ui.last_saved_at = new Date().toISOString();

            try {
                // Fetch the absolute latest network state to deep merge safely without destroying 
                // data altered in parallel tabs/integrations
                const { data: latest } = await supabaseClient.from('organizations').select('external_onboarding_data').eq('id', currentUserOrgId).single();
                let merged = onbData;

                if (latest && latest.external_onboarding_data) {
                    merged = mergeOnbData(latest.external_onboarding_data);
                    // Overwrite selectively with our active state
                    if (onbStep >= 0) Object.assign(merged.profile, onbData.profile);
                    if (onbStep >= 1) Object.assign(merged.business, onbData.business);
                    if (onbStep >= 2) Object.assign(merged.channels, onbData.channels);
                    Object.assign(merged.knowledge_base, onbData.knowledge_base);
                    Object.assign(merged.integrations.woocommerce, onbData.integrations.woocommerce);
                    Object.assign(merged.integrations.shopify, onbData.integrations.shopify);
                    Object.assign(merged.integrations.easy_order, onbData.integrations.easy_order);
                    merged.ui.last_step = onbStep;
                    merged.ui.last_saved_at = onbData.ui.last_saved_at;
                }
                merged.integrations = normalizeIntegrationsBlock(merged.integrations);

                await supabaseClient.from('organizations').update({
                    external_onboarding_data: merged
                }).eq('id', currentUserOrgId);
                onbData.integrations = normalizeIntegrationsBlock(merged.integrations);
                if (typeof currentOrgData !== 'undefined' && currentOrgData) {
                    currentOrgData.external_onboarding_data = merged;
                    if (typeof applyOfferTypeUI === 'function') applyOfferTypeUI();
                }
                syncSavedIntegrationSignature();
            } catch (e) {
                console.warn('Onboarding save error:', e);
            }
        }

        // --- FINISH ---
        window.finishOnboarding = async function () {
            if (onbFinishing) return;
            onbFinishing = true;
            const btn = document.getElementById('onb-finish-btn');
            if (btn) { btn.disabled = true; btn.textContent = '...'; }

            // Upload any pending files first
            await uploadOnbFiles();

            // Save profile + org name
            try {
                const { data: { user } } = await supabaseClient.auth.getUser();
                if (user && onbData.profile.full_name) {
                    await supabaseClient.from('profiles').update({ full_name: onbData.profile.full_name }).eq('user_id', user.id);
                    if (typeof currentUserProfile !== 'undefined' && currentUserProfile) currentUserProfile.full_name = onbData.profile.full_name;
                }
                if (onbData.profile.company_name) {
                    await supabaseClient.from('organizations').update({ name: onbData.profile.company_name }).eq('id', currentUserOrgId);
                    if (typeof currentOrgData !== 'undefined' && currentOrgData) currentOrgData.name = onbData.profile.company_name;
                }
            } catch (e) { console.warn('Profile/org save error:', e); }

            onbData.ui.last_step = 5;
            onbData.ui.last_saved_at = new Date().toISOString();
            onbData.integrations = normalizeIntegrationsBlock(onbData.integrations);

            try {
                const { error } = await supabaseClient.from('organizations').update({
                    external_onboarding_data: onbData,
                    external_onboarding_completed: true,
                    external_onboarding_completed_at: new Date().toISOString()
                }).eq('id', currentUserOrgId);

                if (error) throw error;

                if (typeof currentOrgData !== 'undefined' && currentOrgData) {
                    currentOrgData.external_onboarding_completed = true;
                    currentOrgData.external_onboarding_data = onbData;
                    if (typeof applyOfferTypeUI === 'function') applyOfferTypeUI();
                }
                syncSavedIntegrationSignature();

                document.getElementById('onb-overlay').classList.remove('show');
                document.body.style.overflow = '';
                dismissOnboardingBanner();
                showToast(tOnb('onboarding.finish_success'), 'success');

                // Refresh profile modal data
                if (typeof updateProfileModalData === 'function') updateProfileModalData();
                // Update top-bar avatar
                const avatarEl = document.getElementById('top-bar-avatar');
                if (avatarEl && onbData.profile.full_name) avatarEl.innerText = onbData.profile.full_name.charAt(0).toUpperCase();
            } catch (e) {
                console.error('Finish onboarding error:', e);
                showToast(tOnb('onboarding.finish_error'), 'error');
                onbFinishing = false;
                if (btn) { btn.disabled = false; btn.textContent = tOnb('onboarding.btn_finish'); }
            }
        };

        // --- INTEGRATIONS HUB TAB ---
        let ihData = normalizeIntegrationsBlock(null);
        let ihConnectionState = defaultConnectionState();
        let ihCanEdit = false;
        let ihSaving = false;
        let ihDirty = false;

        function setHubDirty(next) {
            ihDirty = !!next;
        }

        window.confirmDiscardIntegrationsChanges = function () {
            if (!ihDirty) return true;
            const confirmed = window.confirm(t('integrations_hub.unsaved_leave_confirm'));
            if (confirmed) setHubDirty(false);
            return confirmed;
        };

        window.hasUnsavedIntegrationsChanges = function () {
            return ihDirty;
        };

        window.addEventListener('beforeunload', (event) => {
            if (!ihCanEdit || !ihDirty) return;
            event.preventDefault();
            event.returnValue = '';
        });

        function syncHubConnectionStateFromData() {
            ihConnectionState = defaultConnectionState();
            if (ihData.woocommerce?.verified_at) {
                ihConnectionState.woocommerce = {
                    status: 'success',
                    titleKey: 'onboarding.test_success_woo',
                    detailKey: ihData.woocommerce.verification_method === 'query_auth' ? 'onboarding.test_detail_woo_fallback' : 'onboarding.test_detail_woo',
                    detailText: '',
                    testing: false
                };
            }
            if (ihData.shopify?.verified_at) {
                ihConnectionState.shopify = {
                    status: 'success',
                    titleKey: 'onboarding.test_success_shopify',
                    detailKey: ihData.shopify.verification_method === 'storefront_access_token_proxy' ? 'onboarding.test_detail_shopify_proxy' : 'onboarding.test_detail_shopify',
                    detailText: '',
                    testing: false
                };
            }
            if (ihData.easy_order?.verified_at) {
                ihConnectionState.easy_order = {
                    status: 'success',
                    titleKey: 'onboarding.test_success_easy_order',
                    detailKey: 'onboarding.test_detail_easy_order',
                    detailText: '',
                    testing: false
                };
            }
        }

        function getIntegrationProviderTitle(provider) {
            if (provider === 'woocommerce') return tOnb('onboarding.integrations_woo_title');
            if (provider === 'easy_order') return tOnb('onboarding.integrations_easy_order_title');
            return tOnb('onboarding.integrations_shopify_title');
        }

        function clearHubVerification(provider) {
            const target = ihData?.[provider];
            if (!target) return;
            target.verified_at = '';
            target.verified_store = '';
            target.verification_method = '';
            target.verification_snapshot = null;
            target.last_test_status = '';
        }

        function renderHubStatus(provider) {
            const state = ihConnectionState[provider];
            if (!state || state.status === 'idle') return '';
            const title = state.titleKey ? tOnb(state.titleKey) : '';
            const detailParts = [];
            if (state.detailKey) detailParts.push(tOnb(state.detailKey));
            if (state.detailText) detailParts.push(state.detailText);
            const detail = detailParts.join(' ').trim();
            const proofHtml = renderProofRows(ihData?.[provider]?.verification_snapshot);
            return `<div class="onb-test-result ${state.status}">
                <div class="onb-test-result-title">${esc(title || tOnb('onboarding.test_error_unknown'))}</div>
                ${detail ? `<div class="onb-test-result-detail">${esc(detail)}</div>` : ''}
                ${proofHtml}
            </div>`;
        }

        function renderHubProviderCard(provider) {
            const cfg = ihData[provider];
            const testing = !!ihConnectionState[provider]?.testing;
            const disabled = ihCanEdit ? '' : 'disabled';
            const testFn = provider === 'woocommerce' ? 'testHubWooConnection' : provider === 'easy_order' ? 'testHubEasyOrderConnection' : 'testHubShopifyConnection';
            const disconnectFn = `disconnectHubIntegration('${provider}')`;
            const logo = provider === 'woocommerce' ? PLATFORM_LOGOS.wordpress : provider === 'easy_order' ? PLATFORM_LOGOS.easy_order : PLATFORM_LOGOS.shopify;
            const badge = provider === 'woocommerce' ? tOnb('onboarding.integrations_https_recommended') : provider === 'easy_order' ? tOnb('onboarding.integrations_easy_order_badge') : tOnb('onboarding.integrations_shopify_private_note');
            const subtitle = provider === 'woocommerce' ? tOnb('onboarding.integrations_woo_hint') : provider === 'easy_order' ? tOnb('onboarding.integrations_easy_order_hint') : tOnb('onboarding.integrations_shopify_hint');
            let fields;
            if (provider === 'woocommerce') {
                fields = `<div class="ih-form-grid">
                        <div class="ih-field full">
                            <label>${tOnb('onboarding.label_woo_url')}</label>
                            <input type="text" value="${esc(cfg.website_url)}" placeholder="${tOnb('onboarding.placeholder_woo_url')}" oninput="updateHubIntegrationField('woocommerce','website_url',this.value)" ${disabled}>
                        </div>
                        <div class="ih-field">
                            <label>${tOnb('onboarding.label_woo_ck')}</label>
                            <input type="text" value="${esc(cfg.consumer_key)}" placeholder="${tOnb('onboarding.placeholder_woo_ck')}" oninput="updateHubIntegrationField('woocommerce','consumer_key',this.value)" ${disabled}>
                        </div>
                        <div class="ih-field">
                            <label>${tOnb('onboarding.label_woo_cs')}</label>
                            <input type="password" value="${esc(cfg.consumer_secret)}" placeholder="${tOnb('onboarding.placeholder_woo_cs')}" oninput="updateHubIntegrationField('woocommerce','consumer_secret',this.value)" ${disabled}>
                        </div>
                    </div>`;
            } else if (provider === 'easy_order') {
                fields = `<div class="ih-form-grid">
                        <div class="ih-field full">
                            <label>${tOnb('onboarding.label_easy_order_store')}</label>
                            <div class="ih-inline-domain">
                                <input type="text" value="${esc(cfg.store_url)}" placeholder="${tOnb('onboarding.placeholder_easy_order_store')}" oninput="updateHubIntegrationField('easy_order','store_url',this.value)" ${disabled}>
                                <span class="ih-domain-suffix">.easy-orders.net</span>
                            </div>
                        </div>
                        <div class="ih-field full">
                            <label>${tOnb('onboarding.label_easy_order_api_key')}</label>
                            <input type="password" value="${esc(cfg.api_key)}" placeholder="${tOnb('onboarding.placeholder_easy_order_api_key')}" oninput="updateHubIntegrationField('easy_order','api_key',this.value)" ${disabled}>
                        </div>
                    </div>`;
            } else {
                fields = `<div class="ih-form-grid">
                        <div class="ih-field full">
                            <label>${tOnb('onboarding.label_shopify_domain')}</label>
                            <div class="ih-inline-domain">
                                <input type="text" value="${esc(cfg.shop_domain)}" placeholder="${tOnb('onboarding.placeholder_shopify_domain')}" oninput="updateHubIntegrationField('shopify','shop_domain',this.value)" ${disabled}>
                                <span class="ih-domain-suffix">.myshopify.com</span>
                            </div>
                        </div>
                        <div class="ih-field full">
                            <label>${tOnb('onboarding.label_shopify_token')}</label>
                            <input type="password" value="${esc(cfg.storefront_token)}" placeholder="${tOnb('onboarding.placeholder_shopify_token')}" oninput="updateHubIntegrationField('shopify','storefront_token',this.value)" ${disabled}>
                        </div>
                    </div>`;
            }

            return `<div class="ih-card">
                <div class="ih-card-head">
                    <div class="ih-brand">
                        <img class="ih-logo" src="${logo.primary}" onerror="this.onerror=null;this.src='${logo.fallback}'" alt="${esc(getIntegrationProviderTitle(provider))}" loading="lazy" decoding="async">
                        <div>
                            <h3 class="ih-card-title">${getIntegrationProviderTitle(provider)}</h3>
                            <p class="ih-card-subtitle">${subtitle}</p>
                        </div>
                    </div>
                    <span class="ih-badge">${badge}</span>
                </div>
                ${fields}
                <div class="ih-actions">
                    <button class="ih-btn" onclick="${testFn}()" ${testing || !ihCanEdit ? 'disabled' : ''}>${testing ? tOnb('onboarding.test_loading') : tOnb('onboarding.btn_test_connection')}</button>
                    <button class="ih-btn ih-btn-danger" onclick="${disconnectFn}" ${!ihCanEdit ? 'disabled' : ''}>${t('integrations_hub.btn_disconnect')}</button>
                </div>
                ${renderHubStatus(provider)}
            </div>`;
        }

        function renderIntegrationsHubFromState() {
            const root = document.getElementById('integrations-root');
            const note = document.getElementById('ih-readonly-note');
            if (!root || !note) return;
            note.style.display = 'block';
            const baseNote = ihCanEdit ? t('integrations_hub.owner_only') : t('integrations_hub.read_only');
            note.textContent = (ihCanEdit && ihDirty) ? `${baseNote} ${t('integrations_hub.unsaved_hint')}` : baseNote;
            root.innerHTML = `<div class="ih-grid">
                    ${renderHubProviderCard('woocommerce')}
                    ${renderHubProviderCard('shopify')}
                    ${renderHubProviderCard('easy_order')}
                </div>
                <div class="ih-save-all">
                    <button class="ih-btn" onclick="saveIntegrationsHub()" ${!ihCanEdit || ihSaving ? 'disabled' : ''}>${t('integrations_hub.btn_save')}</button>
                </div>`;
            if (typeof applyIntegrationsHubHelp === 'function') applyIntegrationsHubHelp();
        }

        async function loadLatestOnboardingForHub() {
            if (!currentUserOrgId) return mergeOnbData(currentOrgData?.external_onboarding_data || null);
            try {
                const { data, error } = await supabaseClient
                    .from('organizations')
                    .select('external_onboarding_data')
                    .eq('id', currentUserOrgId)
                    .single();
                if (!error && data?.external_onboarding_data) {
                    if (currentOrgData) currentOrgData.external_onboarding_data = data.external_onboarding_data;
                    if (typeof applyOfferTypeUI === 'function') applyOfferTypeUI();
                    return mergeOnbData(data.external_onboarding_data);
                }
            } catch (e) {
                console.warn('loadLatestOnboardingForHub failed', e);
            }
            return mergeOnbData(currentOrgData?.external_onboarding_data || null);
        }

        async function persistHubIntegrations() {
            if (!currentUserOrgId) throw new Error('Missing organization context');
            const latest = await loadLatestOnboardingForHub();
            latest.integrations = normalizeIntegrationsBlock(ihData);
            latest.ui.last_saved_at = new Date().toISOString();
            const { error } = await supabaseClient
                .from('organizations')
                .update({ external_onboarding_data: latest })
                .eq('id', currentUserOrgId);
            if (error) throw error;
            if (currentOrgData) currentOrgData.external_onboarding_data = latest;
            if (typeof applyOfferTypeUI === 'function') applyOfferTypeUI();
            if (onbData) onbData.integrations = normalizeIntegrationsBlock(latest.integrations);
        }

        window.renderIntegrationsHub = async function () {
            const tab = document.getElementById('integrations');
            if (!tab) return;
            ihCanEdit = isOwner();
            const merged = await loadLatestOnboardingForHub();
            ihData = normalizeIntegrationsBlock(merged.integrations);
            setHubDirty(false);
            syncHubConnectionStateFromData();
            renderIntegrationsHubFromState();
        };

        window.updateHubIntegrationField = function (provider, field, value) {
            if (!ihCanEdit || !ihData?.[provider]) return;
            ihData[provider][field] = value;
            if (provider === 'shopify') {
                ihData.shopify.token_type = 'storefront_access_token';
                delete ihData.shopify.client_id;
                delete ihData.shopify.client_secret;
            }
            clearHubVerification(provider);
            ihConnectionState[provider] = createConnectionState();
            setHubDirty(true);
            // Update only the readonly note and status area without full re-render to keep focus
            const note = document.getElementById('ih-readonly-note');
            if (note) {
                const baseNote = ihCanEdit ? t('integrations_hub.owner_only') : t('integrations_hub.read_only');
                note.textContent = (ihCanEdit && ihDirty) ? `${baseNote} ${t('integrations_hub.unsaved_hint')}` : baseNote;
            }
        };

        window.saveIntegrationsHub = async function () {
            if (!ihCanEdit || ihSaving) return;
            ihSaving = true;
            renderIntegrationsHubFromState();
            try {
                ihData = normalizeIntegrationsBlock(ihData);
                await persistHubIntegrations();
                setHubDirty(false);
                showToast(t('integrations_hub.save_success'), 'success');
            } catch (e) {
                console.error('saveIntegrationsHub error', e);
                showToast(t('integrations_hub.save_error'), 'error');
            } finally {
                ihSaving = false;
                renderIntegrationsHubFromState();
            }
        };

        window.disconnectHubIntegration = async function (provider) {
            if (!ihCanEdit || !ihData?.[provider]) return;
            if (provider === 'woocommerce') {
                ihData.woocommerce.website_url = '';
                ihData.woocommerce.consumer_key = '';
                ihData.woocommerce.consumer_secret = '';
            } else if (provider === 'easy_order') {
                ihData.easy_order.store_url = '';
                ihData.easy_order.api_key = '';
            } else {
                ihData.shopify.shop_domain = '';
                ihData.shopify.storefront_token = '';
                ihData.shopify.token_type = 'storefront_access_token';
                delete ihData.shopify.client_id;
                delete ihData.shopify.client_secret;
            }
            clearHubVerification(provider);
            ihConnectionState[provider] = createConnectionState();
            setHubDirty(true);
            renderIntegrationsHubFromState();
            try {
                await persistHubIntegrations();
                setHubDirty(false);
                showToast(t('integrations_hub.disconnect_success', { provider: getIntegrationProviderTitle(provider) }), 'success');
            } catch (e) {
                console.error('disconnectHubIntegration error', e);
                showToast(t('integrations_hub.disconnect_error', { provider: getIntegrationProviderTitle(provider) }), 'error');
            }
        };

        window.testHubWooConnection = async function () {
            if (!ihCanEdit) return;
            const w = ihData.woocommerce;
            if (ihConnectionState.woocommerce.testing) return;
            if (!w.website_url || !w.consumer_key || !w.consumer_secret) {
                ihConnectionState.woocommerce = { status: 'error', titleKey: 'onboarding.test_error_missing', detailKey: '', detailText: '', testing: false };
                renderIntegrationsHubFromState();
                return;
            }
            ihConnectionState.woocommerce = { status: 'loading', titleKey: 'onboarding.test_loading', detailKey: '', detailText: '', testing: true };
            renderIntegrationsHubFromState();
            try {
                const result = await runWooConnectionTest(w);
                Object.assign(ihData.woocommerce, {
                    verified_at: result.verified_at,
                    verified_store: result.verified_store,
                    verification_method: result.verification_method,
                    verification_snapshot: result.verification_snapshot,
                    last_test_status: 'success'
                });
                ihConnectionState.woocommerce = { status: 'success', titleKey: 'onboarding.test_success_woo', detailKey: result.detailKey, detailText: '', testing: false };
                renderIntegrationsHubFromState();
                await persistHubIntegrations();
                setHubDirty(false);
            } catch (err) {
                clearHubVerification('woocommerce');
                ihData.woocommerce.last_test_status = 'failed';
                const mapped = mapConnectionError(err);
                ihConnectionState.woocommerce = Object.assign({ status: 'error', detailKey: '', testing: false }, mapped);
                renderIntegrationsHubFromState();
                try {
                    setHubDirty(true);
                    await persistHubIntegrations();
                    setHubDirty(false);
                } catch (persistErr) {
                    console.warn('Persist Woo failure state failed', persistErr);
                }
            }
        };

        window.testHubShopifyConnection = async function () {
            if (!ihCanEdit) return;
            const s = ihData.shopify;
            if (ihConnectionState.shopify.testing) return;
            if (!s.shop_domain || !s.storefront_token) {
                ihConnectionState.shopify = { status: 'error', titleKey: 'onboarding.test_error_missing', detailKey: '', detailText: '', testing: false };
                renderIntegrationsHubFromState();
                return;
            }
            ihConnectionState.shopify = { status: 'loading', titleKey: 'onboarding.test_loading', detailKey: '', detailText: '', testing: true };
            renderIntegrationsHubFromState();
            try {
                const result = await runShopifyConnectionTest(s);
                Object.assign(ihData.shopify, {
                    token_type: 'storefront_access_token',
                    verified_at: result.verified_at,
                    verified_store: result.verified_store,
                    verification_method: result.verification_method,
                    verification_snapshot: result.verification_snapshot,
                    last_test_status: 'success'
                });
                delete ihData.shopify.client_id;
                delete ihData.shopify.client_secret;
                ihConnectionState.shopify = { status: 'success', titleKey: 'onboarding.test_success_shopify', detailKey: result.detailKey, detailText: '', testing: false };
                renderIntegrationsHubFromState();
                await persistHubIntegrations();
                setHubDirty(false);
            } catch (err) {
                clearHubVerification('shopify');
                ihData.shopify.last_test_status = 'failed';
                const mapped = mapConnectionError(err);
                ihConnectionState.shopify = Object.assign({ status: 'error', detailKey: '', testing: false }, mapped);
                renderIntegrationsHubFromState();
                try {
                    setHubDirty(true);
                    await persistHubIntegrations();
                    setHubDirty(false);
                } catch (persistErr) {
                    console.warn('Persist Shopify failure state failed', persistErr);
                }
            }
        };

        window.testHubEasyOrderConnection = async function () {
            if (!ihCanEdit) return;
            const eo = ihData.easy_order;
            if (ihConnectionState.easy_order.testing) return;
            if (!eo.store_url || !eo.api_key) {
                ihConnectionState.easy_order = { status: 'error', titleKey: 'onboarding.test_error_missing', detailKey: '', detailText: '', testing: false };
                renderIntegrationsHubFromState();
                return;
            }
            ihConnectionState.easy_order = { status: 'loading', titleKey: 'onboarding.test_loading', detailKey: '', detailText: '', testing: true };
            renderIntegrationsHubFromState();
            try {
                const result = await runEasyOrderConnectionTest(eo);
                Object.assign(ihData.easy_order, {
                    verified_at: result.verified_at,
                    verified_store: result.verified_store,
                    verification_method: result.verification_method,
                    verification_snapshot: result.verification_snapshot,
                    last_test_status: 'success'
                });
                ihConnectionState.easy_order = { status: 'success', titleKey: 'onboarding.test_success_easy_order', detailKey: result.detailKey, detailText: '', testing: false };
                renderIntegrationsHubFromState();
                await persistHubIntegrations();
                setHubDirty(false);
            } catch (err) {
                clearHubVerification('easy_order');
                ihData.easy_order.last_test_status = 'failed';
                const mapped = mapConnectionError(err);
                ihConnectionState.easy_order = Object.assign({ status: 'error', detailKey: '', testing: false }, mapped);
                renderIntegrationsHubFromState();
                try {
                    setHubDirty(true);
                    await persistHubIntegrations();
                    setHubDirty(false);
                } catch (persistErr) {
                    console.warn('Persist Easy Order failure state failed', persistErr);
                }
            }
        };

        // ==========================================
        // LEAD PROFILE FUNCTIONS
        // ==========================================

        window.currentLeadProfileId = null;
        window.currentLeadProfileOrgId = null;
        window.currentLeadProfileData = null;
        window.currentLeadCrmState = null;

        // ==========================================
        // PRODUCTION OPERATIONAL LAYER
        // Deep Links, Timezones, Notifications
        // ==========================================

        // Deep Link Parser & Router
        window.parseDeepLink = function() {
            const hash = window.location.hash;
            // Accept invite deep link
            const inviteMatch = hash.match(/#accept-invite\?(.+)/);
            if (inviteMatch) {
                const params = new URLSearchParams(inviteMatch[1]);
                return {
                    view: 'accept-invite',
                    token: params.get('token')
                };
            }
            const match = hash.match(/#(crm|task-manager)\?(.+)/);
            if (match) {
                const view = match[1];
                const params = new URLSearchParams(match[2]);
                return {
                    view,
                    leadId: params.get('lead'),
                    taskId: params.get('task'),
                    eventKey: params.get('event'),
                    notificationId: params.get('notification_id')
                };
            }
            return null;
        };

        window.handleDeepLink = function(deepLink) {
            if (!deepLink) return;

            if (deepLink.view === 'accept-invite' && deepLink.token) {
                switchTab('accept-invite');
                setTimeout(() => {
                    if (typeof initAcceptInvitePage === 'function') initAcceptInvitePage(deepLink.token);
                }, 300);
                return;
            }

            if (deepLink.view === 'crm' && deepLink.leadId) {
                switchTab('crm');
                setTimeout(() => {
                    openLeadProfile(deepLink.leadId, currentUserOrgId || '');
                    if (deepLink.notificationId && typeof markNotificationAsRead === 'function') {
                        markNotificationAsRead(deepLink.notificationId);
                    }
                }, 500);
            }

            if (deepLink.view === 'task-manager' && deepLink.taskId) {
                switchTab('task-manager');
                setTimeout(() => {
                    if (typeof openTaskDetail === 'function') {
                        openTaskDetail(deepLink.taskId);
                    }
                    if (deepLink.notificationId && typeof markNotificationAsRead === 'function') {
                        markNotificationAsRead(deepLink.notificationId);
                    }
                }, 500);
            }
        };

        // Initialize deep link handler on app load
        window.addEventListener('hashchange', () => {
            const deepLink = parseDeepLink();
            if (deepLink && (deepLink.view === 'crm' || deepLink.view === 'task-manager' || deepLink.view === 'accept-invite')) {
                handleDeepLink(deepLink);
            }
        });

        // Check for deep link on initial load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                const deepLink = parseDeepLink();
                if (deepLink) handleDeepLink(deepLink);
            });
        } else {
            const deepLink = parseDeepLink();
            if (deepLink) handleDeepLink(deepLink);
        }

        // Timezone Helper Functions
        window.timezoneHelpers = {
            getUserTimezone: async function(orgId) {
                try {
                    const {data, error} = await supabaseClient
                        .rpc('get_user_timezone', {p_user_id: (await supabaseClient.auth.getUser()).data.user.id, p_org_id: orgId});
                    if (error) throw error;
                    return data || 'UTC';
                } catch (err) {
                    console.warn('Failed to get user timezone:', err);
                    return 'UTC';
                }
            },

            formatToUserTimezone: function(utcTimestamp, timezone, format = 'short') {
                try {
                    if (!utcTimestamp) return '--';
                    const date = new Date(utcTimestamp);
                    if (format === 'short') {
                        return new Intl.DateTimeFormat('en-US', {
                            timeZone: timezone || 'UTC',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        }).format(date);
                    } else {
                        return new Intl.DateTimeFormat('en-US', {
                            timeZone: timezone || 'UTC',
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                        }).format(date);
                    }
                } catch (err) {
                    return new Date(utcTimestamp).toLocaleString();
                }
            },

            parseLocalToUTC: function(localTimeStr, timezone) {
                try {
                    const date = new Date(localTimeStr);
                    return new Date(date.toLocaleString('en-US', {timeZone: timezone})).toISOString();
                } catch (err) {
                    return new Date(localTimeStr).toISOString();
                }
            }
        };

        // Notification routing for CRM/Task handled via existing push-notification-click handler

        // CRM View Initialization
        window.initCrmTab = async function() {
            const grid = document.getElementById('crm-grid');
            if (grid) grid.innerHTML = '<div class="crm-loading"><div class="spinner" style="width:32px;height:32px;margin:0 auto 12px;"></div><p>Loading…</p></div>';
            try {
                if (!currentUserOrgId) throw new Error('Not authenticated');
                const [{data, error}] = await Promise.all([
                    supabaseClient.from('leads').select('*').eq('org_id', currentUserOrgId).order('created_at', {ascending: false}),
                    fetchOrgMembersCache()
                ]);
                if (error) throw error;
                cachedLeads = data || [];
                renderCrmView(cachedLeads);
            } catch (err) {
                console.error('Failed to load CRM data:', err);
                if (grid) grid.innerHTML = `<div class="crm-error-state"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#ef4444" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><p>Failed to load CRM data.</p><button onclick="initCrmTab()" style="margin-top:12px;padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.9rem;">Retry</button></div>`;
            }
        };

        // ── helpers ──────────────────────────────────────────────
        function crmInitials(name) {
            if (!name) return '?';
            const parts = name.trim().split(/\s+/);
            return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
        }
        function crmStatusChip(status) {
            return `<span class="status-chip s-${status}">${t('leads.status.'+status) || status}</span>`;
        }

        function renderCrmView(leads) {
            const grid    = document.getElementById('crm-grid');
            const toolbar = document.getElementById('crm-toolbar-container');
            if (!grid || !toolbar) return;

            // Stats strip
            const total    = leads.length;
            const newCount = leads.filter(l => l.status === 'new' || l.status === 'contacted').length;
            const fuCount  = leads.filter(l => l.status === 'follow_up').length;
            const wonCount = leads.filter(l => l.status === 'won').length;
            const lostCount= leads.filter(l => l.status === 'lost').length;

            // Dynamic categories for filter
            const categories = [...new Set(leads.map(l => l.category).filter(Boolean))].sort();
            const catOptions = categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

            // Platform filter options (whatsapp / instagram / messenger / website)
            const PLATFORM_FILTER_OPTIONS = [
                { value: 'whatsapp',  label: t('leads.platform.whatsapp')  || 'WhatsApp',  icon: '🟢' },
                { value: 'instagram', label: t('leads.platform.instagram') || 'Instagram', icon: '📷' },
                { value: 'page',      label: t('leads.platform.messenger') || 'Messenger', icon: '💬' },
                { value: 'website',   label: t('leads.platform.website')   || 'Website',   icon: '🌐' }
            ];
            const platformOptions = PLATFORM_FILTER_OPTIONS
                .map(p => `<option value="${p.value}">${p.icon} ${esc(p.label)}</option>`)
                .join('');

            const currentView = document.querySelector('.crm-view-btn.active')?.dataset.view || 'table';

            toolbar.innerHTML = `
                <div class="crm-stats-strip">
                    <span class="crm-stat-pill stat-total"><span class="stat-num">${total}</span> ${t('leads.stat_total')}</span>
                    <span class="crm-stat-pill stat-new"><span class="stat-num">${newCount}</span> ${t('leads.stat_new')}</span>
                    <span class="crm-stat-pill stat-follow"><span class="stat-num">${fuCount}</span> ${t('leads.stat_follow_up')}</span>
                    <span class="crm-stat-pill stat-won"><span class="stat-num">${wonCount}</span> ${t('leads.stat_won')}</span>
                    <span class="crm-stat-pill stat-lost"><span class="stat-num">${lostCount}</span> ${t('leads.stat_lost')}</span>
                </div>
                <div class="crm-toolbar">
                    <div class="crm-search-wrap">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                        <input type="text" id="crm-search-input" class="crm-search-input"
                            placeholder="${t('leads.search_placeholder')}"
                            oninput="filterAndRenderCrmData()">
                    </div>
                    <select id="crm-status-filter" class="crm-filter-select" onchange="filterAndRenderCrmData()">
                        <option value="">${t('leads.filter_all_statuses')}</option>
                        ${LEAD_STATUSES.map(s => `<option value="${s}">${t('leads.status.'+s)}</option>`).join('')}
                    </select>
                    <select id="crm-category-filter" class="crm-filter-select" onchange="filterAndRenderCrmData()">
                        <option value="">${t('leads.filter_all_categories')}</option>
                        ${catOptions}
                    </select>
                    <select id="crm-platform-filter" class="crm-filter-select" onchange="filterAndRenderCrmData()" title="${t('leads.filter_all_platforms')}">
                        <option value="">${t('leads.filter_all_platforms')}</option>
                        ${platformOptions}
                    </select>
                    <select id="crm-date-preset" class="crm-filter-select" onchange="applyCrmDatePreset(this.value)">
                        <option value="">All Time</option>
                        <option value="today">Today</option>
                        <option value="yesterday">Yesterday</option>
                        <option value="7days">Last 7 Days</option>
                        <option value="30days">Last 30 Days</option>
                        <option value="this_month">This Month</option>
                        <option value="last_month">Last Month</option>
                        <option value="custom">Custom Range...</option>
                    </select>
                    <input type="date" id="crm-date-from" class="crm-filter-select" style="display:none;max-width:140px;" onchange="filterAndRenderCrmData()">
                    <input type="date" id="crm-date-to" class="crm-filter-select" style="display:none;max-width:140px;" onchange="filterAndRenderCrmData()">
                    <select id="crm-sort" class="crm-filter-select" onchange="filterAndRenderCrmData()">
                        <option value="newest">Newest First</option>
                        <option value="oldest">Oldest First</option>
                        <option value="name_az">Name A→Z</option>
                        <option value="name_za">Name Z→A</option>
                        <option value="due_soonest">Due Date (Soonest)</option>
                        <option value="priority">Priority (Urgent First)</option>
                    </select>
                    <button class="btn-secondary" onclick="openAddLeadModal()" style="padding:8px 14px;font-size:0.82rem;white-space:nowrap;" title="Add Lead">➕ Add Lead</button>
                    <button class="btn-secondary" onclick="openCrmImportModal()" style="padding:8px 14px;font-size:0.82rem;white-space:nowrap;" title="${t('leads.btn_import')}">📥 ${t('leads.btn_import')}</button>
                    <div class="crm-view-btns">
                        <button class="crm-view-btn ${currentView==='table'?'active':''}" data-view="table" onclick="setCrmView('table',this)">☰ ${t('leads.view_btn_table')}</button>
                        <button class="crm-view-btn ${currentView==='grid'?'active':''}" data-view="grid"  onclick="setCrmView('grid',this)">⊞ ${t('leads.view_btn_cards')}</button>
                        <button class="crm-view-btn ${currentView==='pipeline'?'active':''}" data-view="pipeline" onclick="setCrmView('pipeline',this)">⋮⋮⋮ ${t('leads.view_btn_pipeline')}</button>
                        <button class="crm-view-btn ${currentView==='dashboard'?'active':''}" data-view="dashboard" onclick="setCrmView('dashboard',this)">◫ ${t('leads.view_btn_dashboard')}</button>
                    </div>
                </div>
            `;
            renderCrmGrid(filterCrmRows(leads));
        }

        window.filterAndRenderCrmData = function() {
            if (cachedLeads) renderCrmGrid(filterCrmRows(cachedLeads));
        };

        function filterCrmRows(leads) {
            const q  = (document.getElementById('crm-search-input')?.value || '').toLowerCase();
            const sf = document.getElementById('crm-status-filter')?.value || '';
            const cf = document.getElementById('crm-category-filter')?.value || '';
            const pf = document.getElementById('crm-platform-filter')?.value || '';
            return leads.filter(l =>
                (!q  || (l.full_name||'').toLowerCase().includes(q) || (l.phone||'').includes(q) || (l.email||'').toLowerCase().includes(q)) &&
                (!sf || String(l.status||'').toLowerCase() === sf) &&
                (!cf || (l.category||'') === cf) &&
                (!pf || String(l.source||'').toLowerCase() === pf)
            );
        }

        function renderCrmGrid(rows) {
            const grid = document.getElementById('crm-grid');
            if (!grid) return;

            const view = document.querySelector('.crm-view-btn.active')?.dataset.view || 'table';

            if (view === 'dashboard') {
                renderCrmDashboard(grid);
                return;
            }

            if (!rows || rows.length === 0) {
                grid.innerHTML = `<div style="text-align:center;padding:48px 24px;color:var(--text-muted,#888);">${t('leads.empty_search')}</div>`;
                return;
            }

            if (view === 'pipeline') {
                const colHtml = PIPELINE_STAGES.map(stage => {
                    const label = t(`leads.status.${stage}`) || stage;
                    const color = PIPELINE_COLORS[stage] || '#888';
                    const colRows = rows.filter(r => mapStatusForPipeline(String(r.status||'')) === stage);
                    const cards = colRows.length
                        ? colRows.map(r => {
                            const relDate = r.created_at ? formatDate(new Date(r.created_at)) : '';
                            return `
                            <div class="crm-kanban-card" onclick="openLeadProfile('${r.id}','${currentUserOrgId||''}')">
                                <div class="crm-kanban-card-name">${esc(r.full_name||'Unknown')}</div>
                                <div class="crm-kanban-card-phone">${esc(r.phone||'')}</div>
                                <div class="crm-kanban-card-row">
                                    ${r.category ? `<span class="crm-kanban-card-tag">${esc(r.category)}</span>` : '<span></span>'}
                                    ${r.assigned_to_user_id ? `<span class="crm-assignee-chip" title="${esc(getOrgMemberName(r.assigned_to_user_id))}">${getOrgMemberInitials(r.assigned_to_user_id)}</span>` : ''}
                                </div>
                                ${relDate ? `<div class="crm-kanban-card-date">${relDate}</div>` : ''}
                            </div>`}).join('')
                        : `<div class="crm-kanban-empty">${t('leads.pipeline_empty')}</div>`;
                    return `
                        <div class="crm-kanban-col" style="border-top:3px solid ${color};">
                            <div class="crm-kanban-head">${crmStatusChip(stage)}<span class="crm-kanban-count">${colRows.length}</span></div>
                            <div class="crm-kanban-list">${cards}</div>
                        </div>`;
                }).join('');
                grid.innerHTML = `<div class="crm-kanban">${colHtml}</div>`;

            } else if (view === 'grid') {
                grid.innerHTML = `<div class="crm-cards-grid">${rows.map(r => `
                    <div class="crm-card" onclick="openLeadProfile('${r.id}','${currentUserOrgId||''}')">
                        <div class="crm-card-head">
                            <div class="crm-lead-avatar">${crmInitials(r.full_name)}</div>
                            <div class="crm-card-info">
                                <div class="crm-card-name">${esc(r.full_name||'Unknown')}</div>
                                <div class="crm-card-phone">${esc(r.phone||'--')}</div>
                            </div>
                            ${r.assigned_to_user_id ? `<span class="crm-assignee-chip" title="${esc(getOrgMemberName(r.assigned_to_user_id))}">${getOrgMemberInitials(r.assigned_to_user_id)}</span>` : ''}
                        </div>
                        <div class="crm-card-foot">
                            ${crmStatusChip(r.status||'new')}
                            <span class="crm-source-tag">${(r.source||'unknown').toUpperCase()}</span>
                        </div>
                        ${r.category ? `<span class="crm-category-tag">${esc(r.category)}</span>` : ''}
                        ${r.persona ? `<span class="crm-persona-label">${esc(r.persona)}</span>` : ''}
                    </div>`).join('')}</div>`;

            } else {
                // Table view — extended with category, assignee, due date
                const trs = rows.map(r => `
                    <tr onclick="openLeadProfile('${r.id}','${currentUserOrgId||''}')">
                        <td><div class="crm-name-cell">
                            <div class="crm-lead-avatar">${crmInitials(r.full_name)}</div>
                            <div>
                                <div class="crm-name-text">${esc(r.full_name||'--')}</div>
                                <div class="crm-phone-text">${esc(r.phone||'')}</div>
                            </div>
                        </div></td>
                        <td>${crmStatusChip(r.status||'new')}</td>
                        <td><span class="crm-source-tag">${(r.source||'unknown').toUpperCase()}</span></td>
                        <td class="crm-col-category">${r.category ? esc(r.category) : '--'}</td>
                        <td>${r.assigned_to_user_id ? `<span class="crm-assignee-chip" title="${esc(getOrgMemberName(r.assigned_to_user_id))}">${getOrgMemberInitials(r.assigned_to_user_id)}</span> ${esc(getOrgMemberName(r.assigned_to_user_id).split(' ')[0])}` : '--'}</td>
                        <td class="crm-col-due">${r.due_at ? new Date(r.due_at).toLocaleDateString() : '--'}</td>
                        <td>${r.created_at ? new Date(r.created_at).toLocaleDateString() : '--'}</td>
                    </tr>`).join('');
                grid.innerHTML = `
                    <div class="crm-table-wrap">
                        <table class="crm-table">
                            <thead><tr>
                                <th>${t('leads.col_name')}</th>
                                <th>${t('leads.col_status')}</th>
                                <th>${t('leads.col_platform')}</th>
                                <th class="crm-col-category">${t('leads.col_category')}</th>
                                <th>${t('leads.col_assignee')}</th>
                                <th class="crm-col-due">${t('leads.col_due_date')}</th>
                                <th>${t('leads.col_date')}</th>
                            </tr></thead>
                            <tbody>${trs}</tbody>
                        </table>
                    </div>`;
            }
        }

        window.setCrmView = function(viewType, btn) {
            document.querySelectorAll('.crm-view-btn').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            if (cachedLeads) renderCrmGrid(filterCrmRows(cachedLeads));
        };

        window.openLeadProfile = async function(leadId, orgId) {
            if (!leadId) return;
            const resolvedOrg = orgId || currentUserOrgId;
            if (!resolvedOrg) return;

            window.currentLeadProfileId  = leadId;
            window.currentLeadProfileOrgId = resolvedOrg;

            const profilePage = document.getElementById('lead-profile-page');
            if (!profilePage) return;
            profilePage.style.display = 'flex';

            // Show skeleton while loading
            const nameEl   = document.getElementById('lead-profile-name');
            const avatarEl = document.getElementById('lp-avatar');
            if (nameEl)   nameEl.textContent = '…';
            if (avatarEl) avatarEl.textContent = '…';

            try {
                const leadData = await fetchLeadForProfile(leadId, resolvedOrg);
                if (!leadData) { showToast(t('crm.error_loading')); return; }
                window.currentLeadProfileData = leadData;

                const crmState = await supabaseClient.rpc('get_lead_crm_state', {p_lead_id: leadId, p_org_id: resolvedOrg});
                window.currentLeadCrmState = crmState.data || {};
                renderLeadProfile(leadData, crmState.data || {});
            } catch (err) {
                console.error('Failed to load lead profile:', err);
                showToast(t('crm.error_loading'));
            }
        };

        window.closeLeadProfile = function() {
            const profilePage = document.getElementById('lead-profile-page');
            if (profilePage) profilePage.style.display = 'none';
            document.getElementById('status-dropdown').style.display = 'none';
            window.currentLeadProfileId = null;
            window.currentLeadProfileOrgId = null;
        };

        async function fetchLeadForProfile(leadId, orgId) {
            try {
                const {data, error} = await supabaseClient.from('leads').select('*')
                    .eq('id', leadId).eq('org_id', orgId).single();
                if (error) throw error;
                return data;
            } catch (err) {
                console.error('Fetch lead failed:', err);
                return null;
            }
        }

        function renderLeadProfile(leadData, crmState) {
            if (!leadData) return;

            const name     = leadData.full_name || 'Unknown';
            const phone    = leadData.phone || '--';
            const platform = (leadData.source || 'unknown').toUpperCase();
            const status   = leadData.status || 'new';

            // Avatar + header
            const avatarEl = document.getElementById('lp-avatar');
            if (avatarEl) avatarEl.textContent = crmInitials(name);
            document.getElementById('lead-profile-name').textContent = name;
            document.getElementById('lead-profile-phone').textContent = phone;
            document.getElementById('lead-profile-platform').textContent = platform;

            const badgeEl = document.getElementById('lead-profile-status-badge');
            if (badgeEl) {
                badgeEl.textContent = getStatusLabel(status);
                badgeEl.className   = 'lead-status-badge status-' + status;
            }

            // Extended fields section
            renderLeadExtendedFields(leadData);

            // AI Summary
            const aiEl = document.getElementById('lead-profile-ai-summary');
            if (crmState?.ai_summary) {
                aiEl.innerHTML = `<div>${esc(crmState.ai_summary)}</div>` +
                    (crmState.ai_summary_updated_at
                        ? `<div style="font-size:0.75rem;color:var(--text-muted,#888);margin-top:8px;">Updated ${formatDate(new Date(crmState.ai_summary_updated_at))}</div>`
                        : '');
            } else {
                aiEl.innerHTML = `<span style="color:var(--text-muted,#888);font-size:0.875rem;">No AI summary yet. Tap 🤖 to generate.</span>`;
            }

            // Follow-up
            const fuSection = document.getElementById('lead-profile-followup-section');
            if (crmState?.follow_up_due_at) {
                fuSection.style.display = 'block';
                const dueDate  = new Date(crmState.follow_up_due_at);
                const isOver   = dueDate < new Date();
                document.getElementById('lead-profile-followup-content').innerHTML = `
                    <div class="followup-item">
                        <span class="followup-due ${isOver ? 'followup-overdue' : 'followup-due-soon'}">
                            ${isOver ? '⚠️ ' : '📅 '}${formatDate(dueDate)}
                        </span>
                        ${crmState.follow_up_completed_at
                            ? '<span style="color:#34d399;font-size:0.8rem;">✓ Completed</span>'
                            : `<button class="btn-secondary" style="padding:4px 12px;font-size:0.78rem;" onclick="markFollowUpComplete()">Mark done</button>`}
                    </div>`;
                document.getElementById('lead-profile-complete-btn').style.display =
                    !crmState.follow_up_completed_at ? 'flex' : 'none';
            } else {
                fuSection.style.display = 'none';
                document.getElementById('lead-profile-complete-btn').style.display = 'none';
            }

            // Notes
            const notesEl = document.getElementById('lead-profile-notes');
            if (crmState?.notes?.length) {
                notesEl.innerHTML = crmState.notes.slice().reverse().map(n => `
                    <div class="note-item">
                        <div class="note-author">${esc(n.author_name||'Unknown')} · ${formatDate(new Date(n.created_at))}</div>
                        <div class="note-body">${esc(n.body)}</div>
                    </div>`).join('');
            } else {
                notesEl.innerHTML = `<div class="section-content" style="color:var(--text-muted,#888);font-size:0.875rem;">No notes yet.</div>`;
            }

            // Activity
            const actEl = document.getElementById('lead-profile-activity');
            if (crmState?.activity?.length) {
                actEl.innerHTML = crmState.activity.slice().reverse().map(a => `
                    <div class="activity-item">
                        <div><span class="activity-timestamp">${formatDate(new Date(a.created_at))} · ${esc(a.actor_name||'System')}</span>
                        <span class="activity-text">${getActivityTypeLabel(a.type)}: ${esc(a.label)}</span></div>
                    </div>`).join('');
            } else {
                actEl.innerHTML = `<div style="color:var(--text-muted,#888);font-size:0.875rem;padding:8px 0;">No activity recorded.</div>`;
            }
        }

        // Convert a Date or ISO-string to a "datetime-local" value (local-time YYYY-MM-DDTHH:MM)
        function formatDatetimeLocal(value) {
            if (!value) return '';
            const d = (value instanceof Date) ? value : new Date(value);
            if (Number.isNaN(d.getTime())) return '';
            const off = d.getTimezoneOffset() * 60000;
            return new Date(d.getTime() - off).toISOString().slice(0, 16);
        }

        // ── Custom Fields helpers ───────────────────────────────────
        const CUSTOM_FIELD_TYPES = [
            { value: 'text',   label: 'Text'    },
            { value: 'number', label: 'Number'  },
            { value: 'date',   label: 'Date'    },
            { value: 'url',    label: 'URL'     },
            { value: 'phone',  label: 'Phone'   },
            { value: 'email',  label: 'Email'   }
        ];
        function getLeadCustomFields(lead) {
            try {
                const arr = lead?.meta?.crm?.custom_fields;
                if (Array.isArray(arr)) return arr.filter(f => f && typeof f === 'object');
            } catch (_) {}
            return [];
        }
        function renderCustomFieldsSection(lead) {
            const fields = getLeadCustomFields(lead);
            const rows = fields.map((f, i) => {
                const id = esc(f.id || ('cf-' + i));
                const name = esc(f.name || '');
                const type = CUSTOM_FIELD_TYPES.find(x => x.value === f.type) ? f.type : 'text';
                const val = f.value == null ? '' : String(f.value);
                return `
                <div class="lead-cf-row" data-cf-id="${id}" data-cf-type="${esc(type)}">
                    <div class="lead-cf-row-grid">
                        <input type="text" class="lead-cf-name" value="${name}" placeholder="${esc(t('leads.cf_name_placeholder') || 'Field name')}" dir="auto" aria-label="${esc(t('leads.cf_name') || 'Custom field name')}">
                        <input type="${type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}" class="lead-cf-value" value="${esc(val)}" placeholder="${esc(t('leads.cf_value_placeholder') || 'Value')}" dir="auto" aria-label="${esc(t('leads.cf_value') || 'Custom field value')}">
                    </div>
                    <button type="button" class="lead-cf-remove" onclick="removeLeadCustomField('${id}')" title="${esc(t('leads.cf_remove') || 'Remove')}" aria-label="${esc(t('leads.cf_remove') || 'Remove')}">✕</button>
                </div>`;
            }).join('');
            const typeOpts = CUSTOM_FIELD_TYPES.map(t2 => `<option value="${t2.value}">${esc(t2.label)}</option>`).join('');
            return `
                <div class="lead-detail-section">
                    <div class="lead-detail-section-title">
                        <span>${esc(t('leads.section_custom_fields') || 'Custom Fields')}</span>
                        <span class="lead-cf-section-hint">${esc(t('leads.cf_section_hint') || 'Add any extra info you need to track.')}</span>
                    </div>
                    <div id="lead-cf-list" class="lead-cf-list">${rows || `<div class="lead-cf-empty">${esc(t('leads.cf_empty') || 'No custom fields yet.')}</div>`}</div>
                    <div class="lead-cf-add-row">
                        <select id="lead-cf-new-type" class="lead-cf-type-select" aria-label="${esc(t('leads.cf_type') || 'Field type')}">${typeOpts}</select>
                        <button type="button" class="btn-secondary lead-cf-add-btn" onclick="addLeadCustomField()">
                            <span aria-hidden="true">＋</span> ${esc(t('leads.cf_add') || 'Add Custom Field')}
                        </button>
                    </div>
                </div>`;
        }
        function readCustomFieldsFromDom() {
            const out = [];
            document.querySelectorAll('#lead-cf-list .lead-cf-row').forEach(row => {
                const id = row.dataset.cfId || ('cf-' + Math.random().toString(36).slice(2, 10));
                const type = row.dataset.cfType || 'text';
                const name = row.querySelector('.lead-cf-name')?.value?.trim() || '';
                const value = row.querySelector('.lead-cf-value')?.value ?? '';
                if (!name && !value) return; // drop fully empty rows
                out.push({ id, name, type, value });
            });
            return out;
        }
        window.addLeadCustomField = function() {
            const list = document.getElementById('lead-cf-list');
            if (!list) return;
            const empty = list.querySelector('.lead-cf-empty');
            if (empty) empty.remove();
            const type = document.getElementById('lead-cf-new-type')?.value || 'text';
            const id = 'cf-' + Math.random().toString(36).slice(2, 10);
            const inputType = type === 'number' ? 'number' : type === 'date' ? 'date' : 'text';
            const wrapper = document.createElement('div');
            wrapper.className = 'lead-cf-row';
            wrapper.dataset.cfId = id;
            wrapper.dataset.cfType = type;
            wrapper.innerHTML = `
                <div class="lead-cf-row-grid">
                    <input type="text" class="lead-cf-name" value="" placeholder="${esc(t('leads.cf_name_placeholder') || 'Field name')}" dir="auto" aria-label="${esc(t('leads.cf_name') || 'Custom field name')}">
                    <input type="${inputType}" class="lead-cf-value" value="" placeholder="${esc(t('leads.cf_value_placeholder') || 'Value')}" dir="auto" aria-label="${esc(t('leads.cf_value') || 'Custom field value')}">
                </div>
                <button type="button" class="lead-cf-remove" onclick="removeLeadCustomField('${id}')" title="${esc(t('leads.cf_remove') || 'Remove')}" aria-label="${esc(t('leads.cf_remove') || 'Remove')}">✕</button>`;
            list.appendChild(wrapper);
            wrapper.querySelector('.lead-cf-name')?.focus();
        };
        window.removeLeadCustomField = function(id) {
            const row = document.querySelector(`#lead-cf-list .lead-cf-row[data-cf-id="${CSS.escape(id)}"]`);
            if (row) row.remove();
            const list = document.getElementById('lead-cf-list');
            if (list && !list.querySelector('.lead-cf-row')) {
                list.innerHTML = `<div class="lead-cf-empty">${esc(t('leads.cf_empty') || 'No custom fields yet.')}</div>`;
            }
        };

        function renderLeadExtendedFields(lead) {
            const el = document.getElementById('lead-profile-fields');
            if (!el) return;
            const members = window.orgMembersCache || [];
            const memberOptions = members.map(m => `<option value="${m.user_id}" ${lead.assigned_to_user_id === m.user_id ? 'selected' : ''}>${esc(m.full_name || m.email)}</option>`).join('');

            el.innerHTML = `
                <div class="lead-detail-form">
                    <div class="lead-detail-section">
                        <div class="lead-detail-section-title">${t('leads.section_contact')}</div>
                        <div class="lead-detail-grid">
                            <div class="lead-detail-field">
                                <label>${t('leads.col_name')}</label>
                                <input type="text" id="lf-full_name" value="${esc(lead.full_name||'')}" dir="auto">
                            </div>
                            <div class="lead-detail-field">
                                <label>${t('leads.col_phone')}</label>
                                <input type="text" id="lf-phone" value="${esc(lead.phone||'')}" dir="auto">
                            </div>
                            <div class="lead-detail-field">
                                <label>${t('leads.col_email')}</label>
                                <input type="email" id="lf-email" value="${esc(lead.email||'')}" dir="auto">
                            </div>
                        </div>
                    </div>
                    <div class="lead-detail-section">
                        <div class="lead-detail-section-title">${t('leads.section_classification')}</div>
                        <div class="lead-detail-grid">
                            <div class="lead-detail-field">
                                <label>${t('leads.col_platform')}</label>
                                <select id="lf-source">
                                    <option value="manual"    ${lead.source==='manual'?'selected':''}>Manual</option>
                                    <option value="whatsapp"  ${lead.source==='whatsapp'?'selected':''}>WhatsApp</option>
                                    <option value="instagram" ${lead.source==='instagram'?'selected':''}>Instagram</option>
                                    <option value="page"      ${lead.source==='page'?'selected':''}>Messenger</option>
                                    <option value="telegram"  ${lead.source==='telegram'?'selected':''}>Telegram</option>
                                    <option value="website"   ${lead.source==='website'?'selected':''}>Website</option>
                                    <option value="import"    ${lead.source==='import'?'selected':''}>Import</option>
                                </select>
                            </div>
                            <div class="lead-detail-field">
                                <label>${t('leads.col_category')}</label>
                                <input type="text" id="lf-category" value="${esc(lead.category||'')}" dir="auto">
                            </div>
                            <div class="lead-detail-field">
                                <label>${t('leads.col_persona')}</label>
                                <input type="text" id="lf-persona" value="${esc(lead.persona||'')}" dir="auto">
                            </div>
                            <div class="lead-detail-field">
                                <label>${t('leads.col_service')}</label>
                                <input type="text" id="lf-service_required" value="${esc(lead.service_required||'')}" dir="auto">
                            </div>
                            <div class="lead-detail-field">
                                <label>${t('leads.col_priority')}</label>
                                <select id="lf-priority">
                                    <option value="">--</option>
                                    <option value="low" ${lead.priority==='low'?'selected':''}>Low</option>
                                    <option value="medium" ${lead.priority==='medium'?'selected':''}>Medium</option>
                                    <option value="high" ${lead.priority==='high'?'selected':''}>High</option>
                                    <option value="urgent" ${lead.priority==='urgent'?'selected':''}>Urgent</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="lead-detail-section">
                        <div class="lead-detail-section-title">${t('leads.section_assignment')}</div>
                        <div class="lead-detail-grid">
                            <div class="lead-detail-field">
                                <label>${t('leads.col_assignee')}</label>
                                <select id="lf-assigned_to_user_id">
                                    <option value="">${t('leads.unassigned')}</option>
                                    ${memberOptions}
                                </select>
                            </div>
                            <div class="lead-detail-field">
                                <label>${t('leads.col_due_date')}</label>
                                <input type="datetime-local" id="lf-due_at" value="${lead.due_at ? formatDatetimeLocal(lead.due_at) : ''}">
                            </div>
                        </div>
                    </div>
                    ${renderCustomFieldsSection(lead)}
                    <div class="lead-detail-section">
                        <div class="lead-detail-section-title">${t('leads.section_timeline')}</div>
                        <div class="lead-detail-grid">
                            <div class="lead-detail-field">
                                <label>${t('leads.col_first_call')}</label>
                                <input type="date" id="lf-first_call_at" value="${lead.first_call_at || ''}">
                            </div>
                            <div class="lead-detail-field">
                                <label>${t('leads.col_subscription')}</label>
                                <input type="date" id="lf-subscription_date" value="${lead.subscription_date || ''}">
                            </div>
                        </div>
                    </div>
                    <div class="lead-detail-section">
                        <div class="lead-detail-section-title">${t('leads.section_notes')}</div>
                        <div class="lead-detail-field">
                            <textarea id="lf-notes" dir="auto" rows="3">${esc(lead.notes||'')}</textarea>
                        </div>
                    </div>
                    <div style="display:flex;justify-content:flex-end;padding:4px 0 8px;">
                        <button class="btn-primary" onclick="saveLeadExtendedFields()" style="padding:8px 20px;font-size:0.85rem;">💾 ${t('leads.btn_save')}</button>
                    </div>
                </div>`;
        }

        window.saveLeadExtendedFields = async function() {
            if (!window.currentLeadProfileId || !window.currentLeadProfileOrgId) return;
            const getVal = id => document.getElementById(id)?.value?.trim() || null;
            const oldLead = window.currentLeadProfileData || {};
            const newAssignee = getVal('lf-assigned_to_user_id');
            const newSource = getVal('lf-source');
            const dueAtRaw = getVal('lf-due_at');
            const dueAtIso = dueAtRaw ? new Date(dueAtRaw).toISOString() : null;
            const updates = {
                full_name: getVal('lf-full_name'),
                phone: getVal('lf-phone'),
                email: getVal('lf-email'),
                category: getVal('lf-category'),
                persona: getVal('lf-persona'),
                service_required: getVal('lf-service_required'),
                priority: getVal('lf-priority'),
                assigned_to_user_id: newAssignee || null,
                due_at: dueAtIso,
                first_call_at: getVal('lf-first_call_at') || null,
                subscription_date: getVal('lf-subscription_date') || null,
                notes: getVal('lf-notes'),
                updated_at: new Date().toISOString()
            };
            // Only write platform (source) when the select actually has a value — keeps payload clean for DB enum
            if (newSource) updates.source = newSource;
            const customFields = readCustomFieldsFromDom();
            try {
                const {error} = await supabaseClient.from('leads').update(updates)
                    .eq('id', window.currentLeadProfileId).eq('org_id', window.currentLeadProfileOrgId);
                if (error) throw error;
                // Persist custom fields into meta.crm.custom_fields (jsonb merge via RPC)
                try {
                    await supabaseClient.rpc('patch_lead_crm_state', {
                        p_lead_id: window.currentLeadProfileId,
                        p_org_id: window.currentLeadProfileOrgId,
                        p_crm_patch: { custom_fields: customFields }
                    });
                } catch (cfErr) {
                    console.warn('Save custom fields failed:', cfErr);
                }
                // Fire notification if assignee changed
                if (newAssignee && newAssignee !== oldLead.assigned_to_user_id) {
                    insertCrmNotification({
                        orgId: window.currentLeadProfileOrgId,
                        entityId: window.currentLeadProfileId,
                        eventKey: 'crm_lead_assigned',
                        title: t('notifications.events.crm_lead_assigned.title'),
                        body: t('notifications.events.crm_lead_assigned.body', { lead_name: updates.full_name || 'Lead' }),
                        recipientUserId: newAssignee
                    });
                    logLeadActivity('assignment_changed', 'Assigned to ' + getOrgMemberName(newAssignee), {assigned_to: newAssignee});
                }
                // Log platform (source) change and refresh header chip
                if (newSource && newSource !== oldLead.source) {
                    try { logLeadActivity('platform_changed', 'Platform changed to ' + newSource, {new_platform: newSource}); } catch (_) {}
                    const hdr = document.getElementById('lead-profile-platform');
                    if (hdr) hdr.textContent = String(newSource).toUpperCase();
                }
                // Fire email + log activity when due date changes
                const oldDueIso = oldLead.due_at ? new Date(oldLead.due_at).toISOString() : null;
                if (dueAtIso && dueAtIso !== oldDueIso) {
                    try { logLeadActivity('due_date_set', 'Due date set to ' + new Date(dueAtIso).toLocaleString(), {due_at: dueAtIso}); } catch (_) {}
                    try {
                        await notifyLeadDueDateSet({
                            leadId: window.currentLeadProfileId,
                            orgId: window.currentLeadProfileOrgId,
                            leadName: updates.full_name || oldLead.full_name || 'Lead',
                            leadEmail: updates.email || oldLead.email || '',
                            leadPhone: updates.phone || oldLead.phone || '',
                            source: updates.source || oldLead.source || '',
                            dueAtIso
                        });
                    } catch (nErr) { console.warn('Due-date email notification failed:', nErr); }
                }
                window.currentLeadProfileData = {...oldLead, ...updates, meta: {...(oldLead.meta||{}), crm: {...((oldLead.meta||{}).crm||{}), custom_fields: customFields}}};
                showToast(t('crm.assign_saved'));
                initCrmTab();
            } catch(err) {
                console.error('Save lead fields failed:', err);
                showToast(t('crm.assign_error'));
            }
        };

        // Fire an email notification (to the current user) when a due date is set on a lead.
        // Uses the existing semantic-notification pipeline; the email channel is force-dispatched
        // via `bypass_channel_check=true` so the user gets the email regardless of org channel toggles.
        async function notifyLeadDueDateSet({leadId, orgId, leadName, leadEmail, leadPhone, source, dueAtIso}) {
            try {
                const {data: {user: authUser}} = await supabaseClient.auth.getUser();
                if (!authUser?.id) return;
                const recipientEmail = authUser.email || '';
                if (!recipientEmail) return;

                const dueLocal = new Date(dueAtIso).toLocaleString();
                const title = (t('notifications.events.crm_due_date_set.title') || 'Due date set');
                const body  = (t('notifications.events.crm_due_date_set.body',  { lead_name: leadName, due_at: dueLocal }) ||
                              `Due date for ${leadName} is now ${dueLocal}.`);

                // Insert the semantic notification with explicit recipient_emails so the email
                // function delivers to the user who scheduled the due date.
                const {data: notifId, error} = await supabaseClient.rpc('insert_semantic_notification', {
                    p_org_id: orgId,
                    p_type: 'crm',
                    p_title: title,
                    p_message: body,
                    p_entity: 'lead',
                    p_entity_id: leadId,
                    p_event_key: 'crm_due_date_set',
                    p_payload: {
                        recipient_user_id: authUser.id,
                        recipient_emails: [recipientEmail],
                        lead_name: leadName,
                        lead_email: leadEmail || '',
                        lead_phone: leadPhone || '',
                        source: source || '',
                        due_at: dueAtIso,
                        due_at_local: dueLocal
                    }
                });
                if (error) throw error;

                // Force-dispatch the email even if the org-level channel toggle is off — the user
                // explicitly scheduled this due date and asked to be reminded by email.
                try {
                    await supabaseClient.rpc('dispatch_email_notification', {
                        p_notification_id: notifId,
                        p_bypass_channel_check: true
                    });
                } catch (_) { /* notification still exists in-app */ }
            } catch (err) {
                console.warn('notifyLeadDueDateSet failed:', err);
            }
        }

        function getStatusLabel(status) {
            return t('leads.status.' + status) || status;
        }

        function getActivityTypeLabel(type) {
            const typeMap = {
                'status_changed': t('crm.activity_type.status_changed'),
                'note_added': t('crm.activity_type.note_added'),
                'follow_up_set': t('crm.activity_type.follow_up_set'),
                'follow_up_completed': t('crm.activity_type.follow_up_completed'),
                'ai_summary_refreshed': t('crm.activity_type.ai_summary_refreshed'),
                'assignment_changed': t('crm.activity_type.assignment_changed'),
                'profile_opened': t('crm.activity_type.profile_opened')
            };
            return typeMap[type] || type;
        }

        function formatDate(date) {
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

        window.openStatusDropdown = function() {
            const dropdown = document.getElementById('status-dropdown');
            if (dropdown) {
                dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
            }
        };

        window.updateLeadStatus = async function(newStatus) {
            if (!window.currentLeadProfileId || !window.currentLeadProfileOrgId) return;

            // Preserve any in-flight draft note across the status change. The textarea is
            // re-rendered when the profile re-renders, but the draft survives via localStorage.
            const ta = document.getElementById('note-textarea');
            if (ta && window.currentLeadProfileId) setNoteDraft(window.currentLeadProfileId, ta.value);

            try {
                const {data: updatedLead, error} = await supabaseClient
                    .from('leads')
                    .update({status: newStatus, updated_at: new Date().toISOString()})
                    .eq('id', window.currentLeadProfileId)
                    .eq('org_id', window.currentLeadProfileOrgId)
                    .select()
                    .single();

                if (error) throw error;

                // Keep meta (notes / activity / custom_fields) merged in so a status update
                // never blanks the in-memory lead snapshot.
                window.currentLeadProfileData = {
                    ...(window.currentLeadProfileData || {}),
                    ...updatedLead,
                    meta: updatedLead.meta || (window.currentLeadProfileData||{}).meta || {}
                };
                const crmRefresh = await supabaseClient.rpc('get_lead_crm_state', {
                    p_lead_id: window.currentLeadProfileId,
                    p_org_id: window.currentLeadProfileOrgId
                });
                window.currentLeadCrmState = crmRefresh.data || window.currentLeadCrmState || {};
                renderLeadProfile(window.currentLeadProfileData, window.currentLeadCrmState);

                // Re-attach autosave to the freshly-rendered textarea & restore the draft.
                if (window.currentLeadProfileId) {
                    const ta2 = document.getElementById('note-textarea');
                    if (ta2) ta2.value = getNoteDraft(window.currentLeadProfileId);
                    bindNoteDraftAutosave();
                }

                logLeadActivity('status_changed', `Status changed to ${newStatus}`, {new_status: newStatus});
                // Fire status change notification
                const recipientId = updatedLead.assigned_to_user_id || null;
                insertCrmNotification({
                    orgId: window.currentLeadProfileOrgId,
                    entityId: window.currentLeadProfileId,
                    eventKey: 'crm_status_changed',
                    title: t('notifications.events.crm_status_changed.title'),
                    body: t('notifications.events.crm_status_changed.body', { lead_name: updatedLead.full_name || 'Lead', new_status: getStatusLabel(newStatus) }),
                    recipientUserId: recipientId
                });
                showToast(t('crm.status_updated') || 'Status updated');
                document.getElementById('status-dropdown').style.display = 'none';
                initCrmTab();
            } catch (err) {
                console.error('Update status failed:', err);
                showToast(t('crm.error_loading'));
            }
        };

        // Note drafts are saved to localStorage so they survive status changes, modal closes,
        // and accidental navigation. Drafts are keyed per lead. Cleared on successful save.
        function noteDraftKey(leadId) { return `crm:note-draft:${leadId || 'unknown'}`; }
        function getNoteDraft(leadId) {
            try { return localStorage.getItem(noteDraftKey(leadId)) || ''; } catch (_) { return ''; }
        }
        function setNoteDraft(leadId, text) {
            try {
                if (text && text.trim()) localStorage.setItem(noteDraftKey(leadId), text);
                else localStorage.removeItem(noteDraftKey(leadId));
            } catch (_) {}
        }
        function clearNoteDraft(leadId) {
            try { localStorage.removeItem(noteDraftKey(leadId)); } catch (_) {}
        }
        function bindNoteDraftAutosave() {
            const ta = document.getElementById('note-textarea');
            if (!ta || ta.dataset.draftBound === '1') return;
            ta.dataset.draftBound = '1';
            let timer = null;
            const flush = () => {
                if (!window.currentLeadProfileId) return;
                setNoteDraft(window.currentLeadProfileId, ta.value);
                const ind = document.getElementById('note-draft-status');
                if (ind) {
                    ind.textContent = ta.value.trim()
                        ? (t('crm.note_draft_saved') || 'Draft saved')
                        : (t('crm.note_draft_empty') || '');
                    ind.classList.toggle('is-visible', !!ta.value.trim());
                }
            };
            ta.addEventListener('input', () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(flush, 250); // ~realtime draft persistence
            });
            ta.addEventListener('blur', flush);
        }

        window.openAddNoteModal = function() {
            const modal = document.getElementById('add-note-modal');
            const ta = document.getElementById('note-textarea');
            if (ta && window.currentLeadProfileId) {
                // Restore any unsent draft for this lead — don't blow it away every open.
                const draft = getNoteDraft(window.currentLeadProfileId);
                ta.value = draft;
                bindNoteDraftAutosave();
                const ind = document.getElementById('note-draft-status');
                if (ind) ind.classList.toggle('is-visible', !!draft);
            }
            if (modal) modal.style.display = 'flex';
            setTimeout(() => { try { ta?.focus(); } catch (_) {} }, 60);
        };

        window.closeAddNoteModal = function(event) {
            if (event && event.target.id !== 'add-note-modal') return;
            const modal = document.getElementById('add-note-modal');
            const ta = document.getElementById('note-textarea');
            // Persist the current text as a draft so closing the modal never destroys typed work.
            if (ta && window.currentLeadProfileId) setNoteDraft(window.currentLeadProfileId, ta.value);
            if (modal) modal.style.display = 'none';
        };

        window.saveNewNote = async function() {
            if (!window.currentLeadProfileId || !window.currentLeadProfileOrgId) return;

            const body = document.getElementById('note-textarea').value.trim();
            if (!body) {
                showToast('Note cannot be empty');
                return;
            }

            try {
                const noteId = crypto.randomUUID();
                const {data: {user: authUser}} = await supabaseClient.auth.getUser();
                const userName = authUser?.email?.split('@')[0] || 'You';

                const {data, error} = await supabaseClient.rpc('append_lead_note', {
                    p_lead_id: window.currentLeadProfileId,
                    p_org_id: window.currentLeadProfileOrgId,
                    p_note_id: noteId,
                    p_body: body,
                    p_author_id: authUser?.id,
                    p_author_name: userName
                });

                if (error) throw error;

                const leadData = await fetchLeadForProfile(window.currentLeadProfileId, window.currentLeadProfileOrgId);
                if (leadData) {
                    const crmState = await supabaseClient.rpc('get_lead_crm_state', {
                        p_lead_id: window.currentLeadProfileId,
                        p_org_id: window.currentLeadProfileOrgId
                    });
                    window.currentLeadCrmState = crmState.data;
                    renderLeadProfile(leadData, crmState.data || {});
                }

                logLeadActivity('note_added', 'Added a note', {note_id: noteId});
                showToast(t('crm.note_saved'));
                // Successfully saved → discard the draft.
                clearNoteDraft(window.currentLeadProfileId);
                const ta = document.getElementById('note-textarea');
                if (ta) ta.value = '';
                const ind = document.getElementById('note-draft-status');
                if (ind) ind.classList.remove('is-visible');
                const modal = document.getElementById('add-note-modal');
                if (modal) modal.style.display = 'none';
            } catch (err) {
                console.error('Save note failed:', err);
                // Keep the draft on failure so the user doesn't lose what they typed.
                showToast(t('crm.note_error'));
            }
        };

        window.openFollowUpModal = function() {
            const modal = document.getElementById('follow-up-modal');
            const input = document.getElementById('followup-datetime');

            if (window.currentLeadCrmState && window.currentLeadCrmState.follow_up_due_at) {
                input.value = formatDatetimeLocal(window.currentLeadCrmState.follow_up_due_at);
            } else {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(9, 0, 0, 0);
                input.value = formatDatetimeLocal(tomorrow);
            }

            if (modal) modal.style.display = 'flex';
            // Defer focus so the modal animates in before the picker pops open
            setTimeout(() => { try { input.focus(); } catch (_) {} }, 60);
        };

        window.closeFollowUpModal = function(event) {
            if (event && event.target.id !== 'follow-up-modal') return;
            const modal = document.getElementById('follow-up-modal');
            if (modal) modal.style.display = 'none';
        };

        window.saveFollowUpDate = async function() {
            if (!window.currentLeadProfileId || !window.currentLeadProfileOrgId) return;

            const inputEl = document.getElementById('followup-datetime');
            const datetimeStr = inputEl?.value || '';
            if (!datetimeStr) {
                showToast(t('crm.follow_up_pick_required') || 'Please select a date and time');
                inputEl?.focus();
                return;
            }
            // Guard against double-clicks
            const saveBtn = document.querySelector('#follow-up-modal .btn-primary');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.add('is-saving'); }

            const dueIso = new Date(datetimeStr).toISOString();
            const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';

            try {
                // Prefer the dedicated RPC (resets completion + logs activity server-side).
                let saveErr = null;
                try {
                    const {error: e1} = await supabaseClient.rpc('update_lead_follow_up_due', {
                        p_lead_id: window.currentLeadProfileId,
                        p_org_id: window.currentLeadProfileOrgId,
                        p_due_at_utc: dueIso,
                        p_due_timezone: tz
                    });
                    saveErr = e1;
                } catch (rpcErr) { saveErr = rpcErr; }
                // Fallback to the generic patch RPC if the dedicated one is unavailable
                if (saveErr) {
                    const {error: e2} = await supabaseClient.rpc('patch_lead_crm_state', {
                        p_lead_id: window.currentLeadProfileId,
                        p_org_id: window.currentLeadProfileOrgId,
                        p_crm_patch: {
                            follow_up_due_at: dueIso,
                            follow_up_due_timezone: tz,
                            follow_up_completed_at: null
                        }
                    });
                    if (e2) throw e2;
                    // The dedicated RPC logs activity itself; only log here when we fell back.
                    try { logLeadActivity('follow_up_set', `Follow-up set for ${new Date(datetimeStr).toLocaleString()}`, {due_at: dueIso}); } catch (_) {}
                }

                const crmState = await supabaseClient.rpc('get_lead_crm_state', {
                    p_lead_id: window.currentLeadProfileId,
                    p_org_id: window.currentLeadProfileOrgId
                });
                window.currentLeadCrmState = crmState.data || {};

                if (window.currentLeadProfileData) {
                    renderLeadProfile(window.currentLeadProfileData, window.currentLeadCrmState);
                }

                showToast(t('crm.follow_up_set'));
                closeFollowUpModal();
            } catch (err) {
                console.error('Save follow-up failed:', err);
                showToast(t('crm.follow_up_error'));
            } finally {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.remove('is-saving'); }
            }
        };

        window.markFollowUpComplete = async function() {
            if (!window.currentLeadProfileId || !window.currentLeadProfileOrgId) return;

            try {
                const {data, error} = await supabaseClient.rpc('patch_lead_crm_state', {
                    p_lead_id: window.currentLeadProfileId,
                    p_org_id: window.currentLeadProfileOrgId,
                    p_crm_patch: {follow_up_completed_at: new Date().toISOString()}
                });

                if (error) throw error;

                const crmState = await supabaseClient.rpc('get_lead_crm_state', {
                    p_lead_id: window.currentLeadProfileId,
                    p_org_id: window.currentLeadProfileOrgId
                });

                if (window.currentLeadProfileData) {
                    renderLeadProfile(window.currentLeadProfileData, crmState.data || {});
                }

                logLeadActivity('follow_up_completed', 'Follow-up marked complete', {});
                showToast(t('crm.follow_up_completed'));
            } catch (err) {
                console.error('Complete follow-up failed:', err);
                showToast(t('crm.follow_up_error'));
            }
        };

        window.refreshAISummary = async function() {
            if (!window.currentLeadProfileId || !window.currentLeadProfileOrgId) return;

            try {
                const {data, error} = await supabaseClient.rpc('patch_lead_crm_state', {
                    p_lead_id: window.currentLeadProfileId,
                    p_org_id: window.currentLeadProfileOrgId,
                    p_crm_patch: {ai_summary_updated_at: new Date().toISOString()}
                });

                if (error) throw error;

                const crmState = await supabaseClient.rpc('get_lead_crm_state', {
                    p_lead_id: window.currentLeadProfileId,
                    p_org_id: window.currentLeadProfileOrgId
                });

                if (window.currentLeadProfileData) {
                    renderLeadProfile(window.currentLeadProfileData, crmState.data || {});
                }

                logLeadActivity('ai_summary_refreshed', 'AI summary refreshed', {});
                showToast('AI Summary refreshed');
            } catch (err) {
                console.error('Refresh AI failed:', err);
                showToast('Failed to refresh AI summary');
            }
        };

        // ── Activity logger helper ──
        // ==========================================
        // NOTIFICATION HELPERS (Phase 1)
        // ==========================================
        async function insertCrmNotification({orgId, entityId, eventKey, title, body, recipientUserId}) {
            try {
                const payload = recipientUserId ? {recipient_user_id: recipientUserId} : {};
                await supabaseClient.rpc('insert_semantic_notification', {
                    p_org_id: orgId,
                    p_type: 'crm',
                    p_title: title,
                    p_message: body,
                    p_entity: 'lead',
                    p_entity_id: entityId,
                    p_event_key: eventKey,
                    p_payload: payload
                });
            } catch(err) { console.warn('CRM notification insert failed:', err); }
        }

        async function insertTaskNotification({orgId, entityId, eventKey, title, body, recipientUserId}) {
            try {
                const payload = recipientUserId ? {recipient_user_id: recipientUserId} : {};
                await supabaseClient.rpc('insert_semantic_notification', {
                    p_org_id: orgId,
                    p_type: 'task',
                    p_title: title,
                    p_message: body,
                    p_entity: 'task',
                    p_entity_id: entityId,
                    p_event_key: eventKey,
                    p_payload: payload
                });
            } catch(err) { console.warn('Task notification insert failed:', err); }
        }
        // TODO: Phase 2 — extend send_my_email_notification_test to handle crm_lead_assigned and task_assigned

        // ==========================================
        // CRM IMPORT (Feature 3)
        // ==========================================
        window.openCrmImportModal = function() {
            let existing = document.getElementById('crm-import-modal');
            if (existing) { existing.style.display = 'flex'; return; }
            const modal = document.createElement('div');
            modal.id = 'crm-import-modal';
            modal.className = 'modal-overlay';
            modal.style.display = 'flex';
            modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };
            modal.innerHTML = `
                <div class="modal-box" style="max-width:620px;width:calc(100% - 32px);max-height:90dvh;overflow-y:auto;" onclick="event.stopPropagation()">
                    <div class="modal-header">
                        <h3>${t('leads.import_title')}</h3>
                        <button class="modal-close-btn" onclick="document.getElementById('crm-import-modal').style.display='none'">✕</button>
                    </div>
                    <div class="modal-body" style="padding:20px;" id="crm-import-body">
                        <div class="import-dropzone" id="crm-import-dropzone" onclick="document.getElementById('crm-import-file').click()">
                            <div class="import-dropzone-icon">📁</div>
                            <div class="import-dropzone-title">${t('leads.import_drop_title')}</div>
                            <div class="import-dropzone-text">${t('leads.import_drop_text')}</div>
                            <div id="crm-import-filename" class="import-file-name" style="display:none;"></div>
                            <input type="file" id="crm-import-file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="handleCrmImportFile(this)">
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            // Drag & drop
            const dz = document.getElementById('crm-import-dropzone');
            dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
            dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
            dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); if(e.dataTransfer.files.length) handleCrmImportFileObj(e.dataTransfer.files[0]); });
        };

        window._crmImportData = null;
        window._crmImportHeaders = null;

        window.handleCrmImportFile = function(input) {
            if (input.files.length) handleCrmImportFileObj(input.files[0]);
        };

        function handleCrmImportFileObj(file) {
            const fnEl = document.getElementById('crm-import-filename');
            if (fnEl) { fnEl.textContent = file.name; fnEl.style.display = 'block'; }
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const wb = XLSX.read(e.target.result, {type:'array'});
                    const sheet = wb.Sheets[wb.SheetNames[0]];
                    const json = XLSX.utils.sheet_to_json(sheet, {defval:''});
                    if (!json.length) { showToast(t('leads.import_no_data')); return; }
                    window._crmImportHeaders = Object.keys(json[0]);
                    window._crmImportData = json;
                    showCrmImportMapping();
                } catch(err) { console.error('Parse file failed:', err); showToast(t('leads.import_error')); }
            };
            reader.readAsArrayBuffer(file);
        }

        const CRM_IMPORT_FIELDS = [
            {key:'full_name', label:'Customer Name'},
            {key:'phone', label:'Phone'},
            {key:'email', label:'Email'},
            {key:'category', label:'Category'},
            {key:'persona', label:'Persona'},
            {key:'service_required', label:'Service Required'},
            {key:'priority', label:'Priority'},
            {key:'notes', label:'Notes'},
            {key:'company', label:'Company'}
        ];
        const CRM_IMPORT_AUTO_MAP = {
            'customer name':'full_name','name':'full_name','full name':'full_name','الاسم':'full_name',
            'phone':'phone','telephone':'phone','mobile':'phone','الهاتف':'phone',
            'email':'email','e-mail':'email','البريد':'email',
            'category':'category','sector':'category','الفئة':'category',
            'persona':'persona','job title':'persona','title':'persona',
            'service':'service_required','service required':'service_required',
            'priority':'priority','الأولوية':'priority',
            'notes':'notes','ملاحظات':'notes',
            'company':'company','الشركة':'company'
        };

        function showCrmImportMapping() {
            const body = document.getElementById('crm-import-body');
            const headers = window._crmImportHeaders;
            const mappings = headers.map(h => {
                const lh = h.toLowerCase().trim();
                return CRM_IMPORT_AUTO_MAP[lh] || '';
            });
            const fieldOpts = CRM_IMPORT_FIELDS.map(f => `<option value="${f.key}">${f.label}</option>`).join('');
            const rows = headers.map((h, i) => `
                <tr>
                    <td>${esc(h)}</td>
                    <td><select id="crm-map-${i}">
                        <option value="">${t('leads.import_mapping_skip')}</option>
                        ${fieldOpts}
                    </select></td>
                </tr>`).join('');
            body.innerHTML = `
                <h4 style="margin:0 0 12px;">${t('leads.import_mapping_title')}</h4>
                <div style="overflow-x:auto;"><table class="import-mapping-table">
                    <thead><tr><th>${t('leads.import_mapping_source')}</th><th>${t('leads.import_mapping_target')}</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table></div>
                <h4 style="margin:16px 0 8px;">${t('leads.import_preview_title')}</h4>
                <div style="overflow-x:auto;" id="crm-import-preview"></div>
                <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
                    <button class="btn-secondary" onclick="openCrmImportModal()">${t('leads.import_btn_back')}</button>
                    <button class="btn-primary" onclick="executeCrmImport()">${t('leads.import_btn_import')}</button>
                </div>`;
            // Set auto-mapped values
            headers.forEach((h, i) => {
                const sel = document.getElementById('crm-map-' + i);
                if (sel && mappings[i]) sel.value = mappings[i];
            });
            // Preview first 3 rows
            renderCrmImportPreview();
        }

        function renderCrmImportPreview() {
            const previewEl = document.getElementById('crm-import-preview');
            if (!previewEl || !window._crmImportData) return;
            const data = window._crmImportData.slice(0, 3);
            const headers = window._crmImportHeaders;
            const ths = headers.map(h => `<th>${esc(h)}</th>`).join('');
            const trs = data.map(row => `<tr>${headers.map(h => `<td>${esc(String(row[h]||''))}</td>`).join('')}</tr>`).join('');
            previewEl.innerHTML = `<table class="import-preview-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
        }

        window.executeCrmImport = async function() {
            if (!window._crmImportData || !currentUserOrgId) return;
            const headers = window._crmImportHeaders;
            const mapping = {};
            headers.forEach((h, i) => {
                const sel = document.getElementById('crm-map-' + i);
                if (sel && sel.value) mapping[h] = sel.value;
            });
            if (Object.keys(mapping).length === 0) { showToast('Please map at least one column'); return; }

            const body = document.getElementById('crm-import-body');
            body.innerHTML = `<div style="text-align:center;padding:32px;"><div class="spinner" style="width:28px;height:28px;margin:0 auto 12px;"></div><p>${t('leads.import_progress')}</p><div class="import-progress-bar"><div id="crm-import-progress-fill" class="import-progress-fill" style="width:0%;"></div></div></div>`;

            const rows = window._crmImportData;
            let imported = 0, skipped = 0;
            const chunks = [];
            const batchSize = 50;

            for (let i = 0; i < rows.length; i += batchSize) {
                chunks.push(rows.slice(i, i + batchSize));
            }

            for (let ci = 0; ci < chunks.length; ci++) {
                const chunk = chunks[ci];
                const inserts = [];
                for (const row of chunk) {
                    const rec = {org_id: currentUserOrgId, source: 'import', status: 'new'};
                    for (const [srcCol, tgtField] of Object.entries(mapping)) {
                        const val = String(row[srcCol] || '').trim();
                        if (val) rec[tgtField] = val;
                    }
                    if (!rec.full_name && !rec.phone) { skipped++; continue; }
                    inserts.push(rec);
                }
                if (inserts.length) {
                    try {
                        const {error} = await supabaseClient.from('leads').insert(inserts);
                        if (error) throw error;
                        imported += inserts.length;
                    } catch(err) {
                        console.error('Import chunk failed:', err);
                        skipped += inserts.length;
                    }
                }
                const fill = document.getElementById('crm-import-progress-fill');
                if (fill) fill.style.width = Math.round(((ci+1)/chunks.length)*100) + '%';
            }

            let msg = t('leads.import_success').replace('{x}', imported);
            if (skipped > 0) msg += ' ' + t('leads.import_skipped').replace('{y}', skipped);
            body.innerHTML = `<div style="text-align:center;padding:32px;"><div style="font-size:2rem;margin-bottom:8px;">✅</div><p style="font-weight:600;">${msg}</p><button class="btn-primary" onclick="document.getElementById('crm-import-modal').style.display='none';initCrmTab();" style="margin-top:12px;">OK</button></div>`;
            window._crmImportData = null;
            window._crmImportHeaders = null;
        };

        // ==========================================
        // CRM DASHBOARD (Feature 5)
        // ==========================================
        function renderCrmDashboard(grid) {
            const leads = cachedLeads || [];
            if (leads.length < 3) {
                grid.innerHTML = `<div class="crm-dash-empty-state"><div style="font-size:2rem;margin-bottom:8px;">📊</div><p>${t('leads.dash_empty')}</p><button class="btn-primary" style="margin-top:12px;" onclick="setCrmView('table',document.querySelector('.crm-view-btn[data-view=table]'))">+ ${t('leads.stat_new')}</button></div>`;
                return;
            }

            // KPIs
            const total = leads.length;
            const won = leads.filter(l => l.status === 'won').length;
            const fu = leads.filter(l => l.status === 'follow_up').length;
            const assignees = [...new Set(leads.map(l => l.assigned_to_user_id).filter(Boolean))];
            const avgPerAssignee = assignees.length ? (total / assignees.length).toFixed(1) : '--';

            // Chart data
            const stageData = {};
            const allStages = [...PIPELINE_STAGES, 'won', 'lost'];
            allStages.forEach(s => stageData[s] = 0);
            leads.forEach(l => { const ms = mapStatusForPipeline(l.status||'new'); stageData[ms] = (stageData[ms]||0) + 1; });

            const catData = {};
            leads.forEach(l => { const c = l.category || ''; if (c) catData[c] = (catData[c]||0) + 1; });
            const catEntries = Object.entries(catData).sort((a,b) => b[1]-a[1]);

            const assigneeData = {};
            leads.forEach(l => { const a = l.assigned_to_user_id || '__unassigned'; assigneeData[a] = (assigneeData[a]||0) + 1; });
            const assigneeEntries = Object.entries(assigneeData).sort((a,b) => b[1]-a[1]).slice(0, 8);

            const recent = leads.slice(0, 5);

            grid.innerHTML = `
                <div class="crm-dash-kpi-strip">
                    <div class="crm-dash-kpi"><div class="crm-dash-kpi-value">${total}</div><div class="crm-dash-kpi-label">${t('leads.dash_kpi_total')}</div><div class="crm-dash-kpi-sub">${t('leads.dash_kpi_total_sub')}</div></div>
                    <div class="crm-dash-kpi"><div class="crm-dash-kpi-value" style="color:#34d399;">${won}</div><div class="crm-dash-kpi-label">${t('leads.dash_kpi_won')}</div><div class="crm-dash-kpi-sub">${t('leads.dash_kpi_won_sub')}</div></div>
                    <div class="crm-dash-kpi"><div class="crm-dash-kpi-value" style="color:#fb923c;">${fu}</div><div class="crm-dash-kpi-label">${t('leads.dash_kpi_followup')}</div><div class="crm-dash-kpi-sub">${t('leads.dash_kpi_followup_sub')}</div></div>
                    <div class="crm-dash-kpi"><div class="crm-dash-kpi-value">${avgPerAssignee}</div><div class="crm-dash-kpi-label">${t('leads.dash_kpi_avg')}</div><div class="crm-dash-kpi-sub">${t('leads.dash_kpi_avg_sub')}</div></div>
                </div>
                <div class="crm-dash-grid">
                    <div>
                        <div class="crm-dash-chart-card">
                            <div class="crm-dash-chart-title">${t('leads.dash_chart_by_stage')} <button class="crm-dash-refresh-btn" onclick="initCrmTab()" title="${t('leads.dash_refresh')}">↻</button></div>
                            ${renderHBarChart(allStages.filter(s => stageData[s] > 0).map(s => ({label: t('leads.status.'+s)||s, value: stageData[s], color: PIPELINE_COLORS[s]||'#888'})))}
                        </div>
                        <div class="crm-dash-chart-card">
                            <div class="crm-dash-chart-title">${t('leads.dash_chart_by_assignee')}</div>
                            ${renderHBarChart(assigneeEntries.map(([k,v]) => ({label: k==='__unassigned' ? t('leads.unassigned') : getOrgMemberName(k)||'Member', value:v, color:'#6366f1'})))}
                        </div>
                    </div>
                    <div>
                        <div class="crm-dash-chart-card">
                            <div class="crm-dash-chart-title">${t('leads.dash_chart_by_category')}</div>
                            ${catEntries.length ? renderDonutChart(catEntries.slice(0,6)) : `<div style="text-align:center;padding:20px;color:var(--text-muted,#888);">${t('leads.dash_no_category')}</div>`}
                        </div>
                        <div class="crm-dash-chart-card">
                            <div class="crm-dash-chart-title">${t('leads.dash_chart_recent')}</div>
                            ${recent.map(r => `
                                <div class="crm-dash-recent-item" onclick="openLeadProfile('${r.id}','${currentUserOrgId||''}')">
                                    <div class="crm-lead-avatar" style="width:28px;height:28px;font-size:0.65rem;">${crmInitials(r.full_name)}</div>
                                    <div style="flex:1;min-width:0;">
                                        <div style="font-weight:600;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.full_name||'Unknown')}</div>
                                    </div>
                                    ${crmStatusChip(r.status||'new')}
                                    <span style="font-size:0.72rem;color:var(--text-muted,#888);white-space:nowrap;">${r.created_at ? formatDate(new Date(r.created_at)) : ''}</span>
                                </div>`).join('')}
                        </div>
                    </div>
                </div>`;
        }

        // ==========================================
        // SHARED SVG CHART HELPERS
        // ==========================================
        function renderHBarChart(items) {
            if (!items.length) return '<div style="color:var(--text-muted,#888);font-size:0.85rem;padding:8px;">No data</div>';
            const max = Math.max(...items.map(i => i.value), 1);
            return items.map(item => `
                <div class="crm-dash-bar-row">
                    <span class="crm-dash-bar-label">${esc(item.label)}</span>
                    <div class="crm-dash-bar-track"><div class="crm-dash-bar-fill" style="width:${(item.value/max)*100}%;background:${item.color};"></div></div>
                    <span class="crm-dash-bar-count">${item.value}</span>
                </div>`).join('');
        }

        function renderDonutChart(entries, customColors) {
            const colors = customColors || ['#6366f1','#f59e0b','#10b981','#f97316','#06b6d4','#ef4444','#8b5cf6'];
            const total = entries.reduce((s,[,v]) => s+v, 0);
            if (total === 0) return '';
            const size = 120, cx = 60, cy = 60, r = 48, inner = 30;
            let paths = '', startAngle = -Math.PI / 2;
            entries.forEach(([label, value], i) => {
                const pct = value / total;
                const endAngle = startAngle + pct * 2 * Math.PI;
                const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
                const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
                const ix1 = cx + inner * Math.cos(endAngle), iy1 = cy + inner * Math.sin(endAngle);
                const ix2 = cx + inner * Math.cos(startAngle), iy2 = cy + inner * Math.sin(startAngle);
                const large = pct > 0.5 ? 1 : 0;
                paths += `<path d="M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${ix1},${iy1} A${inner},${inner} 0 ${large} 0 ${ix2},${iy2} Z" fill="${colors[i%colors.length]}" opacity="0.85"/>`;
                startAngle = endAngle;
            });
            const legend = entries.map(([label, value], i) =>
                `<div class="crm-dash-donut-legend-item"><span class="crm-dash-donut-swatch" style="background:${colors[i%colors.length]};"></span>${esc(label)} <strong>${value}</strong></div>`
            ).join('');
            return `<div class="crm-dash-donut-wrap"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${paths}</svg><div class="crm-dash-donut-legend">${legend}</div></div>`;
        }

        async function logLeadActivity(type, label, payload) {
            try {
                const {data: {user: authUser}} = await supabaseClient.auth.getUser();
                const actorName = authUser?.email?.split('@')[0] || 'System';
                await supabaseClient.rpc('append_lead_activity', {
                    p_lead_id: window.currentLeadProfileId,
                    p_org_id: window.currentLeadProfileOrgId,
                    p_activity_id: crypto.randomUUID(),
                    p_type: type,
                    p_label: label,
                    p_actor_id: authUser?.id || null,
                    p_actor_name: actorName,
                    p_payload: payload || {}
                });
            } catch (err) {
                console.warn('Activity log failed:', err);
            }
        }

        // ==========================================
        // TASK MANAGER IMPLEMENTATION
        // ==========================================

        window.cachedTasks = null;
        window.currentTaskId = null;
        let taskView = 'list';
        let tmCurrentTab = 'myday';

        window.initTaskManagerTab = async function() {
            await fetchOrgMembersCache();
            const content = document.getElementById('task-manager-content');
            if (content) content.innerHTML = '<div style="padding:2rem;text-align:center;"><div class="spinner" style="width:24px;height:24px;margin:0 auto 8px;"></div><p style="color:var(--text-secondary);">Loading...</p></div>';
            await fetchTasks();
        };

        window.setTmTab = function(tab, btn) {
            tmCurrentTab = tab;
            document.querySelectorAll('.tm-tab').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            closeTmDrawer();
            filterAndRenderTasks();
        };

        window.setTaskView = function(view, btn) {
            taskView = view;
            filterAndRenderTasks();
        };

        async function fetchTasks() {
            if (!currentUserOrgId) return;
            try {
                const {data, error} = await supabaseClient
                    .from('tasks')
                    .select('*')
                    .eq('org_id', currentUserOrgId)
                    .order('created_at', {ascending: false});
                if (error) throw error;
                window.cachedTasks = data || [];
                filterAndRenderTasks();
            } catch (err) {
                console.error('Failed to load tasks:', err);
                const content = document.getElementById('task-manager-content');
                if (content) content.innerHTML = `<div style="padding:32px;text-align:center;color:#ef4444;">Failed to load tasks.</div>`;
            }
        }

        window.filterAndRenderTasks = function() {
            if (!window.cachedTasks) return;
            if (tmCurrentTab === 'dashboard') {
                renderTaskDashboard();
                return;
            }

            const search = (document.getElementById('task-search-input')?.value || '').toLowerCase();
            const statusF = document.getElementById('task-status-filter')?.value || '';
            const priorityF = document.getElementById('task-priority-filter')?.value || '';
            const userId = window.currentUserObj?.id;
            const today = new Date().toISOString().split('T')[0];

            let filtered = window.cachedTasks.filter(task => {
                // Exclude sub-tasks from main list
                if (task.parent_task_id) return false;

                const matchSearch = !search || (task.title || '').toLowerCase().includes(search);
                const matchStatus = !statusF || task.status === statusF;
                const matchPriority = !priorityF || task.priority === priorityF;

                // Tab-specific filters
                if (tmCurrentTab === 'myday') {
                    return matchSearch && matchStatus && matchPriority && task.is_my_day && task.my_day_user_id === userId;
                }
                if (tmCurrentTab === 'assigned') {
                    return matchSearch && matchStatus && matchPriority && task.assigned_to_user_id === userId;
                }
                return matchSearch && matchStatus && matchPriority;
            });

            renderTaskList(filtered);
        };

        function renderTaskList(tasks) {
            const content = document.getElementById('task-manager-content');
            if (!content) return;
            const now = new Date();

            if (!tasks || tasks.length === 0) {
                const emptyMsg = tmCurrentTab === 'myday' ? 'No tasks in My Day. Click ☀️ in a task to add it.' :
                    tmCurrentTab === 'assigned' ? 'No tasks assigned to you.' : 'No tasks found.';
                content.innerHTML = `<div style="padding:3rem;text-align:center;color:var(--text-secondary);">
                    <div style="font-size:2rem;margin-bottom:0.5rem;">✅</div>
                    <p style="font-weight:600;margin:0 0 0.3rem;">${emptyMsg}</p>
                    <p style="font-size:0.82rem;">Type in the input above or click "+ Full Task" to create one.</p>
                </div>`;
                return;
            }

            const rows = tasks.map(task => {
                const isDone = task.status === 'done' || task.status === 'cancelled';
                const isOverdue = task.due_at && new Date(task.due_at) < now && !isDone;
                const dueStr = task.due_at ? new Date(task.due_at).toLocaleDateString(undefined, {month:'short', day:'numeric'}) : '';
                const isActive = task.id === window.currentTaskId;
                const catColor = task.category_color || '#3b82f6';

                return `<div class="tm-task-row ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}" data-id="${task.id}">
                    <div class="tm-check ${isDone ? 'checked' : ''}" onclick="event.stopPropagation();toggleTaskDone('${task.id}',${isDone})">${isDone ? '✓' : ''}</div>
                    <span class="tm-task-row-title" onclick="openTmDrawer('${task.id}')">${esc(task.title)}</span>
                    <div class="tm-task-row-meta" onclick="openTmDrawer('${task.id}')">
                        ${task.category ? `<span class="tm-cat-dot" style="background:${catColor};" title="${esc(task.category)}"></span>` : ''}
                        ${dueStr ? `<span class="tm-task-row-due ${isOverdue ? 'overdue' : ''}">${dueStr}</span>` : ''}
                        ${task.assigned_to_user_id ? `<span class="crm-assignee-chip" style="width:20px;height:20px;font-size:0.6rem;" title="${esc(getOrgMemberName(task.assigned_to_user_id))}">${getOrgMemberInitials(task.assigned_to_user_id)}</span>` : ''}
                    </div>
                </div>`;
            }).join('');

            content.innerHTML = rows;
        }

        // Quick Add from inline input
        window.quickAddTask = async function() {
            const input = document.getElementById('tm-quick-add');
            const title = input?.value?.trim();
            if (!title || !currentUserOrgId) return;

            try {
                const {data: {user}} = await supabaseClient.auth.getUser();
                const insertData = {
                    org_id: currentUserOrgId, title, status: 'open', priority: 'medium',
                    task_type: 'general', created_by_user_id: user.id
                };
                // If on My Day tab, auto-add to My Day
                if (tmCurrentTab === 'myday') {
                    insertData.is_my_day = true;
                    insertData.my_day_user_id = user.id;
                    insertData.my_day_date = new Date().toISOString().split('T')[0];
                }
                // If on Assigned to Me, auto-assign
                if (tmCurrentTab === 'assigned') {
                    insertData.assigned_to_user_id = user.id;
                }

                await supabaseClient.from('tasks').insert(insertData);
                input.value = '';
                await fetchTasks();
            } catch (e) { showToast('Failed: ' + (e.message || ''), 'error'); }
        };

        // Toggle task done/undone
        window.toggleTaskDone = async function(taskId, isDone) {
            const updates = isDone
                ? { status: 'open', completed_at: null, updated_at: new Date().toISOString() }
                : { status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() };

            await supabaseClient.from('tasks').update(updates).eq('id', taskId).eq('org_id', currentUserOrgId);

            // Notify creator if completing
            if (!isDone) {
                const task = (window.cachedTasks || []).find(t => t.id === taskId);
                if (task && task.created_by_user_id && typeof insertTaskNotification === 'function') {
                    insertTaskNotification({ orgId: currentUserOrgId, entityId: taskId, eventKey: 'task_completed',
                        title: t('notifications.events.task_completed.title'), body: t('notifications.events.task_completed.body', { task_title: task.title }),
                        recipientUserId: task.created_by_user_id });
                }
            }
            await fetchTasks();
        };

        // ==========================================
        // RIGHT SIDEBAR DRAWER
        // ==========================================
        window.openTmDrawer = async function(taskId) {
            window.currentTaskId = taskId;
            const drawer = document.getElementById('tm-drawer');
            const inner = document.getElementById('tm-drawer-inner');
            if (!drawer || !inner) return;

            drawer.style.width = '380px';
            drawer.style.borderInlineStartWidth = '1px';
            inner.innerHTML = '<div style="text-align:center;padding:2rem;"><div class="spinner" style="width:20px;height:20px;margin:0 auto;"></div></div>';

            // Highlight active row
            document.querySelectorAll('.tm-task-row').forEach(r => r.classList.toggle('active', r.dataset.id === taskId));

            try {
                const [{data: task, error}, {data: subtasks}, {data: attachments}, {data: comments}] = await Promise.all([
                    supabaseClient.from('tasks').select('*').eq('id', taskId).single(),
                    supabaseClient.from('tasks').select('*').eq('parent_task_id', taskId).order('created_at'),
                    supabaseClient.from('task_attachments').select('*').eq('task_id', taskId).order('created_at'),
                    supabaseClient.from('task_comments').select('*').eq('task_id', taskId).order('created_at')
                ]);
                if (error) throw error;
                window._taskDetailData = task;

                const isDone = task.status === 'done';
                const isMyDay = task.is_my_day && task.my_day_user_id === window.currentUserObj?.id;
                const dueDisplay = task.due_at ? new Date(task.due_at).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'}) : '';
                const createdDisplay = task.created_at ? formatDate(new Date(task.created_at)) : '';

                inner.innerHTML = `
                    <!-- Header: check + title -->
                    <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:1rem;">
                        <div class="tm-check ${isDone?'checked':''}" onclick="toggleTaskDone('${task.id}',${isDone})" style="margin-top:3px;">${isDone?'✓':''}</div>
                        <input type="text" id="tm-drawer-title" value="${esc(task.title)}" onblur="updateTaskField('${task.id}','title',this.value)"
                            style="flex:1;font-size:1rem;font-weight:600;background:transparent;border:none;outline:none;color:var(--text-primary);padding:0;">
                        <button onclick="closeTmDrawer()" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:1.1rem;flex-shrink:0;">✕</button>
                    </div>

                    <!-- Sub-tasks -->
                    <div style="margin-bottom:0.8rem;">
                        <div id="tm-subtasks-list">
                            ${(subtasks||[]).map(st => `
                                <div class="tm-subtask-row">
                                    <div class="tm-subtask-check ${st.status==='done'?'checked':''}" onclick="toggleTaskDone('${st.id}',${st.status==='done'})">${st.status==='done'?'✓':''}</div>
                                    <span class="tm-subtask-title ${st.status==='done'?'done':''}">${esc(st.title)}</span>
                                </div>`).join('')}
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                            <span style="font-size:0.8rem;color:var(--text-secondary);">+</span>
                            <input type="text" id="tm-add-step" placeholder="Add step" onkeydown="if(event.key==='Enter')addSubTask('${task.id}')"
                                style="flex:1;background:transparent;border:none;outline:none;color:var(--text-primary);font-size:0.82rem;padding:4px 0;">
                        </div>
                    </div>

                    <!-- My Day toggle -->
                    <div class="tm-drawer-action ${isMyDay?'active':''}" onclick="toggleMyDay('${task.id}',${!isMyDay})">
                        <span class="tm-da-icon">☀️</span>
                        <span class="tm-da-label">${isMyDay ? 'Added to My Day' : 'Add to My Day'}</span>
                    </div>

                    <!-- Remind Me -->
                    <div class="tm-drawer-action" onclick="setTaskReminder('${task.id}')">
                        <span class="tm-da-icon">🔔</span>
                        <span class="tm-da-label">Remind me</span>
                        <span class="tm-da-value">${task.remind_at ? new Date(task.remind_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : ''}</span>
                    </div>

                    <!-- Due Date -->
                    <div class="tm-drawer-action" onclick="showDueDatePicker('${task.id}')">
                        <span class="tm-da-icon">📅</span>
                        <span class="tm-da-label">Due date</span>
                        <span class="tm-da-value ${task.due_at && new Date(task.due_at)<new Date() && !isDone ? 'overdue' : ''}">${dueDisplay}</span>
                    </div>
                    <div id="tm-due-picker" style="display:none;padding:6px 0 8px 28px;">
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            <button class="pill-btn" onclick="setDueDate('${task.id}','today')" style="font-size:0.72rem;">Today</button>
                            <button class="pill-btn" onclick="setDueDate('${task.id}','tomorrow')" style="font-size:0.72rem;">Tomorrow</button>
                            <button class="pill-btn" onclick="setDueDate('${task.id}','next_week')" style="font-size:0.72rem;">Next Week</button>
                            <input type="date" onchange="setDueDate('${task.id}','custom',this.value)" style="padding:4px 8px;border-radius:6px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.1);color:var(--text-primary);font-size:0.75rem;">
                        </div>
                    </div>

                    <!-- Repeat -->
                    <div class="tm-drawer-action" onclick="showRepeatPicker('${task.id}')">
                        <span class="tm-da-icon">🔄</span>
                        <span class="tm-da-label">Repeat</span>
                        <span class="tm-da-value">${task.recurrence ? task.recurrence.charAt(0).toUpperCase()+task.recurrence.slice(1) : ''}</span>
                    </div>
                    <div id="tm-repeat-picker" style="display:none;padding:6px 0 8px 28px;">
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            ${['daily','weekdays','weekly','monthly','yearly'].map(r => `<button class="pill-btn${task.recurrence===r?' primary':''}" onclick="setRecurrence('${task.id}','${r}')" style="font-size:0.72rem;">${r.charAt(0).toUpperCase()+r.slice(1)}</button>`).join('')}
                            <button class="pill-btn${!task.recurrence?' primary':''}" onclick="setRecurrence('${task.id}',null)" style="font-size:0.72rem;">None</button>
                        </div>
                    </div>

                    <!-- Category -->
                    <div class="tm-drawer-action" onclick="showCategoryPicker('${task.id}')">
                        <span class="tm-da-icon">🏷️</span>
                        <span class="tm-da-label">Category</span>
                        <span class="tm-da-value">${task.category ? `<span class="tm-cat-dot" style="display:inline-block;background:${task.category_color||'#3b82f6'};"></span> ${esc(task.category)}` : ''}</span>
                    </div>
                    <div id="tm-cat-picker" style="display:none;padding:6px 0 8px 28px;">
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            ${[{n:'General',c:'#3b82f6'},{n:'Follow-up',c:'#f59e0b'},{n:'Urgent',c:'#ef4444'},{n:'Personal',c:'#8b5cf6'},{n:'Client',c:'#10b981'}].map(cat =>
                                `<button class="pill-btn${task.category===cat.n?' primary':''}" onclick="setCategory('${task.id}','${cat.n}','${cat.c}')" style="font-size:0.72rem;"><span class="tm-cat-dot" style="display:inline-block;background:${cat.c};margin-right:4px;"></span>${cat.n}</button>`
                            ).join('')}
                            <button class="pill-btn${!task.category?' primary':''}" onclick="setCategory('${task.id}',null,null)" style="font-size:0.72rem;">None</button>
                        </div>
                    </div>

                    <!-- File Attachment -->
                    <div class="tm-drawer-action" onclick="document.getElementById('tm-file-input').click()">
                        <span class="tm-da-icon">📎</span>
                        <span class="tm-da-label">Add file</span>
                        <span class="tm-da-value">${(attachments||[]).length ? (attachments||[]).length+' file(s)' : ''}</span>
                    </div>
                    <input type="file" id="tm-file-input" style="display:none;" onchange="uploadTaskFile('${task.id}',this)">
                    ${(attachments||[]).length ? `<div style="padding:0 0 8px 28px;display:flex;gap:4px;flex-wrap:wrap;">
                        ${(attachments||[]).map(a => `<span style="font-size:0.72rem;padding:3px 8px;border-radius:6px;background:rgba(255,255,255,0.06);color:var(--text-secondary);cursor:pointer;" onclick="downloadTaskFile('${a.file_path}','${esc(a.file_name)}')" title="Click to download">📄 ${esc(a.file_name)}</span>`).join('')}
                    </div>` : ''}

                    <!-- Notes -->
                    <div style="margin-top:0.5rem;">
                        <textarea id="tm-drawer-notes" placeholder="Add a note..." rows="3" dir="auto"
                            onblur="updateTaskField('${task.id}','notes',this.value)"
                            style="width:100%;padding:10px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.1);color:var(--text-primary);font-size:0.85rem;resize:vertical;">${esc(task.notes||'')}</textarea>
                    </div>

                    <!-- Status + Priority + Assignee -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:0.8rem;">
                        <select onchange="updateTaskField('${task.id}','status',this.value)" style="padding:7px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.1);color:var(--text-primary);font-size:0.82rem;">
                            ${['open','in_progress','waiting','done','cancelled'].map(s => `<option value="${s}"${task.status===s?' selected':''}>${s.replace('_',' ')}</option>`).join('')}
                        </select>
                        <select onchange="updateTaskField('${task.id}','priority',this.value)" style="padding:7px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.1);color:var(--text-primary);font-size:0.82rem;">
                            ${['low','medium','high','urgent'].map(p => `<option value="${p}"${task.priority===p?' selected':''}>${p}</option>`).join('')}
                        </select>
                    </div>
                    <select onchange="updateTaskAssignee(this.value)" style="width:100%;margin-top:6px;padding:7px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.1);color:var(--text-primary);font-size:0.82rem;">
                        <option value="">Unassigned</option>
                        ${(window.orgMembersCache||[]).map(m => `<option value="${m.user_id}"${task.assigned_to_user_id===m.user_id?' selected':''}>${esc(m.full_name||m.email)}</option>`).join('')}
                    </select>

                    <!-- Footer: created date + delete -->
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;padding-top:0.8rem;border-top:1px solid rgba(255,255,255,0.06);">
                        <span style="font-size:0.72rem;color:var(--text-secondary);">Created ${createdDisplay}</span>
                        <button onclick="deleteTask('${task.id}')" style="background:none;border:none;color:#ef4444;font-size:0.75rem;cursor:pointer;font-weight:600;">Delete</button>
                    </div>
                `;
            } catch (err) {
                inner.innerHTML = '<div style="padding:1rem;color:#ef4444;">Failed to load task.</div>';
            }
        };

        window.closeTmDrawer = function() {
            const drawer = document.getElementById('tm-drawer');
            if (drawer) { drawer.style.width = '0'; drawer.style.borderInlineStartWidth = '0'; }
            window.currentTaskId = null;
            document.querySelectorAll('.tm-task-row').forEach(r => r.classList.remove('active'));
        };

        // Drawer helpers
        window.showDueDatePicker = function() { document.getElementById('tm-due-picker').style.display = document.getElementById('tm-due-picker').style.display === 'none' ? 'block' : 'none'; };
        window.showRepeatPicker = function() { document.getElementById('tm-repeat-picker').style.display = document.getElementById('tm-repeat-picker').style.display === 'none' ? 'block' : 'none'; };
        window.showCategoryPicker = function() { document.getElementById('tm-cat-picker').style.display = document.getElementById('tm-cat-picker').style.display === 'none' ? 'block' : 'none'; };

        window.setDueDate = async function(taskId, preset, customVal) {
            let due;
            const today = new Date(); today.setHours(23,59,59,0);
            if (preset === 'today') due = today;
            else if (preset === 'tomorrow') { due = new Date(today); due.setDate(due.getDate()+1); }
            else if (preset === 'next_week') { due = new Date(today); due.setDate(due.getDate()+7); }
            else if (preset === 'custom' && customVal) due = new Date(customVal+'T23:59:59');
            if (due) await updateTaskField(taskId, 'due_at', due.toISOString());
            openTmDrawer(taskId);
        };

        window.setRecurrence = async function(taskId, value) {
            await updateTaskField(taskId, 'recurrence', value);
            openTmDrawer(taskId);
        };

        window.setCategory = async function(taskId, name, color) {
            await supabaseClient.from('tasks').update({ category: name, category_color: color, updated_at: new Date().toISOString() }).eq('id', taskId);
            await fetchTasks();
            openTmDrawer(taskId);
        };

        window.toggleMyDay = async function(taskId, add) {
            const userId = window.currentUserObj?.id;
            await supabaseClient.from('tasks').update({
                is_my_day: add, my_day_user_id: add ? userId : null,
                my_day_date: add ? new Date().toISOString().split('T')[0] : null,
                updated_at: new Date().toISOString()
            }).eq('id', taskId);
            await fetchTasks();
            openTmDrawer(taskId);
        };

        window.addSubTask = async function(parentId) {
            const input = document.getElementById('tm-add-step');
            const title = input?.value?.trim();
            if (!title) return;
            const {data:{user}} = await supabaseClient.auth.getUser();
            await supabaseClient.from('tasks').insert({
                org_id: currentUserOrgId, title, parent_task_id: parentId,
                status: 'open', priority: 'medium', task_type: 'general', created_by_user_id: user.id
            });
            input.value = '';
            openTmDrawer(parentId);
        };

        window.updateTaskField = async function(taskId, field, value) {
            const updates = { [field]: value, updated_at: new Date().toISOString() };
            if (field === 'status' && value === 'done') updates.completed_at = new Date().toISOString();
            await supabaseClient.from('tasks').update(updates).eq('id', taskId).eq('org_id', currentUserOrgId);
            await fetchTasks();
        };

        window.setTaskReminder = async function(taskId) {
            const options = ['In 1 hour', 'Tomorrow 9 AM', 'Next Monday 9 AM', 'Pick date/time'];
            const choice = prompt('Remind me:\n1. In 1 hour\n2. Tomorrow 9 AM\n3. Next Monday 9 AM\n4. Custom (enter ISO date)', '1');
            let remindAt;
            const now = new Date();
            if (choice === '1') { remindAt = new Date(now.getTime() + 3600000); }
            else if (choice === '2') { remindAt = new Date(now); remindAt.setDate(remindAt.getDate()+1); remindAt.setHours(9,0,0,0); }
            else if (choice === '3') { remindAt = new Date(now); remindAt.setDate(remindAt.getDate()+(8-remindAt.getDay())%7||7); remindAt.setHours(9,0,0,0); }
            else if (choice) { remindAt = new Date(choice); }
            if (remindAt && !isNaN(remindAt)) {
                await updateTaskField(taskId, 'remind_at', remindAt.toISOString());
                showToast('Reminder set for ' + remindAt.toLocaleString(), 'success');
                openTmDrawer(taskId);
            }
        };

        window.uploadTaskFile = async function(taskId, inputEl) {
            const file = inputEl?.files?.[0];
            if (!file || !taskId) return;
            try {
                const path = `${currentUserOrgId}/${taskId}/${Date.now()}_${file.name}`;
                const {error: upErr} = await supabaseClient.storage.from('task_attachments').upload(path, file);
                if (upErr) throw upErr;
                const {data:{user}} = await supabaseClient.auth.getUser();
                await supabaseClient.from('task_attachments').insert({
                    task_id: taskId, org_id: currentUserOrgId, file_name: file.name,
                    file_path: path, file_size: file.size, mime_type: file.type, uploaded_by: user.id
                });
                showToast('File attached', 'success');
                openTmDrawer(taskId);
            } catch (e) { showToast('Upload failed: '+(e.message||''), 'error'); }
            inputEl.value = '';
        };

        window.downloadTaskFile = async function(path, name) {
            const {data} = await supabaseClient.storage.from('task_attachments').createSignedUrl(path, 3600);
            if (data?.signedUrl) window.open(data.signedUrl, '_blank');
        };

        window.openCreateTaskModal = function() {
            document.getElementById('create-task-title').value = '';
            document.getElementById('create-task-desc').value = '';
            document.getElementById('create-task-type').value = 'general';
            document.getElementById('create-task-priority').value = 'medium';
            document.getElementById('create-task-due').value = '';
            // Populate assign-to dropdown
            const assignSel = document.getElementById('create-task-assign');
            if (assignSel) {
                assignSel.innerHTML = `<option value="">${t('task_manager.unassigned')}</option>` +
                    (window.orgMembersCache||[]).map(m => `<option value="${m.user_id}">${esc(m.full_name||m.email)}</option>`).join('');
            }
            document.getElementById('create-task-modal').style.display = 'flex';
        };

        window.closeCreateTaskModal = function(event) {
            if (event && event.target.id !== 'create-task-modal') return;
            document.getElementById('create-task-modal').style.display = 'none';
        };

        window.submitCreateTask = async function() {
            const title = document.getElementById('create-task-title').value.trim();
            if (!title) { showToast('Task title is required'); return; }
            if (!currentUserOrgId) return;

            try {
                const {data: {user}} = await supabaseClient.auth.getUser();
                const dueVal = document.getElementById('create-task-due').value;
                const assignVal = document.getElementById('create-task-assign')?.value || null;
                const {data, error} = await supabaseClient.from('tasks').insert({
                    org_id: currentUserOrgId,
                    title,
                    description: document.getElementById('create-task-desc').value.trim() || null,
                    task_type: document.getElementById('create-task-type').value,
                    priority: document.getElementById('create-task-priority').value,
                    due_at: dueVal ? new Date(dueVal).toISOString() : null,
                    assigned_to_user_id: assignVal || null,
                    created_by_user_id: user.id,
                    status: 'open'
                }).select().single();

                if (error) throw error;

                // Fire task_assigned notification
                if (assignVal) {
                    insertTaskNotification({
                        orgId: currentUserOrgId,
                        entityId: data.id,
                        eventKey: 'task_assigned',
                        title: t('notifications.events.task_assigned.title'),
                        body: t('notifications.events.task_assigned.body', { task_title: title }),
                        recipientUserId: assignVal
                    });
                }

                showToast(t('task_manager.task_saved'));
                closeCreateTaskModal();
                await fetchTasks();
            } catch (err) {
                console.error('Create task failed:', err);
                showToast(t('task_manager.error_create'));
            }
        };

        window.openTaskDetail = async function(taskId) {
            if (!taskId) return;
            window.currentTaskId = taskId;
            const modal = document.getElementById('task-detail-modal');
            const body = document.getElementById('task-detail-body');
            if (!modal || !body) return;

            modal.style.display = 'flex';
            body.innerHTML = '<div class="crm-loading"><div class="spinner" style="width:24px;height:24px;margin:0 auto 8px;"></div><p>Loading…</p></div>';

            try {
                const [{data: task, error: te}, {data: comments}] = await Promise.all([
                    supabaseClient.from('tasks').select('*').eq('id', taskId).eq('org_id', currentUserOrgId).single(),
                    supabaseClient.from('task_comments').select('*').eq('task_id', taskId).order('created_at', {ascending: true})
                ]);
                if (te) throw te;

                document.getElementById('task-detail-title').textContent = task.title;

                const pColor = {urgent:'#ef4444', high:'#f97316', medium:'#3b82f6', low:'#9ca3af'}[task.priority] || '#9ca3af';
                const isOverdue = task.due_at && new Date(task.due_at) < new Date() && task.status !== 'done' && task.status !== 'cancelled';
                const dueStr = task.due_at
                    ? new Date(task.due_at).toLocaleString(undefined, {month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})
                    : 'No due date';

                const commentHtml = (comments||[]).length
                    ? (comments||[]).map(c => `
                        <div class="note-item" style="border-inline-start-color:rgba(99,102,241,.4);">
                            <div class="note-author">${new Date(c.created_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
                            <div class="note-body">${esc(c.body)}</div>
                        </div>`).join('')
                    : `<div style="color:var(--text-muted,#888);font-size:0.875rem;padding:4px 0;">No comments yet.</div>`;

                const members = window.orgMembersCache || [];
                const assigneeOptions = members.map(m => `<option value="${m.user_id}" ${task.assigned_to_user_id===m.user_id?'selected':''}>${esc(m.full_name||m.email)}</option>`).join('');
                window._taskDetailData = task;

                body.innerHTML = `
                    <!-- Status + Priority row -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div class="form-group">
                            <label class="form-label">${t('task_manager.col_status')}</label>
                            <select id="task-detail-status" class="form-input" onchange="updateTaskStatus(this.value)">
                                <option value="open"        ${task.status==='open'?'selected':''}>${t('task_manager.status.open')}</option>
                                <option value="in_progress" ${task.status==='in_progress'?'selected':''}>${t('task_manager.status.in_progress')}</option>
                                <option value="waiting"     ${task.status==='waiting'?'selected':''}>${t('task_manager.status.waiting')}</option>
                                <option value="done"        ${task.status==='done'?'selected':''}>${t('task_manager.status.done')}</option>
                                <option value="cancelled"   ${task.status==='cancelled'?'selected':''}>${t('task_manager.status.cancelled')}</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">${t('task_manager.col_priority')}</label>
                            <div style="display:flex;align-items:center;gap:8px;padding:10px 0;">
                                <span style="width:10px;height:10px;border-radius:50%;background:${pColor};display:inline-block;flex-shrink:0;"></span>
                                <span style="font-weight:600;color:${pColor};text-transform:capitalize;">${task.priority||'medium'}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Assigned To -->
                    <div class="form-group">
                        <label class="form-label">${t('task_manager.label_assign_to')}</label>
                        <select id="task-detail-assignee" class="form-input" onchange="updateTaskAssignee(this.value)">
                            <option value="">${t('task_manager.unassigned')}</option>
                            ${assigneeOptions}
                        </select>
                    </div>

                    <!-- Due date -->
                    <div class="form-group">
                        <label class="form-label">${t('task_manager.col_due')}</label>
                        <div style="padding:10px 12px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);font-size:0.875rem;${isOverdue?'color:#f87171;font-weight:600;':''}">${isOverdue?'⚠️ Overdue · ':''}${dueStr}</div>
                    </div>

                    <!-- Description -->
                    ${task.description ? `
                    <div class="form-group">
                        <label class="form-label">Description</label>
                        <div style="padding:12px 14px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);font-size:0.875rem;line-height:1.6;">${esc(task.description)}</div>
                    </div>` : ''}

                    <!-- Comments -->
                    <div class="form-group">
                        <label class="form-label">Comments</label>
                        <div id="task-comments-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;">${commentHtml}</div>
                        <div style="display:flex;gap:8px;">
                            <input id="task-comment-input" type="text" class="form-input" style="flex:1;" placeholder="Write a comment…">
                            <button class="btn-primary" onclick="submitTaskComment()">Send</button>
                        </div>
                    </div>

                    <!-- Danger zone -->
                    <div style="padding-top:12px;border-top:1px solid rgba(255,255,255,.07);display:flex;justify-content:flex-end;">
                        <button onclick="deleteTask('${esc(task.id)}')" style="background:rgba(239,68,68,.1);color:#f87171;border:1px solid rgba(239,68,68,.25);padding:8px 16px;border-radius:8px;cursor:pointer;font-size:0.8rem;font-weight:600;">${t('task_manager.btn_delete')}</button>
                    </div>
                `;
            } catch (err) {
                console.error('Failed to load task detail:', err);
                body.innerHTML = '<div style="padding:24px;text-align:center;color:#f87171;">Failed to load task.</div>';
            }
        };

        window.closeTaskDetail = function(event) {
            if (event && event.target.id !== 'task-detail-modal') return;
            document.getElementById('task-detail-modal').style.display = 'none';
            window.currentTaskId = null;
        };

        window.updateTaskStatus = async function(newStatus) {
            if (!window.currentTaskId || !currentUserOrgId) return;
            try {
                const updates = {status: newStatus, updated_at: new Date().toISOString()};
                if (newStatus === 'done') updates.completed_at = new Date().toISOString();
                const {error} = await supabaseClient.from('tasks').update(updates)
                    .eq('id', window.currentTaskId).eq('org_id', currentUserOrgId);
                if (error) throw error;
                // Fire task_completed notification
                if (newStatus === 'done' && window._taskDetailData) {
                    insertTaskNotification({
                        orgId: currentUserOrgId,
                        entityId: window.currentTaskId,
                        eventKey: 'task_completed',
                        title: t('notifications.events.task_completed.title'),
                        body: t('notifications.events.task_completed.body', { task_title: window._taskDetailData.title || 'Task' }),
                        recipientUserId: window._taskDetailData.created_by_user_id
                    });
                }
                showToast(t('task_manager.task_saved'));
                await fetchTasks();
            } catch (err) {
                console.error('Update task status failed:', err);
                showToast(t('messages.toast_status_fail'));
            }
        };

        window.updateTaskAssignee = async function(userId) {
            if (!window.currentTaskId || !currentUserOrgId) return;
            try {
                const {error} = await supabaseClient.from('tasks').update({
                    assigned_to_user_id: userId || null,
                    updated_at: new Date().toISOString()
                }).eq('id', window.currentTaskId).eq('org_id', currentUserOrgId);
                if (error) throw error;
                // Fire task_assigned notification
                if (userId) {
                    insertTaskNotification({
                        orgId: currentUserOrgId,
                        entityId: window.currentTaskId,
                        eventKey: 'task_assigned',
                        title: t('notifications.events.task_assigned.title'),
                        body: t('notifications.events.task_assigned.body', { task_title: window._taskDetailData?.title || 'Task' }),
                        recipientUserId: userId
                    });
                }
                showToast(t('task_manager.task_saved'));
                await fetchTasks();
            } catch(err) {
                console.error('Update task assignee failed:', err);
                showToast(t('task_manager.error_assignee'));
            }
        };

        window.submitTaskComment = async function() {
            if (!window.currentTaskId || !currentUserOrgId) return;
            const input = document.getElementById('task-comment-input');
            const body = input?.value.trim();
            if (!body) return;

            try {
                const {data: {user}} = await supabaseClient.auth.getUser();
                const {error} = await supabaseClient.from('task_comments').insert({
                    task_id: window.currentTaskId,
                    org_id: currentUserOrgId,
                    author_user_id: user.id,
                    body
                });
                if (error) throw error;
                input.value = '';
                showToast('Comment added');
                // Reload the task detail comments section
                await openTaskDetail(window.currentTaskId);
            } catch (err) {
                console.error('Add comment failed:', err);
                showToast('Failed to add comment');
            }
        };

        // ==========================================
        // TASK MANAGER DASHBOARD (Feature 6)
        // ==========================================
        function renderTaskDashboard() {
            const content = document.getElementById('task-manager-content');
            if (!content) return;
            const tasks = window.cachedTasks || [];
            if (tasks.length === 0) {
                content.innerHTML = `<div class="crm-dash-empty-state"><div style="font-size:2rem;margin-bottom:8px;">📋</div><p>${t('task_manager.dash_empty')}</p><button class="btn-primary" style="margin-top:12px;" onclick="openCreateTaskModal()">+ ${t('task_manager.btn_create_task')}</button></div>`;
                return;
            }
            const now = new Date();
            const total = tasks.length;
            const done = tasks.filter(t => t.status === 'done').length;
            const overdue = tasks.filter(t => t.due_at && new Date(t.due_at) < now && t.status !== 'done' && t.status !== 'cancelled').length;
            const rate = total > 0 ? Math.round((done / total) * 100) : 0;

            // Status data
            const statusData = {};
            ['open','in_progress','waiting','done','cancelled'].forEach(s => statusData[s] = 0);
            tasks.forEach(tk => { statusData[tk.status] = (statusData[tk.status]||0) + 1; });
            const statusColors = {open:'#3b82f6',in_progress:'#f59e0b',waiting:'#8b5cf6',done:'#10b981',cancelled:'#64748b'};

            // Priority data
            const priData = {};
            ['urgent','high','medium','low'].forEach(p => priData[p] = 0);
            tasks.forEach(tk => { priData[tk.priority] = (priData[tk.priority]||0) + 1; });
            const priColors = {urgent:'#ef4444',high:'#f97316',medium:'#3b82f6',low:'#9ca3af'};

            // Assignee data
            const assigneeData = {};
            tasks.forEach(tk => { const a = tk.assigned_to_user_id || '__unassigned'; assigneeData[a] = (assigneeData[a]||0) + 1; });
            const assigneeEntries = Object.entries(assigneeData).sort((a,b) => b[1]-a[1]).slice(0, 8);

            // Overdue tasks
            const overdueTasks = tasks.filter(tk => tk.due_at && new Date(tk.due_at) < now && tk.status !== 'done' && tk.status !== 'cancelled')
                .sort((a,b) => new Date(a.due_at) - new Date(b.due_at)).slice(0, 5);

            content.innerHTML = `
                <div class="crm-dash-kpi-strip">
                    <div class="crm-dash-kpi"><div class="crm-dash-kpi-value">${total}</div><div class="crm-dash-kpi-label">${t('task_manager.dash_kpi_total')}</div><div class="crm-dash-kpi-sub">${t('task_manager.dash_kpi_total_sub')}</div></div>
                    <div class="crm-dash-kpi"><div class="crm-dash-kpi-value" style="color:#34d399;">${done}</div><div class="crm-dash-kpi-label">${t('task_manager.dash_kpi_done')}</div><div class="crm-dash-kpi-sub">${t('task_manager.dash_kpi_done_sub')}</div></div>
                    <div class="crm-dash-kpi"><div class="crm-dash-kpi-value" style="color:#f87171;">${overdue}</div><div class="crm-dash-kpi-label">${t('task_manager.dash_kpi_overdue')}</div><div class="crm-dash-kpi-sub">${t('task_manager.dash_kpi_overdue_sub')}</div></div>
                    <div class="crm-dash-kpi"><div class="crm-dash-kpi-value">${rate}%</div><div class="crm-dash-kpi-label">${t('task_manager.dash_kpi_rate')}</div><div class="crm-dash-kpi-sub">${t('task_manager.dash_kpi_rate_sub')}</div></div>
                </div>
                <div class="crm-dash-grid">
                    <div>
                        <div class="crm-dash-chart-card">
                            <div class="crm-dash-chart-title">${t('task_manager.dash_chart_by_status')} <button class="crm-dash-refresh-btn" onclick="fetchTasks()" title="${t('task_manager.dash_refresh')}">↻</button></div>
                            ${renderDonutChart(Object.entries(statusData).filter(([,v]) => v > 0).map(([k,v]) => [t('task_manager.status.'+k)||k, v]), Object.values(statusColors))}
                        </div>
                        <div class="crm-dash-chart-card">
                            <div class="crm-dash-chart-title">${t('task_manager.dash_chart_by_assignee')}</div>
                            ${renderHBarChart(assigneeEntries.map(([k,v]) => ({label: k==='__unassigned' ? t('task_manager.unassigned') : getOrgMemberName(k)||'Member', value:v, color:'#6366f1'})))}
                        </div>
                    </div>
                    <div>
                        <div class="crm-dash-chart-card">
                            <div class="crm-dash-chart-title">${t('task_manager.dash_chart_by_priority')}</div>
                            ${renderHBarChart(['urgent','high','medium','low'].filter(p => priData[p] > 0).map(p => ({label: t('task_manager.priority.'+p)||p, value: priData[p], color: priColors[p]})))}
                        </div>
                        <div class="crm-dash-chart-card">
                            <div class="crm-dash-chart-title">${t('task_manager.dash_chart_overdue')}</div>
                            ${overdueTasks.length ? overdueTasks.map(tk => {
                                const daysOver = Math.floor((now - new Date(tk.due_at)) / (1000*60*60*24));
                                const pDotColor = {urgent:'#ef4444',high:'#f97316',medium:'#3b82f6',low:'#9ca3af'}[tk.priority] || '#9ca3af';
                                return `<div class="crm-dash-recent-item" onclick="openTaskDetail('${esc(tk.id)}')">
                                    <span style="width:8px;height:8px;border-radius:50%;background:${pDotColor};flex-shrink:0;"></span>
                                    <div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(tk.title)}</div></div>
                                    ${tk.assigned_to_user_id ? `<span class="crm-assignee-chip" style="width:22px;height:22px;font-size:0.58rem;">${getOrgMemberInitials(tk.assigned_to_user_id)}</span>` : ''}
                                    <span style="font-size:0.72rem;color:#f87171;font-weight:600;white-space:nowrap;">${t('task_manager.dash_overdue_days').replace('{n}', daysOver)}</span>
                                </div>`;
                            }).join('') : `<div style="text-align:center;padding:16px;color:#34d399;font-weight:600;">✓ ${t('task_manager.dash_no_overdue')}</div>`}
                        </div>
                    </div>
                </div>`;
        }

        window.deleteTask = async function(taskId) {
            if (!taskId || !currentUserOrgId) return;
            if (!confirm(t('task_manager.confirm_delete'))) return;
            try {
                const {error} = await supabaseClient.from('tasks').delete()
                    .eq('id', taskId).eq('org_id', currentUserOrgId);
                if (error) throw error;
                showToast(t('task_manager.task_deleted'));
                closeTaskDetail();
                await fetchTasks();
            } catch (err) {
                console.error('Delete task failed:', err);
                showToast(t('task_manager.error_delete'));
            }
        };

        // --- HELPERS ---
        function esc(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        // --- OFFER-TYPE LABEL HELPER (future-ready) ---
        window.getOfferLabel = function (key) {
            return t(key);
        };

        // ===========================================================
        //     TEAM MANAGEMENT & RBAC PERMISSION SYSTEM
        // ===========================================================
        (function () {
            let teamMembers = [];
            let teamPermissionsCache = {};
            let teamActiveSubtab = 'members';
            let teamActivePermRole = 'manager';
            let teamCustomRoles = [];
            let teamCustomRolesLoaded = false;
            let teamLoading = false;
            let myPermissions = null;
            let myEffectiveRole = null;

            // --- Permission definitions for the UI ---
            const PERM_GROUPS = [
                { key: 'crm', i18n: 'perm_group_crm', perms: [
                    { key: 'crm.read', i18n: 'perm_read' },
                    { key: 'crm.write', i18n: 'perm_write' },
                    { key: 'crm.delete', i18n: 'perm_delete' },
                    { key: 'crm.change_status', i18n: 'perm_change_status' },
                    { key: 'crm.assign', i18n: 'perm_assign' },
                    { key: 'crm.notes', i18n: 'perm_notes' }
                ]},
                { key: 'tasks', i18n: 'perm_group_tasks', perms: [
                    { key: 'tasks.read', i18n: 'perm_read' },
                    { key: 'tasks.write', i18n: 'perm_write' },
                    { key: 'tasks.delete', i18n: 'perm_delete' },
                    { key: 'tasks.assign', i18n: 'perm_assign' },
                    { key: 'tasks.complete', i18n: 'perm_complete' },
                    { key: 'tasks.complete_own', i18n: 'perm_complete_own' }
                ]},
                { key: 'followups', i18n: 'perm_group_followups', perms: [
                    { key: 'followups.read', i18n: 'perm_read' },
                    { key: 'followups.write', i18n: 'perm_write' }
                ]},
                { key: 'inbox', i18n: 'perm_group_inbox', perms: [
                    { key: 'inbox.read', i18n: 'perm_read' },
                    { key: 'inbox.reply', i18n: 'perm_reply' },
                    { key: 'inbox.toggle_ai', i18n: 'perm_toggle_ai' }
                ]},
                { key: 'insights', i18n: 'perm_group_insights', perms: [
                    { key: 'insights.read', i18n: 'perm_read' }
                ]},
                { key: 'orders', i18n: 'perm_group_orders', perms: [
                    { key: 'orders.read', i18n: 'perm_read' },
                    { key: 'orders.manage', i18n: 'perm_manage' }
                ]},
                { key: 'agents', i18n: 'perm_group_agents', perms: [
                    { key: 'agents.read', i18n: 'perm_read' },
                    { key: 'agents.configure', i18n: 'perm_configure' }
                ]},
                { key: 'integrations', i18n: 'perm_group_integrations', perms: [
                    { key: 'integrations.read', i18n: 'perm_read' },
                    { key: 'integrations.manage', i18n: 'perm_manage' }
                ]},
                { key: 'org', i18n: 'perm_group_org', perms: [
                    { key: 'org.settings', i18n: 'perm_settings' },
                    { key: 'org.members', i18n: 'perm_members' },
                    { key: 'org.roles', i18n: 'perm_roles' },
                    { key: 'org.billing', i18n: 'perm_billing' }
                ]}
            ];

            function tt(key) { return t('team.' + key); }

            function getEffectiveRoleFromRaw(raw) {
                const r = String(raw || '').toLowerCase();
                if (r === 'owner') return 'owner';
                if (r === 'admin' || r === 'moderator' || r === 'manager') return 'manager';
                return 'user';
            }

            // --- Fetch my permissions on login ---
            async function fetchMyPermissions() {
                if (!currentUserOrgId) return;
                try {
                    const { data, error } = await supabaseClient.rpc('get_my_permissions', { p_org_id: currentUserOrgId });
                    if (error) throw error;
                    myEffectiveRole = data?.role || 'user';
                    myPermissions = data?.permissions || {};
                    window.myEffectiveRole = myEffectiveRole;
                    window.myPermissions = myPermissions;

                    // Show/hide team nav
                    const teamNav = document.getElementById('nav-team-item');
                    if (teamNav) {
                        teamNav.style.display = (myEffectiveRole === 'owner' || myEffectiveRole === 'manager') ? '' : 'none';
                    }
                } catch (e) {
                    console.error('Failed to fetch permissions:', e);
                    myEffectiveRole = getEffectiveRoleFromRaw(window.currentUserRole);
                    myPermissions = {};
                    window.myEffectiveRole = myEffectiveRole;
                    window.myPermissions = myPermissions;
                }
            }

            // Global permission check
            window.hasPermission = function (perm) {
                if (!myPermissions) return myEffectiveRole === 'owner';
                if (myEffectiveRole === 'owner') return true;
                return myPermissions[perm] === true;
            };

            // Nice permission denied handling
            window.showPermissionDenied = function () {
                // Remove existing
                document.getElementById('perm-denied-overlay')?.remove();

                const overlay = document.createElement('div');
                overlay.id = 'perm-denied-overlay';
                overlay.className = 'perm-denied-modal';
                overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
                overlay.innerHTML = `
                    <div class="perm-denied-box">
                        <div class="perm-denied-icon">
                            <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v2h-2V7zm0 4h2v6h-2v-6z"/></svg>
                        </div>
                        <div class="perm-denied-title">${esc(tt('permission_denied_title'))}</div>
                        <div class="perm-denied-msg">${esc(tt('permission_denied_msg'))}</div>
                        <button class="perm-denied-close" onclick="this.closest('.perm-denied-modal').remove()">OK</button>
                    </div>
                `;
                document.body.appendChild(overlay);
            };

            // Guarded action wrapper
            window.guardPermission = function (perm, callback) {
                if (window.hasPermission(perm)) {
                    return callback();
                }
                window.showPermissionDenied();
                return false;
            };

            // --- Team Tab Init ---
            let teamInvitations = [];
            let teamInviteFilter = 'all';

            window.initTeamTab = async function () {
                const root = document.getElementById('team-page-root');
                if (!root) return;
                const isOwnerOrAdmin = myEffectiveRole === 'owner' || myEffectiveRole === 'manager';
                // Pre-load custom roles for invite form and permissions tab
                if (isOwnerOrAdmin && !teamCustomRolesLoaded) await teamLoadCustomRoles();

                root.innerHTML = `
                    <div class="team-header">
                        <h2>${esc(tt('title'))}</h2>
                        <p>${esc(tt('subtitle'))}</p>
                    </div>
                    <div class="team-tabs">
                        <button class="team-tab-btn ${teamActiveSubtab === 'members' ? 'active' : ''}" onclick="teamSwitchSubtab('members', this)">${esc(tt('tab_members'))}</button>
                        ${isOwnerOrAdmin ? `<button class="team-tab-btn ${teamActiveSubtab === 'invitations' ? 'active' : ''}" onclick="teamSwitchSubtab('invitations', this)">${esc(tt('tab_invitations'))}</button>` : ''}
                        <button class="team-tab-btn ${teamActiveSubtab === 'permissions' ? 'active' : ''}" onclick="teamSwitchSubtab('permissions', this)" style="${myEffectiveRole === 'owner' ? '' : 'display:none'}">${esc(tt('tab_permissions'))}</button>
                    </div>
                    <div id="team-panel-members" class="team-tab-panel ${teamActiveSubtab === 'members' ? 'active' : ''}">
                        <div id="team-members-container"></div>
                    </div>
                    <div id="team-panel-invitations" class="team-tab-panel ${teamActiveSubtab === 'invitations' ? 'active' : ''}">
                        <div id="team-invitations-container"></div>
                    </div>
                    <div id="team-panel-permissions" class="team-tab-panel ${teamActiveSubtab === 'permissions' ? 'active' : ''}">
                        <div id="team-permissions-container"></div>
                    </div>
                `;

                await teamLoadMembers();
                if (teamActiveSubtab === 'invitations' && isOwnerOrAdmin) {
                    await teamLoadInvitations();
                }
                if (teamActiveSubtab === 'permissions' && myEffectiveRole === 'owner') {
                    await teamLoadPermissionsPanel();
                }
            };

            window.teamSwitchSubtab = function (tab, el) {
                teamActiveSubtab = tab;
                document.querySelectorAll('.team-tab-btn').forEach(b => b.classList.remove('active'));
                if (el) el.classList.add('active');
                document.querySelectorAll('.team-tab-panel').forEach(p => p.classList.remove('active'));
                const panel = document.getElementById('team-panel-' + tab);
                if (panel) panel.classList.add('active');

                if (tab === 'invitations') {
                    teamLoadInvitations();
                }
                if (tab === 'permissions' && myEffectiveRole === 'owner') {
                    teamLoadPermissionsPanel();
                }
            };

            // --- Members List ---
            async function teamLoadMembers() {
                const container = document.getElementById('team-members-container');
                if (!container || !currentUserOrgId) return;

                container.innerHTML = `<div class="team-empty"><p>${currentLang === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p></div>`;

                try {
                    const { data, error } = await supabaseClient.rpc('list_org_members', { p_org_id: currentUserOrgId });
                    if (error) throw error;
                    teamMembers = data || [];
                } catch (e) {
                    console.error('Failed to load members:', e);
                    container.innerHTML = `<div class="team-empty"><p>${esc(tt('error_generic'))}</p></div>`;
                    return;
                }

                renderTeamMembers(container);
            }

            function renderTeamMembers(container) {
                const { data: { user: currentUser } } = { data: { user: { id: null } } };
                let currentUserId = null;
                try { currentUserId = supabaseClient.auth?.user?.()?.id; } catch (_) {}
                if (!currentUserId) {
                    try {
                        const session = JSON.parse(localStorage.getItem('sb-' + new URL(supabaseClient.supabaseUrl || '').hostname.split('.')[0] + '-auth-token') || '{}');
                        currentUserId = session?.user?.id;
                    } catch (_) {}
                }
                if (!currentUserId && currentUserProfile) currentUserId = currentUserProfile.user_id;

                const isOwner = myEffectiveRole === 'owner';
                const isOwnerOrAdmin = isOwner || myEffectiveRole === 'manager';

                let html = '';

                // Invitation form (owner/admin only)
                if (isOwnerOrAdmin) {
                    html += `
                    <div class="team-invite-bar">
                        <div class="team-invite-header">
                            <h3>${esc(tt('invite_title'))}</h3>
                            <p>${esc(tt('invite_subtitle'))}</p>
                        </div>
                        <div class="team-invite-form">
                            <div class="team-invite-fields">
                                <div class="form-group">
                                    <label class="form-label">${esc(tt('input_email'))} *</label>
                                    <input type="email" id="team-invite-email" class="form-input" placeholder="${esc(tt('input_email_placeholder'))}">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">${esc(tt('input_name'))}</label>
                                    <input type="text" id="team-invite-name" class="form-input" placeholder="${esc(tt('input_name_placeholder'))}">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">${esc(tt('input_phone'))}</label>
                                    <input type="tel" id="team-invite-phone" class="form-input" placeholder="${esc(tt('input_phone_placeholder'))}">
                                </div>
                                <div class="form-group role-group">
                                    <label class="form-label">${esc(tt('input_role'))}</label>
                                    <select id="team-invite-role" class="form-input">
                                        <option value="manager">${esc(tt('role_manager'))}</option>
                                        <option value="user" selected>${esc(tt('role_user'))}</option>
                                    </select>
                                </div>
                                ${teamCustomRoles.length ? `<div class="form-group role-group">
                                    <label class="form-label">${esc(tt('label_custom_role_invite'))}</label>
                                    <select id="team-invite-custom-role" class="form-input">
                                        <option value="">${esc(tt('invite_custom_role_none'))}</option>
                                        ${teamCustomRoles.map(cr => '<option value="' + cr.id + '">' + esc(cr.name) + '</option>').join('')}
                                    </select>
                                </div>` : ''}
                            </div>
                            <button class="btn-primary" id="team-invite-btn" onclick="teamSendInvite()">${esc(tt('btn_send_invite'))}</button>
                        </div>
                        <div class="team-invite-tip">${esc(tt('domain_tip'))}</div>
                        <div id="team-invite-result" class="team-invite-result" style="display:none"></div>
                    </div>`;
                }

                if (!teamMembers.length) {
                    html += `<div class="team-empty"><p>${esc(tt('empty_members'))}</p></div>`;
                } else {
                    html += '<div class="team-members-list">';
                    for (const m of teamMembers) {
                        const effRole = m.effective_role || getEffectiveRoleFromRaw(m.raw_role);
                        const isMe = m.user_id === currentUserId;
                        const initials = (m.full_name || m.email || '?').slice(0, 2).toUpperCase();
                        const avatarHtml = m.avatar_url
                            ? `<img src="${esc(m.avatar_url)}" alt="" loading="lazy">`
                            : esc(initials);
                        const joinDate = m.created_at ? new Date(m.created_at).toLocaleDateString(currentLang === 'ar' ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';

                        html += `
                        <div class="team-member-card" onclick="teamShowProfile('${m.user_id}')" style="cursor:pointer">
                            <div class="team-avatar">${avatarHtml}</div>
                            <div class="team-member-info">
                                <div class="team-member-name">
                                    ${esc(m.full_name || (currentLang === 'ar' ? 'بدون اسم' : 'No name'))}
                                    ${m.custom_role_name
                                        ? `<span class="team-role-badge user" title="${esc(tt('role_' + effRole))}">${esc(m.custom_role_name)}</span>`
                                        : `<span class="team-role-badge ${effRole}">${esc(tt('role_' + effRole))}</span>`}
                                    ${isMe ? `<span class="team-you-badge">${esc(tt('you_badge'))}</span>` : ''}
                                    ${isOwnerOrAdmin && m.override_count > 0 ? `<span class="overrides-count-badge">${esc(tt('overrides_badge').replace('{count}', m.override_count))}</span>` : ''}
                                </div>
                                <div class="team-member-email">${esc(m.email || '')}</div>
                                ${joinDate ? `<div class="team-member-meta">${esc(tt('joined'))} ${esc(joinDate)}</div>` : ''}
                            </div>
                            <div class="team-member-actions" onclick="event.stopPropagation()">
                                ${isOwner && !isMe && effRole !== 'owner' ? `
                                    <select onchange="teamChangeRole('${m.user_id}', this.value)" aria-label="${esc(tt('input_role'))}">
                                        <option value="manager" ${effRole === 'manager' ? 'selected' : ''}>${esc(tt('role_manager'))}</option>
                                        <option value="user" ${effRole === 'user' ? 'selected' : ''}>${esc(tt('role_user'))}</option>
                                    </select>
                                    <button class="team-remove-btn" onclick="teamRemoveMember('${m.user_id}', this)">${esc(tt('btn_remove'))}</button>
                                ` : ''}
                            </div>
                        </div>`;
                    }
                    html += '</div>';
                }

                container.innerHTML = html;
            }

            // --- Send Invitation ---
            window.teamSendInvite = async function () {
                const emailInput = document.getElementById('team-invite-email');
                const nameInput = document.getElementById('team-invite-name');
                const phoneInput = document.getElementById('team-invite-phone');
                const roleInput = document.getElementById('team-invite-role');
                const btn = document.getElementById('team-invite-btn');
                const resultDiv = document.getElementById('team-invite-result');
                if (!emailInput || !btn) return;

                const email = emailInput.value.trim();
                const fullName = nameInput?.value.trim() || null;
                const phone = phoneInput?.value.trim() || null;
                const role = roleInput?.value || 'user';
                const customRoleInput = document.getElementById('team-invite-custom-role');
                const customRoleId = customRoleInput?.value || null;
                if (!email) { emailInput.focus(); return; }

                btn.disabled = true;
                btn.textContent = tt('btn_sending_invite');
                if (resultDiv) resultDiv.style.display = 'none';

                try {
                    const rpcParams = {
                        p_org_id: currentUserOrgId,
                        p_email: email,
                        p_full_name: fullName,
                        p_phone: phone,
                        p_role: role
                    };
                    rpcParams.p_custom_role_id = customRoleId || null;
                    const { data, error } = await supabaseClient.rpc('send_org_invitation', rpcParams);
                    if (error) throw error;

                    if (data?.success) {
                        showToast(tt('invite_sent'), 'success');
                        // Show copy link result
                        const token = data.token;
                        const inviteUrl = `${location.origin}${location.pathname}#accept-invite?token=${token}`;
                        if (resultDiv) {
                            resultDiv.style.display = 'flex';
                            resultDiv.innerHTML = `
                                <input type="text" class="form-input" value="${esc(inviteUrl)}" readonly id="team-invite-link-input">
                                <button class="btn-secondary" onclick="teamCopyInviteLink()">${esc(tt('btn_copy_link'))}</button>
                            `;
                        }

                        // --- Send invitation email via insert_semantic_notification ---
                        // NOTE: The send-email-notification edge function needs a new event_key
                        // 'team_invitation_sent' to render an invitation email template.
                        // Required payload fields: organization_name, inviter_name, invited_name,
                        // invited_email, role, accept_url, recipient_emails.
                        // Until the edge function is extended, this notification is inserted
                        // so it's ready when the backend template is added.
                        try {
                            const orgName = window.currentOrgData?.name || '';
                            const inviterName = currentUserProfile?.full_name || currentUserProfile?.email || '';
                            await supabaseClient.rpc('insert_semantic_notification', {
                                p_org_id: currentUserOrgId,
                                p_type: 'team',
                                p_title: 'Team Invitation Sent',
                                p_message: `${inviterName} invited ${fullName || email} to join ${orgName}`,
                                p_entity: 'invitation',
                                p_entity_id: null,
                                p_event_key: 'team_invitation_sent',
                                p_payload: {
                                    organization_name: orgName,
                                    inviter_name: inviterName,
                                    invited_name: fullName || '',
                                    invited_email: email,
                                    role: role,
                                    accept_url: inviteUrl,
                                    recipient_emails: [email.toLowerCase().trim()]
                                }
                            });
                        } catch (emailErr) {
                            console.warn('Invitation email notification failed:', emailErr);
                        }

                        emailInput.value = '';
                        if (nameInput) nameInput.value = '';
                        if (phoneInput) phoneInput.value = '';
                    } else {
                        const errKey = data?.error || 'generic';
                        const localized = tt('error_' + errKey);
                        showToast((localized && localized !== 'error_' + errKey) ? localized : tt('error_generic'), 'error');
                    }
                } catch (e) {
                    console.error('Send invitation failed:', e);
                    const msg = (e?.message || '').toLowerCase();
                    if (msg.includes('already_in_another_org')) {
                        showToast(tt('error_already_in_another_org'), 'error');
                    } else if (msg.includes('pending_invite_elsewhere')) {
                        showToast(tt('error_pending_invite_elsewhere'), 'error');
                    } else if (msg.includes('already_invited') || msg.includes('duplicate')) {
                        showToast(tt('error_already_invited'), 'error');
                    } else if (msg.includes('already_member') || msg.includes('already a member')) {
                        showToast(tt('error_already_member'), 'error');
                    } else if (msg.includes('invalid_email')) {
                        showToast(tt('error_invalid_email'), 'error');
                    } else if (msg.includes('not found') || msg.includes('42883')) {
                        showToast(tt('error_generic') + ' (RPC)', 'error');
                    } else {
                        showToast(tt('error_generic'), 'error');
                    }
                } finally {
                    btn.disabled = false;
                    btn.textContent = tt('btn_send_invite');
                }
            };

            window.teamCopyInviteLink = function () {
                const input = document.getElementById('team-invite-link-input');
                if (!input) return;
                navigator.clipboard.writeText(input.value).then(() => {
                    showToast(tt('link_copied'), 'success');
                }).catch(() => {
                    input.select();
                    document.execCommand('copy');
                    showToast(tt('link_copied'), 'success');
                });
            };

            // --- Invitations Panel (Tracker) ---
            async function teamLoadInvitations() {
                const container = document.getElementById('team-invitations-container');
                if (!container || !currentUserOrgId) return;

                container.innerHTML = `<div class="team-empty"><p>${currentLang === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p></div>`;

                try {
                    const { data, error } = await supabaseClient.rpc('list_org_invitations', { p_org_id: currentUserOrgId });
                    if (error) throw error;
                    if (data?.success) {
                        teamInvitations = data.invitations || [];
                    } else {
                        showToast(tt('error_' + (data?.error || 'generic')) || tt('error_generic'), 'error');
                        container.innerHTML = '';
                        return;
                    }
                } catch (e) {
                    console.error('Failed to load invitations:', e);
                    container.innerHTML = `<div class="team-empty"><p>${esc(tt('error_generic'))}</p></div>`;
                    return;
                }

                renderInvitationsPanel(container);
            }

            function renderInvitationsPanel(container) {
                let html = '';

                // Invitation form at top
                const isOwnerOrAdmin = myEffectiveRole === 'owner' || myEffectiveRole === 'manager';
                if (isOwnerOrAdmin) {
                    html += `
                    <div class="team-invite-bar">
                        <div class="team-invite-header">
                            <h3>${esc(tt('invite_title'))}</h3>
                            <p>${esc(tt('invite_subtitle'))}</p>
                        </div>
                        <div class="team-invite-form">
                            <div class="team-invite-fields">
                                <div class="form-group">
                                    <label class="form-label">${esc(tt('input_email'))} *</label>
                                    <input type="email" id="team-invite-email" class="form-input" placeholder="${esc(tt('input_email_placeholder'))}">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">${esc(tt('input_name'))}</label>
                                    <input type="text" id="team-invite-name" class="form-input" placeholder="${esc(tt('input_name_placeholder'))}">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">${esc(tt('input_phone'))}</label>
                                    <input type="tel" id="team-invite-phone" class="form-input" placeholder="${esc(tt('input_phone_placeholder'))}">
                                </div>
                                <div class="form-group role-group">
                                    <label class="form-label">${esc(tt('input_role'))}</label>
                                    <select id="team-invite-role" class="form-input">
                                        <option value="manager">${esc(tt('role_manager'))}</option>
                                        <option value="user" selected>${esc(tt('role_user'))}</option>
                                    </select>
                                </div>
                                ${teamCustomRoles.length ? `<div class="form-group role-group">
                                    <label class="form-label">${esc(tt('label_custom_role_invite'))}</label>
                                    <select id="team-invite-custom-role" class="form-input">
                                        <option value="">${esc(tt('invite_custom_role_none'))}</option>
                                        ${teamCustomRoles.map(cr => '<option value="' + cr.id + '">' + esc(cr.name) + '</option>').join('')}
                                    </select>
                                </div>` : ''}
                            </div>
                            <button class="btn-primary" id="team-invite-btn" onclick="teamSendInvite()">${esc(tt('btn_send_invite'))}</button>
                        </div>
                        <div class="team-invite-tip">${esc(tt('domain_tip'))}</div>
                        <div id="team-invite-result" class="team-invite-result" style="display:none"></div>
                    </div>`;
                }

                // Filter tabs
                html += `
                <div class="team-tracker-header">
                    <h3>${esc(tt('tracker_title'))}</h3>
                    <div class="team-tracker-filters">
                        ${['all', 'pending', 'accepted', 'revoked', 'expired'].map(f =>
                            `<button class="team-filter-btn ${teamInviteFilter === f ? 'active' : ''}" onclick="teamFilterInvites('${f}', this)">${esc(tt('tracker_filter_' + f))}</button>`
                        ).join('')}
                    </div>
                </div>`;

                // Filter invitations
                let filtered = teamInvitations;
                if (teamInviteFilter !== 'all') {
                    filtered = teamInvitations.filter(inv => {
                        if (teamInviteFilter === 'expired') return inv.is_expired || inv.status === 'expired';
                        if (inv.is_expired && inv.status === 'pending') return teamInviteFilter === 'expired';
                        return inv.status === teamInviteFilter;
                    });
                }

                if (!filtered.length) {
                    html += `<div class="team-empty"><p>${esc(tt('tracker_empty'))}</p></div>`;
                } else {
                    html += '<div class="team-invitations-list">';
                    for (const inv of filtered) {
                        const isExpired = inv.is_expired || (inv.status === 'pending' && new Date(inv.expires_at) < new Date());
                        const displayStatus = isExpired && inv.status === 'pending' ? 'expired' : inv.status;
                        const roleLabel = inv.role === 'admin' ? tt('role_manager') : inv.role === 'member' ? tt('role_user') : tt('role_' + inv.role);
                        const dateStr = new Date(inv.created_at).toLocaleDateString(currentLang === 'ar' ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                        const initials = (inv.full_name || inv.email || '?').slice(0, 2).toUpperCase();

                        let statusMeta = '';
                        if (displayStatus === 'pending') {
                            const expDate = new Date(inv.expires_at).toLocaleDateString(currentLang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' });
                            statusMeta = `${tt('tracker_expires')} ${expDate}`;
                        } else if (displayStatus === 'accepted' && inv.accepted_at) {
                            statusMeta = `${tt('tracker_accepted_on')} ${new Date(inv.accepted_at).toLocaleDateString(currentLang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' })}`;
                        } else if (displayStatus === 'revoked' && inv.revoked_at) {
                            statusMeta = `${tt('tracker_revoked_on')} ${new Date(inv.revoked_at).toLocaleDateString(currentLang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' })}`;
                        } else if (displayStatus === 'expired') {
                            statusMeta = `${tt('tracker_expired_on')} ${new Date(inv.expires_at).toLocaleDateString(currentLang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' })}`;
                        }

                        html += `
                        <div class="team-invite-card">
                            <div class="team-avatar">${esc(initials)}</div>
                            <div class="team-invite-info">
                                <div class="team-invite-name">${esc(inv.full_name || inv.email)}</div>
                                ${inv.full_name ? `<div class="team-invite-email">${esc(inv.email)}</div>` : ''}
                                <div class="team-invite-meta">
                                    <span class="team-role-badge ${inv.role === 'admin' ? 'manager' : inv.role === 'member' ? 'user' : inv.role}">${esc(roleLabel)}</span>
                                    <span class="team-invite-status ${displayStatus}">${esc(tt('tracker_status_' + displayStatus))}</span>
                                    <span class="team-invite-date">${esc(dateStr)}</span>
                                </div>
                                ${statusMeta ? `<div class="team-invite-status-meta">${esc(statusMeta)}</div>` : ''}
                                ${inv.invited_by_name ? `<div class="team-invite-by">${esc(tt('tracker_invited_by'))} ${esc(inv.invited_by_name)}</div>` : ''}
                            </div>
                            <div class="team-invite-actions">
                                ${displayStatus === 'pending' && !isExpired ? `
                                    <button class="btn-secondary btn-sm" onclick="teamCopyInviteLinkById('${inv.token}')">${esc(tt('btn_copy_link'))}</button>
                                    <button class="btn-secondary btn-sm" onclick="teamResendInvite('${inv.id}', this)">${esc(tt('btn_resend'))}</button>
                                    <button class="team-remove-btn btn-sm" onclick="teamRevokeInvite('${inv.id}', this)">${esc(tt('btn_revoke'))}</button>
                                ` : ''}
                                ${(displayStatus === 'expired' || displayStatus === 'revoked') ? `
                                    <button class="btn-secondary btn-sm" onclick="teamResendInvite('${inv.id}', this)">${esc(tt('btn_resend'))}</button>
                                ` : ''}
                            </div>
                        </div>`;
                    }
                    html += '</div>';
                }

                container.innerHTML = html;
            }

            window.teamFilterInvites = function (filter, el) {
                teamInviteFilter = filter;
                document.querySelectorAll('.team-filter-btn').forEach(b => b.classList.remove('active'));
                if (el) el.classList.add('active');
                const container = document.getElementById('team-invitations-container');
                if (container) renderInvitationsPanel(container);
            };

            window.teamCopyInviteLinkById = function (token) {
                const inviteUrl = `${location.origin}${location.pathname}#accept-invite?token=${token}`;
                navigator.clipboard.writeText(inviteUrl).then(() => {
                    showToast(tt('link_copied'), 'success');
                }).catch(() => {
                    showToast(tt('link_copied'), 'success');
                });
            };

            window.teamResendInvite = async function (invId, btn) {
                if (btn) { btn.disabled = true; btn.textContent = tt('btn_resending'); }
                try {
                    const { data, error } = await supabaseClient.rpc('resend_org_invitation', { p_invitation_id: invId });
                    if (error) throw error;
                    if (data?.success) {
                        showToast(tt('invite_resent'), 'success');
                        await teamLoadInvitations();
                    } else {
                        showToast(tt('error_' + (data?.error || 'generic')) || tt('error_generic'), 'error');
                    }
                } catch (e) {
                    console.error('Resend invite failed:', e);
                    showToast(tt('error_generic'), 'error');
                } finally {
                    if (btn) { btn.disabled = false; btn.textContent = tt('btn_resend'); }
                }
            };

            window.teamRevokeInvite = async function (invId, btn) {
                if (!confirm(tt('confirm_revoke'))) return;
                if (btn) { btn.disabled = true; btn.textContent = tt('btn_revoking'); }
                try {
                    const { data, error } = await supabaseClient.rpc('revoke_org_invitation', { p_invitation_id: invId });
                    if (error) throw error;
                    if (data?.success) {
                        showToast(tt('invite_revoked'), 'success');
                        await teamLoadInvitations();
                    } else {
                        showToast(tt('error_' + (data?.error || 'generic')) || tt('error_generic'), 'error');
                    }
                } catch (e) {
                    console.error('Revoke invite failed:', e);
                    showToast(tt('error_generic'), 'error');
                } finally {
                    if (btn) { btn.disabled = false; btn.textContent = tt('btn_revoke'); }
                }
            };

            // --- Member Profile Modal ---
            // Store member permissions data for the open profile modal
            let profileMemberPermsData = null;
            let profileEditMode = false;

            window.teamShowProfile = async function (userId) {
                const member = teamMembers.find(m => m.user_id === userId);
                if (!member) return;

                document.getElementById('team-profile-modal')?.remove();
                profileEditMode = false;
                profileMemberPermsData = null;

                const effRole = member.effective_role || getEffectiveRoleFromRaw(member.raw_role);
                const roleLabel = tt('role_' + effRole);
                const initials = (member.full_name || member.email || '?').slice(0, 2).toUpperCase();
                const avatarHtml = member.avatar_url
                    ? `<img src="${esc(member.avatar_url)}" alt="" loading="lazy">`
                    : esc(initials);
                const joinDate = member.created_at ? new Date(member.created_at).toLocaleDateString(currentLang === 'ar' ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

                const isOwner = myEffectiveRole === 'owner';
                const isMemberOwner = effRole === 'owner';

                // Build basic permissions summary
                const memberPerms = teamPermissionsCache[effRole] || {};
                let permSummaryHtml = '';
                if (isMemberOwner) {
                    permSummaryHtml = `<div class="profile-perm-note">${esc(tt('role_owner_desc'))}</div>`;
                } else {
                    for (const group of PERM_GROUPS) {
                        const grantedPerms = group.perms.filter(p => memberPerms[p.key] === true);
                        if (grantedPerms.length > 0) {
                            permSummaryHtml += `<div class="profile-perm-group"><strong>${esc(tt(group.i18n))}</strong>: ${grantedPerms.map(p => esc(tt(p.i18n))).join(', ')}</div>`;
                        }
                    }
                    if (!permSummaryHtml) {
                        permSummaryHtml = `<div class="profile-perm-note">${esc(tt('role_user_desc'))}</div>`;
                    }
                }

                const overlay = document.createElement('div');
                overlay.id = 'team-profile-modal';
                overlay.className = 'team-modal-overlay';
                overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
                overlay.innerHTML = `
                    <div class="team-modal-box">
                        <div class="team-modal-close" onclick="document.getElementById('team-profile-modal').remove()">&times;</div>
                        <div class="team-profile-content">
                            <div class="team-profile-avatar">${avatarHtml}</div>
                            <h3 class="team-profile-name">${esc(member.full_name || (currentLang === 'ar' ? 'بدون اسم' : 'No name'))}</h3>
                            <span class="team-role-badge ${effRole}">${esc(roleLabel)}</span>
                            <div class="team-profile-details">
                                <div class="team-profile-row">
                                    <span class="team-profile-label">${esc(tt('profile_email'))}</span>
                                    <span>${esc(member.email || '')}</span>
                                </div>
                                <div class="team-profile-row">
                                    <span class="team-profile-label">${esc(tt('profile_phone'))}</span>
                                    <span>${esc(member.phone || tt('profile_no_phone'))}</span>
                                </div>
                                ${joinDate ? `<div class="team-profile-row">
                                    <span class="team-profile-label">${esc(tt('profile_joined'))}</span>
                                    <span>${esc(joinDate)}</span>
                                </div>` : ''}
                            </div>
                            <div class="team-profile-perms">
                                <h4>${esc(tt('profile_permissions_title'))}</h4>
                                ${permSummaryHtml}
                            </div>
                            ${isOwner && !isMemberOwner ? `<div class="member-perms-section" id="member-perms-section">
                                <div class="member-perms-header">
                                    <h4>${esc(tt('section_custom_permissions'))}</h4>
                                    <button class="btn-secondary btn-sm" id="member-perms-edit-btn" onclick="memberPermsToggleEdit('${userId}')">${esc(tt('btn_edit_permissions'))}</button>
                                </div>
                                <div id="member-perms-body"><div class="team-empty"><p>${currentLang === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p></div></div>
                            </div>` : ''}
                        </div>
                        <button class="btn-primary team-modal-close-btn" onclick="document.getElementById('team-profile-modal').remove()">${esc(tt('btn_close'))}</button>
                    </div>
                `;
                document.body.appendChild(overlay);

                // Load member permissions for owner
                if (isOwner && !isMemberOwner) {
                    if (!teamCustomRolesLoaded) await teamLoadCustomRoles();
                    await memberPermsLoad(userId);
                }
            };

            async function memberPermsLoad(userId) {
                try {
                    const { data, error } = await supabaseClient.rpc('get_member_permissions', {
                        p_org_id: currentUserOrgId,
                        p_member_user_id: userId
                    });
                    if (error) throw error;
                    if (data?.success) {
                        profileMemberPermsData = data;
                        memberPermsRender(userId);
                    }
                } catch (e) {
                    console.error('Failed to load member permissions:', e);
                    const body = document.getElementById('member-perms-body');
                    if (body) body.innerHTML = `<div class="team-empty"><p>${esc(tt('error_generic'))}</p></div>`;
                }
            }

            function memberPermsRender(userId) {
                const body = document.getElementById('member-perms-body');
                if (!body || !profileMemberPermsData) return;

                const d = profileMemberPermsData;
                const basePerms = d.base_permissions || {};
                const effectivePerms = d.effective_permissions || {};
                const overrides = d.permission_overrides || {};
                const overrideCount = Object.keys(overrides).length;
                const modeClass = profileEditMode ? 'member-perms-edit' : 'member-perms-view';

                let html = '';

                // Role / Custom Role selector
                let roleOptions = `<option value="" ${!d.custom_role_id ? 'selected' : ''}>${esc(tt('role_manager'))} / ${esc(tt('role_user'))} (${esc(tt('label_member_role'))})</option>`;
                for (const cr of teamCustomRoles) {
                    roleOptions += `<option value="${cr.id}" ${d.custom_role_id === cr.id ? 'selected' : ''}>${esc(cr.name)}</option>`;
                }

                if (profileEditMode) {
                    html += `
                    <div class="member-role-select">
                        <label>${esc(tt('custom_role_label'))}:</label>
                        <select onchange="memberPermsSetCustomRole('${userId}', this.value || null)">
                            <option value="" ${!d.custom_role_id ? 'selected' : ''}>${esc(tt('no_custom_role'))}</option>
                            ${teamCustomRoles.map(cr => `<option value="${cr.id}" ${d.custom_role_id === cr.id ? 'selected' : ''}>${esc(cr.name)}</option>`).join('')}
                        </select>
                    </div>`;
                } else if (d.custom_role_id && d.custom_role_name) {
                    html += `<div class="member-role-select"><label>${esc(tt('custom_role_label'))}:</label><span style="font-size:0.85rem;color:var(--text-main,#fff)">${esc(d.custom_role_name)}</span></div>`;
                }

                // Overrides banner
                if (overrideCount > 0) {
                    html += `
                    <div class="overrides-banner">
                        <span class="overrides-banner-text">⚠ ${esc(tt('overrides_active').replace('{count}', overrideCount))}</span>
                        ${profileEditMode ? `<button class="btn-secondary" onclick="memberPermsClearAll('${userId}')">${esc(tt('btn_clear_overrides'))}</button>` : ''}
                    </div>`;
                }

                // Permission toggles
                html += `<div class="${modeClass}">`;
                for (const group of PERM_GROUPS) {
                    html += `<div class="team-perm-group"><div class="team-perm-group-title">${esc(tt(group.i18n))}</div>`;
                    for (const p of group.perms) {
                        const effective = effectivePerms[p.key] === true;
                        const base = basePerms[p.key] === true;
                        const hasOverride = overrides.hasOwnProperty(p.key);
                        let chipHtml = '';
                        if (profileEditMode) {
                            if (hasOverride) {
                                chipHtml = effective
                                    ? `<span class="override-chip up">${esc(tt('override_chip_up'))}</span>`
                                    : `<span class="override-chip down">${esc(tt('override_chip_down'))}</span>`;
                            } else {
                                chipHtml = `<span class="override-chip default">${esc(tt('override_chip_default'))}</span>`;
                            }
                        } else if (hasOverride) {
                            chipHtml = effective
                                ? `<span class="override-chip up">${esc(tt('override_chip_up'))}</span>`
                                : `<span class="override-chip down">${esc(tt('override_chip_down'))}</span>`;
                        }

                        html += `
                        <div class="perm-override-row">
                            <div class="perm-override-left">
                                <span class="perm-override-label">${esc(tt(p.i18n))}</span>
                                ${chipHtml}
                            </div>
                            <label class="team-perm-toggle">
                                <input type="checkbox" ${effective ? 'checked' : ''} ${profileEditMode ? `onchange="memberPermsToggle('${userId}', '${p.key}', this.checked, ${base})"` : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>`;
                    }
                    html += '</div>';
                }
                html += '</div>';

                body.innerHTML = html;
            }

            window.memberPermsToggleEdit = function (userId) {
                profileEditMode = !profileEditMode;
                const btn = document.getElementById('member-perms-edit-btn');
                if (btn) btn.textContent = profileEditMode ? tt('btn_done_editing') : tt('btn_edit_permissions');
                memberPermsRender(userId);
            };

            window.memberPermsSetCustomRole = async function (userId, customRoleId) {
                try {
                    const { data, error } = await supabaseClient.rpc('set_member_custom_role', {
                        p_org_id: currentUserOrgId,
                        p_member_user_id: userId,
                        p_custom_role_id: customRoleId || null
                    });
                    if (error) throw error;
                    if (data?.success) {
                        showToast(tt('role_updated'), 'success');
                        await memberPermsLoad(userId);
                    } else {
                        showToast(tt('error_generic'), 'error');
                    }
                } catch (e) {
                    console.error('Set custom role failed:', e);
                    showToast(tt('error_generic'), 'error');
                }
            };

            window.memberPermsToggle = async function (userId, perm, checked, baseValue) {
                // If toggled value matches base, remove override; otherwise set it
                const pValue = (checked === baseValue) ? null : checked;
                try {
                    const { data, error } = await supabaseClient.rpc('set_member_permission_override', {
                        p_org_id: currentUserOrgId,
                        p_member_user_id: userId,
                        p_permission: perm,
                        p_value: pValue
                    });
                    if (error) throw error;
                    if (data?.success) {
                        // Update local data
                        if (pValue === null) {
                            delete profileMemberPermsData.permission_overrides[perm];
                        } else {
                            profileMemberPermsData.permission_overrides[perm] = pValue;
                        }
                        profileMemberPermsData.effective_permissions[perm] = checked;
                        memberPermsRender(userId);
                    }
                } catch (e) {
                    console.error('Toggle override failed:', e);
                    showToast(tt('error_generic'), 'error');
                }
            };

            window.memberPermsClearAll = async function (userId) {
                if (!confirm(tt('clear_overrides_confirm'))) return;
                try {
                    const { data, error } = await supabaseClient.rpc('clear_member_permission_overrides', {
                        p_org_id: currentUserOrgId,
                        p_member_user_id: userId
                    });
                    if (error) throw error;
                    if (data?.success) {
                        showToast(tt('overrides_cleared'), 'success');
                        await memberPermsLoad(userId);
                    } else {
                        showToast(tt('error_generic'), 'error');
                    }
                } catch (e) {
                    console.error('Clear overrides failed:', e);
                    showToast(tt('error_generic'), 'error');
                }
            };

            // --- Change Role ---
            window.teamChangeRole = async function (userId, newRole) {
                try {
                    const { data, error } = await supabaseClient.rpc('update_member_role', {
                        p_org_id: currentUserOrgId,
                        p_target_user_id: userId,
                        p_new_role: newRole
                    });
                    if (error) throw error;

                    if (data?.success) {
                        showToast(tt('role_updated'), 'success');
                        await teamLoadMembers();
                    } else {
                        const errKey = data?.error || 'error_generic';
                        const errMsg = tt('error_' + errKey.replace('only_owner_can_change_roles', 'only_owner').replace('cannot_change_own_role', 'cannot_change_own_role').replace('cannot_change_owner_role', 'cannot_change_owner')) || tt('error_generic');
                        showToast(errMsg, 'error');
                        await teamLoadMembers(); // revert select
                    }
                } catch (e) {
                    console.error('Change role failed:', e);
                    showToast(tt('error_generic'), 'error');
                    await teamLoadMembers();
                }
            };

            // --- Remove Member ---
            window.teamRemoveMember = async function (userId, btn) {
                if (!confirm(tt('confirm_remove'))) return;

                if (btn) { btn.disabled = true; btn.textContent = tt('btn_removing'); }

                try {
                    const { data, error } = await supabaseClient.rpc('remove_org_member', {
                        p_org_id: currentUserOrgId,
                        p_target_user_id: userId
                    });
                    if (error) throw error;

                    if (data?.success) {
                        showToast(tt('member_removed'), 'success');
                        await teamLoadMembers();
                    } else {
                        const errKey = data?.error || 'error_generic';
                        const errMsg = tt('error_' + errKey.replace('only_owner_can_remove', 'only_owner').replace('cannot_remove_self', 'cannot_remove_self').replace('cannot_remove_owner', 'cannot_remove_owner')) || tt('error_generic');
                        showToast(errMsg, 'error');
                    }
                } catch (e) {
                    console.error('Remove member failed:', e);
                    showToast(tt('error_generic'), 'error');
                } finally {
                    if (btn) { btn.disabled = false; btn.textContent = tt('btn_remove'); }
                }
            };

            // --- Permissions Panel ---
            async function teamLoadPermissionsPanel() {
                const container = document.getElementById('team-permissions-container');
                if (!container || !currentUserOrgId) return;

                if (myEffectiveRole !== 'owner') {
                    container.innerHTML = `<div class="team-perm-owner-note">${esc(tt('error_only_owner'))}</div>`;
                    return;
                }

                // Load permissions for active role
                try {
                    const { data, error } = await supabaseClient.rpc('get_role_permissions', {
                        p_org_id: currentUserOrgId,
                        p_role: teamActivePermRole
                    });
                    if (error) throw error;
                    teamPermissionsCache[teamActivePermRole] = data?.permissions || {};
                } catch (e) {
                    console.error('Failed to load permissions:', e);
                }

                renderPermissionsPanel(container);
            }

            function renderPermissionsPanel(container) {
                const perms = teamPermissionsCache[teamActivePermRole] || {};
                const isOwnerRole = teamActivePermRole === 'owner';
                const isCustomRolesView = teamActivePermRole === 'custom';

                let html = `
                    <div class="team-perm-role-tabs">
                        <button class="team-perm-role-btn ${teamActivePermRole === 'manager' ? 'active' : ''}" onclick="teamSwitchPermRole('manager', this)">${esc(tt('role_manager'))}</button>
                        <button class="team-perm-role-btn ${teamActivePermRole === 'user' ? 'active' : ''}" onclick="teamSwitchPermRole('user', this)">${esc(tt('role_user'))}</button>
                        <button class="team-perm-role-btn ${teamActivePermRole === 'owner' ? 'active' : ''}" onclick="teamSwitchPermRole('owner', this)">${esc(tt('role_owner'))}</button>
                        <button class="team-perm-role-btn ${teamActivePermRole === 'custom' ? 'active' : ''}" onclick="teamSwitchPermRole('custom', this)">${esc(tt('tab_custom_roles'))}</button>
                    </div>
                `;

                if (isCustomRolesView) {
                    html += renderCustomRolesPanel();
                } else if (isOwnerRole) {
                    html += `<div class="team-perm-owner-note">${esc(tt('role_owner_desc'))}</div>`;
                } else {
                    for (const group of PERM_GROUPS) {
                        html += `<div class="team-perm-group">`;
                        html += `<div class="team-perm-group-title">${esc(tt(group.i18n))}</div>`;
                        for (const p of group.perms) {
                            const checked = perms[p.key] === true;
                            html += `
                                <div class="team-perm-row">
                                    <span class="team-perm-label">${esc(tt(p.i18n))}</span>
                                    <label class="team-perm-toggle">
                                        <input type="checkbox" ${checked ? 'checked' : ''} onchange="teamTogglePerm('${teamActivePermRole}', '${p.key}', this.checked)">
                                        <span class="slider"></span>
                                    </label>
                                </div>
                            `;
                        }
                        html += `</div>`;
                    }
                }

                container.innerHTML = html;
            }

            window.teamSwitchPermRole = async function (role, el) {
                teamActivePermRole = role;
                document.querySelectorAll('.team-perm-role-btn').forEach(b => b.classList.remove('active'));
                if (el) el.classList.add('active');
                if (role === 'custom') {
                    await teamLoadCustomRoles();
                }
                await teamLoadPermissionsPanel();
            };

            // ---- Custom Roles ----
            async function teamLoadCustomRoles() {
                try {
                    const { data, error } = await supabaseClient.rpc('list_org_custom_roles', { p_org_id: currentUserOrgId });
                    if (error) throw error;
                    if (data?.success) {
                        teamCustomRoles = data.roles || [];
                        teamCustomRolesLoaded = true;
                    }
                } catch (e) {
                    console.error('Failed to load custom roles:', e);
                }
            }

            function renderCustomRolesPanel() {
                let html = `
                    <div class="custom-roles-header">
                        <h3>${esc(tt('custom_roles_title'))}</h3>
                        <button class="btn-new-role" onclick="teamOpenCustomRoleEditor()">${esc(tt('btn_new_custom_role'))}</button>
                    </div>
                `;

                if (!teamCustomRoles.length) {
                    html += `<div class="team-empty"><p>${esc(tt('custom_roles_empty'))}</p></div>`;
                } else {
                    html += '<div class="custom-roles-list">';
                    for (const cr of teamCustomRoles) {
                        const memberText = cr.member_count > 0
                            ? tt('custom_role_members_using').replace('{count}', cr.member_count)
                            : tt('custom_role_no_members');
                        html += `
                        <div class="custom-role-card">
                            <div class="custom-role-card-top">
                                <div class="custom-role-info">
                                    <div class="custom-role-name">${esc(cr.name)}</div>
                                    ${cr.description ? `<div class="custom-role-desc">"${esc(cr.description)}"</div>` : ''}
                                    <div class="custom-role-meta">${esc(memberText)}</div>
                                </div>
                                <div class="custom-role-actions">
                                    <button class="btn-secondary" onclick="teamOpenCustomRoleEditor('${cr.id}')">${esc(tt('btn_edit_role'))}</button>
                                    <button class="btn-secondary" onclick="teamDuplicateCustomRole('${cr.id}')">${esc(tt('btn_duplicate_role'))}</button>
                                    <button class="team-remove-btn" onclick="teamDeleteCustomRole('${cr.id}', ${cr.member_count})">${esc(tt('btn_delete_role'))}</button>
                                </div>
                            </div>
                        </div>`;
                    }
                    html += '</div>';
                }

                return html;
            }

            window.teamOpenCustomRoleEditor = function (roleId) {
                const existing = roleId ? teamCustomRoles.find(r => r.id === roleId) : null;
                const isEdit = !!existing;
                const title = isEdit ? tt('modal_edit_role_title') : tt('modal_new_role_title');

                document.getElementById('cr-editor-modal')?.remove();

                const overlay = document.createElement('div');
                overlay.id = 'cr-editor-modal';
                overlay.className = 'cr-editor-overlay';
                overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

                // Build permission toggles HTML
                let permsHtml = '';
                const editPerms = existing ? (existing.permissions || {}) : {};
                for (const group of PERM_GROUPS) {
                    permsHtml += `<div class="team-perm-group"><div class="team-perm-group-title">${esc(tt(group.i18n))}</div>`;
                    for (const p of group.perms) {
                        const checked = editPerms[p.key] === true;
                        permsHtml += `
                            <div class="team-perm-row">
                                <span class="team-perm-label">${esc(tt(p.i18n))}</span>
                                <label class="team-perm-toggle">
                                    <input type="checkbox" data-perm="${p.key}" ${checked ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                            </div>`;
                    }
                    permsHtml += '</div>';
                }

                // Build "start from" existing custom roles options
                let existingRoleOptions = '';
                for (const cr of teamCustomRoles) {
                    if (cr.id !== roleId) {
                        existingRoleOptions += `<option value="${cr.id}">${esc(cr.name)}</option>`;
                    }
                }

                overlay.innerHTML = `
                <div class="cr-editor-box">
                    <div class="team-modal-close" onclick="document.getElementById('cr-editor-modal').remove()">&times;</div>
                    <div class="cr-editor-title">${esc(title)}</div>
                    <div class="cr-editor-fields">
                        <div class="form-group">
                            <label class="form-label">${esc(tt('label_role_name'))} *</label>
                            <input type="text" id="cr-editor-name" class="form-input" value="${esc(existing?.name || '')}" placeholder="${esc(tt('label_role_name'))}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">${esc(tt('label_role_description'))}</label>
                            <input type="text" id="cr-editor-desc" class="form-input" value="${esc(existing?.description || '')}" placeholder="${esc(tt('label_role_description'))}">
                        </div>
                    </div>
                    ${!isEdit ? `
                    <div class="cr-start-from">
                        <div class="cr-start-from-label">${esc(tt('label_start_from'))}</div>
                        <div class="cr-start-from-strip">
                            <button class="cr-start-btn" onclick="crPrefillFrom('blank', this)">${esc(tt('start_from_blank'))}</button>
                            <button class="cr-start-btn" onclick="crPrefillFrom('manager', this)">${esc(tt('start_from_manager'))}</button>
                            <button class="cr-start-btn" onclick="crPrefillFrom('user', this)">${esc(tt('start_from_user'))}</button>
                            ${existingRoleOptions ? `<select class="form-input" style="flex:1;min-width:120px;font-size:0.76rem;padding:6px 10px" onchange="if(this.value)crPrefillFrom(this.value,this)">
                                <option value="">${esc(tt('start_from_existing'))}</option>
                                ${existingRoleOptions}
                            </select>` : ''}
                        </div>
                        <div class="cr-start-tip" id="cr-start-tip">${esc(tt('start_from_tip'))}</div>
                    </div>` : ''}
                    <div class="cr-editor-perms" id="cr-editor-perms">
                        ${permsHtml}
                    </div>
                    <div class="cr-editor-footer">
                        <button class="btn-secondary" onclick="document.getElementById('cr-editor-modal').remove()">${esc(tt('btn_close'))}</button>
                        <button class="btn-primary" id="cr-editor-save" onclick="crSaveRole('${roleId || ''}')">${esc(tt('btn_save_role'))}</button>
                    </div>
                </div>`;

                document.body.appendChild(overlay);
            };

            window.crPrefillFrom = async function (source, el) {
                let perms = {};
                if (source === 'blank') {
                    perms = {};
                } else if (source === 'manager' || source === 'user') {
                    // Fetch from cache or RPC
                    if (teamPermissionsCache[source]) {
                        perms = teamPermissionsCache[source];
                    } else {
                        try {
                            const { data, error } = await supabaseClient.rpc('get_role_permissions', { p_org_id: currentUserOrgId, p_role: source });
                            if (!error && data?.permissions) {
                                perms = data.permissions;
                                teamPermissionsCache[source] = perms;
                            }
                        } catch (_) {}
                    }
                } else {
                    // UUID = existing custom role
                    const cr = teamCustomRoles.find(r => r.id === source);
                    if (cr) perms = cr.permissions || {};
                }

                // Apply to toggles
                const container = document.getElementById('cr-editor-perms');
                if (container) {
                    container.querySelectorAll('input[data-perm]').forEach(inp => {
                        inp.checked = perms[inp.dataset.perm] === true;
                    });
                }

                // Show tip
                const tip = document.getElementById('cr-start-tip');
                if (tip) tip.classList.add('visible');

                // Highlight button
                document.querySelectorAll('.cr-start-btn').forEach(b => b.classList.remove('active'));
                if (el && el.classList.contains('cr-start-btn')) el.classList.add('active');
            };

            window.crSaveRole = async function (roleId) {
                const nameInput = document.getElementById('cr-editor-name');
                const descInput = document.getElementById('cr-editor-desc');
                const btn = document.getElementById('cr-editor-save');
                if (!nameInput) return;

                const name = nameInput.value.trim();
                if (!name) { showToast(tt('custom_role_name_required'), 'error'); nameInput.focus(); return; }

                // Check client-side uniqueness
                const duplicate = teamCustomRoles.find(r => r.name.toLowerCase() === name.toLowerCase() && r.id !== roleId);
                if (duplicate) { showToast(tt('custom_role_name_taken'), 'error'); nameInput.focus(); return; }

                // Collect permissions from toggles
                const perms = {};
                document.querySelectorAll('#cr-editor-perms input[data-perm]').forEach(inp => {
                    perms[inp.dataset.perm] = inp.checked;
                });

                if (btn) { btn.disabled = true; btn.textContent = tt('btn_saving_role'); }

                try {
                    const params = {
                        p_org_id: currentUserOrgId,
                        p_name: name,
                        p_description: descInput?.value.trim() || null,
                        p_permissions: perms
                    };
                    if (roleId) params.p_id = roleId;

                    const { data, error } = await supabaseClient.rpc('upsert_org_custom_role', params);
                    if (error) throw error;

                    if (data?.success) {
                        showToast(tt('custom_role_saved'), 'success');
                        document.getElementById('cr-editor-modal')?.remove();
                        await teamLoadCustomRoles();
                        await teamLoadPermissionsPanel();
                    } else {
                        const errKey = data?.error || 'error_generic';
                        if (errKey === 'name_taken') showToast(tt('custom_role_name_taken'), 'error');
                        else if (errKey === 'name_required') showToast(tt('custom_role_name_required'), 'error');
                        else showToast(tt('error_generic'), 'error');
                    }
                } catch (e) {
                    console.error('Save custom role failed:', e);
                    showToast(tt('error_generic'), 'error');
                } finally {
                    if (btn) { btn.disabled = false; btn.textContent = tt('btn_save_role'); }
                }
            };

            window.teamDuplicateCustomRole = async function (roleId) {
                const cr = teamCustomRoles.find(r => r.id === roleId);
                if (!cr) return;

                const newName = tt('custom_role_duplicate_name').replace('{name}', cr.name);
                try {
                    const { data, error } = await supabaseClient.rpc('upsert_org_custom_role', {
                        p_org_id: currentUserOrgId,
                        p_name: newName,
                        p_description: cr.description,
                        p_permissions: cr.permissions
                    });
                    if (error) throw error;
                    if (data?.success) {
                        showToast(tt('custom_role_saved'), 'success');
                        await teamLoadCustomRoles();
                        await teamLoadPermissionsPanel();
                    } else {
                        showToast(tt('error_' + (data?.error || 'generic')) || tt('error_generic'), 'error');
                    }
                } catch (e) {
                    console.error('Duplicate custom role failed:', e);
                    showToast(tt('error_generic'), 'error');
                }
            };

            window.teamDeleteCustomRole = async function (roleId, memberCount) {
                let msg = tt('custom_role_delete_confirm');
                if (memberCount > 0) {
                    msg = tt('custom_role_delete_warn').replace('{count}', memberCount);
                }
                if (!confirm(msg)) return;

                try {
                    const { data, error } = await supabaseClient.rpc('delete_org_custom_role', {
                        p_org_id: currentUserOrgId,
                        p_role_id: roleId
                    });
                    if (error) throw error;
                    if (data?.success) {
                        showToast(tt('custom_role_deleted'), 'success');
                        await teamLoadCustomRoles();
                        await teamLoadPermissionsPanel();
                    } else {
                        showToast(tt('error_generic'), 'error');
                    }
                } catch (e) {
                    console.error('Delete custom role failed:', e);
                    showToast(tt('error_generic'), 'error');
                }
            };

            window.teamTogglePerm = async function (role, perm, granted) {
                try {
                    const { data, error } = await supabaseClient.rpc('set_role_permission', {
                        p_org_id: currentUserOrgId,
                        p_role: role,
                        p_permission: perm,
                        p_granted: granted
                    });
                    if (error) throw error;

                    if (data?.success) {
                        if (teamPermissionsCache[role]) {
                            teamPermissionsCache[role][perm] = granted;
                        }
                        showToast(tt('permissions_saved'), 'success');
                    } else {
                        showToast(tt('permissions_save_failed'), 'error');
                        await teamLoadPermissionsPanel();
                    }
                } catch (e) {
                    console.error('Toggle perm failed:', e);
                    showToast(tt('permissions_save_failed'), 'error');
                    await teamLoadPermissionsPanel();
                }
            };

            // --- Accept Invite Page ---
            window.initAcceptInvitePage = async function (token) {
                const root = document.getElementById('accept-invite-root');
                if (!root) return;

                root.innerHTML = `<div class="accept-invite-loading"><p>${t('team.accept_loading')}</p></div>`;

                // Fetch invitation details
                let invite = null;
                try {
                    const { data, error } = await supabaseClient.rpc('get_invitation_by_token', { p_token: token });
                    if (error) throw error;
                    if (data?.success) {
                        invite = data;
                    } else {
                        root.innerHTML = `<div class="accept-invite-card"><div class="accept-invite-error"><svg viewBox="0 0 24 24" width="48" height="48"><path fill="var(--danger)" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg><h3>${esc(tt('accept_error_not_found'))}</h3></div></div>`;
                        return;
                    }
                } catch (e) {
                    console.error('Failed to load invitation:', e);
                    root.innerHTML = `<div class="accept-invite-card"><div class="accept-invite-error"><h3>${esc(tt('error_generic'))}</h3></div></div>`;
                    return;
                }

                // Check status
                if (invite.status === 'accepted') {
                    root.innerHTML = `<div class="accept-invite-card"><div class="accept-invite-error"><svg viewBox="0 0 24 24" width="48" height="48"><path fill="var(--warning)" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-6h2v6z"/></svg><h3>${esc(tt('accept_error_used'))}</h3></div></div>`;
                    return;
                }
                if (invite.status === 'revoked') {
                    root.innerHTML = `<div class="accept-invite-card"><div class="accept-invite-error"><svg viewBox="0 0 24 24" width="48" height="48"><path fill="var(--danger)" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg><h3>${esc(tt('accept_error_revoked'))}</h3></div></div>`;
                    return;
                }
                if (invite.expired) {
                    root.innerHTML = `<div class="accept-invite-card"><div class="accept-invite-error"><svg viewBox="0 0 24 24" width="48" height="48"><path fill="var(--warning)" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg><h3>${esc(tt('accept_error_expired'))}</h3></div></div>`;
                    return;
                }

                // Check if user is logged in
                const { data: { session } } = await supabaseClient.auth.getSession();
                const roleLabel = invite.role === 'admin' ? tt('role_manager') : invite.role === 'member' ? tt('role_user') : tt('role_' + invite.role);

                if (!session) {
                    // Not logged in - show sign-in + sign-up paths
                    root.innerHTML = `
                    <div class="accept-invite-card">
                        <div class="accept-invite-icon">
                            <svg viewBox="0 0 24 24" width="64" height="64"><path fill="var(--theme-color)" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                        </div>
                        <h2>${esc(tt('accept_title'))}</h2>
                        <p class="accept-invite-subtitle">${esc(tt('accept_subtitle'))} <strong>${esc(invite.org_name || '')}</strong></p>
                        ${invite.invited_by_name ? `<p class="accept-invite-by">${esc(tt('accept_invited_by'))}: ${esc(invite.invited_by_name)}</p>` : ''}
                        <p class="accept-invite-role">${esc(tt('accept_role'))}: <span class="team-role-badge ${invite.role === 'admin' ? 'manager' : invite.role === 'member' ? 'user' : invite.role}">${esc(roleLabel)}</span></p>
                        <div class="accept-invite-email-note">
                            <p>${esc(tt('accept_email_note'))}: <strong>${esc(invite.email)}</strong></p>
                        </div>

                        <div class="accept-invite-paths">
                            <!-- Path A: Existing user sign-in -->
                            <div class="accept-invite-path">
                                <h3 style="margin:0 0 8px; font-size:0.95rem; color:var(--text-main);">${esc(tt('accept_signin_title'))}</h3>
                                <button class="btn-primary accept-invite-btn" onclick="acceptInviteSignIn('${esc(token)}')">${esc(tt('accept_signin_btn'))}</button>
                            </div>

                            <div class="accept-invite-or"><span>${esc(tt('accept_or_divider'))}</span></div>

                            <!-- Path B: New user sign-up -->
                            <div class="accept-invite-path">
                                <h3 style="margin:0 0 12px; font-size:0.95rem; color:var(--text-main);">${esc(tt('accept_signup_title'))}</h3>
                                <form id="accept-invite-signup-form" onsubmit="acceptInviteSignUp(event, '${esc(token)}', '${esc(invite.email)}')">
                                    <input type="text" class="form-input" id="accept-signup-name" placeholder="${esc(tt('accept_fullname'))}" value="${esc(invite.invited_name || '')}" style="margin-bottom:10px;">
                                    <input type="password" class="form-input" id="accept-signup-pass" placeholder="${esc(tt('accept_password'))}" autocomplete="new-password" style="margin-bottom:10px;">
                                    <input type="password" class="form-input" id="accept-signup-pass2" placeholder="${esc(tt('accept_confirm_password'))}" autocomplete="new-password" style="margin-bottom:12px;">
                                    <div id="accept-signup-error" style="color:#ef4444; font-size:0.82rem; margin-bottom:8px; display:none;"></div>
                                    <button type="submit" class="btn-primary accept-invite-btn" id="accept-signup-btn">${esc(tt('accept_signup_btn'))}</button>
                                </form>
                            </div>
                        </div>
                    </div>`;
                    return;
                }

                // User is logged in - check email match
                const userEmail = session.user?.email?.toLowerCase() || '';
                const inviteEmail = (invite.email || '').toLowerCase();
                const emailMatch = userEmail === inviteEmail;

                root.innerHTML = `
                <div class="accept-invite-card">
                    <div class="accept-invite-icon">
                        <svg viewBox="0 0 24 24" width="64" height="64"><path fill="var(--theme-color)" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                    </div>
                    <h2>${esc(tt('accept_title'))}</h2>
                    <p class="accept-invite-subtitle">${esc(tt('accept_subtitle'))} <strong>${esc(invite.org_name || '')}</strong></p>
                    ${invite.invited_by_name ? `<p class="accept-invite-by">${esc(tt('accept_invited_by'))}: ${esc(invite.invited_by_name)}</p>` : ''}
                    <p class="accept-invite-role">${esc(tt('accept_role'))}: <span class="team-role-badge ${invite.role === 'admin' ? 'manager' : invite.role === 'member' ? 'user' : invite.role}">${esc(roleLabel)}</span></p>
                    <div class="accept-invite-email-note">
                        <p>${esc(tt('accept_email_note'))}: <strong>${esc(invite.email)}</strong></p>
                    </div>
                    ${!emailMatch ? `<div class="accept-invite-mismatch"><p>${esc(tt('accept_error_email_mismatch'))}</p></div>` : ''}
                    ${emailMatch ? `<button class="btn-primary accept-invite-btn" id="accept-invite-btn" onclick="acceptInvitation('${token}')">${esc(tt('accept_btn'))}</button>` : ''}
                    <div id="accept-invite-status"></div>
                </div>`;
            };

            window.acceptInvitation = async function (token) {
                const btn = document.getElementById('accept-invite-btn');
                const statusDiv = document.getElementById('accept-invite-status');
                if (btn) { btn.disabled = true; btn.textContent = tt('accept_btn_accepting'); }

                try {
                    const { data, error } = await supabaseClient.rpc('accept_org_invitation', { p_token: token });
                    if (error) throw error;

                    if (data?.success) {
                        const root = document.getElementById('accept-invite-root');
                        if (root) {
                            root.innerHTML = `
                            <div class="accept-invite-card accept-invite-success">
                                <div class="accept-invite-icon">
                                    <svg viewBox="0 0 24 24" width="64" height="64"><path fill="var(--success)" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                                </div>
                                <h2>${esc(tt('accept_success_title'))}</h2>
                                <p>${esc(tt('accept_success_msg'))} <strong>${esc(data.org_name || '')}</strong></p>
                                <button class="btn-primary" onclick="location.hash='';location.reload()">${esc(tt('accept_go_dashboard'))}</button>
                            </div>`;
                        }
                    } else {
                        const errKey = data?.error || 'generic';
                        const errMsg = tt('accept_error_' + errKey) || tt('error_' + errKey) || tt('error_generic');
                        if (statusDiv) statusDiv.innerHTML = `<p class="accept-invite-error-msg">${esc(errMsg)}</p>`;
                        if (btn) { btn.disabled = false; btn.textContent = tt('accept_btn'); }
                    }
                } catch (e) {
                    console.error('Accept invitation failed:', e);
                    if (statusDiv) statusDiv.innerHTML = `<p class="accept-invite-error-msg">${esc(tt('error_generic'))}</p>`;
                    if (btn) { btn.disabled = false; btn.textContent = tt('accept_btn'); }
                }
            };

            // --- Accept invite: Sign In path ---
            window.acceptInviteSignIn = function(token) {
                sessionStorage.setItem('pending_invite_token', token);
                location.hash = '';
                location.reload();
            };

            // --- Accept invite: Sign Up path ---
            window.acceptInviteSignUp = async function(e, token, email) {
                e.preventDefault();
                const nameInput = document.getElementById('accept-signup-name');
                const passInput = document.getElementById('accept-signup-pass');
                const pass2Input = document.getElementById('accept-signup-pass2');
                const errDiv = document.getElementById('accept-signup-error');
                const btn = document.getElementById('accept-signup-btn');
                const tt = window._teamTT || ((k) => t('team.' + k));

                const fullName = nameInput?.value.trim() || '';
                const pass = passInput?.value || '';
                const pass2 = pass2Input?.value || '';

                errDiv.style.display = 'none';
                const showErr = (msg) => { errDiv.textContent = msg; errDiv.style.display = 'block'; };

                if (pass !== pass2) { showErr(tt('accept_pass_mismatch')); return; }
                if (pass.length < 8) { showErr(tt('accept_pass_short')); return; }

                btn.disabled = true;
                btn.textContent = tt('accept_creating');

                try {
                    const { data: signUpData, error: signUpErr } = await supabaseClient.auth.signUp({
                        email: email,
                        password: pass,
                        options: { data: { full_name: fullName } }
                    });
                    if (signUpErr) {
                        if (signUpErr.message && signUpErr.message.toLowerCase().includes('already registered')) {
                            showErr(tt('accept_email_registered'));
                        } else {
                            showErr(signUpErr.message || tt('error_generic'));
                        }
                        btn.disabled = false;
                        btn.textContent = tt('accept_signup_btn');
                        return;
                    }

                    // Accept the invitation
                    const { data: acceptData, error: acceptErr } = await supabaseClient.rpc('accept_org_invitation', { p_token: token });
                    if (acceptErr) throw acceptErr;

                    if (acceptData?.success) {
                        showToast(tt('accept_success_title'), 'success');
                        sessionStorage.removeItem('pending_invite_token');
                        location.hash = '';
                        location.reload();
                    } else {
                        const errKey = acceptData?.error || 'generic';
                        showErr(tt('accept_error_' + errKey) || tt('error_generic'));
                        btn.disabled = false;
                        btn.textContent = tt('accept_signup_btn');
                    }
                } catch (err) {
                    console.error('Sign up + accept failed:', err);
                    showErr(tt('error_generic'));
                    btn.disabled = false;
                    btn.textContent = tt('accept_signup_btn');
                }
            };

            // --- Hook into app init ---
            const origFetchUserRole = window.fetchUserRole || (async function () {});
            window.fetchUserRole = async function () {
                await origFetchUserRole();
                await fetchMyPermissions();
            };

            // If role already loaded, fetch permissions now
            if (currentUserOrgId && window.currentUserRole) {
                fetchMyPermissions();
            }
        })();

    })();
