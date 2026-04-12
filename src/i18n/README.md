# i18n Extraction Guide

## Current State
Language dictionaries are embedded in `index.html`:
- `window.LANG_EN` — lines ~125-1250 (base) + extensions via `Object.assign` scattered through lines 2375-3413
- `window.LANG_AR` — lines ~1252-2373 (base) + extensions via `Object.assign` scattered after

## Extraction Steps (for developer)
1. Copy `window.LANG_EN = { ... };` content to `src/i18n/en.json`
2. Copy `window.LANG_AR = { ... };` content to `src/i18n/ar.json`  
3. Find all `Object.assign(window.LANG_EN.*` and merge into `en.json`
4. Find all `window.LANG_EN.* = {` and merge into `en.json`
5. Repeat steps 3-4 for `LANG_AR`
6. Replace the inline dictionaries with:
   ```js
   import en from './src/i18n/en.json';
   import ar from './src/i18n/ar.json';
   window.LANG_EN = en;
   window.LANG_AR = ar;
   ```

## How to find all extensions
```bash
grep -n "Object.assign(window.LANG_EN" index.html
grep -n "Object.assign(window.LANG_AR" index.html
grep -n "window.LANG_EN\." index.html | grep " = {"
grep -n "window.LANG_AR\." index.html | grep " = {"
```
