# Metro Prices Design

Goal: add METRO as a price-export supplier and collect the price visible in the user's existing Chrome login session.

Architecture: reuse the existing content-script supplier pipeline. The Metro adapter runs inside `online.metro-cc.ru`, uses the page search UI and DOM parsing, and never stores credentials, cookies, or tokens. If Metro shows a logged-out state, the background flow pauses like the existing suppliers.

Scope:
- Add `metro` to supplier types, registry, permissions, content-script matches, and default selection.
- Add Metro-specific selectors for search, product rows, product names, visible prices, product links, cart controls, and quantity inputs.
- Add a stricter Metro logged-out check so public prices are not silently exported when the user has not logged in.
- Verify with typecheck, tests, and build.

Risks:
- Metro can change client-side markup; selectors are intentionally broad and may need real-account tuning after first run.
- The adapter exports the first visible product price in the user's rendered Metro page, matching the current extension model.
