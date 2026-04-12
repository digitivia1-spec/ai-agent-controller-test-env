# Source Code Decomposition Guide

## Current Architecture
The entire application is a single `index.html` file (~46,335 lines):
- Lines 1-55: `<head>` (meta, scripts, SEO)
- Lines 56-125: Theme init, permission stubs
- Lines 125-3413: i18n dictionaries (EN + AR)
- Lines 3715-22340: CSS (`<style>` block)
- Lines 22340-22800: HTML body (app structure, modals, templates)
- Lines 22800-46335: JavaScript (all app logic in IIFEs)

## Target Module Structure
```
src/
├── main.js              # App entry point, router, auth check
├── config.js            # SUPABASE_URL, SUPABASE_KEY, VAPID, webhook URLs
├── i18n/
│   ├── en.json          # English translations
│   ├── ar.json          # Arabic translations
│   └── loader.js        # i18n initialization, t() function
├── styles/              # Modular CSS (see styles/README.md)
├── modules/
│   ├── auth.js          # Login, signup, OAuth, session management
│   ├── dashboard.js     # Dashboard widgets, KPI cards, charts
│   ├── inbox.js         # AI Inbox, message loading, AI/Human toggle
│   ├── agents.js        # Agent config, system prompts, tones, KB
│   ├── crm.js           # CRM views, lead profiles, filtering
│   ├── orders.js        # Order management, WhatsApp confirmations
│   ├── tasks.js         # Task manager, task CRUD, dashboard
│   ├── content.js       # Content Studio, post scheduling
│   ├── reviews.js       # Google Reviews monitoring
│   ├── automation.js    # Automation rules, follow-ups
│   ├── team.js          # Team management, RBAC, permissions
│   ├── billing.js       # Pricing, Stripe checkout, addons
│   ├── notifications.js # Push notifications, in-app notifications
│   ├── onboarding.js    # Setup wizard, product tour
│   └── settings.js      # Org settings, integrations, legal
└── utils/
    ├── supabase.js      # Supabase client initialization
    ├── toast.js         # showToast() utility
    ├── date.js          # Date formatting, relative dates
    └── helpers.js       # esc(), getOrgMemberName(), etc.
```

## Key Functions by Module (line references from index.html)

### auth.js
- `performLogin()` — Email/password login
- `performSignUp()` — Registration
- `performOAuthLogin()` — Google/LinkedIn OAuth
- `handleLogout()` — Logout and cleanup
- `showApp()` — Post-auth app initialization (~line 26211)

### dashboard.js
- `loadDashboard()` — Load dashboard data
- `renderDashboard()` — Render KPI cards and widgets
- `startAutoRefresh()` — Inbox polling (~line 25939)

### inbox.js
- `loadInbox()` — Load conversations by platform
- `loadInboxMessages()` — Load message thread
- `sendMessage()` — Send human message
- `toggleAIMode()` — AI/Human toggle

### crm.js
- `initCrmTab()` — Initialize CRM (~line 43181)
- `renderCrmGrid()` — Render views (~line 43277)
- `openLeadProfile()` — Lead detail modal (~line 43381)
- `saveLeadExtendedFields()` — Update lead (~line 43612)
- `openLeadChat()` — Navigate to inbox (~line 28234)

### tasks.js
- `loadTaskManager()` — Init task list (~line 44280)
- `openCreateTaskModal()` — Create task (~line 44408)
- `openTaskDetail()` — Task detail modal (~line 44472)
- `updateTaskStatus()` — Status change (~line 44580)
- `renderTaskDashboard()` — Task analytics (~line 44662)

### billing.js
- `openPricingModal()` — Show pricing
- `initiateStripeCheckout()` — Stripe checkout (~line 36027)
- `buyAddon()` — Addon purchase (~line 35948)
- `detectCurrency()` — Geo-based currency (~line 35666)
- `toggleBillingPeriod()` — Monthly/yearly toggle

### notifications.js
- `setupNotifications()` — Init push notifications
- `insertTaskNotification()` — Task notification (~line 43936)
- `insertCrmNotification()` — CRM notification (~line 43638)

## Migration Strategy
1. **Phase 1** (Current): Set up build tooling, create structure, document targets
2. **Phase 2**: Extract utility functions (toast, date, helpers) — lowest risk
3. **Phase 3**: Extract config (Supabase URL, keys) — simple globals
4. **Phase 4**: Extract i18n to JSON — no logic changes needed
5. **Phase 5**: Extract CSS to modular files — visual-only, easy to verify
6. **Phase 6**: Extract JS modules one-by-one, starting with least-connected (billing, reviews)
7. **Phase 7**: Extract core modules (auth, inbox, CRM) — most interconnected, highest risk
