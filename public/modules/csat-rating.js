(function() {
    // ==========================================
    //   SPRINT 22: CSAT RATING COLLECTION
    // ==========================================
    window.showCSATPrompt = function(entityType, entityId, customerName) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9500;display:flex;justify-content:center;align-items:center;padding:2rem;';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        overlay.innerHTML = `
            <div style="background:var(--bg-card,#1a1b2e);border:1px solid rgba(255,255,255,0.1);border-radius:18px;max-width:400px;width:100%;padding:2rem;text-align:center;">
                <div style="font-size:1.5rem;margin-bottom:0.5rem;">How was your experience?</div>
                <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1.5rem;">Rate your satisfaction from 1 to 5 stars</p>
                <div style="display:flex;justify-content:center;gap:8px;margin-bottom:1.2rem;" id="csat-stars">
                    ${[1,2,3,4,5].map(n => `<button onclick="selectCSATStar(${n})" style="background:none;border:none;font-size:2rem;cursor:pointer;opacity:0.3;transition:all 0.15s;" data-star="${n}">★</button>`).join('')}
                </div>
                <textarea id="csat-comment" placeholder="Any additional feedback? (optional)" style="width:100%;height:60px;padding:8px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.1);color:var(--text-primary);font-size:0.85rem;resize:none;margin-bottom:1rem;"></textarea>
                <button id="csat-submit-btn" disabled onclick="submitCSAT('${entityType}','${entityId}','${(customerName||'').replace(/'/g,"\\'")}')" style="width:100%;padding:0.7rem;border-radius:10px;background:var(--theme-color);color:#fff;border:none;font-weight:600;font-size:0.9rem;cursor:pointer;opacity:0.5;">Submit Rating</button>
            </div>`;

        document.body.appendChild(overlay);
        window._csatOverlay = overlay;
        window._csatRating = 0;
    };

    window.selectCSATStar = function(n) {
        window._csatRating = n;
        document.querySelectorAll('#csat-stars button').forEach(btn => {
            const star = parseInt(btn.getAttribute('data-star'));
            btn.style.opacity = star <= n ? '1' : '0.3';
            btn.style.color = star <= n ? '#f59e0b' : 'inherit';
        });
        const submitBtn = document.getElementById('csat-submit-btn');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = '1'; }
    };

    window.submitCSAT = async function(entityType, entityId, customerName) {
        const rating = window._csatRating;
        const comment = document.getElementById('csat-comment')?.value || '';
        if (!rating) return;

        try {
            await supabaseClient.from('csat_ratings').insert({
                org_id: currentUserOrgId,
                entity_type: entityType,
                entity_id: entityId,
                rating: rating,
                comment: comment || null,
                customer_name: customerName || null
            });

            // Update ticket CSAT if applicable
            if (entityType === 'ticket') {
                await supabaseClient.from('tickets').update({ csat_rating: rating, csat_comment: comment || null }).eq('id', entityId);
            }

            showToast('Thank you for your feedback!', 'success');
        } catch (e) { showToast('Rating saved locally', 'info'); }

        if (window._csatOverlay) window._csatOverlay.remove();
    };

    // CSAT Dashboard Widget
    window.dashRenderCSATWidget = async function() {
        let container = document.getElementById('dash-csat-widget');
        if (!container) {
            const secondary = document.getElementById('dash-secondary-section') || document.getElementById('dashboard');
            if (!secondary) return;
            container = document.createElement('div');
            container.id = 'dash-csat-widget';
            container.className = 'dash-trend-widget';
            container.style.cssText = 'margin-top:1rem;';
            secondary.appendChild(container);
        }
        if (!currentUserOrgId) return;

        try {
            const { data, error } = await supabaseClient.rpc('get_csat_summary', { p_org_id: currentUserOrgId, p_days: 30 });
            if (error || !data || !data[0]) throw new Error('No CSAT data');

            const s = data[0];
            const starBar = [5,4,3,2,1].map(n => {
                const count = s[['','one','two','three','four','five'][n] + '_star'] || 0;
                const pct = s.total_ratings > 0 ? Math.round((count / s.total_ratings) * 100) : 0;
                return `<div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;">
                    <span style="width:12px;color:var(--text-secondary);">${n}★</span>
                    <div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.06);"><div style="height:100%;width:${pct}%;border-radius:3px;background:#f59e0b;"></div></div>
                    <span style="width:28px;color:var(--text-secondary);text-align:right;">${pct}%</span>
                </div>`;
            }).join('');

            container.innerHTML = `
                <div style="padding:1.2rem;">
                    <div style="font-weight:700;font-size:0.95rem;margin-bottom:0.8rem;color:var(--text-primary);">Customer Satisfaction (30 days)</div>
                    <div style="display:flex;gap:1.5rem;align-items:center;margin-bottom:1rem;">
                        <div style="text-align:center;">
                            <div style="font-size:2.2rem;font-weight:800;color:#f59e0b;">${s.avg_rating || '--'}</div>
                            <div style="font-size:0.72rem;color:var(--text-secondary);">Avg Rating</div>
                        </div>
                        <div style="flex:1;">${starBar}</div>
                    </div>
                    <div style="display:flex;gap:1rem;justify-content:center;">
                        <div style="text-align:center;"><span style="font-weight:700;color:var(--text-primary);">${s.total_ratings}</span><div style="font-size:0.68rem;color:var(--text-secondary);">Total</div></div>
                        <div style="text-align:center;"><span style="font-weight:700;color:#10b981;">${s.satisfaction_pct}%</span><div style="font-size:0.68rem;color:var(--text-secondary);">Satisfied</div></div>
                    </div>
                </div>`;
        } catch (e) {
            container.innerHTML = '<div style="padding:1.2rem;"><div style="font-weight:700;font-size:0.95rem;color:var(--text-primary);margin-bottom:0.5rem;">Customer Satisfaction</div><div style="font-size:0.82rem;color:var(--text-secondary);">No ratings yet. CSAT prompts will appear after ticket resolution.</div></div>';
        }
    };

    // ==========================================
    //   SPRINT 23: UNIVERSAL EXPORT
    // ==========================================
    window.exportToCSV = function(data, filename) {
        if (!data || data.length === 0) { showToast('No data to export', 'info'); return; }
        const headers = Object.keys(data[0]);
        const csvContent = [
            headers.join(','),
            ...data.map(row => headers.map(h => {
                let val = row[h];
                if (val === null || val === undefined) val = '';
                val = String(val).replace(/"/g, '""');
                if (val.includes(',') || val.includes('"') || val.includes('\n')) val = `"${val}"`;
                return val;
            }).join(','))
        ].join('\n');

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported ${data.length} rows`, 'success');
    };

    window.exportTickets = async function() {
        const { data } = await supabaseClient.from('tickets').select('ticket_number, subject, status, priority, category, customer_name, customer_email, customer_phone, assigned_to, csat_rating, created_at, resolved_at').eq('org_id', currentUserOrgId).order('created_at', { ascending: false });
        exportToCSV(data || [], 'tickets');
    };

    window.exportConversations = async function() {
        const { data } = await supabaseClient.from('inbox_conversations').select('id, platform, ai_paused, last_sentiment, detected_language, created_at, updated_at').eq('org_id', currentUserOrgId).order('updated_at', { ascending: false }).limit(500);
        exportToCSV(data || [], 'conversations');
    };

    window.exportSentimentReport = async function() {
        const { data } = await supabaseClient.from('sentiment_daily_stats').select('*').eq('org_id', currentUserOrgId).order('date', { ascending: false }).limit(90);
        exportToCSV(data || [], 'sentiment_report');
    };

    window.exportCSATRatings = async function() {
        const { data } = await supabaseClient.from('csat_ratings').select('entity_type, rating, comment, customer_name, created_at').eq('org_id', currentUserOrgId).order('created_at', { ascending: false });
        exportToCSV(data || [], 'csat_ratings');
    };

    // ==========================================
    //   SPRINT 24: SLA POLICY MANAGEMENT UI
    // ==========================================
    window.renderSLAPolicies = async function(container) {
        if (!container || !currentUserOrgId) return;

aragraph        try {
            let { data: policies, error } = await supabaseClient.from('sla_policies').select('*').eq('org_id', currentUserOrgId).order('priority');

            // If no policies, seed defaults
            if (!error && (!policies || policies.length === 0)) {
                const defaults = [
                    { priority: 'urgent', response_time_minutes: 15, resolution_time_minutes: 120 },
                    { priority: 'high', response_time_minutes: 60, resolution_time_minutes: 480 },
                    { priority: 'medium', response_time_minutes: 240, resolution_time_minutes: 1440 },
                    { priority: 'low', response_time_minutes: 480, resolution_time_minutes: 2880 },
                ];
                for (const d of defaults) {
                    await supabaseClient.from('sla_policies').insert({ org_id: currentUserOrgId, ...d }).onConflict('org_id,priority').ignore();
                }
                const res = await supabaseClient.from('sla_policies').select('*').eq('org_id', currentUserOrgId).order('priority');
                policies = res.data || [];
            }

            const pColors = { urgent: '#ef4444', high: '#f97316', medium: '#3b82f6', low: '#9ca3af' };
            const formatTime = (mins) => {
                if (mins < 60) return `${mins}m`;
                if (mins < 1440) return `${Math.round(mins/60)}h`;
                return `${Math.round(mins/1440)}d`;
            };

            container.innerHTML = `
                <div style="font-weight:700;font-size:0.95rem;color:var(--text-primary);margin-bottom:0.8rem;">SLA Policies</div>
                <p style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:1rem;">Define response and resolution time targets per priority level.</p>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0.8rem;">
                    ${(policies || []).map(p => `
                        <div style="padding:1rem;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-top:3px solid ${pColors[p.priority] || '#64748b'};">
                            <div style="font-weight:700;font-size:0.9rem;color:${pColors[p.priority]};text-transform:capitalize;margin-bottom:0.6rem;">${p.priority}</div>
                            <div style="display:flex;flex-direction:column;gap:0.5rem;">
                                <div>
                                    <label style="font-size:0.72rem;color:var(--text-secondary);display:block;margin-bottom:2px;">First Response</label>
                                    <input type="number" value="${p.response_time_minutes}" min="1" style="width:100%;padding:6px 8px;border-radius:6px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.1);color:var(--text-primary);font-size:0.82rem;" onchange="updateSLA('${p.id}','response_time_minutes',this.value)">
                                    <span style="font-size:0.65rem;color:var(--text-secondary);">minutes (${formatTime(p.response_time_minutes)})</span>
                                </div>
                                <div>
                                    <label style="font-size:0.72rem;color:var(--text-secondary);display:block;margin-bottom:2px;">Resolution</label>
                                    <input type="number" value="${p.resolution_time_minutes}" min="1" style="width:100%;padding:6px 8px;border-radius:6px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.1);color:var(--text-primary);font-size:0.82rem;" onchange="updateSLA('${p.id}','resolution_time_minutes',this.value)">
                                    <span style="font-size:0.65rem;color:var(--text-secondary);">minutes (${formatTime(p.resolution_time_minutes)})</span>
                                </div>
                            </div>
                        </div>`).join('')}
                </div>`;
        } catch (e) {
            container.innerHTML = '<div style="font-size:0.82rem;color:var(--text-secondary);">Run the ticketing SQL migration to configure SLA policies.</div>';
        }
    };

    window.updateSLA = async function(id, field, value) {
        await supabaseClient.from('sla_policies').update({ [field]: parseInt(value) }).eq('id', id);
        showToast('SLA updated', 'success');
    };

    // ==========================================
    //   SPRINT 25: AUDIT LOG DASHBOARD
    // ==========================================
    window.renderAuditLogDashboard = async function(container) {
        if (!container || !currentUserOrgId) return;

        try {
            const { data: logs, error } = await supabaseClient
                .from('dcc_audit_logs')
                .select('*')
                .eq('org_id', currentUserOrgId)
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) throw error;

            const actionIcons = {
                login: '🔑', logout: '🚪', password_change: '🔒',
                role_changed: '👤', member_added: '➕', member_removed: '➖',
                agent_updated: '🤖', integration_connected: '🔗', settings_changed: '⚙️'
            };

            container.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                    <div>
                        <h3 style="margin:0;font-size:1.05rem;color:var(--text-primary);">Audit Log</h3>
                        <p style="margin:3px 0 0;font-size:0.78rem;color:var(--text-secondary);">Security and activity history for your organization</p>
                    </div>
                    <button class="pill-btn" onclick="exportAuditLog()" style="font-size:0.78rem;">📥 Export</button>
                </div>
                <div style="max-height:500px;overflow-y:auto;">
                    ${(!logs || logs.length === 0) ? '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">No audit entries yet.</div>' :
                    logs.map(log => {
                        const icon = actionIcons[log.action] || '📋';
                        const time = new Date(log.created_at);
                        const timeStr = time.toLocaleString();
                        const userName = log.user_email || log.user_id?.substring(0, 8) || 'System';
                        return `
                        <div style="display:flex;gap:10px;align-items:flex-start;padding:0.6rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                            <span style="font-size:1rem;flex-shrink:0;margin-top:2px;">${icon}</span>
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:0.85rem;color:var(--text-primary);"><strong>${esc(log.action?.replace(/_/g, ' ') || '')}</strong></div>
                                <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:2px;">
                                    ${esc(userName)} · ${timeStr}
                                    ${log.details ? ` · ${esc(typeof log.details === 'string' ? log.details : JSON.stringify(log.details).substring(0, 80))}` : ''}
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>`;
        } catch (e) {
            container.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);font-size:0.82rem;">Audit log not available.</div>';
        }
    };

    window.exportAuditLog = async function() {
        const { data } = await supabaseClient.from('dcc_audit_logs').select('action, user_email, user_id, details, ip_address, created_at').eq('org_id', currentUserOrgId).order('created_at', { ascending: false }).limit(1000);
        exportToCSV(data || [], 'audit_log');
    };

    if (typeof window.esc !== 'function') {
        window.esc = function(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
    }
})();
