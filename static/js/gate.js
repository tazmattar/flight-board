(function () {
    'use strict';

    var AIRPORT  = window.GATE_AIRPORT;
    var CALLSIGN = window.GATE_CALLSIGN;

    // --- Airline logo lookup (mirrors app.js) ---
    var virtualAirlines = new Set(['XNO']);

    var airlineMapping = {
        SWS: 'LX', EZY: 'U2', EJU: 'U2', EZS: 'DS', BEL: 'SN',
        GWI: '4U', EDW: 'WK', ITY: 'AZ', FDX: 'FX', UPS: '5X',
        GEC: 'LH', BCS: 'QY', SAZ: 'REGA', SHT: 'BA'
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

    // Airline ICAO→IATA database (same CDN as app.js)
    var airlineDbReady = fetch('https://cdn.jsdelivr.net/gh/npow/airline-codes@master/airlines.json')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            data.forEach(function (a) {
                if (a.icao && a.iata && a.active === 'Y' && !airlineMapping[a.icao]) {
                    airlineMapping[a.icao] = a.iata;
                }
            });
        })
        .catch(function () { /* non-critical */ });

    // Airport name lookup (CDN)
    var airportNames = {};
    fetch('https://raw.githubusercontent.com/mwgg/Airports/master/airports.json')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            Object.keys(data).forEach(function (k) {
                var a = data[k];
                if (a.icao) airportNames[a.icao] = a.name;
            });
            // Refresh destination name if monitor is already showing
            var destEl = document.getElementById('gateDestName');
            if (destEl && destEl.dataset.icao) {
                var name = airportNames[destEl.dataset.icao];
                if (name) destEl.textContent = name;
            }
        })
        .catch(function () { /* non-critical */ });

    function resolveLogoSrc(callsign) {
        var prefix = callsign.substring(0, 3);
        var code = airlineLogoAliases[prefix] || airlineMapping[prefix] || prefix;
        if (virtualAirlines.has(prefix)) {
            return '/static/logos/' + prefix + '_128.png';
        } else if (localOnlyAirlines.indexOf(code) !== -1) {
            return '/static/logos/' + code + '_128.png';
        }
        // Use proxy so canvas can read pixels (same-origin)
        return '/api/logo/' + code;
    }

    // --- Dominant colour extraction ---
    var lastExtractedCode = '';

    function extractDominantColour(img) {
        var prefix = CALLSIGN.substring(0, 3);
        var code = airlineLogoAliases[prefix] || airlineMapping[prefix] || prefix;
        if (code === lastExtractedCode) return;
        lastExtractedCode = code;

        try {
            var canvas = document.createElement('canvas');
            var size = 64;
            canvas.width = size;
            canvas.height = size;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, size, size);
            var data = ctx.getImageData(0, 0, size, size).data;

            // Bucket pixels by hue, skipping near-white, near-black, and transparent
            var buckets = {};
            for (var i = 0; i < data.length; i += 4) {
                var r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
                if (a < 128) continue;
                var lum = 0.299 * r + 0.587 * g + 0.114 * b;
                if (lum > 240 || lum < 15) continue;
                var sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
                if (sat < 0.15) continue;
                // Bucket by quantised colour (5-bit per channel)
                var key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
                if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, count: 0 };
                buckets[key].r += r;
                buckets[key].g += g;
                buckets[key].b += b;
                buckets[key].count++;
            }

            var best = null;
            var bestCount = 0;
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
                applyAccentColour(cr, cg, cb);
            }
        } catch (e) {
            // Canvas tainted or other error — keep default blue
        }
    }

    function applyAccentColour(r, g, b) {
        var colour = 'rgb(' + r + ',' + g + ',' + b + ')';
        var root = document.documentElement;
        root.style.setProperty('--gate-accent', colour);

        // Determine if text on this colour should be white or black
        var lum = 0.299 * r + 0.587 * g + 0.114 * b;
        var textOnAccent = lum > 150 ? '#111' : '#fff';
        root.style.setProperty('--gate-accent-text', textOnAccent);
    }

    function findFlight(data) {
        var lists = [
            { flights: data.departures || [], isDep: true },
            { flights: data.arrivals  || [], isDep: false }
        ];
        for (var i = 0; i < lists.length; i++) {
            var arr = lists[i].flights;
            for (var j = 0; j < arr.length; j++) {
                if ((arr[j].callsign || '').toUpperCase() === CALLSIGN) {
                    return { flight: arr[j], isDep: lists[i].isDep };
                }
            }
        }
        return null;
    }

    // Status → CSS modifier class
    function statusClass(status) {
        var s = (status || '').toLowerCase();
        if (s === 'boarding') return 'boarding';
        if (s === 'check-in' || s === 'scheduled' || s === 'wait') return 'scheduled';
        if (s === 'taxiing' || s === 'pushback' || s === 'departing') return 'departing';
        if (s === 'en route') return 'enroute';
        if (s === 'approaching' || s === 'landing' || s === 'landed' || s === 'at gate') return 'arriving';
        if (s.indexOf('delayed') !== -1 || s === 'cancelled') return 'delayed';
        if (s.indexOf('go to') !== -1) return 'goto';
        return 'default';
    }

    // Status banner text (shown for certain statuses)
    function bannerText(status, gate, isDep) {
        var s = (status || '').toUpperCase();
        if (s === 'BOARDING') return 'NOW BOARDING';
        if (s.indexOf('GO TO') !== -1) return s;
        if (s === 'DEPARTING' || s === 'PUSHBACK') return 'GATE CLOSED';
        if (s === 'LANDING') return 'NOW LANDING';
        if (s === 'LANDED' || s === 'AT GATE') return 'ARRIVED';
        return '';
    }

    function renderMonitor(flight, isDep) {
        var waiting  = document.getElementById('gateWaiting');
        var notFound = document.getElementById('gateNotFound');
        var monitor  = document.getElementById('gateMonitor');

        var airportCode = flight.destination;
        var airportName = airportNames[airportCode] || airportCode;
        // Strip common suffixes — we know it's an airport
        airportName = airportName
            .replace(/\s+International\s+Airport$/i, '')
            .replace(/\s+International$/i, '')
            .replace(/\s+Airport$/i, '')
            .replace(/\s+Aerodrome$/i, '')
            .replace(/\s+Airfield$/i, '');

        // Gate — CLOSED until flight is near destination; TBA/gate number when arriving
        var gate = flight.gate || 'TBA';
        var nearDest = ['Approaching', 'Landing', 'Landed', 'At Gate'].indexOf(flight.status) !== -1;
        if (!nearDest) gate = 'CLOSED';

        var status = flight.status || '--';

        // Populate header — create fresh img to avoid stale onerror state
        var logoEl = document.getElementById('gateLogo');
        var newLogo = logoEl.cloneNode(false);
        newLogo.id = 'gateLogo';
        newLogo.style.display = 'none';
        newLogo.onload = function () {
            this.style.display = '';
            extractDominantColour(this);
        };
        newLogo.onerror = function () { this.style.display = 'none'; };
        logoEl.parentNode.replaceChild(newLogo, logoEl);
        newLogo.src = resolveLogoSrc(CALLSIGN);
        document.getElementById('gateFlightId').textContent = 'FLIGHT ' + CALLSIGN;
        var pillEl = document.getElementById('gateStatusPill');
        pillEl.textContent = status.toUpperCase();
        pillEl.className = 'status-pill ' + statusClass(status);

        // Gate number
        document.getElementById('gateNumber').textContent = gate;

        // Destination
        var destEl = document.getElementById('gateDestName');
        destEl.textContent = airportName;
        destEl.dataset.icao = airportCode;
        document.getElementById('gateDestIcao').textContent = airportCode;

        // Time & aircraft
        document.getElementById('gateTimeLabel').textContent = isDep ? 'DEPARTS' : 'ARRIVES';
        document.getElementById('gateTimeValue').textContent = flight.time_display || '--:--';
        document.getElementById('gateAircraft').textContent = flight.aircraft || '--';

        // Status banner
        var banner = document.getElementById('gateStatusBanner');
        var bText = bannerText(status, gate, isDep);
        if (bText) {
            banner.textContent = bText;
            banner.style.display = '';
        } else {
            banner.style.display = 'none';
        }

        // Footer
        var distText = flight.distance ? Math.round(flight.distance) + ' km' : '';
        var dirText = isDep ? 'DEPARTURE' : 'ARRIVAL';
        document.getElementById('gateFlightStats').textContent =
            dirText + (distText ? '  \u00b7  ' + distText : '');

        // Show monitor
        waiting.style.display = 'none';
        notFound.style.display = 'none';
        monitor.style.display = '';
    }

    function showNotFound() {
        document.getElementById('gateWaiting').style.display = 'none';
        document.getElementById('gateNotFound').style.display = '';
        document.getElementById('gateMonitor').style.display = 'none';
    }

    // UTC clock in footer
    function updateClock() {
        var el = document.getElementById('gateClock');
        if (!el) return;
        var now = new Date();
        var hh = String(now.getUTCHours()).padStart(2, '0');
        var mm = String(now.getUTCMinutes()).padStart(2, '0');
        el.textContent = hh + ':' + mm + ' UTC';
    }
    setInterval(updateClock, 10000);
    updateClock();

    // Socket.IO
    var socket = io();
    var receivedFirst = false;

    socket.on('connect', function () {
        socket.emit('join_airport', { airport: AIRPORT, explicit: false });
    });

    socket.on('flight_update', function (data) {
        var result = findFlight(data);
        if (result) {
            renderMonitor(result.flight, result.isDep);
        } else if (!receivedFirst) {
            showNotFound();
        }
        receivedFirst = true;
    });
})();
