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
        return L.divIcon({
            className: 'map-plane-icon',
            html: '<div class="map-plane-svg" style="transform:rotate(' + heading + 'deg);color:' + color + '">' + PLANE_SVG + '</div>'
                + '<div class="map-plane-label" style="color:' + color + '">' + f.callsign + '</div>',
            iconSize: [60, 36],
            iconAnchor: [30, 18],
        });
    }

    function updateMarkers(flights) {
        const seen = {};
        flights.forEach(function (f) {
            if (f.latitude == null || f.longitude == null) return;
            seen[f.callsign] = true;
            const pos = [f.latitude, f.longitude];
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
