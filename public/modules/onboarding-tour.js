(function() {
    // ==========================================
    //        PRODUCT ONBOARDING TOUR
    // ==========================================
    const TOUR_STEPS = [
        { target: '[data-tab="dashboard"]', title: 'Dashboard', desc: 'Your command center. See KPIs, agent performance, leads, and tasks at a glance.', position: 'right' },
        { target: '[data-tab="website"]', title: 'AI Agents', desc: 'Configure AI agents for each channel — set system prompts, tones, and knowledge base links.', position: 'right' },
        { target: '[data-tab="inbox"]', title: 'AI Inbox', desc: 'Monitor all conversations in real-time. Toggle between AI and Human mode to take over any chat.', position: 'right' },
        { target: '[data-tab="crm"]', title: 'CRM', desc: 'Your sales pipeline. Leads are auto-captured from conversations. Track them through table, kanban, or dashboard views.', position: 'right' },
        { target: '[data-tab="task-manager"]', title: 'Task Manager', desc: 'Assign tasks to your team, set priorities and due dates, and track completion.', position: 'right' },
        { target: '[data-tab="orders"]', title: 'Orders', desc: 'Track customer orders, payments, and delivery. Send WhatsApp confirmations automatically.', position: 'right' },
        { target: '[data-tab="create-post"]', title: 'Content Studio', desc: 'Create posts with AI-generated images and captions. Schedule to Facebook and Instagram.', position: 'right' },
    ];

    let currentTourStep = 0;
    let prevHighlighted = null;

    window.startTour = function() {
        if (localStorage.getItem('tour_completed')) return;
        currentTourStep = 0;
        document.getElementById('tour-overlay').classList.add('active');
        showTourStep(0);
    };

    window.nextTourStep = function() {
        currentTourStep++;
        if (currentTourStep >= TOUR_STEPS.length) {
            endTour();
            return;
        }
        showTourStep(currentTourStep);
    };

    window.endTour = function() {
        localStorage.setItem('tour_completed', '1');
        document.getElementById('tour-overlay').classList.remove('active');
        document.getElementById('tour-tooltip').style.display = 'none';
        if (prevHighlighted) {
            prevHighlighted.classList.remove('tour-highlight');
            prevHighlighted = null;
        }
    };

    function showTourStep(idx) {
        const step = TOUR_STEPS[idx];
        const el = document.querySelector(step.target);

        // Remove previous highlight
        if (prevHighlighted) prevHighlighted.classList.remove('tour-highlight');

        if (!el) { nextTourStep(); return; }

        // Highlight element
        el.classList.add('tour-highlight');
        prevHighlighted = el;

        // Update tooltip content
        document.getElementById('tour-step-indicator').textContent = `Step ${idx + 1} of ${TOUR_STEPS.length}`;
        document.getElementById('tour-title').textContent = step.title;
        document.getElementById('tour-desc').textContent = step.desc;
        document.getElementById('tour-next-btn').textContent = idx === TOUR_STEPS.length - 1 ? 'Finish' : 'Next';

        // Position tooltip near element
        const tooltip = document.getElementById('tour-tooltip');
        tooltip.style.display = 'block';
        const rect = el.getBoundingClientRect();
        tooltip.style.top = Math.max(10, rect.top) + 'px';
        tooltip.style.left = (rect.right + 16) + 'px';

        // If tooltip goes offscreen, place below
        if (rect.right + 360 > window.innerWidth) {
            tooltip.style.left = Math.max(10, rect.left) + 'px';
            tooltip.style.top = (rect.bottom + 12) + 'px';
        }
    }

    // Auto-start tour for new users (first time after login)
    const origShowApp = window.showApp;
    if (origShowApp) {
        // Hook into showApp to trigger tour after app loads
        const checkTourAfterLoad = function() {
            setTimeout(function() {
                if (!localStorage.getItem('tour_completed') && !localStorage.getItem('tour_dismissed')) {
                    startTour();
                }
            }, 2000);
        };
        // Listen for app becoming visible
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
                if (m.target.id === 'app-container' && m.target.style.display === 'flex') {
                    checkTourAfterLoad();
                    observer.disconnect();
                }
            });
        });
        const appEl = document.getElementById('app-container');
        if (appEl) observer.observe(appEl, { attributes: true, attributeFilter: ['style'] });
    }

    // ==========================================
    //        COMMAND PALETTE (Ctrl+K)
    // ==========================================
    const CMD_ITEMS = [
        { icon: '📊', label: 'Go to Dashboard', shortcut: 'G D', action: () => switchTab('dashboard') },
        { icon: '📨', label: 'Go to AI Inbox', shortcut: 'G I', action: () => switchTab('inbox') },
        { icon: '📋', label: 'Go to CRM', shortcut: 'G C', action: () => switchTab('crm') },
        { icon: '✅', label: 'Go to Task Manager', shortcut: 'G T', action: () => switchTab('task-manager') },
        { icon: '🛒', label: 'Go to Orders', shortcut: 'G O', action: () => switchTab('orders') },
        { icon: '🤖', label: 'Go to Website Agent', shortcut: '', action: () => switchTab('website') },
        { icon: '💬', label: 'Go to WhatsApp Agent', shortcut: '', action: () => switchTab('whatsapp') },
        { icon: '🎨', label: 'Go to Content Studio', shortcut: '', action: () => switchTab('create-post') },
        { icon: '⭐', label: 'Go to Reviews', shortcut: '', action: () => switchTab('reviews') },
        { icon: '⚡', label: 'Go to Automation Rules', shortcut: '', action: () => switchTab('followups') },
        { icon: '👥', label: 'Go to Team', shortcut: '', action: () => switchTab('team') },
        { icon: '💰', label: 'Open Pricing', shortcut: '', action: () => { closeCmdPalette(); if (typeof openPricingModal === 'function') openPricingModal(); } },
        { icon: '📖', label: 'Open Documentation', shortcut: '', action: () => { closeCmdPalette(); if (typeof openDocsModal === 'function') openDocsModal(); } },
        { icon: '🎓', label: 'Start Product Tour', shortcut: '', action: () => { closeCmdPalette(); localStorage.removeItem('tour_completed'); startTour(); } },
    ];

    let cmdActiveIdx = 0;
    let cmdFilteredItems = [...CMD_ITEMS];

    window.openCmdPalette = function() {
        const overlay = document.getElementById('cmd-palette-overlay');
        overlay.classList.add('active');
        const input = document.getElementById('cmd-palette-input');
        input.value = '';
        cmdFilteredItems = [...CMD_ITEMS];
        cmdActiveIdx = 0;
        renderCmdResults();
        setTimeout(() => input.focus(), 50);
    };

    window.closeCmdPalette = function() {
        document.getElementById('cmd-palette-overlay').classList.remove('active');
    };

    window.filterCmdPalette = function(query) {
        const q = query.toLowerCase().trim();
        cmdFilteredItems = q ? CMD_ITEMS.filter(item => item.label.toLowerCase().includes(q)) : [...CMD_ITEMS];
        cmdActiveIdx = 0;
        renderCmdResults();
    };

    window.handleCmdKeydown = function(e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); cmdActiveIdx = Math.min(cmdActiveIdx + 1, cmdFilteredItems.length - 1); renderCmdResults(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); cmdActiveIdx = Math.max(cmdActiveIdx - 1, 0); renderCmdResults(); }
        else if (e.key === 'Enter' && cmdFilteredItems[cmdActiveIdx]) { closeCmdPalette(); cmdFilteredItems[cmdActiveIdx].action(); }
        else if (e.key === 'Escape') { closeCmdPalette(); }
    };

    function renderCmdResults() {
        const container = document.getElementById('cmd-palette-results');
        container.innerHTML = cmdFilteredItems.map((item, i) =>
            `<div class="cmd-palette-item${i === cmdActiveIdx ? ' active' : ''}" onclick="closeCmdPalette();CMD_ITEMS.find(c=>c.label==='${item.label.replace(/'/g,"\\'")}').action()">
                <span class="cmd-icon">${item.icon}</span>
                <span>${item.label}</span>
                ${item.shortcut ? `<span class="cmd-shortcut">${item.shortcut}</span>` : ''}
            </div>`
        ).join('');
    }
    // Expose for onclick
    window.CMD_ITEMS = CMD_ITEMS;

    // ==========================================
    //        KEYBOARD SHORTCUTS
    // ==========================================
    let gKeyPending = false;
    let gKeyTimer = null;

    document.addEventListener('keydown', function(e) {
        // Ignore when typing in inputs
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;

        // Ctrl+K or Cmd+K → Command Palette
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            openCmdPalette();
            return;
        }

        // Escape → Close modals / command palette
        if (e.key === 'Escape') {
            if (document.getElementById('cmd-palette-overlay').classList.contains('active')) {
                closeCmdPalette();
                return;
            }
        }

        // G+key shortcuts (press G, then another key within 500ms)
        if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            gKeyPending = true;
            clearTimeout(gKeyTimer);
            gKeyTimer = setTimeout(() => { gKeyPending = false; }, 500);
            return;
        }

        if (gKeyPending) {
            gKeyPending = false;
            clearTimeout(gKeyTimer);
            const shortcuts = { d: 'dashboard', i: 'inbox', c: 'crm', t: 'task-manager', o: 'orders' };
            if (shortcuts[e.key] && typeof switchTab === 'function') {
                e.preventDefault();
                switchTab(shortcuts[e.key]);
            }
        }
    });
})();
