# CSS Modular Structure

## Current State
All CSS (~18,683 lines) is embedded in `index.html` inside a single `<style>` tag.

## Target Structure
```
src/styles/
├── variables.css       # CSS custom properties (--bg-dark, --theme-color, etc.)
├── base.css            # Reset, typography, scrollbars, global styles
├── layout.css          # App layout, sidebar, topbar, mobile-top-bar
├── components/
│   ├── buttons.css     # .login-btn, .lp-btn, social-btn, etc.
│   ├── cards.css       # .card, .glass, feature cards, stat cards
│   ├── modals.css      # Modal overlays, dialogs, drawers
│   ├── forms.css       # Inputs, selects, textareas, toggles
│   ├── tables.css      # Data tables, lead tables
│   ├── chips.css       # Status chips, badges, tags
│   └── toasts.css      # Toast notifications
├── modules/
│   ├── landing.css     # #landing-page and all lp-* classes
│   ├── login.css       # #login-container, .login-card, auth styles
│   ├── dashboard.css   # Dashboard widgets, KPI cards, charts
│   ├── inbox.css       # AI Inbox, message bubbles, conversation list
│   ├── agents.css      # Agent config, test chat, knowledge base
│   ├── crm.css         # CRM views (table, grid, pipeline, dashboard)
│   ├── orders.css      # Order management, status tracking
│   ├── tasks.css       # Task manager, .tm-* classes
│   ├── content.css     # Content Studio, post scheduling
│   ├── reviews.css     # Reviews management
│   ├── automation.css  # Automation rules
│   ├── team.css        # Team management, RBAC, permissions
│   ├── billing.css     # Pricing modal, plan cards, addons
│   └── settings.css    # Organization settings, integrations
└── responsive.css      # All @media queries consolidated
```

## How to extract (for developer)
1. Search `index.html` for CSS section markers like `/* --- SIDEBAR NAVIGATION --- */`
2. Key CSS boundaries in index.html:
   - Variables/theme: lines ~3715-3800
   - Login styles: lines ~6187-6518
   - Landing page: lines ~6519-6680
   - Sidebar: lines ~6680-7200
   - Dashboard: lines ~7200-8500
   - Inbox: lines ~8500-9000
   - CRM/Leads: lines ~9000-9200
   - Task Manager (.tm-*): lines ~22075-22340
   - General components: scattered throughout
3. Extract each section into its matching file
4. Create a main.css that imports all:
   ```css
   @import './variables.css';
   @import './base.css';
   @import './layout.css';
   /* ...etc */
   ```
5. In index.html, replace the `<style>` block with:
   ```html
   <link rel="stylesheet" href="./src/styles/main.css">
   ```
