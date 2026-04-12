/**
 * Application Configuration
 *
 * All environment-specific values consolidated in one place.
 * When migrating to Vite build, replace hardcoded values with:
 *   import.meta.env.VITE_SUPABASE_URL
 *
 * For now, these are also set on `window.*` for backward compatibility
 * with the monolithic index.html code.
 */

export const SUPABASE_URL = 'https://xrycghxaxqzvkmzqzzkx.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyeWNnaHhheHF6dmttenF6emt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxMjg3NjIsImV4cCI6MjA4MzcwNDc2Mn0.-03VhRZ6ok6Z6NykuJxNLnoHmO2SSv1JSm8VM18yVgU';

export const PUSH_VAPID_PUBLIC_KEY = 'BKc68-GOg13z1Hng83tJbrldQKKouTaGyyZ2ZtYG9wXS94Sw9ofcPj2SYTiyfwJiN0B1XmUMCNMWchhZqJD4FiY';

export const WEBHOOKS = {
    INSIGHTS: 'https://n8n.srv1174105.hstgr.cloud/webhook/insightsgrab',
    AI_HELPER: 'https://n8n.srv1174105.hstgr.cloud/webhook/ai-helper',
    WEBSITE_CHAT: 'https://n8n.srv1174105.hstgr.cloud/webhook/website_chat_digitivia',
};

export const WHATSAPP_CONTACT_URL = 'https://wa.me/201211400092';

// Feature flags
export const FEATURES = {
    STRIPE_CHECKOUT_ENABLED: true,
    PUSH_NOTIFICATIONS_ENABLED: true,
};
