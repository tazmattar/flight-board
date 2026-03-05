(function () {
    'use strict';

    const AIRPORT = window.MAP_AIRPORT;
    const APT_LAT = window.MAP_AIRPORT_LAT;
    const APT_LON = window.MAP_AIRPORT_LON;
    const APT_NAME = window.MAP_AIRPORT_NAME;

    /* ── Leaflet map ──────────────────────────────────────── */
    const map = L.map('map', {
        center: [APT_LAT, APT_LON],
        zoom: 11,
        zoomControl: false,
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(map);

    // Airport marker
    const airportIcon = L.divIcon({
        className: 'map-airport-icon',
        html: '<div class="map-airport-dot"></div><div class="map-airport-label">' + AIRPORT + '</div>',
        iconSize: [60, 30],
        iconAnchor: [30, 15],
    });
    L.marker([APT_LAT, APT_LON], { icon: airportIcon, interactive: false }).addTo(map);

    /* ── Airline logo resolution (mirrors app.js logic) ──── */
    var virtualAirlines = new Set(['XNO']);
    var airlineMapping = {
        'SWS': 'LX', 'EZY': 'U2', 'EJU': 'U2', 'EZS': 'DS', 'BEL': 'SN',
        'GWI': '4U', 'EDW': 'WK', 'ITY': 'AZ', 'FDX': 'FX', 'UPS': '5X',
        'GEC': 'LH', 'BCS': 'QY', 'SAZ': 'REGA', 'SHT': 'BA'
    };
    var airlineLogoAliasGroups = {
        BA: ['SHT'],
        W6: ['WAU', 'WAZ', 'WIZ', 'WMT', 'WUK', 'WVL', 'WZZ']
    };
    var airlineLogoAliases = {};
    Object.keys(airlineLogoAliasGroups).forEach(function (logoCode) {
        airlineLogoAliasGroups[logoCode].forEach(function (prefix) {
            airlineLogoAliases[prefix.toUpperCase()] = logoCode;
        });
    });
    var localOnlyAirlines = ['FX', 'FDX', 'UPS', '5X', 'REGA', 'SAZ'];

    // Load dynamic airline ICAO→IATA mapping
    fetch('https://cdn.jsdelivr.net/gh/npow/airline-codes@master/airlines.json')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            data.forEach(function (a) {
                if (a.icao && a.iata && a.active === 'Y' && !airlineMapping[a.icao]) {
                    airlineMapping[a.icao] = a.iata;
                }
            });
        })
        .catch(function (e) { console.warn('Airline DB failed', e); });

    function getLogoUrl(callsign) {
        var prefix = (callsign || '').substring(0, 3).toUpperCase();
        var code = airlineLogoAliases[prefix] || airlineMapping[prefix] || prefix;
        if (virtualAirlines.has(prefix)) return { primary: '/static/logos/' + prefix + '.png', secondary: '', tertiary: '' };
        if (localOnlyAirlines.indexOf(code) !== -1) return { primary: '/static/logos/' + code + '.png', secondary: 'https://images.kiwi.com/airlines/64/' + code + '.png', tertiary: 'https://content.r9cdn.net/rimg/provider-logos/airlines/v/' + code + '.png' };
        return { primary: 'https://images.kiwi.com/airlines/64/' + code + '.png', secondary: 'https://content.r9cdn.net/rimg/provider-logos/airlines/v/' + code + '.png', tertiary: '/static/logos/' + code + '.png' };
    }

    /* ── Aircraft markers ─────────────────────────────────── */
    const markers = {};
    let selectedCallsign = null;

    const PLANE_SVG = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="currentColor"/></svg>';

    function flightColor(f) {
        const gs = f.groundspeed || 0;
        const onGround = gs < 50 && (f.altitude || 0) < 500;
        if (onGround) return '#4caf50'; // green — ground
        return f.direction === 'ARR' ? '#42a5f5' : '#ffa726'; // blue arrivals, orange departures
    }

    function makeIcon(f) {
        const color = flightColor(f);
        const heading = f.heading || 0;
        const urls = getLogoUrl(f.callsign);
        var logoHtml = '<img class="map-plane-logo" src="' + urls.primary + '"'
            + (urls.secondary ? ' onerror="this.onerror=function(){this.style.display=\'none\'};this.src=\'' + urls.secondary + '\'"' : ' onerror="this.style.display=\'none\'"')
            + '>';
        return L.divIcon({
            className: 'map-plane-icon',
            html: '<div class="map-plane-svg" style="transform:rotate(' + heading + 'deg);color:' + color + '">' + PLANE_SVG + '</div>'
                + '<div class="map-plane-label" style="color:' + color + '">' + logoHtml + f.callsign + '</div>',
            iconSize: [90, 36],
            iconAnchor: [45, 18],
        });
    }

    /* ── Breadcrumb trails ───────────────────────────────── */
    var trails = {};       // callsign → { positions: [[lat,lng], ...], dots: [L.circleMarker, ...] }
    var TRAIL_MAX = 80;    // max trail points per aircraft (interpolated)
    var TRAIL_MIN_DIST = 0.002; // ~200m — skip if barely moved

    function isAirborne(f) {
        return (f.groundspeed || 0) >= 50 || (f.altitude || 0) >= 500;
    }

    function distSq(a, b) {
        var dx = a[0] - b[0], dy = a[1] - b[1];
        return dx * dx + dy * dy;
    }

    function updateTrail(f) {
        var cs = f.callsign;
        var pos = [f.latitude, f.longitude];
        var color = f.direction === 'ARR' ? '#42a5f5' : '#ffa726';

        if (!isAirborne(f)) return; // ground ops — no trail

        if (!trails[cs]) trails[cs] = { positions: [], dots: [], color: color };
        var t = trails[cs];

        // Skip if hasn't moved enough
        var last = t.positions.length > 0 ? t.positions[t.positions.length - 1] : null;
        if (last && distSq(pos, last) < TRAIL_MIN_DIST * TRAIL_MIN_DIST) return;

        // Interpolate between last known position and current
        if (last) {
            var gap = Math.sqrt(distSq(pos, last));
            var steps = Math.min(Math.floor(gap / TRAIL_MIN_DIST), 3); // up to 3 interpolated points
            for (var s = 1; s < steps; s++) {
                var frac = s / steps;
                t.positions.push([
                    last[0] + (pos[0] - last[0]) * frac,
                    last[1] + (pos[1] - last[1]) * frac
                ]);
            }
        }

        t.positions.push(pos);
        t.color = color;

        // Trim oldest
        while (t.positions.length > TRAIL_MAX) {
            t.positions.shift();
            if (t.dots.length > 0) { map.removeLayer(t.dots.shift()); }
        }

        // Re-render all dots with fading opacity
        t.dots.forEach(function (d) { map.removeLayer(d); });
        t.dots = [];
        for (var i = 0; i < t.positions.length - 1; i++) {
            var age = t.positions.length - 1 - i; // 0 = newest
            var opacity = 0.1 + 0.5 * (1 - age / TRAIL_MAX);
            var radius = 1 + 0.5 * (1 - age / TRAIL_MAX);
            var dot = L.circleMarker(t.positions[i], {
                radius: radius,
                fillColor: t.color,
                fillOpacity: opacity,
                stroke: false,
                interactive: false,
            }).addTo(map);
            t.dots.push(dot);
        }
    }

    function removeTrail(cs) {
        if (!trails[cs]) return;
        trails[cs].dots.forEach(function (d) { map.removeLayer(d); });
        delete trails[cs];
    }

    function updateMarkers(flights) {
        const seen = {};
        flights.forEach(function (f) {
            if (f.latitude == null || f.longitude == null) return;
            seen[f.callsign] = true;
            const pos = [f.latitude, f.longitude];

            updateTrail(f);

            if (markers[f.callsign]) {
                markers[f.callsign].setLatLng(pos);
                markers[f.callsign].setIcon(makeIcon(f));
                markers[f.callsign]._flightData = f;
            } else {
                const m = L.marker(pos, { icon: makeIcon(f) }).addTo(map);
                m._flightData = f;
                m.on('click', function () { showFlightPanel(m._flightData); });
                markers[f.callsign] = m;
            }
        });
        // Remove stale
        Object.keys(markers).forEach(function (cs) {
            if (!seen[cs]) {
                map.removeLayer(markers[cs]);
                delete markers[cs];
                removeTrail(cs);
                if (selectedCallsign === cs) closeFlightPanel();
            }
        });
    }

    /* ── Flight detail panel ──────────────────────────────── */
    const panel = document.getElementById('flightPanel');

    function statusColor(status) {
        if (!status) return '#aaa';
        if (status === 'Boarding') return '#00b000';
        if (status.indexOf('GO TO') !== -1) return '#e6007e';
        if (status === 'Check-in' || status === 'Taxiing' || status === 'Wait'
            || status === 'Landing' || status === 'Landed' || status === 'At Gate'
            || status === 'Scheduled') return '#ffcc00';
        if (status === 'Pushback' || status === 'Departing' || status === 'Approaching') return '#0055b8';
        if (status.indexOf('Delayed') !== -1 || status === 'Cancelled' || status === 'CLOSED') return '#d60000';
        if (status === 'En Route') return '#b3d9ff';
        return '#aaa';
    }

    function showFlightPanel(f) {
        selectedCallsign = f.callsign;
        document.getElementById('panelCallsign').textContent = f.callsign;

        var logoEl = document.getElementById('panelLogo');
        var urls = getLogoUrl(f.callsign);
        logoEl.src = urls.primary;
        logoEl.style.display = '';
        logoEl.onerror = function () {
            if (urls.secondary) { logoEl.src = urls.secondary; logoEl.onerror = function () { logoEl.style.display = 'none'; }; }
            else { logoEl.style.display = 'none'; }
        };

        var statusEl = document.getElementById('panelStatus');
        statusEl.textContent = f.status || '--';
        statusEl.style.color = statusColor(f.status);
        document.getElementById('panelAircraft').textContent = f.aircraft || '--';
        document.getElementById('panelOrigin').textContent = f.origin || '--';
        document.getElementById('panelDest').textContent = f.destination || '--';
        document.getElementById('panelAlt').textContent = (f.altitude || 0).toLocaleString() + ' ft';
        document.getElementById('panelSpeed').textContent = (f.groundspeed || 0) + ' kts';
        document.getElementById('panelGate').textContent = f.gate || '--';
        document.getElementById('panelRoute').textContent = f.route || '--';
        document.getElementById('panelGateLink').href = '/gate/' + AIRPORT + '/' + f.callsign;
        panel.classList.add('open');
    }

    function closeFlightPanel() {
        selectedCallsign = null;
        panel.classList.remove('open');
    }

    document.getElementById('flightPanelClose').addEventListener('click', closeFlightPanel);

    /* ── Boarding Pass ─────────────────────────────────────── */
    var lastBpCode = '';

    function bpLogoSrc(callsign) {
        var prefix = (callsign || '').substring(0, 3).toUpperCase();
        var code = airlineLogoAliases[prefix] || airlineMapping[prefix] || prefix;
        // Use proxy so canvas can read pixels (same-origin)
        return '/api/logo/' + code;
    }

    function extractBpColour(img) {
        try {
            var canvas = document.createElement('canvas');
            var size = 64;
            canvas.width = size;
            canvas.height = size;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, size, size);
            var data = ctx.getImageData(0, 0, size, size).data;

            var buckets = {};
            for (var i = 0; i < data.length; i += 4) {
                var r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
                if (a < 128) continue;
                var lum = 0.299 * r + 0.587 * g + 0.114 * b;
                if (lum > 240 || lum < 15) continue;
                var sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
                if (sat < 0.15) continue;
                var key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
                if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, count: 0 };
                buckets[key].r += r;
                buckets[key].g += g;
                buckets[key].b += b;
                buckets[key].count++;
            }

            var best = null, bestCount = 0;
            var keys = Object.keys(buckets);
            for (var j = 0; j < keys.length; j++) {
                if (buckets[keys[j]].count > bestCount) {
                    bestCount = buckets[keys[j]].count;
                    best = buckets[keys[j]];
                }
            }

            if (best && best.count > 20) {
                var cr = Math.round(best.r / best.count);
                var cg = Math.round(best.g / best.count);
                var cb = Math.round(best.b / best.count);
                var colour = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
                var lum2 = 0.299 * cr + 0.587 * cg + 0.114 * cb;
                var textColour = lum2 > 150 ? '#000' : '#fff';
                document.documentElement.style.setProperty('--bp-accent', colour);
                document.documentElement.style.setProperty('--bp-accent-text', textColour);
            }
        } catch (e) {
            // Canvas tainted — keep default blue
        }
    }

    function randomSeat() {
        var row = Math.floor(Math.random() * 35) + 1;
        var letters = 'ABCDEF';
        return row + letters.charAt(Math.floor(Math.random() * letters.length));
    }

    function showBoardingPass(f) {
        // Callsign
        document.getElementById('bpCallsign').textContent = 'Flight ' + f.callsign;

        // Route — determine from/to based on direction
        var isDep = f.direction === 'DEP';
        var homeIcao = AIRPORT;
        var homeName = APT_NAME;
        var remoteIcao = isDep ? (f.destination || '--') : (f.origin || '--');
        var remoteName = remoteIcao;

        var fromIcao = isDep ? homeIcao : remoteIcao;
        var fromName = isDep ? homeName : remoteName;
        var toIcao = isDep ? remoteIcao : homeIcao;
        var toName = isDep ? remoteName : homeName;

        document.getElementById('bpFromIcao').textContent = fromIcao;
        document.getElementById('bpFromName').textContent = fromName;
        document.getElementById('bpToIcao').textContent = toIcao;
        document.getElementById('bpToName').textContent = toName;

        // Date
        var now = new Date();
        var months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        var dateStr = String(now.getUTCDate()).padStart(2, '0') + ' ' + months[now.getUTCMonth()] + ' ' + now.getUTCFullYear();
        document.getElementById('bpDate').textContent = dateStr;

        // Random seat
        var seat = randomSeat();
        document.getElementById('bpSeat').textContent = seat;
        document.getElementById('bpAircraft').textContent = f.aircraft || '--';

        // Random class — weighted but with visible variety
        var classRoll = Math.random();
        var cabinClass = classRoll < 0.1 ? 'FIRST' : classRoll < 0.35 ? 'BUSINESS' : 'ECONOMY';
        document.getElementById('bpClass').textContent = cabinClass;

        // Boarding time (depart minus ~30 min, or just show --)
        var depTime = f.time_display || '--:--';
        document.getElementById('bpDeparts').textContent = depTime;
        if (depTime !== '--:--' && depTime.indexOf(':') !== -1) {
            var parts = depTime.split(':');
            var h = parseInt(parts[0], 10);
            var m = parseInt(parts[1], 10) - 30;
            if (m < 0) { m += 60; h -= 1; }
            if (h < 0) h += 24;
            document.getElementById('bpBoarding').textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        } else {
            document.getElementById('bpBoarding').textContent = '--:--';
        }

        // Barcode text
        var shortDate = String(now.getUTCDate()).padStart(2, '0') + months[now.getUTCMonth()] + String(now.getUTCFullYear()).slice(2);
        document.getElementById('bpBarcodeTxt').textContent = f.callsign + ' \u00b7 ' + fromIcao + ' \u2192 ' + toIcao + ' \u00b7 ' + shortDate;

        // Stub section
        document.getElementById('bpStubCallsign').textContent = f.callsign;
        document.getElementById('bpStubFrom').textContent = fromIcao;
        document.getElementById('bpStubTo').textContent = toIcao;
        document.getElementById('bpStubDate').textContent = dateStr;
        document.getElementById('bpStubTime').textContent = depTime;
        document.getElementById('bpStubSeat').textContent = seat;

        // Logo + colour extraction (main + stub)
        var logoSrc = bpLogoSrc(f.callsign);

        var logoEl = document.getElementById('bpLogo');
        var newLogo = document.createElement('img');
        newLogo.className = 'bp-logo';
        newLogo.crossOrigin = 'anonymous';
        newLogo.onload = function () { extractBpColour(this); };
        newLogo.onerror = function () { this.style.display = 'none'; };
        logoEl.parentNode.replaceChild(newLogo, logoEl);
        newLogo.id = 'bpLogo';
        newLogo.src = logoSrc;

        var stubLogoEl = document.getElementById('bpStubLogo');
        var newStubLogo = document.createElement('img');
        newStubLogo.className = 'bp-stub-logo';
        newStubLogo.crossOrigin = 'anonymous';
        newStubLogo.onerror = function () { this.style.display = 'none'; };
        stubLogoEl.parentNode.replaceChild(newStubLogo, stubLogoEl);
        newStubLogo.id = 'bpStubLogo';
        newStubLogo.src = logoSrc;

        // Reset accent to default in case extraction fails
        document.documentElement.style.setProperty('--bp-accent', '#0066cc');
        document.documentElement.style.setProperty('--bp-accent-text', '#fff');

        // Small delay to let colour extraction fire, then print
        setTimeout(function () { window.print(); }, 300);
    }

    document.getElementById('panelPrintBP').addEventListener('click', function () {
        if (selectedCallsign && markers[selectedCallsign]) {
            showBoardingPass(markers[selectedCallsign]._flightData);
        }
    });

    /* ── ATC panel ────────────────────────────────────────── */
    const atcMarkers = {};
    const atcListEl = document.getElementById('atcPanelList');
    const atcPanel = document.getElementById('atcPanel');
    let atcExpanded = true;

    document.getElementById('atcPanelToggle').addEventListener('click', function () {
        atcExpanded = !atcExpanded;
        atcPanel.classList.toggle('collapsed', !atcExpanded);
        document.getElementById('atcChevron').textContent = atcExpanded ? 'expand_less' : 'expand_more';
    });

    function atcOffset(position) {
        // Return [latOffset, lonOffset] for different ATC types
        switch ((position || '').toUpperCase()) {
            case 'TWR': case 'GND': case 'DEL':
                return [0.005, 0.005];
            case 'APP': case 'DEP':
                return [0.15, 0.15];
            case 'CTR':
                return [0.45, 0.45];
            default:
                return [0.08, 0.08];
        }
    }

    function updateATC(controllers) {
        // List
        atcListEl.innerHTML = '';
        controllers.forEach(function (c) {
            var li = document.createElement('li');
            li.className = 'map-atc-item';
            li.innerHTML = '<span class="map-atc-dot"></span>'
                + '<span class="map-atc-cs">' + c.callsign + '</span>'
                + '<span class="map-atc-freq">' + c.frequency + '</span>';
            atcListEl.appendChild(li);
        });

        // Markers
        var seen = {};
        controllers.forEach(function (c) {
            seen[c.callsign] = true;
            var off = atcOffset(c.position);
            var pos = [APT_LAT + off[0], APT_LON + off[1]];
            if (atcMarkers[c.callsign]) {
                atcMarkers[c.callsign].setLatLng(pos);
            } else {
                var icon = L.divIcon({
                    className: 'map-atc-marker',
                    html: '<div class="map-atc-marker-label">' + c.callsign + '<br><span class="map-atc-marker-freq">' + c.frequency + '</span></div>',
                    iconSize: [100, 30],
                    iconAnchor: [50, 15],
                });
                atcMarkers[c.callsign] = L.marker(pos, { icon: icon, interactive: false }).addTo(map);
            }
        });
        Object.keys(atcMarkers).forEach(function (cs) {
            if (!seen[cs]) {
                map.removeLayer(atcMarkers[cs]);
                delete atcMarkers[cs];
            }
        });
    }

    /* ── Stats + clock ────────────────────────────────────── */
    function updateStats(flightCount, atcCount) {
        document.getElementById('mapFlightCount').textContent = flightCount + ' flight' + (flightCount !== 1 ? 's' : '');
        document.getElementById('mapAtcCount').textContent = atcCount + ' ATC';
    }

    function updateClock() {
        var now = new Date();
        var hh = String(now.getUTCHours()).padStart(2, '0');
        var mm = String(now.getUTCMinutes()).padStart(2, '0');
        document.getElementById('mapClock').textContent = hh + ':' + mm;
    }
    updateClock();
    setInterval(updateClock, 10000);

    /* ── Socket.IO ────────────────────────────────────────── */
    var socket = io({ transports: ['websocket', 'polling'] });

    function handleUpdate(data) {
        var deps = data.departures || [];
        var arrs = data.arrivals || [];
        var allFlights = deps.concat(arrs).filter(function (f) { return f.latitude != null; });
        updateMarkers(allFlights);
        updateATC(data.controllers || []);
        updateStats(allFlights.length, (data.controllers || []).length);

        // Refresh selected panel if still open
        if (selectedCallsign && markers[selectedCallsign]) {
            showFlightPanel(markers[selectedCallsign]._flightData);
        }
    }

    socket.on('connect', function () {
        socket.emit('join_airport', { airport: AIRPORT, explicit: false });
    });

    socket.on('flight_update', handleUpdate);

    // Initial load via API
    fetch('/api/map/' + AIRPORT)
        .then(function (r) { return r.json(); })
        .then(function (data) {
            handleUpdate({
                departures: data.flights.filter(function (f) { return f.direction === 'DEP'; }),
                arrivals: data.flights.filter(function (f) { return f.direction === 'ARR'; }),
                controllers: data.controllers,
            });
        })
        .catch(function (e) { console.warn('Initial map load failed:', e); });

})();
