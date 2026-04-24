# CSS Source Layout

## Live code path

The app loads **one** stylesheet — `src/styles/main.css` — wired from
`index.html` via:

```html
<link rel="stylesheet" href="./src/styles/main.css">
```

Vite processes this link at build time (minifies, hashes, outputs to
`dist/assets/main-<hash>.css`).

## Authoritative file

- `src/styles/main.css` (~19k lines, ~600 KB unminified, ~354 KB after
  Vite CSS minify) — the full stylesheet, extracted verbatim from the
  inline `<style>` block that previously lived in `index.html`. This is
  the single source of truth.

Do **not** edit this file to add/fix module-specific styles without
thinking about the cascade order — it is flat and global.

## Aspirational modular structure (not yet wired)

The files below were extracted earlier as part of an in-progress
decomposition, but **none of them are currently loaded by the app**:

```
src/styles/
├── index.css               # @import orchestrator (not linked from HTML)
├── variables.css
├── base.css
├── layout/
│   ├── sidebar.css
│   ├── main.css
│   └── mobile-topbar.css
├── components/
│   ├── glass.css
│   └── toggle.css
└── modules/
    ├── landing.css
    ├── login.css
    ├── billing.css
    ├── billing-toggle.css
    ├── cards.css
    ├── automation.css
    ├── insights.css
    ├── knowledge-base.css
    ├── content-studio.css
    ├── chat.css
    ├── inbox.css
    ├── inbox-search.css
    ├── export.css
    ├── notifications.css
    └── ai-helper.css
```

Notes:
- `src/styles/index.css` imports a `modules/crm.css` that doesn't exist —
  another drift signal from the earlier partial extract.
- The combined line count of the modules (~16k) is smaller than
  `main.css` (~19k) — they're stale snapshots missing the additions that
  accumulated in the inline block over time.

### To finish the decomposition
1. Pick one module (e.g. `modules/billing.css`) and diff its rules
   against the matching section of `main.css`. Reconcile drift.
2. Add `@import './modules/billing.css';` to `index.css`.
3. Remove the corresponding rules from `main.css`.
4. Ship + smoke-test.
5. Repeat for the next module.

When all modules are reconciled, flip `index.html`'s `<link>` to point
at `./src/styles/index.css` and delete `main.css`.
