(function() {
    // Sidebar Usage Meter
    window.loadUsageMeter = async function() {
        const meter = document.getElementById('sidebar-usage-meter');
        if (!meter || !window.currentUserOrgId) return;

        try {
            const { data: usage } = await supabaseClient
                .from('org_usage')
                .select('conversations_used, period_start, period_end, coins_used, coins_total, is_balance_finished, is_low_balance')
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
                    .select('plan_name, limits')
                    .eq('id', sub.plan_id)
                    .maybeSingle();
                if (plan) {
                    planName = plan.plan_name || 'Starter';
                    let limits = plan.limits || null;
                    if (typeof limits === 'string') {
                        try { limits = JSON.parse(limits); } catch (e) {}
                    }
                    planLimit = limits?.conversations_limit || limits?.conversationsLimit || 5000;
                }
            }

            const used = usage?.conversations_used || 0;
            const pct = Math.min(100, Math.round((used / planLimit) * 100));

            document.getElementById('usage-plan-label').textContent = planName;
            document.getElementById('usage-count-label').textContent = `${used.toLocaleString()} / ${planLimit.toLocaleString()}`;

            const bar = document.getElementById('usage-bar-fill');
            bar.style.background = 'var(--theme-color)';
            bar.style.width = pct + '%';
            if (pct > 80) bar.style.background = '#f59e0b';
            if (pct > 95) bar.style.background = '#ef4444';

            // ── Coin balance row (shown only when coins_total > 0) ──
            const coinsUsed  = Number(usage?.coins_used  ?? 0);
            const coinsTotal = Number(usage?.coins_total ?? 0);
            const isFinished = !!usage?.is_balance_finished;
            const isLow      = !!usage?.is_low_balance;

            let coinRow = document.getElementById('sidebar-coin-row');

            if (coinsTotal > 0) {
                const coinPct  = Math.min(100, Math.round((coinsUsed / coinsTotal) * 100));
                const coinColor = isFinished ? '#ef4444' : isLow ? '#f59e0b' : 'var(--theme-color)';
                const coinsLeft = coinsTotal - coinsUsed;

                if (!coinRow) {
                    coinRow = document.createElement('div');
                    coinRow.id = 'sidebar-coin-row';
                    coinRow.style.cssText = 'margin-top:6px;';
                    meter.appendChild(coinRow);
                }

                coinRow.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                        <span style="font-size:0.65rem;color:var(--text-secondary);display:flex;align-items:center;gap:3px;">
                            <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" style="opacity:.7"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/></svg>
                            ${coinsLeft.toLocaleString()} coins left
                        </span>
                        <span style="font-size:0.6rem;color:${coinColor};font-weight:600;">${coinPct}%</span>
                    </div>
                    <div style="height:3px;border-radius:2px;background:rgba(255,255,255,0.08);overflow:hidden;">
                        <div style="height:100%;border-radius:2px;background:${coinColor};width:${coinPct}%;transition:width 0.5s ease;"></div>
                    </div>
                    ${isFinished ? `<div style="font-size:0.6rem;color:#ef4444;margin-top:3px;font-weight:600;">Balance exhausted</div>` : ''}
                `;
            } else if (coinRow) {
                coinRow.remove();
            }

            meter.style.display = 'block';
        } catch (e) {
            // Silently fail — tables may not exist yet
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
