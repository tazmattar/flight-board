# VATSIM Event Ticker — Implementation Guide

A slim scrolling ticker bar that appears just above the footer whenever the currently-viewed airport is tagged in an active or upcoming (≤ 24 h) VATSIM event. Hidden automatically when there are no relevant events.

---

## Overview of Changes

1. **`app.py`** — cache helper + `GET /api/events` route
2. **`templates/index.html`** — ticker HTML between main board and footer
3. **`static/css/style.css`** — ticker layout + CSS scroll animation
4. **`static/js/app.js`** — `updateEventTicker()` function + call from `updateTheme()`

---

## 1. Update `app.py`

### 1a. Add cache helper (near other module-level globals, around line 22)

```python
_events_cache = {'data': [], 'fetched_at': 0}
EVENTS_CACHE_TTL = 15 * 60  # 15 minutes

def fetch_vatsim_events():
    """Fetch and cache VATSIM events. Returns raw list of event dicts."""
    now = time.time()
    if now - _events_cache['fetched_at'] < EVENTS_CACHE_TTL:
        return _events_cache['data']
    try:
        resp = requests.get('https://vatsim.net/api/events', timeout=8)
        resp.raise_for_status()
        _events_cache['data'] = resp.json()
        _events_cache['fetched_at'] = now
    except Exception as e:
        app.logger.warning(f'VATSIM events fetch failed: {e}')
    return _events_cache['data']
```

`time`, `requests`, `datetime`, and `timedelta` are all already available in app.py.

### 1b. Add route (alongside other `/api/` routes)

```python
@app.route('/api/events')
def get_events():
    icao = request.args.get('icao', '').upper()
    all_events = fetch_vatsim_events()

    now = datetime.utcnow()
    cutoff = now + timedelta(hours=24)

    relevant = []
    for ev in all_events:
        # Time filter: active now OR starting within 24 h
        try:
            start = datetime.fromisoformat(ev['startTime'].replace('Z', ''))
            end   = datetime.fromisoformat(ev['endTime'].replace('Z', ''))
        except (KeyError, ValueError):
            continue
        if end < now or start > cutoff:
            continue
        # Airport filter (match against airports[] array only)
        icao_list = [a['icao'].upper() for a in ev.get('airports', [])]
        if icao and icao not in icao_list:
            continue
        relevant.append({
            'name':  ev.get('name', ''),
            'start': ev['startTime'],
            'end':   ev['endTime'],
            'link':  ev.get('link', ''),
        })

    return jsonify({'events': relevant})
```

---

## 2. Update `templates/index.html`

Insert the ticker div **between** the closing `</div></div>` of the main split-board content and the `<footer>` tag (around line 135):

```html
<div id="eventTicker" class="event-ticker" style="display:none">
    <span class="event-ticker-label">EVENT</span>
    <div class="event-ticker-window">
        <div class="event-ticker-track" id="eventTickerTrack"></div>
    </div>
</div>
```

---

## 3. Update `static/css/style.css`

Append this block before the final responsive `@media` block at the bottom of the file:

```css
/* ---- EVENT TICKER ---- */
.event-ticker {
    display: flex;
    align-items: center;
    height: 26px;
    background-color: #1a1a2e;
    border-top: 1px solid #2a2a4a;
    overflow: hidden;
    flex-shrink: 0;
}

.event-ticker-label {
    flex-shrink: 0;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 2px;
    color: #f9a800;
    padding: 0 10px;
    border-right: 1px solid #2a2a4a;
    height: 100%;
    display: flex;
    align-items: center;
}

.event-ticker-window {
    flex: 1;
    overflow: hidden;
    height: 100%;
    position: relative;
}

.event-ticker-track {
    display: inline-flex;
    white-space: nowrap;
    height: 100%;
    align-items: center;
    animation: ticker-scroll linear infinite;
    animation-play-state: running;
}

.event-ticker-track:hover {
    animation-play-state: paused;
}

.event-ticker-item {
    font-size: 0.78rem;
    color: #e0e0e0;
    padding: 0 40px;
}

.event-ticker-item .ticker-star {
    color: #f9a800;
    margin-right: 6px;
}

@keyframes ticker-scroll {
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
}
```

The `-50%` trick: the track content is duplicated in JS so its total width is exactly double, making the loop seamless with no jump.

---

## 4. Update `static/js/app.js`

### 4a. Add `updateEventTicker()` function

Add this near the other footer-update helpers (e.g. after `updateSecurityTime`, around line 943):

```javascript
async function updateEventTicker(airportCode) {
    const ticker = document.getElementById('eventTicker');
    const track  = document.getElementById('eventTickerTrack');
    if (!ticker || !track) return;

    try {
        const resp = await fetch(`/api/events?icao=${airportCode}`);
        const { events } = await resp.json();

        if (!events || events.length === 0) {
            ticker.style.display = 'none';
            return;
        }

        // Build item HTML
        const items = events.map(ev => {
            const start = new Date(ev.start);
            const end   = new Date(ev.end);
            const pad   = n => String(n).padStart(2, '0');
            const dayStr = start.toLocaleDateString('en-GB', {
                weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'
            });
            const timeStr = `${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())}–${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}z`;
            return `<span class="event-ticker-item"><span class="ticker-star">★</span>${ev.name} — ${dayStr} ${timeStr}</span>`;
        }).join('');

        // Duplicate for seamless CSS loop
        track.innerHTML = items + items;

        // Scale scroll speed to content length (~80 px/s feels natural)
        const trackWidth = track.scrollWidth / 2;
        const duration   = Math.max(15, trackWidth / 80);
        track.style.animationDuration = `${duration}s`;

        ticker.style.display = 'flex';
    } catch (e) {
        ticker.style.display = 'none';
    }
}
```

### 4b. Call from `updateTheme()`

In the `updateTheme(airportCode)` function, add one line after the existing `updateFlags(airportCode)` call:

```javascript
updateEventTicker(airportCode);
```

This fires on every airport switch and on initial page load.

---

## Verification Checklist

1. `systemctl restart flightboard`
2. Switch to an airport currently tagged in a VATSIM event (check https://vatsim.net/events) — ticker should appear and scroll
3. Switch to an airport with no events — ticker should disappear
4. Hover the ticker — scrolling should pause
5. Check browser console — no fetch errors
6. Check server logs after ~15 min — events should re-fetch automatically (`VATSIM events fetch failed` only appears if the API is down)

---

## Notes

- The `#f9a800` amber and dark-navy background are theme-agnostic; they work acceptably across all existing themes. Per-theme overrides can be added later in each `static/css/themes/<icao>.css` if desired.
- The ticker uses `airports[]` array matching only (not route departure/arrival), as that is what VATSIM explicitly tags per the API spec.
- Events are cached server-side for 15 minutes to avoid hammering the VATSIM API.
