# Metro Prices Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add METRO price export using the user's authorized Metro browser session.

**Architecture:** Register Metro as another DOM supplier. The content script runs on Metro pages, detects logged-out state, drives the normal site search UI, parses visible product rows, and returns CSV-compatible results through the existing background and sidepanel flow.

**Tech Stack:** WXT Chrome extension, TypeScript, React sidepanel, Vitest.

---

### Task 1: Register Metro

**Files:**
- Modify: `src/lib/suppliers/types.ts`
- Modify: `src/lib/suppliers/registry.ts`
- Create: `src/lib/suppliers/metro.adapter.ts`
- Modify: `src/lib/storage/results.ts`
- Modify: `src/entrypoints/content.ts`
- Modify: `wxt.config.ts`

**Steps:**
1. Extend `SupplierId` with `"metro"` and add `SUPPLIERS.metro`.
2. Add `metroAdapter` to the registry.
3. Add Metro host permissions and content-script matches.
4. Include Metro in default selected suppliers.

### Task 2: Metro DOM Behavior

**Files:**
- Create: `src/lib/suppliers/metro.adapter.ts`
- Modify: `src/lib/suppliers/dom-search.ts`

**Steps:**
1. Define Metro selectors for search input, product cards, names, units, prices, product links, add-to-cart buttons, and quantity inputs.
2. Add Metro logged-out detection before the generic "search input exists" login fallback.
3. Keep API endpoint config empty until a same-origin endpoint is verified in DevTools.

### Task 3: Verify

**Commands:**
- `npm run typecheck`
- `npm test`
- `npm run build`

**Expected:** all commands complete without TypeScript, test, or build errors.
