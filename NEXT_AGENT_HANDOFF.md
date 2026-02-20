# Agent Handoff Notes

## Session Summary (2026-02-20)

### Git State
- Branch: `main`, remote in sync
- Latest commit: `bb77ca0`

---

## Changes Made This Session

### 1. Rolled back OSM/buffer work
All commits from the morning's OSM buffer/metadata session (10:24–10:58) were
reverted via `git reset --hard 8d82df8`. The rollback target was the last known-
good commit (mobile CSS fixes, 09:04). The stand matching is back to **radius-only
geofencing** driven purely by each stand's `radius` field in `static/stands.json`.

---

### 2. Admin UI rebuilt (commits 825fa26 → dec22c0 → e9c1e71 → 4bc6539 → 65deb39)

`templates/admin.html`, `static/css/admin.css`, `static/js/admin.js`

- **Full-width layout** — removed `max-width` constraint
- **Tab navigation** — Stand Data / Theme Mapping / Traffic Stats tabs
- **Table-based stand editor** — editable rows (Name, Lat, Lon, Radius, Type)
  with Add/Remove per row; replaces the raw textarea-only editor
- **Raw JSON fallback** — collapsible section for bulk paste/edit; syncs with table
- **CSV import** — Import CSV button, parses `name,lat,lon,radius,type` (header
  required; radius/type optional). Duplicate detection on name field with three
  choices: Skip, Overwrite, Cancel. Imported rows are natural-sorted into position.
- **Natural sort** — stands always sort by name using `localeCompare numeric:true`
  (A1, A2, A10 not A1, A10, A2) on load, import, and JSON apply
- **Fixed status bar** — now `position: fixed` at viewport bottom so save
  confirmations are always visible regardless of scroll depth
- **Login page** — re-centred (margin: auto on `.login-shell`)

---

### 3. Stand/gate assignment bugs fixed (commits 138448f, 78f265b, 4badb7b)

`vatsim_fetcher.py`

**GS threshold** — raised from `> 5` to `> 15` so geofencing runs for slow-taxiing
aircraft that VATSIM reports at 6–10 knots while parked.

**GS=0 on taxiway** — if airport has stand data but no stand matched, a stationary
aircraft now returns `Taxiing` (not `Boarding`). Boarding requires being at a
matched stand or the airport having no stand data at all.

**Pushback gate** — Pushback now shows `CLOSED` (was showing stand name). Gate
shows CLOSED for Pushback, Taxiing, Departing, En Route.

**Status/gate logic summary:**
| GS | Stand match? | Status | Gate |
|---|---|---|---|
| 0, < 5 min online | any | Check-in | TBA |
| 0 | no (airport has stands) | Taxiing | CLOSED |
| 0 | yes | Boarding | stand name |
| 1–4 | yes or squawking | Pushback | CLOSED |
| 1–4 | no | Taxiing | CLOSED |
| 5–44 | — | Taxiing | CLOSED |
| 45+ | — | Departing | CLOSED |

---

### 4. EHAM gate assignment fixed (commit 0d308a7)

`vatsim_fetcher.py`

EHAM was missing from `configured_airports`, so `has_stands` was always `False`
and `find_stand()` was never called despite 269 stands in stands.json.
Fixed: added `'EHAM': { 'name': 'Amsterdam Schiphol', 'ceiling': 6000, 'has_stands': True }`.

**Important pattern**: any airport with stands in `stands.json` must also have an
entry in `configured_airports` with `has_stands: True`, otherwise geofencing is
silently skipped. The admin UI hot-reloads stands on save (no restart needed).

---

### 5. Tracking row outline & airport join stats (commit d4389cd)

- Tracked row outline uses `var(--tracking-outline, #ffffff)`; EHAM overrides to
  `#888888` for visibility on white background
- New visitors defaulting to LSZH no longer inflate its airport join count;
  `getInitialAirport()` returns `{ airport, explicit }` — only explicit selections
  (URL param, localStorage, dropdown change) are recorded

---

### 6. EHAM theme refinements (commits c01892a, 19e1f85, 0bbf45b, bb77ca0, + CSS)

`static/css/themes/eham.css`, `static/js/app.js`

- **Boarding status** — green text (`--schiphol-green` / `#298C43`) on transparent
  background, matching real Schiphol FIDS
- **Gate column** — yellow (`--schiphol-yellow`) fill with black bold text; 3px
  inset padding enforced with `!important` to survive all responsive breakpoints.
  `col-gate` class added to gate `<td>` in JS (no styling in base CSS — safe for
  all other themes)
- **Column header row** — light grey (`--schiphol-row-alt` / `#F1F1F1`) background
  with black text
- **SimFixr logo** — increased to 56px desktop / 36px mobile

---

## Known Remaining Issues

### RJTT, KJFK stand coordinate accuracy
Stands at these airports were originally imported from OSM and many coordinates
are offset from real parking positions by 30–80m. With a default radius of 40m
this means aircraft at the correct gate don't always get a match.

**Recommended fix**: replace OSM-derived coordinates with accurate data from
Google Earth or AIP charts, imported via the admin CSV import tool.

As a quick stopgap, radii for individual stands can be increased to 60–80m via
the admin stand editor to catch aircraft parked slightly off-centre.

Do **not** add a global buffer fallback or per-source special behaviour —
keep matching data-driven via `stands.json` only.

---

## Architecture Reminders
- Stand matching: radius-only geofencing in `find_stand()` (Priority 2)
- UK airports only: UKCP API checked first (Priority 1), geofencing as fallback
- `static/stands.json` is the single source of truth for stand coordinates/radii
- Admin API: `GET/POST /api/admin/stands/<icao>` — hot-reloads stands on save (no restart needed)
- Any airport with stands must be in `configured_airports` with `has_stands: True`
- `col-gate` class on gate `<td>` is a styling hook — no base CSS, theme-scoped only
- `data/` directory (traffic stats) and `static/stands.json` are runtime files,
  not committed to git
