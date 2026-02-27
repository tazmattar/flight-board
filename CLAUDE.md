# CLAUDE.md — Flight Board Project

## Service Management
- **Restart:** `systemctl restart flightboard`
- **Status:** `systemctl status flightboard --no-pager`
- There is only ONE service file: `flightboard.service` (no hyphen). A duplicate `flight-board.service` was removed 2026-02-27.
- The Cloudflare tunnel (`cloudflared.service`) runs independently — only restart it if the tunnel itself is broken, not for app changes.

## Runtime files — do NOT commit
- `data/custom_airports.json`
- `data/traffic_stats.json`
- `static/data/theme_map.json`
- `static/stands.json`

## Project Structure
```
app.py                        # Flask app + Socket.IO
checkin_assignments.py        # Check-in desk logic (per airport)
vatsim_fetcher.py             # VATSIM data fetching + stand matching
templates/index.html          # Main FIDS page
templates/admin.html          # Admin panel
static/css/style.css          # Global styles
static/css/themes/            # One CSS file per ICAO code
static/js/app.js              # Main frontend logic
static/js/split_flap.js       # Solari split-flap animation (EDDF only)
static/js/flight_tracking.js  # Flight tracking module
static/js/language_handler.js # Multi-language support
static/data/theme_map.json    # Runtime theme registry (also mirrored in app.js defaultThemeMap)
static/logos/                 # Airline logos
data/                         # Runtime data (not committed)
```

## Adding a New Airport Theme
Each airport theme requires all four of these:
1. CSS file in `static/css/themes/<ICAO>.css`
2. Entry in `static/data/theme_map.json`: `"ICAO": { "css": "/static/css/themes/icao.css", "class": "theme-icao" }`
3. Entry in `defaultThemeMap` in `static/js/app.js` (fallback if API unavailable)
4. `<option value="ICAO">Name</option>` in the `<select>` in `templates/index.html`

Optionally:
- Check-in desk logic in `checkin_assignments.py` → add method + route in `get_checkin_desk()`

## Theme CSS Conventions
- Scope all rules with `body.theme-<icao>` to avoid bleed into other themes
- Status colours use `data-status` attribute on `.col-status` cell — text colour only (no background), with `!important` to beat global `style.css` specificity
- Gate column has class `col-gate` — use it for theme-specific gate cell styling
- Do NOT use `!important` on `.widget-icon` colour — it blocks CSS animations (the ATC radar-pulse needs to override the colour)

## Split-Flap Animation (EDDF only)
- `static/js/split_flap.js` exposes `window.SplitFlap.animateContainer(container, text)`
- Only activates when `body.theme-eddf` is present; all other themes get plain `textContent`
- `app.js` delegates both `updateFlapText()` and `updateStatusWithFade()` to it
- Animation CSS (`@keyframes sf-flip`) lives in `eddf.css`

## Stand Matching
- Priority 1 (UK airports only): UKCP API
- Priority 2: radius-only geofencing via `find_stand()` in `vatsim_fetcher.py`
- `static/stands.json` is the single source of truth for stand coordinates/radii
- Any airport with stands **must** have `has_stands: True` in `configured_airports` — otherwise geofencing is silently skipped
- Admin panel hot-reloads stands on save — no restart needed

## Asset Cache-Busting
- `asset_version` is a Unix timestamp injected server-side into every page render
- Exposed to JS as `window.ASSET_VERSION` via inline script in `index.html`
- All `<script>` and `<link>` tags use `v=asset_version` query param
- `updateTheme()` in `app.js` appends `?v=<ASSET_VERSION>` when loading theme CSS dynamically — prevents Cloudflare from serving stale CSS
