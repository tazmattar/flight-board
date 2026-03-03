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
            return '/static/logos/' + prefix + '.png';
        } else if (localOnlyAirlines.indexOf(code) !== -1) {
            return '/static/logos/' + code + '.png';
        }
        return 'https://images.kiwi.com/airlines/64/' + code + '.png';
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

    // Format route: truncate if too long
    function formatRoute(route) {
        if (!route || route === 'No route available') return '--';
        if (route.length > 60) return route.substring(0, 57) + '...';
        return route;
    }

    function renderMonitor(flight, isDep) {
        var waiting  = document.getElementById('gateWaiting');
        var notFound = document.getElementById('gateNotFound');
        var monitor  = document.getElementById('gateMonitor');

        var airportCode = isDep ? flight.destination : flight.origin;
        var airportName = airportNames[airportCode] || airportCode;

        // Gate
        var gate = flight.gate || '--';
        if (isDep && (flight.status === 'Taxiing' || flight.status === 'Departing')) gate = '--';

        var status = flight.status || '--';

        // Populate header
        document.getElementById('gateNumber').textContent = gate;
        document.getElementById('gateFlightId').textContent = 'FLIGHT ' + CALLSIGN;
        var logoEl = document.getElementById('gateLogo');
        logoEl.src = resolveLogoSrc(CALLSIGN);
        logoEl.style.display = '';
        var pillEl = document.getElementById('gateStatusPill');
        pillEl.textContent = status.toUpperCase();
        pillEl.className = 'status-pill ' + statusClass(status);

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

        // Flight details panel
        document.getElementById('gateRoute').textContent = formatRoute(flight.route);
        var alt = flight.altitude;
        document.getElementById('gateAltitude').textContent = alt ? alt.toLocaleString() + ' ft' : '--';
        var gs = flight.groundspeed;
        document.getElementById('gateSpeed').textContent = gs ? gs + ' kts' : '--';
        document.getElementById('gateSquawk').textContent = flight.squawk || '--';

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
