# Agent Handoff Notes

## Session Summary (2026-02-27)

### Git State
- Branch: `main`, remote in sync
- Latest commit: `7d29ecc`

---

## Changes Made This Session

### 1. EDDF (Frankfurt) theme — full implementation

**Files:** `static/css/themes/eddf.css` (new), `static/data/theme_map.json`, `static/js/app.js`, `templates/index.html`

- Added `EDDF` to the airport `<select>` dropdown in `index.html`
- Added `EDDF` to `defaultThemeMap` in `app.js` (fallback if `/api/theme_map` is unavailable)
- `eddf.css` implements a classic **Solari split-flap aesthetic**:
  - Deep black background (`#050505`), Lufthansa yellow (`#F9A800`) for header/footer accents
  - Table text is **off-white** (`#e0e0e0`) — not yellow
  - Status column uses colour-coded text only (no background blocks):
    - Boarding → bright green `#00e600`
    - Delayed / Cancelled / CLOSED → red `#ff3333`
    - All other statuses → white `#e0e0e0`
  - Subtle 1px split-line at 50% of each `.flap-container` via `::after`
  - Gate column has minimal padding (`1px`) and no letter-spacing to avoid cutoff
  - **Pulsing animations disabled** (`badge-pulse`, status opacity transition) — split-flap handles all transitions
  - **ATC widget pulse re-enabled** — `!important` removed from `.widget-icon` colour so the `radar-pulse` animation can override it to green when ATC is online

---

### 2. Split-flap animation module

**File:** `static/js/split_flap.js` (new)

- Loaded before `app.js` in `index.html`
- Exposes `window.SplitFlap.animateContainer(container, newText)`
- **Only activates when `body.theme-eddf` is present** — all other themes get plain `textContent` updates (and any leftover spans are cleaned up on theme switch)
- Each `.flap-container` is broken into individual `.sf-char` `<span>` elements
- Characters cycle through the Solari glyph order (`SPACE → A-Z → 0-9 → punctuation`) before landing on target
- Long journeys capped at `MAX_STEPS = 10` to keep animation snappy
- Left-to-right stagger wave: 28 ms offset per character position
- `app.js` integration:
  - `updateFlapText()` delegates to `SplitFlap.animateContainer` when available
  - `updateStatusWithFade()` uses split-flap path for EDDF (instant colour change, animated text); keeps opacity-fade for all other themes
- `@keyframes sf-flip` in `eddf.css`: `scaleY` collapses to 0 at midpoint with `brightness(2)` flash — simulates the metal flap catching light

---

### 3. Cache-busting for dynamically loaded theme CSS

**Files:** `templates/index.html`, `static/js/app.js`

- `asset_version` (Unix timestamp, set server-side) is exposed as `window.ASSET_VERSION` via an inline `<script>` tag in `index.html`
- `updateTheme()` in `app.js` appends `?v=<ASSET_VERSION>` when setting `themeLink.href`
- Prevents Cloudflare from serving stale cached versions of theme CSS after updates

---

### 4. EDDF check-in desk logic

**File:** `checkin_assignments.py`

Added `_frankfurt()` method and routing in `get_checkin_desk()`:

| Hall / Terminal | Desk format | Airlines |
|---|---|---|
| Terminal 1, Hall A | `A01`–`A28` | Lufthansa group + Star Alliance (DLH, SWR, AUA, SAS, BEL, LOT, TAP, ACA, THA, ANA, SIA…) |
| Terminal 1, Hall B | `B01`–`B36` | Long-haul non-Star (BAW, AAL, UAL, QFA, CPA, JAL, KAL, UAE, QTR, ETD…) |
| Terminal 2 | `201`–`250` | SkyTeam + low-cost (KLM, AFR, DAL, AFL, RYR, EZY, EJU, WZZ…) |
| Terminal 1, Hall C | `C01`–`C60` | European / charter / regional (fallback) |

---

### 5. Service management fix

- Discovered two conflicting systemd service files: `flightboard.service` (the real one, always enabled) and `flight-board.service` (a duplicate that was never the active one)
- `flight-board.service` was **disabled and deleted**
- Correct restart command: `systemctl restart flightboard`
- The Cloudflare tunnel (`cloudflared.service`) runs separately and reconnects automatically — do not restart it unless the tunnel itself is broken

---

## Architecture Reminders (carried forward)
- Stand matching: radius-only geofencing in `find_stand()` (Priority 2)
- UK airports only: UKCP API checked first (Priority 1), geofencing as fallback
- `static/stands.json` is the single source of truth for stand coordinates/radii
- Admin API: `GET/POST /api/admin/stands/<icao>` — hot-reloads stands on save (no restart needed)
- Any airport with stands must be in `configured_airports` with `has_stands: True`
- `col-gate` class on gate `<td>` is a styling hook — no base CSS, theme-scoped only
- `data/` directory (traffic stats, custom_airports.json) and `static/stands.json` are runtime files, **not committed to git**
- `static/data/theme_map.json` is also runtime — don't commit it

---

## Known Remaining Issues (carried forward)
### RJTT, KJFK stand coordinate accuracy
Stands at these airports were originally imported from OSM and many coordinates
are offset from real parking positions by 30–80m. With a default radius of 40m
this means aircraft at the correct gate don't always get a match.

**Recommended fix**: replace OSM-derived coordinates with accurate data from
Google Earth or AIP charts, imported via the admin CSV import tool.
