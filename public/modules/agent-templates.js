(function() {
    let allTemplates = [];
    let currentCategory = 'all';

    window.openTemplatesModal = async function(targetAgentId) {
        window._tplTargetAgent = targetAgentId || null;
        document.getElementById('tpl-modal-overlay').classList.add('active');

        if (allTemplates.length === 0) {
            try {
                const { data, error } = await supabaseClient.from('agent_templates').select('*').order('is_featured', { ascending: false }).order('popularity', { ascending: false });
                if (!error && data) allTemplates = data;
            } catch (e) { console.warn('Failed to load templates:', e); }
        }

        renderTemplateFilters();
        renderTemplateGrid();
    };

    window.closeTemplatesModal = function() {
        document.getElementById('tpl-modal-overlay').classList.remove('active');
    };

    window.closeTemplatePreview = function() {
        document.getElementById('tpl-preview-overlay').classList.remove('active');
    };

    function renderTemplateFilters() {
        const categories = ['all', ...new Set(allTemplates.map(t => t.category))];
        const container = document.getElementById('tpl-filters');
        container.innerHTML = categories.map(cat =>
            `<button class="tpl-filter-btn${cat === currentCategory ? ' active' : ''}" onclick="filterTemplates('${cat}')">${cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}</button>`
        ).join('');
    }

    window.filterTemplates = function(cat) {
        currentCategory = cat;
        renderTemplateFilters();
        renderTemplateGrid();
    };

    function renderTemplateGrid() {
        const filtered = currentCategory === 'all' ? allTemplates : allTemplates.filter(t => t.category === currentCategory);
        const container = document.getElementById('tpl-grid');

        if (filtered.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">No templates available yet. Run the SQL migration to seed templates.</div>';
            return;
        }

        container.innerHTML = filtered.map(t => `
            <div class="tpl-card${t.is_featured ? ' tpl-card-featured' : ''}" onclick="previewTemplate('${t.id}')">
                <div class="tpl-card-icon">${t.icon || '🤖'}</div>
                <h4>${esc(t.name)}</h4>
                <p>${esc(t.description || '')}</p>
                <div class="tpl-card-tags">
                    ${(t.tags || []).slice(0, 3).map(tag => `<span class="tpl-card-tag">${esc(tag)}</span>`).join('')}
                </div>
            </div>
        `).join('');
    }

    window.previewTemplate = function(id) {
        const tpl = allTemplates.find(t => t.id === id);
        if (!tpl) return;

        document.getElementById('tpl-preview-name').textContent = tpl.name;
        document.getElementById('tpl-preview-body').innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:1rem;">
                <span style="font-size:2.5rem;">${tpl.icon || '🤖'}</span>
                <div>
                    <div style="font-weight:700;color:var(--text-primary);">${esc(tpl.name)}</div>
                    <div style="font-size:0.82rem;color:var(--text-secondary);">${esc(tpl.category)} · ${esc(tpl.tone)} tone</div>
                </div>
            </div>
            <p style="font-size:0.88rem;color:var(--text-secondary);line-height:1.5;">${esc(tpl.description || '')}</p>
            <div style="font-weight:600;font-size:0.85rem;color:var(--text-primary);margin:1rem 0 0.4rem;">System Prompt</div>
            <div class="tpl-preview-prompt">${esc(tpl.system_prompt)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:0.8rem;">
                ${(tpl.tags || []).map(tag => `<span class="tpl-card-tag">${esc(tag)}</span>`).join('')}
            </div>
            <button class="tpl-apply-btn" onclick="applyTemplate('${tpl.id}')">Apply to ${window._tplTargetAgent || 'Agent'}</button>
        `;
        document.getElementById('tpl-preview-overlay').classList.add('active');
    };

    window.applyTemplate = function(id) {
        const tpl = allTemplates.find(t => t.id === id);
        if (!tpl) return;

        const agentId = window._tplTargetAgent;
        if (agentId) {
            const promptEl = document.getElementById(`prompt-${agentId}`);
            const toneEl = document.getElementById(`tone-${agentId}`);
            if (promptEl) { promptEl.value = tpl.system_prompt; promptEl.dispatchEvent(new Event('input')); }
            if (toneEl) { toneEl.value = tpl.tone || ''; }
        }

        // Increment popularity
        supabaseClient.from('agent_templates').update({ popularity: (tpl.popularity || 0) + 1 }).eq('id', id).then(() => {});

        closeTemplatePreview();
        closeTemplatesModal();
        showToast(`Template "${tpl.name}" applied! Don't forget to save.`, 'success');
    };

    // Expose esc for templates (may not be in scope)
    if (typeof window.esc !== 'function') {
        window.esc = function(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
    }
})();
