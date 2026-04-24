(function() {
    // ==========================================
    //   GOOGLE CALENDAR INTEGRATION
    // ==========================================
    window.connectGoogleCalendar = async function() {
        const userId = window.currentUserObj?.id;
        if (!userId || !currentUserOrgId) { showToast('Please login first', 'error'); return; }

        try {
            const { data, error } = await supabaseClient.functions.invoke('google-calendar', {
                body: {},
                headers: {},
            });

            // Build authorize URL with query params
            const authUrl = `${window.SUPABASE_URL}/functions/v1/google-calendar?action=authorize&user_id=${userId}&org_id=${currentUserOrgId}`;
            window.open(authUrl, '_blank');
        } catch (e) {
            showToast('Set up Google Calendar Edge Function first', 'info');
        }
    };

    window.syncGoogleCalendar = async function() {
        const userId = window.currentUserObj?.id;
        if (!userId) return;

        try {
            const { data, error } = await supabaseClient.functions.invoke('google-calendar', {
                body: { user_id: userId, org_id: currentUserOrgId, action: 'sync' },
            });
            if (error) throw error;
            if (data?.events) {
                showToast(`Synced ${data.count} calendar events`, 'success');
                return data.events;
            }
        } catch (e) {
            console.debug('Google Calendar sync:', e.message);
        }
        return [];
    };

    window.createCalendarEvent = async function(title, startTime, endTime, attendeeEmail) {
        const userId = window.currentUserObj?.id;
        if (!userId) return;

        try {
            const { data, error } = await supabaseClient.functions.invoke('google-calendar', {
                body: { user_id: userId, action: 'create-event', title, start_time: startTime, end_time: endTime, attendee_email: attendeeEmail },
            });
            if (data?.success) showToast('Event created in Google Calendar', 'success');
            return data;
        } catch (e) {
            showToast('Could not create calendar event', 'error');
        }
    };

    // Check if connected on page load (show in settings/profile)
    window.checkGoogleCalendarStatus = async function() {
        const userId = window.currentUserObj?.id;
        if (!userId) return false;
        try {
            const { data } = await supabaseClient.from('user_google_tokens').select('expires_at').eq('user_id', userId).maybeSingle();
            return !!data;
        } catch (e) { return false; }
    };

    // Handle ?gcal=connected redirect
    if (window.location.search.includes('gcal=connected')) {
        setTimeout(() => showToast('Google Calendar connected!', 'success'), 1500);
        window.history.replaceState({}, '', window.location.pathname);
    }

    // Google Calendar connect button handler
    window.handleGoogleCalendarConnect = async function() {
        const btn = document.getElementById('gcal-btn-text');
        if (!btn) return;

        btn.textContent = '📅 Checking...';

        // 1. Check if user signed in with Google (already has Calendar access)
        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (user?.app_metadata?.provider === 'google' || user?.identities?.some(i => i.provider === 'google')) {
                // User signed in with Google — try to sync directly
                const events = await syncGoogleCalendar();
                if (events && events.length >= 0) {
                    btn.textContent = '✅ Google Calendar Connected';
                    document.getElementById('profile-gcal-btn').style.borderColor = 'rgba(16,185,129,0.4)';
                    document.getElementById('profile-gcal-btn').style.background = 'rgba(16,185,129,0.1)';
                    showToast(`Calendar synced! ${events.length} upcoming events found.`, 'success');
                    return;
                }
            }
        } catch (e) {
            console.debug('Google identity check:', e.message);
        }

        // 2. Fallback: separate OAuth flow
        btn.textContent = '📅 Connecting...';
        connectGoogleCalendar();
    };

    // Auto-check Calendar status when profile opens
    window.updateGCalButton = async function() {
        const btn = document.getElementById('gcal-btn-text');
        if (!btn) return;

        const connected = await checkGoogleCalendarStatus();
        if (connected) {
            btn.textContent = '✅ Google Calendar Connected';
            document.getElementById('profile-gcal-btn').style.borderColor = 'rgba(16,185,129,0.4)';
            document.getElementById('profile-gcal-btn').style.background = 'rgba(16,185,129,0.1)';
        } else {
            // Check if signed in with Google (might work without separate connect)
            try {
                const { data: { user } } = await supabaseClient.auth.getUser();
                if (user?.app_metadata?.provider === 'google') {
                    btn.textContent = '📅 Sync Google Calendar';
                }
            } catch (e) {}
        }
    };

    // Hook into profile modal open
    const _origOpenProfile = window.openProfileModal;
    if (_origOpenProfile) {
        const _prev = window.openProfileModal;
        window.openProfileModal = function() {
            _prev();
            setTimeout(() => { if (typeof updateGCalButton === 'function') updateGCalButton(); }, 500);
        };
    }

    // ==========================================
    //   DASHBOARD QUICK ACTIONS
    // ==========================================
    window.dashRenderQuickActions = async function() {
        let container = document.getElementById('dash-quick-actions');
        if (!container) {
            // Insert before KPI cards
            const alertsStrip = document.getElementById('dash-alerts-strip');
            if (!alertsStrip) return;
            container = document.createElement('div');
            container.id = 'dash-quick-actions';
            container.className = 'dashboard-widget';
            container.setAttribute('data-widget', 'quick_actions');
            alertsStrip.parentNode.insertBefore(container, alertsStrip.nextSibling);
        }
        if (!currentUserOrgId) return;

        const actions = [];

        try {
            // 1. Unanswered conversations (AI paused but no human reply recently)
            const { count: pausedCount } = await supabaseClient
                .from('inbox_conversations')
                .select('id', { count: 'exact', head: true })
                .eq('org_id', currentUserOrgId)
                .eq('ai_paused', true);
            if (pausedCount > 0) {
                actions.push({ icon: '💬', text: `${pausedCount} conversation${pausedCount > 1 ? 's' : ''} waiting for your reply`, action: "switchTab('inbox')", color: '#3b82f6' });
            }

            // 2. Stale leads (new/contacted, not updated in 7 days)
            const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
            const { count: staleLeads } = await supabaseClient
                .from('leads')
                .select('id', { count: 'exact', head: true })
                .eq('org_id', currentUserOrgId)
                .in('status', ['new', 'contacted'])
                .lt('updated_at', weekAgo);
            if (staleLeads > 0) {
                actions.push({ icon: '📋', text: `${staleLeads} lead${staleLeads > 1 ? 's' : ''} need follow-up (7+ days idle)`, action: "switchTab('crm')", color: '#f59e0b' });
            }

            // 3. Overdue tasks
            const now = new Date().toISOString();
            const { count: overdueTasks } = await supabaseClient
                .from('tasks')
                .select('id', { count: 'exact', head: true })
                .eq('org_id', currentUserOrgId)
                .lt('due_at', now)
                .not('status', 'in', '("done","cancelled")');
            if (overdueTasks > 0) {
                actions.push({ icon: '⏰', text: `${overdueTasks} overdue task${overdueTasks > 1 ? 's' : ''}`, action: "switchTab('task-manager')", color: '#ef4444' });
            }

            // 4. Unassigned tasks
            const { count: unassigned } = await supabaseClient
                .from('tasks')
                .select('id', { count: 'exact', head: true })
                .eq('org_id', currentUserOrgId)
                .is('assigned_to_user_id', null)
                .not('status', 'in', '("done","cancelled")');
            if (unassigned > 2) {
                actions.push({ icon: '👤', text: `${unassigned} tasks need assignment`, action: "switchTab('task-manager')", color: '#8b5cf6' });
            }
        } catch (e) { console.debug('Quick actions:', e.message); }

        if (actions.length === 0) {
            container.innerHTML = `
                <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:12px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.12);">
                    <span style="font-size:1.2rem;">✅</span>
                    <span style="font-size:0.85rem;color:#10b981;font-weight:600;">All caught up! No pending actions right now.</span>
                </div>`;
            return;
        }

        container.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${actions.map(a => `
                    <div onclick="${a.action}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);cursor:pointer;transition:all 0.15s;" onmouseover="this.style.borderColor='${a.color}'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)'">
                        <span style="font-size:1.1rem;">${a.icon}</span>
                        <span style="flex:1;font-size:0.85rem;color:var(--text-primary);">${a.text}</span>
                        <span style="font-size:0.75rem;color:var(--text-secondary);">→</span>
                    </div>`).join('')}
            </div>`;
    };

    // Hook into dashboard load
    const _origLoadDash2 = window.loadDashboard;
    if (_origLoadDash2) {
        setTimeout(() => {
            const dashEl = document.getElementById('dashboard');
            if (dashEl && dashEl.classList.contains('active')) {
                if (typeof dashRenderQuickActions === 'function') dashRenderQuickActions();
            }
        }, 2500);
    }
})();
