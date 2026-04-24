(function() {
    // ==========================================
    //   SPRINT 18: OUTBOUND WEBHOOKS MANAGEMENT
    // ==========================================
    const WEBHOOK_EVENTS = [
        { key: 'new_message', label: 'New Message', icon: '💬' },
        { key: 'lead_created', label: 'Lead Created', icon: '👤' },
        { key: 'lead_status_changed', label: 'Lead Status Changed', icon: '📊' },
        { key: 'ticket_created', label: 'Ticket Created', icon: '🎫' },
        { key: 'ticket_resolved', label: 'Ticket Resolved', icon: '✅' },
        { key: 'order_created', label: 'Order Created', icon: '🛒' },
        { key: 'order_updated', label: 'Order Updated', icon: '📦' },
        { key: 'conversation_closed', label: 'Conversation Closed', icon: '🔒' },
    ];

    window.renderWebhooksPanel = async function(container) {
        if (!container || !window.currentUserOrgId) return;
        try {
            const { data: hooks, error } = await supabaseClient.from('org_webhooks').select('*').eq('org_id', currentUserOrgId).order('created_at', { ascending: false });
            if (error) throw error;

            const { data: deliveries } = await supabaseClient.from('webhook_deliveries').select('webhook_id, success, created_at').eq('org_id', currentUserOrgId).order('created_at', { ascending: false }).limit(50);

            container.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                    <div>
                        <h3 style="margin:0;font-size:1.05rem;color:var(--text-primary);">Outbound Webhooks</h3>
                        <p style="margin:3px 0 0;font-size:0.78rem;color:var(--text-secondary);">Notify external services when events occur</p>
                    </div>
                    <button class="pill-btn primary" onclick="createWebhook()" style="font-size:0.78rem;">+ Add Webhook</button>
                </div>
                ${(!hooks || hooks.length === 0) ? '<div style="text-align:center;padding:1.5rem;color:var(--text-secondary);font-size:0.85rem;">No webhooks configured yet.</div>' :
                hooks.map(h => {
                    const recentDeliveries = (deliveries || []).filter(d => d.webhook_id === h.id);
                    const successRate = recentDeliveries.length > 0 ? Math.round((recentDeliveries.filter(d => d.success).length / recentDeliveries.length) * 100) : null;
                    return `
                    <div style="padding:1rem;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);margin-bottom:0.6rem;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <div style="font-weight:600;font-size:0.9rem;color:var(--text-primary);">${esc(h.name)}</div>
                                <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:2px;word-break:break-all;">${esc(h.url)}</div>
                            </div>
                            <div style="display:flex;gap:6px;align-items:center;">
                                ${successRate !== null ? `<span style="font-size:0.7rem;color:${successRate > 80 ? '#10b981' : '#ef4444'};font-weight:600;">${successRate}% ok</span>` : ''}
                                <span style="width:8px;height:8px;border-radius:50%;background:${h.is_active ? '#10b981' : '#64748b'};"></span>
                                <button onclick="deleteWebhook('${h.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:0.8rem;">✕</button>
                            </div>
                        </div>
                        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:0.5rem;">
                            ${(h.events || []).map(e => `<span style="font-size:0.65rem;padding:2px 6px;border-radius:4px;background:rgba(91,174,176,0.1);color:var(--theme-color);">${e}</span>`).join('')}
                        </div>
                    </div>`;
                }).join('')}`;
        } catch (e) {
            container.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);font-size:0.82rem;">Run the webhooks SQL migration to activate.</div>';
        }
    };

    window.createWebhook = async function() {
        const name = prompt('Webhook name:', 'My Webhook');
        if (!name) return;
        const url = prompt('Webhook URL (https):', 'https://');
        if (!url || !url.startsWith('https://')) { showToast('URL must start with https://', 'error'); return; }
        const eventsStr = prompt('Events (comma-separated):\n' + WEBHOOK_EVENTS.map(e => e.key).join(', '), 'new_message,lead_created');
        if (!eventsStr) return;
        const events = eventsStr.split(',').map(s => s.trim()).filter(Boolean);

        try {
            await supabaseClient.from('org_webhooks').insert({ org_id: currentUserOrgId, name, url, events, is_active: true });
            showToast('Webhook created', 'success');
            const container = document.getElementById('webhooks-panel');
            if (container) renderWebhooksPanel(container);
        } catch (e) { showToast('Failed: ' + (e.message || ''), 'error'); }
    };

    window.deleteWebhook = async function(id) {
        if (!confirm('Delete this webhook?')) return;
        await supabaseClient.from('org_webhooks').delete().eq('id', id);
        showToast('Webhook deleted', 'info');
        const container = document.getElementById('webhooks-panel');
        if (container) renderWebhooksPanel(container);
    };

    // ==========================================
    //   SPRINT 19: API KEY MANAGEMENT UI
    // ==========================================
    window.renderApiKeysPanel = async function(container) {
        if (!container || !window.currentUserOrgId) return;
        try {
            const { data: keys, error } = await supabaseClient.from('api_keys').select('id, name, key_prefix, scopes, rate_limit, is_active, last_used_at, created_at').eq('org_id', currentUserOrgId).order('created_at', { ascending: false });
            if (error) throw error;

            container.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                    <div>
                        <h3 style="margin:0;font-size:1.05rem;color:var(--text-primary);">API Keys</h3>
                        <p style="margin:3px 0 0;font-size:0.78rem;color:var(--text-secondary);">Manage keys for the public REST API</p>
                    </div>
                    <button class="pill-btn primary" onclick="createApiKey()" style="font-size:0.78rem;">+ Create Key</button>
                </div>
                ${(!keys || keys.length === 0) ? '<div style="text-align:center;padding:1.5rem;color:var(--text-secondary);font-size:0.85rem;">No API keys yet. Create one to use the public API.</div>' :
                keys.map(k => `
                    <div style="padding:0.8rem 1rem;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-weight:600;font-size:0.88rem;color:var(--text-primary);">${esc(k.name)}</div>
                            <div style="font-size:0.75rem;color:var(--text-secondary);font-family:monospace;margin-top:2px;">${esc(k.key_prefix)}${'•'.repeat(20)}</div>
                            <div style="font-size:0.68rem;color:var(--text-secondary);margin-top:3px;">
                                Scopes: ${(k.scopes || []).join(', ')} · Rate: ${k.rate_limit}/min
                                ${k.last_used_at ? ` · Last used: ${new Date(k.last_used_at).toLocaleDateString()}` : ' · Never used'}
                            </div>
                        </div>
                        <div style="display:flex;gap:6px;align-items:center;">
                            <span style="width:8px;height:8px;border-radius:50%;background:${k.is_active ? '#10b981' : '#64748b'};"></span>
                            <button onclick="revokeApiKey('${k.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:0.75rem;font-weight:600;">Revoke</button>
                        </div>
                    </div>`).join('')}
                <div style="margin-top:1rem;padding:0.8rem;border-radius:10px;background:rgba(91,174,176,0.06);font-size:0.78rem;color:var(--text-secondary);line-height:1.5;">
                    <strong style="color:var(--theme-color);">API Docs:</strong> See <code>docs/api-reference.md</code> for full endpoint documentation. Base URL: <code>${window.SUPABASE_URL}/functions/v1/api-v1</code>
                </div>`;
        } catch (e) {
            container.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);font-size:0.82rem;">Run the API keys SQL migration to activate.</div>';
        }
    };

    window.createApiKey = async function() {
        const name = prompt('Key name:', 'Production Key');
        if (!name) return;

        // Generate a random API key
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let key = 'dk_live_';
        for (let i = 0; i < 32; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));

        try {
            await supabaseClient.from('api_keys').insert({
                org_id: currentUserOrgId,
                name: name,
                key_hash: key, // In production, hash this server-side
                key_prefix: key.substring(0, 12),
                scopes: ['read', 'write'],
                rate_limit: 100,
                is_active: true
            });

            // Show the key once (it won't be shown again)
            alert('Your API key (save this — it won\'t be shown again):\n\n' + key);
            showToast('API key created', 'success');
            const container = document.getElementById('api-keys-panel');
            if (container) renderApiKeysPanel(container);
        } catch (e) { showToast('Failed: ' + (e.message || ''), 'error'); }
    };

    window.revokeApiKey = async function(id) {
        if (!confirm('Revoke this API key? This cannot be undone.')) return;
        await supabaseClient.from('api_keys').update({ is_active: false }).eq('id', id);
        showToast('API key revoked', 'info');
        const container = document.getElementById('api-keys-panel');
        if (container) renderApiKeysPanel(container);
    };

    // ==========================================
    //   SPRINT 20: AI BUSINESS INSIGHTS
    // ==========================================
    window.dashRenderAIInsights = async function() {
        let container = document.getElementById('dash-ai-insights');
        if (!container) {
            const secondary = document.getElementById('dash-secondary-section') || document.getElementById('dashboard');
            if (!secondary) return;
            container = document.createElement('div');
            container.id = 'dash-ai-insights';
            container.className = 'dash-trend-widget';
            container.style.cssText = 'margin-top:1rem;';
            secondary.appendChild(container);
        }

        if (!currentUserOrgId) { container.style.display = 'none'; return; }

        const insights = [];

        try {
            // Analyze recent data for actionable insights
            const now = new Date();
            const weekAgo = new Date(now - 7 * 86400000);
            const twoWeeksAgo = new Date(now - 14 * 86400000);

            // 1. Check overdue tasks
            const { data: overdueTasks } = await supabaseClient.from('tasks').select('id').eq('org_id', currentUserOrgId).lt('due_at', now.toISOString()).not('status', 'in', '("done","cancelled")');
            if (overdueTasks && overdueTasks.length > 0) {
                insights.push({ type: 'warning', icon: '⏰', text: `You have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}. Consider reassigning or updating deadlines.` });
            }

            // 2. Check stale leads
            const { data: staleLeads } = await supabaseClient.from('leads').select('id').eq('org_id', currentUserOrgId).in('status', ['new', 'contacted']).lt('updated_at', weekAgo.toISOString());
            if (staleLeads && staleLeads.length > 3) {
                insights.push({ type: 'action', icon: '📋', text: `${staleLeads.length} leads haven't been updated in 7+ days. Follow up to keep your pipeline moving.` });
            }

            // 3. Check unassigned tasks
            const { data: unassigned } = await supabaseClient.from('tasks').select('id').eq('org_id', currentUserOrgId).is('assigned_to_user_id', null).not('status', 'in', '("done","cancelled")');
            if (unassigned && unassigned.length > 2) {
                insights.push({ type: 'info', icon: '👤', text: `${unassigned.length} tasks are unassigned. Distribute workload across your team.` });
            }

            // 4. Check conversation volume trend
            const { count: thisWeekMsgs } = await supabaseClient.from('inbox_messages').select('id', { count: 'exact', head: true }).eq('org_id', currentUserOrgId).gte('created_at', weekAgo.toISOString());
            const { count: lastWeekMsgs } = await supabaseClient.from('inbox_messages').select('id', { count: 'exact', head: true }).eq('org_id', currentUserOrgId).gte('created_at', twoWeeksAgo.toISOString()).lt('created_at', weekAgo.toISOString());

            if (thisWeekMsgs && lastWeekMsgs && lastWeekMsgs > 0) {
                const change = Math.round(((thisWeekMsgs - lastWeekMsgs) / lastWeekMsgs) * 100);
                if (change > 30) {
                    insights.push({ type: 'success', icon: '📈', text: `Message volume is up ${change}% this week! Your agents are handling more conversations.` });
                } else if (change < -30) {
                    insights.push({ type: 'warning', icon: '📉', text: `Message volume dropped ${Math.abs(change)}% this week. Check if your channels are connected.` });
                }
            }

            // 5. Won leads celebration
            const { data: wonThisWeek } = await supabaseClient.from('leads').select('id').eq('org_id', currentUserOrgId).eq('status', 'won').gte('updated_at', weekAgo.toISOString());
            if (wonThisWeek && wonThisWeek.length > 0) {
                insights.push({ type: 'success', icon: '🎉', text: `${wonThisWeek.length} lead${wonThisWeek.length > 1 ? 's' : ''} won this week! Great work.` });
            }

        } catch (e) {
            console.debug('AI Insights data fetch:', e.message);
        }

        if (insights.length === 0) {
            insights.push({ type: 'success', icon: '✅', text: 'Everything looks good! No action items right now.' });
        }

        const typeColors = { warning: '#f59e0b', action: '#3b82f6', info: '#8b5cf6', success: '#10b981' };

        container.innerHTML = `
            <div style="padding:1.2rem;">
                <div style="font-weight:700;font-size:0.95rem;margin-bottom:0.8rem;color:var(--text-primary);">🧠 AI Insights</div>
                ${insights.map(i => `
                    <div style="display:flex;gap:10px;align-items:flex-start;padding:0.6rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                        <span style="font-size:1.1rem;flex-shrink:0;">${i.icon}</span>
                        <span style="font-size:0.82rem;color:var(--text-secondary);line-height:1.5;border-left:2px solid ${typeColors[i.type]};padding-left:8px;">${i.text}</span>
                    </div>`).join('')}
            </div>`;
    };

    // Hook into dashboard load
    const _origLoadDash = window.loadDashboard;
    if (_origLoadDash) {
        const _patched = window.loadDashboard;
        // We'll call it after dashboard renders via a small delay
        setTimeout(() => {
            if (typeof dashRenderAIInsights === 'function') {
                const dashEl = document.getElementById('dashboard');
                if (dashEl && dashEl.classList.contains('active')) dashRenderAIInsights();
            }
        }, 3000);
    }

    // ==========================================
    //   SPRINT 21: MULTI-LANGUAGE AGENT CONFIG UI
    // ==========================================
    window.renderLanguageConfig = function(agentId) {
        const container = document.getElementById(`lang-config-${agentId}`);
        if (!container) return;

        const isVisible = container.style.display !== 'none';
        container.style.display = isVisible ? 'none' : 'block';
        if (isVisible) return;

        container.innerHTML = `
            <div style="padding:1rem;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);margin-top:0.8rem;">
                <div style="font-weight:600;font-size:0.9rem;color:var(--text-primary);margin-bottom:0.8rem;">🌍 Multi-Language Settings</div>

                <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.8rem;">
                    <label style="font-size:0.82rem;color:var(--text-secondary);">Auto-detect language:</label>
                    <input type="checkbox" id="auto-lang-${agentId}" onchange="saveLanguageSetting('${agentId}', 'auto_detect_language', this.checked)">
                </div>

                <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.5rem;">Supported Languages:</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:1rem;" id="lang-chips-${agentId}">
                    ${['en', 'ar', 'fr', 'es', 'de', 'tr', 'pt', 'zh', 'hi', 'ru'].map(lang => `
                        <button class="pill-btn${['en'].includes(lang) ? ' primary' : ''}" onclick="toggleAgentLanguage('${agentId}', '${lang}', this)" style="font-size:0.75rem;padding:4px 10px;">
                            ${lang.toUpperCase()}
                        </button>`).join('')}
                </div>

                <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.5rem;">Language-Specific Prompts:</div>
                <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:0.5rem;">Add a system prompt in Arabic so the agent responds in Arabic when it detects Arabic messages.</div>
                <div style="margin-bottom:0.5rem;">
                    <label style="font-size:0.78rem;color:var(--text-secondary);">Arabic (AR) Prompt:</label>
                    <textarea id="lang-prompt-ar-${agentId}" placeholder="Write your Arabic system prompt here..." style="width:100%;height:80px;margin-top:4px;padding:8px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.1);color:var(--text-primary);font-size:0.82rem;resize:vertical;direction:rtl;"></textarea>
                </div>
                <button class="pill-btn primary" onclick="saveMultilingualPrompts('${agentId}')" style="font-size:0.78rem;">Save Language Settings</button>
            </div>`;
    };

    window.toggleAgentLanguage = function(agentId, lang, btn) {
        btn.classList.toggle('primary');
    };

    window.saveLanguageSetting = async function(agentId, field, value) {
        try {
            await supabaseClient.from('agent_configs').update({ [field]: value, updated_at: new Date().toISOString() }).eq('org_id', currentUserOrgId).eq('agent', agentId);
            showToast('Language setting saved', 'success');
        } catch (e) { console.warn('Save language setting:', e); }
    };

    window.saveMultilingualPrompts = async function(agentId) {
        const arPrompt = document.getElementById(`lang-prompt-ar-${agentId}`)?.value || '';
        const prompts = {};
        if (arPrompt.trim()) prompts.ar = arPrompt;

        try {
            await supabaseClient.from('agent_configs').update({ multilingual_prompts: prompts, updated_at: new Date().toISOString() }).eq('org_id', currentUserOrgId).eq('agent', agentId);
            showToast('Multilingual prompts saved', 'success');
        } catch (e) { showToast('Failed: ' + (e.message || ''), 'error'); }
    };

    if (typeof window.esc !== 'function') {
        window.esc = function(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
    }
})();
