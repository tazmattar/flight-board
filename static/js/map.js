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

    /* ── Airport features (OSM Overpass + stands.json) ──────── */
    function calcBearing(lat1, lon1, lat2, lon2) {
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
        var x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180)
              - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    var runwayLabelGroup = L.layerGroup();
    var taxiwayGroup     = L.layerGroup();
    var standGroup       = L.layerGroup();

    function updateFeatureVisibility() {
        var z = map.getZoom();
        function toggle(group, minZ) {
            if (z >= minZ) { if (!map.hasLayer(group)) group.addTo(map); }
            else           { if (map.hasLayer(group))  map.removeLayer(group); }
        }
        toggle(runwayLabelGroup, 12);
        toggle(taxiwayGroup,     13);
        toggle(standGroup,       14);
    }
    map.on('zoomend', updateFeatureVisibility);

    function addRunwayLabel(latlng, text, rotation) {
        L.marker(latlng, {
            icon: L.divIcon({
                className: '',
                html: '<div class="map-runway-label" style="transform:translate(-50%,-50%) rotate(' + rotation + 'deg)">' + text + '</div>',
                iconSize: [0, 0],
                iconAnchor: [0, 0],
            }),
            interactive: false,
        }).addTo(runwayLabelGroup);
    }

    function renderStands(stands) {
        stands.forEach(function (s) {
            if (s.lat == null || s.lon == null) return;
            var label = s.name || s.ref || '';
            if (!label) return;
            L.marker([s.lat, s.lon], {
                icon: L.divIcon({
                    className: '',
                    html: '<div class="map-stand-label">' + label + '</div>',
                    iconSize: [0, 0],
                    iconAnchor: [0, 0],
                }),
                interactive: false,
            }).addTo(standGroup);
        });
    }

    var OVERPASS_ENDPOINTS = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://overpass.openstreetmap.ru/api/interpreter',
    ];

    function fetchOverpass(q, endpointIndex) {
        endpointIndex = endpointIndex || 0;
        if (endpointIndex >= OVERPASS_ENDPOINTS.length) return Promise.reject(new Error('All Overpass endpoints failed'));
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 15000);
        return fetch(OVERPASS_ENDPOINTS[endpointIndex] + '?data=' + encodeURIComponent(q), { signal: controller.signal })
            .then(function (r) { clearTimeout(timer); return r.json(); })
            .catch(function (e) {
                clearTimeout(timer);
                console.warn('Overpass endpoint ' + OVERPASS_ENDPOINTS[endpointIndex] + ' failed, trying next:', e);
                return fetchOverpass(q, endpointIndex + 1);
            });
    }

    function processOsmElements(elements, useLocalStands) {
        var osmStands = [];
        elements.forEach(function (el) {
            var aw = el.tags && el.tags.aeroway;

            if (aw === 'runway' && el.geometry && el.geometry.length >= 2) {
                var coords = el.geometry.map(function (p) { return [p.lat, p.lon]; });
                L.polyline(coords, { color: '#555', weight: 6, opacity: 0.55, interactive: false }).addTo(map);
                L.polyline(coords, { color: '#888', weight: 1, opacity: 0.45, dashArray: '10 8', interactive: false }).addTo(map);
                var ref = el.tags.ref;
                if (!ref || ref.indexOf('/') === -1) return;
                var parts = ref.split('/');
                var p1 = coords[0], p2 = coords[coords.length - 1];
                var hdg = calcBearing(p1[0], p1[1], p2[0], p2[1]);
                var approxNum = Math.round(hdg / 10) % 36 || 36;
                var n1 = parseInt(parts[0]);
                var labelP1, labelP2;
                if (Math.abs(approxNum - n1) <= 2 || Math.abs(approxNum - n1) >= 34) {
                    labelP1 = parts[0]; labelP2 = parts[1];
                } else {
                    labelP1 = parts[1]; labelP2 = parts[0];
                }
                addRunwayLabel(p1, labelP1, hdg + 180);
                addRunwayLabel(p2, labelP2, hdg);
            }

            if ((aw === 'taxiway' || aw === 'taxilane') && el.geometry && el.geometry.length >= 2) {
                var txCoords = el.geometry.map(function (p) { return [p.lat, p.lon]; });
                L.polyline(txCoords, {
                    color: '#aa9900',
                    weight: aw === 'taxilane' ? 1.5 : 2.5,
                    opacity: aw === 'taxilane' ? 0.4 : 0.55,
                    interactive: false,
                }).addTo(taxiwayGroup);
            }

            if (aw === 'parking_position' && !useLocalStands) {
                var lat, lon;
                if (el.type === 'node') {
                    lat = el.lat; lon = el.lon;
                } else if (el.geometry && el.geometry.length) {
                    var sLat = 0, sLon = 0;
                    el.geometry.forEach(function (p) { sLat += p.lat; sLon += p.lon; });
                    lat = sLat / el.geometry.length;
                    lon = sLon / el.geometry.length;
                }
                var label = el.tags && (el.tags.ref || el.tags.name);
                if (lat != null && label) osmStands.push({ name: label, lat: lat, lon: lon });
            }
        });
        return osmStands;
    }

    function fetchAirportFeatures() {
        var q = '[out:json];('
            + 'way[aeroway=runway](around:4000,'   + APT_LAT + ',' + APT_LON + ');'
            + 'way[aeroway=taxiway](around:4000,'  + APT_LAT + ',' + APT_LON + ');'
            + 'way[aeroway=taxilane](around:4000,' + APT_LAT + ',' + APT_LON + ');'
            + 'node[aeroway=parking_position](around:4000,' + APT_LAT + ',' + APT_LON + ');'
            + 'way[aeroway=parking_position](around:4000,'  + APT_LAT + ',' + APT_LON + ');'
            + ');out geom;';

        // Stands are fetched and rendered independently — OSM failure won't block them
        var standsP = fetch('/static/stands.json').then(function (r) { return r.json(); }).catch(function () { return {}; });
        standsP.then(function (standsJson) {
            var useLocalStands = !!(standsJson[AIRPORT] && standsJson[AIRPORT].length);
            if (useLocalStands) {
                renderStands(standsJson[AIRPORT]);
                updateFeatureVisibility();
            }

            // OSM fetch: try primary + mirrors with per-request timeout
            fetchOverpass(q)
                .then(function (data) {
                    var osmStands = processOsmElements(data.elements || [], useLocalStands);
                    if (!useLocalStands && osmStands.length) renderStands(osmStands);
                    updateFeatureVisibility();
                })
                .catch(function (e) { console.warn('All Overpass endpoints failed:', e); });
        });
    }

    fetchAirportFeatures();

    /* ── ATC sector boundaries ────────────────────────────── */
    var boundaryLabelGroup = L.layerGroup();
    var boundaryLayer = null;
    var sectorLabelMarkers = {};          // sector id → L.marker
    var activeCtrControllers = new Map(); // prefix → {callsign, frequency}

    var SECTOR_DIM  = { color: '#4caf50', weight: 1,   opacity: 0.3, fillOpacity: 0.02 };
    var SECTOR_LIT  = { color: '#69f0ae', weight: 1.5, opacity: 0.8, fillOpacity: 0.10 };

    function highlightActiveSectors() {
        if (!boundaryLayer) return;
        boundaryLayer.eachLayer(function (layer) {
            var id = layer.feature && layer.feature.properties && layer.feature.properties.id;
            if (!id) return;
            var ctrl = null;
            activeCtrControllers.forEach(function (info, boundaryId) {
                if (id === boundaryId) ctrl = info;
            });
            layer.setStyle(ctrl ? SECTOR_LIT : SECTOR_DIM);

            // Update label content
            var labelMarker = sectorLabelMarkers[id];
            if (!labelMarker) return;
            var el = labelMarker.getElement();
            if (!el) return;
            var div = el.querySelector('.map-boundary-label-text');
            if (!div) return;
            if (ctrl) {
                div.classList.add('sector-active');
                div.innerHTML = '<span class="sector-id">' + id + '</span>'
                    + '<span class="sector-cs">' + ctrl.callsign + '</span>'
                    + '<span class="sector-freq">' + ctrl.frequency + '</span>';
            } else {
                div.classList.remove('sector-active');
                div.textContent = id;
            }
        });
    }

    function updateBoundaryLabelVisibility() {
        var z = map.getZoom();
        if (z >= 5) { if (!map.hasLayer(boundaryLabelGroup)) boundaryLabelGroup.addTo(map); }
        else         { if (map.hasLayer(boundaryLabelGroup))  map.removeLayer(boundaryLabelGroup); }
    }
    map.on('zoomend', updateBoundaryLabelVisibility);

    function fetchATCBoundaries() {
        fetch('/static/data/Boundaries.geojson')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                boundaryLayer = L.geoJSON(data, {
                    style: function () { return SECTOR_DIM; },
                    interactive: false,
                }).addTo(map);

                // Sector labels at the provided label coordinates
                data.features.forEach(function (feature) {
                    var p = feature.properties;
                    if (!p || !p.id || p.label_lat == null || p.label_lon == null) return;
                    var m = L.marker([parseFloat(p.label_lat), parseFloat(p.label_lon)], {
                        icon: L.divIcon({
                            className: 'map-boundary-label',
                            html: '<div class="map-boundary-label-text">' + p.id + '</div>',
                            iconSize: [0, 0],
                            iconAnchor: [0, 0],
                        }),
                        interactive: false,
                    }).addTo(boundaryLabelGroup);
                    sectorLabelMarkers[p.id] = m;
                });

                updateBoundaryLabelVisibility();
                highlightActiveSectors(); // apply any already-known CTR state
            })
            .catch(function (err) { console.warn('ATC Boundary load failed:', err); });
    }

    fetchATCBoundaries();

    /* ── Airline logo resolution (mirrors app.js logic) ──── */
    var virtualAirlines = new Set(['XNO']);
    var airlineMapping = {
        'SWS': 'LX', 'EZY': 'U2', 'EJU': 'U2', 'EZS': 'DS', 'BEL': 'SN',
        'GWI': '4U', 'EDW': 'WK', 'ITY': 'AZ', 'FDX': 'FX', 'UPS': '5X',
        'GEC': 'LH', 'BCS': 'QY', 'SAZ': 'REGA', 'SHT': 'BA'
    };
    var airlineLogoAliasGroups = {
        BA: ['SHT', 'EFW'],
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
    var userOffsets = {}; // callsign → {dx,dy} set by user drag
    let selectedCallsign = null;
    let panelAutoOpened = false;

    function flightColor(f) {
        const gs = f.groundspeed || 0;
        const onGround = gs < 50 && (f.altitude || 0) < 500;
        if (onGround) return '#4caf50'; // green — ground
        return f.direction === 'ARR' ? '#42a5f5' : '#ffa726'; // blue arrivals, orange departures
    }

    function boxEdgePoint(dx, dy, half) {
        if (dx === 0 && dy === 0) return [0, 0];
        var ax = Math.abs(dx), ay = Math.abs(dy);
        var scale = ax >= ay ? half / ax : half / ay;
        return [+(dx * scale).toFixed(2), +(dy * scale).toFixed(2)];
    }

    // Returns the point on the label box edge (hw×hh half-sizes) closest to the aircraft (0,0)
    function labelEdgePoint(dx, dy, hw, hh) {
        if (dx === 0 && dy === 0) return [0, 0];
        var ax = Math.abs(dx), ay = Math.abs(dy);
        var s = 1 / Math.max(ax / hw, ay / hh);
        s = Math.min(1, s);
        return [+(dx * (1 - s)).toFixed(2), +(dy * (1 - s)).toFixed(2)];
    }

    function makeIcon(f, dx, dy, tracked) {
        var color = flightColor(f);
        var urls = getLogoUrl(f.callsign);
        var logoHtml = '<img class="map-plane-logo" src="' + urls.primary + '"'
            + (urls.secondary ? ' onerror="this.onerror=function(){this.style.display=\'none\'};this.src=\'' + urls.secondary + '\'"' : ' onerror="this.style.display=\'none\'"')
            + '>';
        var edge = boxEdgePoint(dx, dy, 3);
        var lhw = tracked ? 52 : 40;
        var lhh = tracked ? 16 : 8;
        var labelEdge = labelEdgePoint(dx, dy, lhw, lhh);
        return L.divIcon({
            className: 'map-plane-icon',
            html: '<div class="map-plane-wrap' + (tracked ? ' tracked-flight' : '') + '" style="color:' + color + '">'
                + '<svg class="map-plane-stalk-svg">'
                + '<line x1="' + edge[0] + '" y1="' + edge[1] + '" x2="' + labelEdge[0] + '" y2="' + labelEdge[1] + '" stroke="currentColor" stroke-width="1" stroke-opacity="0.65"/>'
                + '<rect x="-3" y="-3" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.5"/>'
                + '</svg>'
                + '<div class="map-plane-label" style="left:' + dx + 'px;top:' + dy + 'px">'
                + logoHtml
                + '<span class="map-plane-label-text">'
                + '<span class="map-plane-callsign">' + f.callsign + '</span>'
                + '<span class="map-plane-stats">'
                + (f.groundspeed || 0)
                + ' ' + String(Math.round(f.heading || 0) % 360).padStart(3, '0')
                + ' ' + (function(a) {
                    return a >= 6000
                        ? 'FL' + String(Math.round(a / 100)).padStart(3, '0')
                        : String(a);
                })(Math.round(f.altitude || 0))
                + '</span>'
                + '</span>'
                + '</div>'
                + '</div>',
            iconSize: [1, 1],
            iconAnchor: [0, 0],
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

    function updateTrail(f, dimmed) {
        var cs = f.callsign;
        var pos = [f.latitude, f.longitude];
        var color = f.direction === 'ARR' ? '#42a5f5' : '#ffa726';
        var dimFactor = dimmed ? 0.2 : 1;

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
            var opacity = dimFactor * (0.1 + 0.5 * (1 - age / TRAIL_MAX));
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

    /* ── Label collision avoidance ───────────────────────── */
    function computeOffsets(flights) {
        var LABEL_W = 78;
        var LABEL_H = 14;
        var ALL_ANGLES = [0,15,30,45,60,75,90,105,120,135,150,165,180,195,210,225,240,255,270,285,300,315,330,345];
        var STALKS = [20, 35, 52, 72];
        var offsets = {};
        var placed = [];

        // Pre-pass: lock in user-dragged labels and reserve their screen space
        flights.forEach(function (f) {
            if (f.latitude == null || f.longitude == null) return;
            if (!userOffsets[f.callsign]) return;
            var off = userOffsets[f.callsign];
            offsets[f.callsign] = off;
            var pt = map.latLngToContainerPoint([f.latitude, f.longitude]);
            placed.push({
                x1: pt.x + off.dx - LABEL_W / 2 - 2, y1: pt.y + off.dy - LABEL_H / 2 - 2,
                x2: pt.x + off.dx + LABEL_W / 2 + 2, y2: pt.y + off.dy + LABEL_H / 2 + 2
            });
        });

        // Auto-place the rest
        flights.forEach(function (f) {
            if (f.latitude == null || f.longitude == null) return;
            if (offsets[f.callsign]) return; // already user-placed
            var pt = map.latLngToContainerPoint([f.latitude, f.longitude]);
            var preferred = ((f.heading || 0) + 90) % 360;
            var sorted = ALL_ANGLES.slice().sort(function (a, b) {
                var da = Math.abs(((a - preferred + 540) % 360) - 180);
                var db = Math.abs(((b - preferred + 540) % 360) - 180);
                return da - db;
            });

            var chosen = null;
            for (var s = 0; s < STALKS.length && !chosen; s++) {
                var stalk = STALKS[s];
                for (var i = 0; i < sorted.length && !chosen; i++) {
                    var rad = sorted[i] * Math.PI / 180;
                    var dx = Math.round(stalk * Math.sin(rad));
                    var dy = Math.round(-stalk * Math.cos(rad));
                    var lx1 = pt.x + dx - LABEL_W / 2 - 2;
                    var ly1 = pt.y + dy - LABEL_H / 2 - 2;
                    var lx2 = lx1 + LABEL_W + 4;
                    var ly2 = ly1 + LABEL_H + 4;
                    var overlaps = false;
                    for (var j = 0; j < placed.length; j++) {
                        var p = placed[j];
                        if (lx1 < p.x2 && lx2 > p.x1 && ly1 < p.y2 && ly2 > p.y1) {
                            overlaps = true;
                            break;
                        }
                    }
                    if (!overlaps) {
                        chosen = { dx: dx, dy: dy };
                        placed.push({ x1: lx1, y1: ly1, x2: lx2, y2: ly2 });
                    }
                }
            }
            if (!chosen) {
                var rad0 = sorted[0] * Math.PI / 180;
                var sl = STALKS[STALKS.length - 1];
                chosen = { dx: Math.round(sl * Math.sin(rad0)), dy: Math.round(-sl * Math.cos(rad0)) };
            }
            offsets[f.callsign] = chosen;
        });

        return offsets;
    }

    /* ── Draggable labels ────────────────────────────────── */
    function attachLabelDrag(marker, callsign) {
        var el = marker.getElement();
        if (!el) return;
        var label = el.querySelector('.map-plane-label');
        var svgLine = el.querySelector('.map-plane-stalk-svg line');
        if (!label || !svgLine) return;

        label.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            var startX = e.clientX, startY = e.clientY;
            var startDx = parseInt(label.style.left) || 14;
            var startDy = parseInt(label.style.top) || -14;
            var hasDragged = false;

            function onMove(e) {
                var ddx = e.clientX - startX, ddy = e.clientY - startY;
                if (!hasDragged && Math.abs(ddx) < 4 && Math.abs(ddy) < 4) return;
                if (!hasDragged) {
                    hasDragged = true;
                    label.style.cursor = 'grabbing';
                    map.dragging.disable();
                }
                var newDx = startDx + ddx, newDy = startDy + ddy;
                label.style.left = newDx + 'px';
                label.style.top  = newDy + 'px';
                var isTracked = el.querySelector('.map-plane-wrap').classList.contains('tracked-flight');
                var lhw = isTracked ? 52 : 40;
                var lhh = isTracked ? 16 : 8;
                var le = labelEdgePoint(newDx, newDy, lhw, lhh);
                svgLine.setAttribute('x2', le[0]);
                svgLine.setAttribute('y2', le[1]);
            }

            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                label.style.cursor = 'grab';
                map.dragging.enable();
                if (hasDragged) {
                    userOffsets[callsign] = {
                        dx: parseInt(label.style.left),
                        dy: parseInt(label.style.top)
                    };
                    // Swallow the synthetic click so the flight panel doesn't open
                    label.addEventListener('click', function (e) {
                        e.stopPropagation();
                    }, { once: true, capture: true });
                }
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // Double-click resets to auto-placement
        label.addEventListener('dblclick', function (e) {
            delete userOffsets[callsign];
            e.stopPropagation();
        });
    }

    /* ── Tracked flight ──────────────────────────────────── */
    let routeLayer = null;
    let renderedRouteCallsign = null;
    var waypointLabelGroup = L.layerGroup();

    function updateWaypointLabelVisibility() {
        var z = map.getZoom();
        if (z >= 7) { if (!map.hasLayer(waypointLabelGroup)) waypointLabelGroup.addTo(map); }
        else         { if (map.hasLayer(waypointLabelGroup))  map.removeLayer(waypointLabelGroup); }
    }
    map.on('zoomend', updateWaypointLabelVisibility);

    function clearRouteLayer() {
        if (routeLayer) {
            routeLayer.forEach(function (l) { map.removeLayer(l); });
            routeLayer = null;
        }
        waypointLabelGroup.clearLayers();
        renderedRouteCallsign = null;
    }

    function renderTrackedRoute(callsign) {
        if (renderedRouteCallsign === callsign) return; // already drawn
        clearRouteLayer();
        if (!callsign) return;

        fetch('/api/route/' + encodeURIComponent(callsign) + '?airport=' + encodeURIComponent(AIRPORT))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var wps = data.waypoints || [];
                if (wps.length < 2) return;

                renderedRouteCallsign = callsign;
                routeLayer = [];


                // Colour segments and dots by waypoint type
                var TYPE_COLOR = { sid: '#69f0ae', star: '#64b5f6', fix: '#f0b429', navaid: '#f0b429', airport: '#f0b429' };

                // Draw segments between consecutive waypoints, coloured by the segment's type
                for (var i = 0; i < wps.length - 1; i++) {
                    var segColor = TYPE_COLOR[wps[i + 1].type] || '#f0b429';
                    var seg = L.polyline([[wps[i].lat, wps[i].lon], [wps[i + 1].lat, wps[i + 1].lon]], {
                        color: segColor,
                        weight: 2,
                        dashArray: '6 4',
                        opacity: 0.8,
                        interactive: false,
                    }).addTo(map);
                    routeLayer.push(seg);
                }

                // Small dots + permanent name labels for intermediate waypoints
                for (var i = 1; i < wps.length - 1; i++) {
                    var w = wps[i];
                    var dotColor = TYPE_COLOR[w.type] || '#f0b429';
                    var dot = L.circleMarker([w.lat, w.lon], {
                        radius: 3,
                        color: dotColor,
                        fillColor: dotColor,
                        fillOpacity: 0.7,
                        weight: 1,
                        interactive: false,
                    });
                    dot.addTo(map);
                    routeLayer.push(dot);

                    if (w.name) {
                        var labelClass = 'map-waypoint-label'
                            + (w.type === 'sid'  ? ' map-waypoint-label--sid'  : '')
                            + (w.type === 'star' ? ' map-waypoint-label--star' : '');
                        var wLabel = L.marker([w.lat, w.lon], {
                            icon: L.divIcon({
                                className: '',
                                html: '<div class="' + labelClass + '">' + w.name + '</div>',
                                iconSize: [0, 0],
                                iconAnchor: [0, 0],
                            }),
                            interactive: false,
                        });
                        wLabel.addTo(waypointLabelGroup);
                    }
                }
                updateWaypointLabelVisibility();

                // Destination label at end of route
                var destIcao = (markers[callsign] && markers[callsign]._flightData && markers[callsign]._flightData.destination) || '';
                if (destIcao) {
                    var last = wps[wps.length - 1];
                    var destMarker = L.marker([last.lat, last.lon], {
                        icon: L.divIcon({
                            className: 'map-route-dest-label',
                            html: '<div class="map-route-dest">' + destIcao + '</div>',
                            iconSize: [0, 0],
                            iconAnchor: [0, 0],
                        }),
                        interactive: false,
                    }).addTo(map);
                    routeLayer.push(destMarker);
                }

                // Auto-fit to route bounds
                try {
                    var allLatLngs = wps.map(function (w) { return [w.lat, w.lon]; });
                    map.fitBounds(L.polyline(allLatLngs).getBounds().pad(0.1));
                } catch (e) { /* bounds too small */ }
            })
            .catch(function (e) { console.warn('Route fetch failed:', e); });
    }

    function updateMarkers(flights) {
        const seen = {};
        const trackedCallsign = localStorage.getItem('flightboard.tracked_callsign');
        const offsets = computeOffsets(flights);
        flights.forEach(function (f) {
            if (f.latitude == null || f.longitude == null) return;
            seen[f.callsign] = true;
            const pos = [f.latitude, f.longitude];
            const off = offsets[f.callsign] || { dx: 14, dy: -14 };

            const isTracked = f.callsign === trackedCallsign;
            updateTrail(f, !!trackedCallsign && !isTracked);
            if (markers[f.callsign]) {
                markers[f.callsign].setLatLng(pos);
                markers[f.callsign].setIcon(makeIcon(f, off.dx, off.dy, isTracked));
                markers[f.callsign]._flightData = f;
                attachLabelDrag(markers[f.callsign], f.callsign);
            } else {
                const m = L.marker(pos, { icon: makeIcon(f, off.dx, off.dy, isTracked), zIndexOffset: 1000 }).addTo(map);
                m._flightData = f;
                m.on('click', function () {
                    const tc = localStorage.getItem('flightboard.tracked_callsign');
                    if (tc && m._flightData.callsign !== tc) return;
                    showFlightPanel(m._flightData);
                });
                markers[f.callsign] = m;
                attachLabelDrag(m, f.callsign);
            }

        });
        // Remove stale — but preserve the tracked flight if it's being tracked en route
        Object.keys(markers).forEach(function (cs) {
            if (!seen[cs]) {
                if (trackedEnRoute && cs === trackedCallsign) return;
                map.removeLayer(markers[cs]);
                delete markers[cs];
                delete userOffsets[cs];
                removeTrail(cs);
                if (selectedCallsign === cs) closeFlightPanel();
            }
        });

        // Dim non-tracked markers via map container class
        map.getContainer().classList.toggle('has-tracked', !!trackedCallsign);

        // Auto-open panel for tracked flight on first data load
        if (!panelAutoOpened && trackedCallsign && markers[trackedCallsign]) {
            panelAutoOpened = true;
            showFlightPanel(markers[trackedCallsign]._flightData);
        }
        // Reset auto-open flag if tracking is cleared
        if (!trackedCallsign) panelAutoOpened = false;

        // Render route for tracked flight (only once per callsign change)
        renderTrackedRoute(trackedCallsign || null);
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
        // Sector highlights: use local CTR data only when not in tracking mode.
        // In tracking mode, refreshGlobalATC() manages activeCtrControllers instead.
        if (!lastTrackedCallsign) {
            activeCtrControllers = new Map();
            controllers.forEach(function (c) {
                if ((c.position || '').toUpperCase() === 'CTR' && c.boundary_id) {
                    activeCtrControllers.set(c.boundary_id, { callsign: c.callsign, frequency: c.frequency });
                }
            });
            highlightActiveSectors();
        }

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

    /* ── En-route flight tracking ─────────────────────────── */
    var lastTrackedCallsign = null;
    var trackedEnRoute = false;   // true when tracked flight is not in local airport data
    var trackPoller = null;       // setInterval handle for flight position polling
    var globalAtcPoller = null;   // setInterval handle for global CTR refresh

    function refreshGlobalATC() {
        fetch('/api/controllers')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                activeCtrControllers = new Map();
                (data.controllers || []).forEach(function (c) {
                    if ((c.position || '').toUpperCase() === 'CTR' && c.boundary_id) {
                        activeCtrControllers.set(c.boundary_id, { callsign: c.callsign, frequency: c.frequency });
                    }
                });
                highlightActiveSectors();
            })
            .catch(function (e) { console.warn('Global ATC fetch failed:', e); });
    }

    function updateEnRouteMarker(f) {
        if (!f || f.latitude == null) return;
        var cs = f.callsign;
        var pos = [f.latitude, f.longitude];
        var off = { dx: 14, dy: -14 };
        if (markers[cs]) {
            markers[cs].setLatLng(pos);
            markers[cs].setIcon(makeIcon(f, off.dx, off.dy, true));
            markers[cs]._flightData = f;
        } else {
            var m = L.marker(pos, { icon: makeIcon(f, off.dx, off.dy, true), zIndexOffset: 1000 }).addTo(map);
            m._flightData = f;
            m.on('click', function () { showFlightPanel(m._flightData); });
            markers[cs] = m;
            attachLabelDrag(m, cs);
        }
        updateTrail(f, false);
        // Auto-pan if flight has moved outside current view
        if (!map.getBounds().contains(pos)) {
            map.panTo(pos, { animate: true, duration: 1.0 });
        }
        // Auto-open panel on first en-route detection
        if (!panelAutoOpened) {
            panelAutoOpened = true;
            showFlightPanel(f);
        }
        if (selectedCallsign === cs) showFlightPanel(f);
    }

    function pollTrackedFlight(callsign) {
        fetch('/api/flight/' + encodeURIComponent(callsign))
            .then(function (r) { return r.json(); })
            .then(function (data) { updateEnRouteMarker(data.flight); })
            .catch(function (e) { console.warn('Tracked flight poll failed:', e); });
    }

    function ensureTrackPoller(callsign) {
        if (trackPoller) return;
        trackedEnRoute = true;
        pollTrackedFlight(callsign);
        trackPoller = setInterval(function () { pollTrackedFlight(callsign); }, 15000);
    }

    function stopTrackPoller() {
        if (trackPoller) { clearInterval(trackPoller); trackPoller = null; }
        trackedEnRoute = false;
    }

    function onTrackingStart(callsign) {
        refreshGlobalATC();
        if (globalAtcPoller) clearInterval(globalAtcPoller);
        globalAtcPoller = setInterval(refreshGlobalATC, 30000);
    }

    function onTrackingStop() {
        stopTrackPoller();
        if (globalAtcPoller) { clearInterval(globalAtcPoller); globalAtcPoller = null; }
        // Sector highlights will revert to local CTR on the next updateATC call
    }

    /* ── Socket.IO ────────────────────────────────────────── */
    var socket = io({ transports: ['websocket', 'polling'] });

    function handleUpdate(data) {
        var tc = localStorage.getItem('flightboard.tracked_callsign');

        // Detect tracking state changes
        if (tc !== lastTrackedCallsign) {
            if (tc) onTrackingStart(tc);
            else onTrackingStop();
            lastTrackedCallsign = tc;
        }

        var deps = data.departures || [];
        var arrs = data.arrivals || [];
        var allFlights = deps.concat(arrs).filter(function (f) { return f.latitude != null; });
        updateMarkers(allFlights);
        updateATC(data.controllers || []);
        updateStats(allFlights.length, (data.controllers || []).length);

        // Manage en-route poller based on whether tracked flight is in local data
        if (tc) {
            var inLocal = allFlights.some(function (f) { return f.callsign === tc; });
            if (inLocal) stopTrackPoller();
            else ensureTrackPoller(tc);
        }

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

    // Re-render route + tracking mode when tracking changes from another tab
    window.addEventListener('storage', function (e) {
        if (e.key === 'flightboard.tracked_callsign') {
            clearRouteLayer();
            renderTrackedRoute(e.newValue || null);
            if (e.newValue && e.newValue !== lastTrackedCallsign) onTrackingStart(e.newValue);
            else if (!e.newValue) onTrackingStop();
            lastTrackedCallsign = e.newValue || null;
        }
    });

})();
