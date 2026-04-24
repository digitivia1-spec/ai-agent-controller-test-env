(function() {
    let cachedTickets = [];
    const TICKET_STATUS_COLORS = { open: '#3b82f6', in_progress: '#f59e0b', waiting: '#8b5cf6', resolved: '#10b981', closed: '#64748b' };
    const PRIORITY_DOTS = { urgent: '#ef4444', high: '#f97316', medium: '#3b82f6', low: '#9ca3af' };

    window.loadTickets = async function() {
        if (!window.currentUserOrgId) return;
        try {
            const { data, error } = await supabaseClient.from('tickets').select('*').eq('org_id', currentUserOrgId).order('created_at', { ascending: false });
            if (error) throw error;
            cachedTickets = data || [];
            renderTicketKPIs();
            renderTicketList();
        } catch (e) {
            document.getElementById('tickets-list').innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Run the ticketing SQL migration to activate this feature.</div>';
        }
    };

    function renderTicketKPIs() {
        const strip = document.getElementById('tickets-kpi-strip');
        if (!strip) return;
        const open = cachedTickets.filter(t => t.status === 'open').length;
        const inProgress = cachedTickets.filter(t => t.status === 'in_progress').length;
        const resolved = cachedTickets.filter(t => t.status === 'resolved' && new Date(t.resolved_at) >= new Date(new Date().setHours(0,0,0,0))).length;
        const breached = cachedTickets.filter(t => t.sla_resolution_due_at && new Date(t.sla_resolution_due_at) < new Date() && !['resolved','closed'].includes(t.status)).length;

        strip.innerHTML = [
            { label: 'Open', value: open, color: '#3b82f6' },
            { label: 'In Progress', value: inProgress, color: '#f59e0b' },
            { label: 'Resolved Today', value: resolved, color: '#10b981' },
            { label: 'SLA Breached', value: breached, color: breached > 0 ? '#ef4444' : '#10b981' }
        ].map(k => `
            <div style="text-align:center;padding:0.8rem;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);">
                <div style="font-size:1.5rem;font-weight:800;color:${k.color};">${k.value}</div>
                <div style="font-size:0.72rem;color:var(--text-secondary);">${k.label}</div>
            </div>`).join('');
    }

    function renderTicketList() {
        const list = document.getElementById('tickets-list');
        if (!list) return;

        const search = (document.getElementById('ticket-search')?.value || '').toLowerCase();
        const statusFilter = document.getElementById('ticket-status-filter')?.value || '';
        const priorityFilter = document.getElementById('ticket-priority-filter')?.value || '';

        let filtered = cachedTickets;
        if (search) filtered = filtered.filter(t => (t.subject || '').toLowerCase().includes(search) || (t.customer_name || '').toLowerCase().includes(search));
        if (statusFilter) filtered = filtered.filter(t => t.status === statusFilter);
        if (priorityFilter) filtered = filtered.filter(t => t.priority === priorityFilter);

        if (filtered.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">No tickets found.</div>';
            return;
        }

        list.innerHTML = filtered.map(t => {
            const sColor = TICKET_STATUS_COLORS[t.status] || '#64748b';
            const pColor = PRIORITY_DOTS[t.priority] || '#9ca3af';
            const isOverdue = t.sla_resolution_due_at && new Date(t.sla_resolution_due_at) < new Date() && !['resolved','closed'].includes(t.status);
            const timeAgo = t.created_at ? formatTicketDate(t.created_at) : '';

            return `
            <div onclick="openTicketDetail('${t.id}')" style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor='var(--theme-color)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)'">
                <div style="width:4px;height:36px;border-radius:2px;background:${pColor};flex-shrink:0;"></div>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-weight:600;font-size:0.88rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.subject)}</span>
                        ${isOverdue ? '<span style="font-size:0.68rem;color:#ef4444;font-weight:600;">⚠️ SLA</span>' : ''}
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:3px;">
                        <span style="font-size:0.72rem;color:var(--text-secondary);">${esc(t.customer_name || 'No customer')}</span>
                        <span style="font-size:0.68rem;padding:2px 8px;border-radius:999px;background:${sColor}22;color:${sColor};font-weight:600;">${t.status.replace('_',' ')}</span>
                        ${t.category ? `<span style="font-size:0.68rem;color:var(--text-secondary);">${esc(t.category)}</span>` : ''}
                    </div>
                </div>
                <div style="font-size:0.72rem;color:var(--text-secondary);white-space:nowrap;">${timeAgo}</div>
            </div>`;
        }).join('');
    }

    window.filterTickets = renderTicketList;

    window.openCreateTicketModal = async function() {
        const subject = prompt('Ticket subject:');
        if (!subject) return;
        const priority = prompt('Priority (low/medium/high/urgent):', 'medium') || 'medium';
        const category = prompt('Category (billing/technical/general/complaint):', 'general') || 'general';
        const customerName = prompt('Customer name (optional):', '') || null;

        try {
            const userId = window.currentUserObj?.id || '00000000-0000-0000-0000-000000000000';
            await supabaseClient.from('tickets').insert({
                org_id: currentUserOrgId,
                subject: subject,
                priority: priority,
                category: category,
                customer_name: customerName,
                source: 'manual',
                created_by: userId,
                status: 'open'
            });
            showToast('Ticket created', 'success');
            loadTickets();
        } catch (e) {
            showToast('Failed: ' + (e.message || ''), 'error');
        }
    };

    window.openTicketDetail = async function(ticketId) {
        const ticket = cachedTickets.find(t => t.id === ticketId);
        if (!ticket) return;

        const sColor = TICKET_STATUS_COLORS[ticket.status] || '#64748b';
        const detail = `
            <div style="padding:1.5rem;">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:1rem;">
                    <div>
                        <h3 style="margin:0 0 0.3rem;color:var(--text-primary);">${esc(ticket.subject)}</h3>
                        <div style="font-size:0.82rem;color:var(--text-secondary);">#${ticket.ticket_number || '--'} · ${esc(ticket.category || 'general')} · ${esc(ticket.customer_name || 'No customer')}</div>
                    </div>
                    <select onchange="updateTicketStatus('${ticketId}', this.value)" style="padding:6px 10px;border-radius:8px;background:${sColor}22;color:${sColor};border:1px solid ${sColor}44;font-size:0.78rem;font-weight:600;">
                        ${['open','in_progress','waiting','resolved','closed'].map(s => `<option value="${s}"${ticket.status===s?' selected':''}>${s.replace('_',' ')}</option>`).join('')}
                    </select>
                </div>
                ${ticket.description ? `<p style="font-size:0.88rem;color:var(--text-secondary);line-height:1.5;margin-bottom:1rem;">${esc(ticket.description)}</p>` : ''}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;font-size:0.82rem;">
                    <div><span style="color:var(--text-secondary);">Priority:</span> <strong style="color:${PRIORITY_DOTS[ticket.priority]}">${ticket.priority}</strong></div>
                    <div><span style="color:var(--text-secondary);">Assigned:</span> ${ticket.assigned_to ? getOrgMemberName(ticket.assigned_to) : 'Unassigned'}</div>
                    <div><span style="color:var(--text-secondary);">Created:</span> ${new Date(ticket.created_at).toLocaleString()}</div>
                    <div><span style="color:var(--text-secondary);">Email:</span> ${esc(ticket.customer_email || '--')}</div>
                </div>
                ${ticket.sla_resolution_due_at ? `<div style="margin-top:0.8rem;font-size:0.78rem;color:${new Date(ticket.sla_resolution_due_at) < new Date() ? '#ef4444' : 'var(--text-secondary)'};">SLA Due: ${new Date(ticket.sla_resolution_due_at).toLocaleString()}</div>` : ''}
            </div>`;

        // Use a simple modal approach
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:8000;display:flex;justify-content:center;align-items:center;padding:2rem;';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = `<div style="background:var(--bg-card,#1a1b2e);border:1px solid rgba(255,255,255,0.1);border-radius:18px;max-width:600px;width:100%;max-height:85vh;overflow-y:auto;">
            <div style="display:flex;justify-content:flex-end;padding:0.8rem 1rem 0;"><button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;color:var(--text-secondary);font-size:1.2rem;cursor:pointer;">✕</button></div>
            ${detail}
        </div>`;
        document.body.appendChild(overlay);
    };

    window.updateTicketStatus = async function(ticketId, newStatus) {
        const updates = { status: newStatus, updated_at: new Date().toISOString() };
        if (newStatus === 'resolved') updates.resolved_at = new Date().toISOString();
        await supabaseClient.from('tickets').update(updates).eq('id', ticketId);
        showToast('Status updated', 'success');
        loadTickets();
    };

    function formatTicketDate(dateStr) {
        const d = new Date(dateStr);
        const now = new Date();
        const diff = now - d;
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return mins + 'm ago';
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + 'h ago';
        const days = Math.floor(hrs / 24);
        if (days < 7) return days + 'd ago';
        return d.toLocaleDateString();
    }

    function getOrgMemberName(userId) {
        if (!userId || !window.orgMembersCache) return '';
        const m = window.orgMembersCache.find(m => m.user_id === userId);
        return m ? (m.full_name || m.email || 'Member') : '';
    }

    if (typeof window.esc !== 'function') {
        window.esc = function(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
    }

    // Auto-load tickets when tab is switched to
    const origSwitchTab = window.switchTab;
    if (origSwitchTab) {
        window.switchTab = function(tabId, el) {
            origSwitchTab(tabId, el);
            if (tabId === 'tickets') {
                loadTickets();
                const slaPanel = document.getElementById('sla-policies-panel');
                if (slaPanel && typeof renderSLAPolicies === 'function') renderSLAPolicies(slaPanel);
            }
            if (tabId === 'team') {
                // Render audit log if container exists
                setTimeout(() => {
                    let auditContainer = document.getElementById('audit-log-panel');
                    if (!auditContainer) {
                        const teamTab = document.getElementById('team');
                        if (teamTab) {
                            const card = document.createElement('div');
                            card.className = 'card glass';
                            card.style.marginTop = '1rem';
                            card.innerHTML = '<div id="audit-log-panel"></div>';
                            teamTab.appendChild(card);
                            auditContainer = document.getElementById('audit-log-panel');
                        }
                    }
                    if (auditContainer && typeof renderAuditLogDashboard === 'function') renderAuditLogDashboard(auditContainer);
                }, 300);
            }
            if (tabId === 'integrations') {
                const wp = document.getElementById('webhooks-panel');
                const ap = document.getElementById('api-keys-panel');
                if (wp && typeof renderWebhooksPanel === 'function') renderWebhooksPanel(wp);
                if (ap && typeof renderApiKeysPanel === 'function') renderApiKeysPanel(ap);
            }
        };
    }
})();
