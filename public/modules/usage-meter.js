(function() {
    // Sidebar Usage Meter
    window.loadUsageMeter = async function() {
        const meter = document.getElementById('sidebar-usage-meter');
        if (!meter || !window.currentUserOrgId) return;

        try {
            const { data: usage } = await supabaseClient
                .from('org_usage')
                .select('conversations_used, period_start, period_end')
                .eq('org_id', currentUserOrgId)
                .maybeSingle();

            const { data: sub } = await supabaseClient
                .from('org_subscriptions')
                .select('plan_id, status')
                .eq('org_id', currentUserOrgId)
                .eq('status', 'active')
                .maybeSingle();

            // Get plan details
            let planName = 'Starter';
            let planLimit = 5000;
            if (sub && sub.plan_id) {
                const { data: plan } = await supabaseClient
                    .from('billing_plans')
                    .select('plan_name, conversations_limit')
                    .eq('id', sub.plan_id)
                    .maybeSingle();
                if (plan) {
                    planName = plan.plan_name || 'Starter';
                    planLimit = plan.conversations_limit || 5000;
                }
            }

            const used = usage?.conversations_used || 0;
            const pct = Math.min(100, Math.round((used / planLimit) * 100));

            document.getElementById('usage-plan-label').textContent = planName;
            document.getElementById('usage-count-label').textContent = `${used.toLocaleString()} / ${planLimit.toLocaleString()}`;

            const bar = document.getElementById('usage-bar-fill');
            bar.style.width = pct + '%';
            if (pct > 80) bar.style.background = '#f59e0b';
            if (pct > 95) bar.style.background = '#ef4444';

            meter.style.display = 'block';
        } catch (e) {
            // Silently fail — tables may not exist
        }
    };

    // Load after app initializes
    const origShowApp = window.showApp;
    if (origShowApp) {
        setTimeout(() => {
            if (typeof loadUsageMeter === 'function') loadUsageMeter();
        }, 3000);
    }

    // Landing page: Live activity simulation (uses real-feeling data)
    function updateLiveActivity() {
        const countEl = document.getElementById('lp-live-count');
        if (!countEl) return;
        const hour = new Date().getHours();
        const baseUsers = hour >= 9 && hour <= 22 ? 12 : 4;
        const active = baseUsers + Math.floor(Math.random() * 8);
        countEl.textContent = active;
    }
    updateLiveActivity();
    setInterval(updateLiveActivity, 30000);
})();
