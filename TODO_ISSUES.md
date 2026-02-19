# TODO Issues

## [enhancement] Track Flight Mode: Auto-switch board to destination ICAO for selected callsign

### Summary
Add a "Track Flight" mode so a user can select/enter a callsign (e.g. `BAW123`) and have the board automatically switch to that flight's destination airport as the flight progresses.

### Why
Users want a personal tracking experience from departure to arrival without manually changing airports.

### Proposed Behavior (v1)
- Add a UI control to enable tracking by callsign.
- While enabled:
  - Monitor live flight updates for that callsign.
  - Read the tracked flight's `arrival` ICAO from flight plan data.
  - If destination ICAO differs from current board ICAO, auto-switch board to destination.
- Show tracking status in UI:
  - Example: `Tracking BAW123: EGLL -> LEMD`
- Allow user to stop tracking at any time.

### Acceptance Criteria
- User can start tracking with a valid callsign.
- Board auto-switches to destination ICAO when applicable.
- Tracking survives websocket reconnect.
- No rapid/looping airport switches (debounce/cooldown guard).
- Clear fallback when callsign is not found or has no flight plan.

### Technical Notes
- Reuse existing `join_airport` / `leave_airport` flow and dynamic airport loading.
- Keep airport selection persistence compatible with current localStorage/url logic.
- Add guard to switch once per leg unless destination changes.

### Edge Cases
- Callsign disappears temporarily.
- Duplicate callsigns (prefer exact match + most recent active pilot).
- Missing arrival ICAO.
- User manually changes airport while tracking.

### Nice-to-have (later)
- Search/select from currently visible flights instead of free text.
- Pin tracked flight row.
- Follow multi-leg route over time.
