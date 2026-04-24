(function() {
    // ==========================================
    //   ADD LEAD MODAL
    // ==========================================
    window.openAddLeadModal = function() {
        const members = window.orgMembersCache || [];
        const memberOpts = members.map(m => `<option value="${m.user_id}">${esc(m.full_name || m.email)}</option>`).join('');

        const overlay = document.createElement('div');
        overlay.id = 'add-lead-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:8500;display:flex;justify-content:center;align-items:center;padding:1rem;';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        overlay.innerHTML = `
        <div style="background:var(--bg-card,#1a1b2e);border:1px solid rgba(255,255,255,0.1);border-radius:18px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;padding:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:1.2rem 1.5rem;border-bottom:1px solid rgba(255,255,255,0.08);">
                <h3 style="margin:0;font-size:1.05rem;color:var(--text-primary);">Add New Lead</h3>
                <button onclick="document.getElementById('add-lead-overlay').remove()" style="background:none;border:none;color:var(--text-secondary);font-size:1.3rem;cursor:pointer;">✕</button>
            </div>
            <div style="padding:1.2rem 1.5rem;display:flex;flex-direction:column;gap:0.8rem;">
                <!-- Contact -->
                <div style="font-weight:600;font-size:0.82rem;color:var(--theme-color);margin-bottom:-4px;">Contact Information</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;">
                    <div style="grid-column:1/-1;">
                        <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:3px;">Full Name *</label>
                        <input type="text" id="al-full_name" placeholder="John Doe" dir="auto" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.12);color:var(--text-primary);font-size:0.88rem;">
                    </div>
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:3px;">Phone</label>
                        <input type="tel" id="al-phone" placeholder="+1234567890" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.12);color:var(--text-primary);font-size:0.88rem;">
                    </div>
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:3px;">Email</label>
                        <input type="email" id="al-email" placeholder="john@example.com" dir="auto" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.12);color:var(--text-primary);font-size:0.88rem;">
                    </div>
                </div>

                <!-- Classification -->
                <div style="font-weight:600;font-size:0.82rem;color:var(--theme-color);margin-top:0.4rem;margin-bottom:-4px;">Classification</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;">
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:3px;">Status</label>
                        <select id="al-status" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.12);color:var(--text-primary);font-size:0.85rem;">
                            ${LEAD_STATUSES.map(s => `<option value="${s}"${s==='new'?' selected':''}>${s.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:3px;">Source</label>
                        <select id="al-source" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.12);color:var(--text-primary);font-size:0.85rem;">
                            <option value="manual">Manual</option>
                            <option value="whatsapp">WhatsApp</option>
                            <option value="instagram">Instagram</option>
                            <option value="page">Messenger</option>
                            <option value="telegram">Telegram</option>
                            <option value="website">Website</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:3px;">Category</label>
                        <input type="text" id="al-category" placeholder="e.g. Enterprise" dir="auto" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.12);color:var(--text-primary);font-size:0.88rem;">
                    </div>
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:3px;">Priority</label>
                        <select id="al-priority" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.12);color:var(--text-primary);font-size:0.85rem;">
                            <option value="">--</option>
                            <option value="low">Low</option>
                            <option value="medium" selected>Medium</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:3px;">Service Required</label>
                        <input type="text" id="al-service_required" placeholder="e.g. Web Design" dir="auto" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.12);color:var(--text-primary);font-size:0.88rem;">
                    </div>
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:3px;">Persona</label>
                        <input type="text" id="al-persona" placeholder="e.g. Decision Maker" dir="auto" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.12);color:var(--text-primary);font-size:0.88rem;">
                    </div>
                </div>

                <!-- Assignment -->
                <div style="font-weight:600;font-size:0.82rem;color:var(--theme-color);margin-top:0.4rem;margin-bottom:-4px;">Assignment</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;">
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:3px;">Assigned To</label>
                        <select id="al-assigned_to" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.12);color:var(--text-primary);font-size:0.85rem;">
                            <option value="">Unassigned</option>
                            ${memberOpts}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:3px;">Due Date</label>
                        <input type="date" id="al-due_at" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.12);color:var(--text-primary);font-size:0.85rem;">
                    </div>
                </div>

                <!-- Notes -->
                <div>
                    <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:3px;">Notes</label>
                    <textarea id="al-notes" rows="2" dir="auto" placeholder="Any additional context..." style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg-input,rgba(255,255,255,0.06));border:1px solid rgba(255,255,255,0.12);color:var(--text-primary);font-size:0.88rem;resize:vertical;"></textarea>
                </div>

                <!-- Submit -->
                <button onclick="submitAddLead()" style="width:100%;padding:0.75rem;border-radius:10px;background:var(--theme-color);color:#fff;border:none;font-weight:600;font-size:0.92rem;cursor:pointer;margin-top:0.3rem;">Create Lead</button>
            </div>
        </div>`;

        document.body.appendChild(overlay);
        setTimeout(() => document.getElementById('al-full_name')?.focus(), 100);
    };

    window.submitAddLead = async function() {
        const name = document.getElementById('al-full_name')?.value?.trim();
        if (!name) { showToast('Name is required', 'error'); return; }

        const lead = {
            org_id: currentUserOrgId,
            full_name: name,
            phone: document.getElementById('al-phone')?.value?.trim() || null,
            email: document.getElementById('al-email')?.value?.trim() || null,
            status: document.getElementById('al-status')?.value || 'new',
            source: document.getElementById('al-source')?.value || 'manual',
            category: document.getElementById('al-category')?.value?.trim() || null,
            priority: document.getElementById('al-priority')?.value || null,
            service_required: document.getElementById('al-service_required')?.value?.trim() || null,
            persona: document.getElementById('al-persona')?.value?.trim() || null,
            assigned_to_user_id: document.getElementById('al-assigned_to')?.value || null,
            due_at: document.getElementById('al-due_at')?.value || null,
            notes: document.getElementById('al-notes')?.value?.trim() || null,
        };

        try {
            const { error } = await supabaseClient.from('leads').insert(lead);
            if (error) throw error;

            // Fire notification if assigned
            if (lead.assigned_to_user_id && typeof insertCrmNotification === 'function') {
                insertCrmNotification({ orgId: currentUserOrgId, entityId: null, eventKey: 'crm_lead_assigned', title: 'Lead Assigned', body: `Lead "${name}" has been assigned to you.`, recipientUserId: lead.assigned_to_user_id });
            }

            document.getElementById('add-lead-overlay')?.remove();
            showToast('Lead created successfully', 'success');

            // Refresh CRM data
            if (typeof initCrmTab === 'function') initCrmTab();
            else if (typeof fetchLeads === 'function') fetchLeads();
        } catch (e) {
            showToast('Failed: ' + (e.message || 'Unknown error'), 'error');
        }
    };

    // ==========================================
    //   OPEN CHAT FROM LEAD PROFILE
    // ==========================================
    window.openLeadChatFromProfile = function() {
        const lead = window.currentLeadProfileData;
        if (!lead) { showToast('No lead data', 'error'); return; }

        const phone = lead.phone;
        const source = lead.source;

        if (!phone && !source) {
            showToast('No phone or platform for this lead', 'info');
            return;
        }

        // Close the lead profile first
        if (typeof closeLeadProfile === 'function') closeLeadProfile();

        // Open the chat
        if (typeof openLeadChat === 'function') {
            openLeadChat(phone, source);
        }
    };

    // ==========================================
    //   DATE PRESET FILTERING
    // ==========================================
    window.applyCrmDatePreset = function(preset) {
        const fromEl = document.getElementById('crm-date-from');
        const toEl = document.getElementById('crm-date-to');

        if (preset === 'custom') {
            fromEl.style.display = 'block';
            toEl.style.display = 'block';
            return;
        }

        fromEl.style.display = 'none';
        toEl.style.display = 'none';

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let from = null, to = null;

        if (preset === 'today') {
            from = today;
            to = new Date(today.getTime() + 86400000);
        } else if (preset === 'yesterday') {
            from = new Date(today.getTime() - 86400000);
            to = today;
        } else if (preset === '7days') {
            from = new Date(today.getTime() - 7 * 86400000);
            to = new Date(today.getTime() + 86400000);
        } else if (preset === '30days') {
            from = new Date(today.getTime() - 30 * 86400000);
            to = new Date(today.getTime() + 86400000);
        } else if (preset === 'this_month') {
            from = new Date(now.getFullYear(), now.getMonth(), 1);
            to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        } else if (preset === 'last_month') {
            from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            to = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        if (from) fromEl.value = from.toISOString().split('T')[0];
        if (to) toEl.value = to.toISOString().split('T')[0];

        filterAndRenderCrmData();
    };

    // ==========================================
    //   ENHANCED FILTER + SORT
    // ==========================================
    // Override filterCrmRows to include date + sort
    const _origFilterCrmRows = window.filterCrmRows || function(l) { return l; };

    window.filterCrmRows = function(leads) {
        // Apply original filters (search, status, category)
        let filtered = _origFilterCrmRows(leads);

        // Date filter
        const fromVal = document.getElementById('crm-date-from')?.value;
        const toVal = document.getElementById('crm-date-to')?.value;

        if (fromVal) {
            const from = new Date(fromVal);
            filtered = filtered.filter(l => new Date(l.created_at) >= from);
        }
        if (toVal) {
            const to = new Date(toVal);
            to.setDate(to.getDate() + 1); // inclusive
            filtered = filtered.filter(l => new Date(l.created_at) < to);
        }

        // Sort
        const sort = document.getElementById('crm-sort')?.value || 'newest';
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };

        filtered.sort((a, b) => {
            switch (sort) {
                case 'newest': return new Date(b.created_at) - new Date(a.created_at);
                case 'oldest': return new Date(a.created_at) - new Date(b.created_at);
                case 'name_az': return (a.full_name || '').localeCompare(b.full_name || '');
                case 'name_za': return (b.full_name || '').localeCompare(a.full_name || '');
                case 'due_soonest':
                    if (!a.due_at && !b.due_at) return 0;
                    if (!a.due_at) return 1;
                    if (!b.due_at) return -1;
                    return new Date(a.due_at) - new Date(b.due_at);
                case 'priority':
                    return (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99);
                default: return 0;
            }
        });

        return filtered;
    };

    if (typeof window.esc !== 'function') {
        window.esc = function(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
    }
})();
