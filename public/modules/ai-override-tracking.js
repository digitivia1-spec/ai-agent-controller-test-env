(function() {
    // Track when humans override AI in the inbox
    // The AI/Human toggle already exists — we track the override signal

    window.trackConversationOverride = async function(conversationId, agentId) {
        if (!currentUserOrgId || !conversationId) return;

        try {
            await supabaseClient.from('conversation_overrides').insert({
                org_id: currentUserOrgId,
                conversation_id: conversationId,
                agent_id: agentId || null,
                overridden_by: window.currentUserObj?.id || null,
                created_at: new Date().toISOString()
            });
        } catch (e) {
            // Table may not exist yet — silent fail
            console.debug('Override tracking:', e.message);
        }
    };

    // Learning dashboard renderer
    window.renderLearningDashboard = async function(agentId) {
        const container = document.getElementById(`learning-panel-${agentId}`);
        if (!container) return;

        try {
            // Get override stats for this agent
            const { data: overrides, error } = await supabaseClient
                .from('conversation_overrides')
                .select('created_at, conversation_id')
                .eq('org_id', currentUserOrgId)
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) throw error;

            const total = overrides?.length || 0;
            const last7Days = (overrides || []).filter(o => new Date(o.created_at) > new Date(Date.now() - 7 * 86400000)).length;
            const uniqueConvos = new Set((overrides || []).map(o => o.conversation_id)).size;

            container.innerHTML = `
                <div style="padding:1rem;">
                    <div style="font-weight:700;font-size:0.95rem;margin-bottom:1rem;color:var(--text-primary);">AI Learning Insights</div>
                    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.8rem;margin-bottom:1rem;">
                        <div style="text-align:center;padding:0.8rem;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);">
                            <div style="font-size:1.4rem;font-weight:800;color:var(--theme-color);">${total}</div>
                            <div style="font-size:0.72rem;color:var(--text-secondary);">Total Overrides</div>
                        </div>
                        <div style="text-align:center;padding:0.8rem;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);">
                            <div style="font-size:1.4rem;font-weight:800;color:${last7Days > 10 ? '#ef4444' : '#10b981'};">${last7Days}</div>
                            <div style="font-size:0.72rem;color:var(--text-secondary);">Last 7 Days</div>
                        </div>
                        <div style="text-align:center;padding:0.8rem;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);">
                            <div style="font-size:1.4rem;font-weight:800;color:var(--text-primary);">${uniqueConvos}</div>
                            <div style="font-size:0.72rem;color:var(--text-secondary);">Conversations</div>
                        </div>
                    </div>
                    <div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.5;">
                        ${total === 0 ? 'No human overrides detected yet. When you switch from AI to Human mode in conversations, the system tracks these corrections to help improve your agent.' :
                        last7Days > 10 ? '⚠️ High override rate this week. Consider reviewing your system prompt or updating your knowledge base.' :
                        '✅ Override rate looks healthy. Your AI agent is handling most conversations well.'}
                    </div>
                </div>`;
        } catch (e) {
            container.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);font-size:0.82rem;">Run the conversation learning migration to activate insights.</div>';
        }
    };
})();
