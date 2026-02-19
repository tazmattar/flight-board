# TODO Issues

## [enhancement] Track Flight Mode: Auto-switch board to destination ICAO for selected callsign

### Summary
Add a "Track Flight" mode so a user can click a flight row (e.g. `BAW123`) to pin/track it, and have the board automatically switch to that flight's destination airport as the flight progresses.

### Why
Users want a personal tracking experience from departure to arrival without manually changing airports.
Keep UI clean by avoiding an additional text input box.

### Proposed Behavior (v1)
- Clicking a departure/arrival row toggles tracking for that flight.
- The selected row gets a pinned/active visual state.
- While enabled:
  - Monitor live flight updates for that tracked callsign.
  - Read the tracked flight's `arrival` ICAO from flight plan data.
  - If destination ICAO differs from current board ICAO, auto-switch board to destination.
- Show compact tracking status in UI (non-input chip/badge):
  - Example: `Tracking BAW123: EGLL -> LEMD`
- Allow user to stop tracking by clicking the same row again or using an untrack action on the status chip.
- No new text input field in v1.

### Acceptance Criteria
- User can start tracking by selecting a visible flight row.
- Board auto-switches to destination ICAO when applicable.
- Tracking survives websocket reconnect.
- No rapid/looping airport switches (debounce/cooldown guard).
- Clear fallback when tracked flight disappears or has no arrival ICAO.
- Exactly one tracked flight at a time.

### Technical Notes
- Reuse existing `join_airport` / `leave_airport` flow and dynamic airport loading.
- Keep airport selection persistence compatible with current localStorage/url logic.
- Add guard to switch once per leg unless destination changes.
- Persist tracked callsign in local storage for page refresh recovery.

### Edge Cases
- Callsign disappears temporarily.
- Duplicate callsigns (prefer exact match + most recent active pilot).
- Missing arrival ICAO.
- User manually changes airport while tracking.

### Nice-to-have (later)
- Optional search-based tracking mode for hidden/non-visible flights.
- Follow multi-leg route over time.
