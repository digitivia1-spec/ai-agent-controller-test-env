(function() {
    window.openABTestPanel = async function(agentId) {
        const container = document.getElementById(`ab-test-panel-${agentId}`);
        if (!container) return;

        container.style.display = container.style.display === 'none' ? 'block' : 'none';
        if (container.style.display === 'none') return;

        try {
            const { data: tests } = await supabaseClient
                .from('agent_ab_tests')
                .select('*')
                .eq('org_id', currentUserOrgId)
                .eq('agent_id', agentId)
                .order('created_at', { ascending: false });

            if (!tests || tests.length === 0) {
                container.innerHTML = `
                    <div class="ab-test-card" style="text-align:center;padding:1.5rem;">
                        <p style="color:var(--text-secondary);margin:0 0 1rem;">No A/B tests yet. Create one to optimize your agent's responses.</p>
                        <button class="lp-btn lp-btn-primary" onclick="createABTest('${agentId}')" style="font-size:0.85rem;">Create A/B Test</button>
                    </div>`;
                return;
            }

            container.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.8rem;">
                    <span style="font-weight:600;font-size:0.9rem;color:var(--text-primary);">A/B Tests</span>
                    <button class="lp-btn lp-btn-outline" onclick="createABTest('${agentId}')" style="font-size:0.78rem;padding:4px 12px;">+ New Test</button>
                </div>
                ${tests.map(test => renderABTestCard(test)).join('')}
            `;
        } catch (e) {
            container.innerHTML = '<div style="color:var(--text-secondary);padding:1rem;">Run the A/B testing SQL migration to activate.</div>';
        }
    };

    function renderABTestCard(test) {
        const statusClass = test.status === 'running' ? 'running' : test.status === 'completed' ? 'completed' : 'draft';
        return `
            <div class="ab-test-card">
                <div class="ab-test-header">
                    <h4>${esc(test.name)}</h4>
                    <span class="ab-status-badge ${statusClass}">${test.status}</span>
                </div>
                <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.6rem;">Traffic split: ${test.traffic_split}% A / ${100 - test.traffic_split}% B</div>
                <div class="ab-variants">
                    <div class="ab-variant">
                        <div class="ab-variant-label">Variant A${test.winner === 'a' ? ' 🏆' : ''}</div>
                        <div class="ab-variant-prompt">${esc(test.variant_a_prompt)}</div>
                    </div>
                    <div class="ab-variant">
                        <div class="ab-variant-label">Variant B${test.winner === 'b' ? ' 🏆' : ''}</div>
                        <div class="ab-variant-prompt">${esc(test.variant_b_prompt)}</div>
                    </div>
                </div>
                ${test.status === 'draft' ? `<button class="lp-btn lp-btn-primary" style="width:100%;margin-top:0.8rem;font-size:0.82rem;" onclick="startABTest('${test.id}')">Start Test</button>` : ''}
                ${test.status === 'running' ? `<button class="lp-btn lp-btn-outline" style="width:100%;margin-top:0.8rem;font-size:0.82rem;" onclick="stopABTest('${test.id}')">Stop Test</button>` : ''}
            </div>`;
    }

    window.createABTest = async function(agentId) {
        const promptEl = document.getElementById(`prompt-${agentId}`);
        const currentPrompt = promptEl ? promptEl.value : '';

        const name = prompt('Test name:', 'Tone Comparison Test');
        if (!name) return;

        const variantB = prompt('Variant B prompt (Variant A uses current prompt):', currentPrompt);
        if (!variantB) return;

        try {
            await supabaseClient.from('agent_ab_tests').insert({
                org_id: currentUserOrgId,
                agent_id: agentId,
                name: name,
                variant_a_prompt: currentPrompt,
                variant_b_prompt: variantB,
                traffic_split: 50,
                status: 'draft'
            });
            showToast('A/B test created', 'success');
            openABTestPanel(agentId);
        } catch (e) {
            showToast('Failed to create test: ' + (e.message || ''), 'error');
        }
    };

    window.startABTest = async function(testId) {
        await supabaseClient.from('agent_ab_tests').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', testId);
        showToast('A/B test started', 'success');
        location.reload();
    };

    window.stopABTest = async function(testId) {
        await supabaseClient.from('agent_ab_tests').update({ status: 'completed', ended_at: new Date().toISOString() }).eq('id', testId);
        showToast('A/B test stopped', 'info');
        location.reload();
    };

    if (typeof window.esc !== 'function') {
        window.esc = function(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
    }
})();
