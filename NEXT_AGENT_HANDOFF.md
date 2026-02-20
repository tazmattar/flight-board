# Agent Handoff Notes

## Session Summary (2026-02-20)

### Git State
- Branch: `main`, remote in sync
- Latest commit: `0d308a7`

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

### 3. Three stand/gate assignment bugs fixed (commit 138448f)

`vatsim_fetcher.py`

**Bug 1 — `find_stand()` threshold too strict**
- Was: `groundspeed > 5` — VATSIM commonly reports 6–10 knots for truly parked
  aircraft, so geofencing was skipped and no gate was ever assigned
- Fixed: raised to `groundspeed > 15`

**Bug 2 — Stationary aircraft incorrectly shown as Taxiing**
- Was: hardcoded `return 'Taxiing'` for any `gs < 1` aircraft at an airport that
  has stand data but no gate match (comment in code even said `# Hardcoded`)
- Fixed: `gs < 1` now always returns `Check-in` (< 5 min online) or `Boarding`
  regardless of gate match. A stationary aircraft is never Taxiing.

**Bug 3 — Gate display showed CLOSED during Pushback**
- Was: `gate_display = 'CLOSED'` for Pushback, Taxiing, Departing, En Route
- Fixed: Pushback now shows the stand name (aircraft just left it). Only Taxiing,
  Departing, and En Route show CLOSED.

---

### 4. EHAM gate assignment fixed (commit 0d308a7)

`vatsim_fetcher.py`

**Bug — EHAM missing from `configured_airports`**
- EHAM was not in the `configured_airports` dict, so `has_stands` was always
  `False` for Schiphol. `find_stand()` was never called despite 269 stands in
  stands.json.
- Fixed: added `'EHAM': { 'name': 'Amsterdam Schiphol', 'ceiling': 6000, 'has_stands': True }`
- Verified: AEE341 was 4.6m from B31 centre — coordinates accurate (Google Earth)

**Important pattern**: any airport with stands in `stands.json` must also have an
entry in `configured_airports` with `has_stands: True`, otherwise geofencing is
silently skipped. The admin UI hot-reloads stands on save (no restart needed).

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
- `data/` directory (traffic stats) and `static/stands.json` are runtime files,
  not committed to git
