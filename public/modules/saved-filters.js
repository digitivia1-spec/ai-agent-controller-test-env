(function() {
    // ==========================================
    //   SPRINT 26: SAVED FILTERS
    // ==========================================
    window.renderSavedFilters = async function(module, container, applyCallback) {
        if (!container || !currentUserOrgId) return;
        try {
            const userId = window.currentUserObj?.id;
            if (!userId) return;

            const { data: filters } = await supabaseClient.from('saved_filters')
                .select('*').eq('user_id', userId).eq('module', module).order('created_at');

            container.innerHTML = `
                <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
                    <span style="font-size:0.72rem;color:var(--text-secondary);margin-right:4px;">Saved:</span>
                    ${(filters || []).map(f => `
                        <button class="pill-btn" style="font-size:0.7rem;padding:3px 8px;position:relative;" onclick='applySavedFilter(${JSON.stringify(f.filters).replace(/'/g,"&#39;")}, ${JSON.stringify(applyCallback.name)})'>
                            ${esc(f.name)}
                            <span onclick="event.stopPropagation();deleteSavedFilter('${f.id}','${module}',this.closest('[id]'))" style="margin-left:4px;cursor:pointer;opacity:0.5;font-size:0.65rem;">✕</span>
                        </button>`).join('')}
                    <button class="pill-btn" style="font-size:0.68rem;padding:3px 8px;opacity:0.6;" onclick="saveCurrentFilter('${module}')">+ Save Current</button>
                </div>`;
        } catch (e) { /* Migration not run yet */ }
    };

    window.saveCurrentFilter = async function(module) {
        const name = prompt('Filter name:', 'My Filter');
        if (!name) return;

        let filters = {};
        if (module === 'tickets') {
            filters.status = document.getElementById('ticket-status-filter')?.value || '';
            filters.priority = document.getElementById('ticket-priority-filter')?.value || '';
            filters.search = document.getElementById('ticket-search')?.value || '';
        } else if (module === 'crm') {
            filters.status = document.getElementById('crm-status-filter')?.value || '';
            filters.category = document.getElementById('crm-category-filter')?.value || '';
            filters.search = document.getElementById('crm-search-input')?.value || '';
        }

        try {
            await supabaseClient.from('saved_filters').insert({
                org_id: currentUserOrgId, user_id: window.currentUserObj?.id,
                name, module, filters
            });
            showToast('Filter saved', 'success');
        } catch (e) { showToast('Run saved_filters migration first', 'info'); }
    };

    window.applySavedFilter = function(filters, callbackName) {
        if (filters.status) {
            const el = document.getElementById('ticket-status-filter') || document.getElementById('crm-status-filter');
            if (el) el.value = filters.status;
        }
        if (filters.priority) {
            const el = document.getElementById('ticket-priority-filter');
            if (el) el.value = filters.priority;
        }
        if (filters.search) {
            const el = document.getElementById('ticket-search') || document.getElementById('crm-search-input');
            if (el) el.value = filters.search;
        }
        if (typeof window.filterTickets === 'function') window.filterTickets();
        if (typeof window.filterAndRenderCrmData === 'function') window.filterAndRenderCrmData();
    };

    window.deleteSavedFilter = async function(id, module) {
        await supabaseClient.from('saved_filters').delete().eq('id', id);
        showToast('Filter removed', 'info');
    };

    // ==========================================
    //   SPRINT 27: BULK ACTIONS
    // ==========================================
    let bulkSelectedIds = new Set();
    let bulkModule = '';

    window.initBulkSelect = function(module) {
        bulkModule = module;
        bulkSelectedIds.clear();
        updateBulkBar();
    };

    window.toggleBulkItem = function(id, checkbox) {
        if (checkbox.checked) bulkSelectedIds.add(id);
        else bulkSelectedIds.delete(id);
        updateBulkBar();
    };

    window.toggleBulkAll = function(checked) {
        const items = document.querySelectorAll('.bulk-checkbox');
        items.forEach(cb => { cb.checked = checked; if (checked) bulkSelectedIds.add(cb.value); else bulkSelectedIds.delete(cb.value); });
        updateBulkBar();
    };

    function updateBulkBar() {
        let bar = document.getElementById('bulk-action-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'bulk-action-bar';
            bar.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--bg-card,#1a1b2e);border:1px solid var(--theme-color);border-radius:14px;padding:10px 18px;display:none;align-items:center;gap:12px;z-index:7000;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
            document.body.appendChild(bar);
        }

        if (bulkSelectedIds.size === 0) { bar.style.display = 'none'; return; }
        bar.style.display = 'flex';

        const actions = bulkModule === 'tickets' ?
            `<button class="pill-btn primary" onclick="bulkUpdateStatus('open')" style="font-size:0.75rem;">Set Open</button>
             <button class="pill-btn primary" onclick="bulkUpdateStatus('in_progress')" style="font-size:0.75rem;">Set In Progress</button>
             <button class="pill-btn primary" onclick="bulkUpdateStatus('resolved')" style="font-size:0.75rem;">Resolve</button>
             <button class="pill-btn" onclick="bulkDelete()" style="font-size:0.75rem;color:#ef4444;">Delete</button>` :
        bulkModule === 'leads' ?
            `<button class="pill-btn primary" onclick="bulkUpdateLeadStatus('contacted')" style="font-size:0.75rem;">Mark Contacted</button>
             <button class="pill-btn primary" onclick="bulkUpdateLeadStatus('qualified')" style="font-size:0.75rem;">Qualify</button>
             <button class="pill-btn primary" onclick="bulkUpdateLeadStatus('won')" style="font-size:0.75rem;">Won</button>` :
            `<button class="pill-btn primary" onclick="bulkUpdateTaskStatus('done')" style="font-size:0.75rem;">Complete</button>
             <button class="pill-btn" onclick="bulkDelete()" style="font-size:0.75rem;color:#ef4444;">Delete</button>`;

        bar.innerHTML = `
            <span style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">${bulkSelectedIds.size} selected</span>
            ${actions}
            <button onclick="initBulkSelect('${bulkModule}')" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:0.85rem;">✕</button>`;
    }

    window.bulkUpdateStatus = async function(status) {
        const ids = [...bulkSelectedIds];
        const table = bulkModule === 'tickets' ? 'tickets' : bulkModule === 'leads' ? 'leads' : 'tasks';
        const updates = { status, updated_at: new Date().toISOString() };
        if (status === 'resolved') updates.resolved_at = new Date().toISOString();
        if (status === 'done') updates.completed_at = new Date().toISOString();

        await supabaseClient.from(table).update(updates).in('id', ids);
        showToast(`${ids.length} items updated`, 'success');
        bulkSelectedIds.clear();
        updateBulkBar();
        if (bulkModule === 'tickets' && typeof loadTickets === 'function') loadTickets();
    };
    window.bulkUpdateLeadStatus = window.bulkUpdateStatus;
    window.bulkUpdateTaskStatus = window.bulkUpdateStatus;

    window.bulkDelete = async function() {
        if (!confirm(`Delete ${bulkSelectedIds.size} items? This cannot be undone.`)) return;
        const ids = [...bulkSelectedIds];
        const table = bulkModule === 'tickets' ? 'tickets' : bulkModule === 'leads' ? 'leads' : 'tasks';
        await supabaseClient.from(table).delete().in('id', ids);
        showToast(`${ids.length} items deleted`, 'success');
        bulkSelectedIds.clear();
        updateBulkBar();
        if (bulkModule === 'tickets' && typeof loadTickets === 'function') loadTickets();
    };

    // ==========================================
    //   SPRINT 29: TEAM PRESENCE INDICATORS
    // ==========================================
    window.updateMyPresence = async function(tab, entityId) {
        try {
            const userId = window.currentUserObj?.id;
            if (!userId || !currentUserOrgId) return;

            await supabaseClient.from('team_presence').upsert({
                user_id: userId,
                org_id: currentUserOrgId,
                status: 'online',
                current_tab: tab || null,
                current_entity_id: entityId || null,
                last_seen_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
        } catch (e) { /* Migration not run yet — silent */ }
    };

    window.getOnlineTeamMembers = async function() {
        try {
            const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
            const { data } = await supabaseClient.from('team_presence')
                .select('user_id, status, current_tab, last_seen_at')
                .eq('org_id', currentUserOrgId)
                .gte('last_seen_at', fiveMinAgo);
            return data || [];
        } catch (e) { return []; }
    };

    window.renderPresenceIndicators = async function() {
        const members = await getOnlineTeamMembers();
        if (members.length === 0) return;

        let indicator = document.getElementById('presence-strip');
        if (!indicator) {
            const sidebar = document.querySelector('.sidebar');
            if (!sidebar) return;
            indicator = document.createElement('div');
            indicator.id = 'presence-strip';
            indicator.style.cssText = 'padding:8px 14px;border-top:1px solid rgba(255,255,255,0.06);';
            sidebar.appendChild(indicator);
        }

        const myId = window.currentUserObj?.id;
        const others = members.filter(m => m.user_id !== myId);

        indicator.innerHTML = `
            <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
                <span style="width:6px;height:6px;border-radius:50%;background:#10b981;flex-shrink:0;"></span>
                <span style="font-size:0.7rem;color:var(--text-secondary);">${others.length + 1} online</span>
                ${others.slice(0, 5).map(m => {
                    const name = (window.orgMembersCache || []).find(c => c.user_id === m.user_id);
                    const initials = name ? (name.full_name || name.email || '?').substring(0, 2).toUpperCase() : '?';
                    return `<span title="${name?.full_name || 'Team member'} · ${m.current_tab || 'idle'}" style="width:22px;height:22px;border-radius:50%;background:var(--theme-color);color:#fff;font-size:0.6rem;display:flex;align-items:center;justify-content:center;font-weight:700;">${initials}</span>`;
                }).join('')}
            </div>`;
    };

    // Update presence on tab switch
    const _origSwitch = window.switchTab;
    if (_origSwitch) {
        const _prev = window.switchTab;
        window.switchTab = function(tabId, el) {
            _prev(tabId, el);
            if (typeof updateMyPresence === 'function') updateMyPresence(tabId);
        };
    }

    // Periodic presence update
    setInterval(() => {
        if (!document.hidden && typeof updateMyPresence === 'function') {
            updateMyPresence();
            if (typeof renderPresenceIndicators === 'function') renderPresenceIndicators();
        }
    }, 60000);

    // ==========================================
    //   SPRINT 30: GLOBAL SEARCH
    // ==========================================
    window.globalSearch = async function(query) {
        if (!query || query.length < 2 || !currentUserOrgId) return [];
        const q = query.toLowerCase().trim();
        const results = [];

        try {
            // Search leads
            const { data: leads } = await supabaseClient.from('leads')
                .select('id, full_name, phone, email, status')
                .eq('org_id', currentUserOrgId)
                .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
                .limit(5);
            (leads || []).forEach(l => results.push({
                type: 'lead', icon: '👤', title: l.full_name || l.phone || 'Lead',
                subtitle: `${l.status} · ${l.email || l.phone || ''}`,
                action: () => { switchTab('crm'); }
            }));

            // Search tickets
            const { data: tickets } = await supabaseClient.from('tickets')
                .select('id, subject, status, customer_name')
                .eq('org_id', currentUserOrgId)
                .or(`subject.ilike.%${q}%,customer_name.ilike.%${q}%`)
                .limit(5);
            (tickets || []).forEach(t => results.push({
                type: 'ticket', icon: '🎫', title: t.subject,
                subtitle: `${t.status} · ${t.customer_name || ''}`,
                action: () => { switchTab('tickets'); if (typeof openTicketDetail === 'function') setTimeout(() => openTicketDetail(t.id), 300); }
            }));

            // Search tasks
            const { data: tasks } = await supabaseClient.from('tasks')
                .select('id, title, status, priority')
                .eq('org_id', currentUserOrgId)
                .ilike('title', `%${q}%`)
                .limit(5);
            (tasks || []).forEach(t => results.push({
                type: 'task', icon: '✅', title: t.title,
                subtitle: `${t.status} · ${t.priority}`,
                action: () => { switchTab('task-manager'); if (typeof openTaskDetail === 'function') setTimeout(() => openTaskDetail(t.id), 300); }
            }));

            // Search conversations (contacts)
            const { data: contacts } = await supabaseClient.from('inbox_contacts')
                .select('id, display_name, phone, platform')
                .eq('org_id', currentUserOrgId)
                .or(`display_name.ilike.%${q}%,phone.ilike.%${q}%`)
                .limit(5);
            (contacts || []).forEach(c => results.push({
                type: 'contact', icon: '💬', title: c.display_name || c.phone || 'Contact',
                subtitle: c.platform || '',
                action: () => { switchTab('inbox'); }
            }));

        } catch (e) { console.debug('Global search error:', e.message); }

        return results;
    };

    // Enhance command palette with global search
    const _origFilter = window.filterCmdPalette;
    window.filterCmdPalette = async function(query) {
        // First show command results
        if (_origFilter) _origFilter(query);

        // Then append search results if query is long enough
        if (query && query.length >= 2) {
            const searchResults = await globalSearch(query);
            if (searchResults.length > 0) {
                const container = document.getElementById('cmd-palette-results');
                if (!container) return;

                // Add divider
                container.innerHTML += '<div style="padding:6px 12px;font-size:0.7rem;color:var(--text-secondary);border-top:1px solid rgba(255,255,255,0.06);margin-top:4px;">Search Results</div>';

                // Add search results
                container.innerHTML += searchResults.map(r => `
                    <div class="cmd-palette-item" onclick="closeCmdPalette();(${r.action.toString()})()">
                        <span class="cmd-icon">${r.icon}</span>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.85rem;">${esc(r.title)}</div>
                            <div style="font-size:0.7rem;color:var(--text-secondary);">${esc(r.subtitle)}</div>
                        </div>
                        <span class="cmd-shortcut">${r.type}</span>
                    </div>`).join('');
            }
        }
    };

    if (typeof window.esc !== 'function') {
        window.esc = function(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
    }
})();
