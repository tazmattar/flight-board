document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    const AIRPORT_STORAGE_KEY = 'flightboard.airport';
    const TRACKING_STORAGE_KEY = 'flightboard.tracked_callsign';
    const TRACKING_SWITCH_COOLDOWN_MS = 8000;
    const TRACKING_MANUAL_HOLD_MS = 20000;

    function normalizeIcao(value) {
        return String(value || '').trim().toUpperCase();
    }

    function isLszhThemeActive() {
        return document.body.classList.contains('theme-lszh');
    }

    function isTitleCaseThemeActive() {
        return document.body.classList.contains('theme-lszh') ||
               document.body.classList.contains('theme-egcc') ||
               document.body.classList.contains('theme-egll') ||
               document.body.classList.contains('theme-egss') ||
               document.body.classList.contains('theme-egkk') ||
               document.body.classList.contains('theme-eglc');
    }

    function toTitleCase(value) {
        return String(value || '').toLowerCase().replace(/\b([a-z])/g, (match) => match.toUpperCase());
    }

    function formatStatusDisplayText(value) {
        const text = String(value || '');
        return isTitleCaseThemeActive() ? toTitleCase(text) : text.toUpperCase();
    }

    function formatAirportNameForTheme(value) {
        const text = String(value || '');
        return isTitleCaseThemeActive() ? text : text.toUpperCase();
    }

    function formatLszhOperationalLabel(value) {
        const text = String(value || '');
        if (!isTitleCaseThemeActive()) return text;

        const normalized = text.trim().toUpperCase();
        if (normalized === 'CLOSED') return 'Closed';
        if (normalized === 'WAIT') return 'Wait';
        return text;
    }

    function resolveStatusColorClass(baseClass, displayText, isArrivalContext) {
        if (!isLszhThemeActive()) return baseClass;
        if (!isArrivalContext) return baseClass;

        const normalizedText = String(displayText || '').trim().toUpperCase();
        if (normalizedText.includes('LATE ARRIVAL')) return 'Late Arrival';
        return baseClass;
    }

    function getInitialAirport() {
        const params = new URLSearchParams(window.location.search);
        const paramValue = normalizeIcao(params.get('icao') || params.get('airport'));
        if (paramValue.length === 4) return { airport: paramValue, explicit: true };

        try {
            const stored = normalizeIcao(localStorage.getItem(AIRPORT_STORAGE_KEY));
            if (stored.length === 4) return { airport: stored, explicit: true };
        } catch (e) {
            console.warn('LocalStorage unavailable, falling back to default.');
        }

        return { airport: 'LSZH', explicit: false };
    }

    function persistAirportSelection(icao) {
        try {
            localStorage.setItem(AIRPORT_STORAGE_KEY, icao);
        } catch (e) {
            // Ignore storage errors
        }

        if (history && history.replaceState) {
            const url = new URL(window.location.href);
            url.searchParams.set('icao', icao);
            history.replaceState({}, '', url);
        }
    }

    const _initial = getInitialAirport();
    let currentAirport = _initial.airport;
    let initialAirportExplicit = _initial.explicit;
    let rawFlightData = { departures: [], arrivals: [] };
    
    // Global flag to track the display cycle (Status vs Delay)
    let showingDelayPhase = false;

    const elements = {
        airportSelect: document.getElementById('airportSelect'),
        airportName: document.getElementById('airportName'),
        departureList: document.getElementById('departureList'),
        arrivalList: document.getElementById('arrivalList'),
        lastUpdate: document.getElementById('lastUpdate'),
        fsBtn: document.getElementById('fullscreenBtn'),
        trackingChip: document.getElementById('trackingChip'),
        trackingChipText: document.getElementById('trackingChipText'),
        trackingChipStop: document.getElementById('trackingChipStop')
    };

    const socket = io();
    let flightTracker = null;
    let lastTouchTrackToggleAt = 0;

    function renderTrackingChip(state) {
        if (!elements.trackingChip || !elements.trackingChipText) return;

        if (!state || !state.enabled) {
            elements.trackingChip.hidden = true;
            elements.trackingChipText.textContent = '';
            elements.trackingChip.removeAttribute('title');
            return;
        }

        const from = state.from || '----';
        const to = state.to || '----';
        const text = `Tracking Flight ${state.callsign} (${from}-${to})`;

        elements.trackingChipText.textContent = text;
        elements.trackingChip.title = text;
        elements.trackingChip.hidden = false;
    }

    function refreshTrackedRowHighlights() {
        if (!flightTracker) return;
        document.querySelectorAll('tr[data-callsign]').forEach((row) => {
            const callsign = row.getAttribute('data-callsign');
            row.classList.toggle('is-tracked', flightTracker.isTrackedCallsign(callsign));
        });
    }

    async function switchAirport(nextAirport, options = {}) {
        const source = options.source || 'manual';
        const requested = normalizeIcao(nextAirport);
        if (requested.length !== 4) return false;

        const oldAirport = currentAirport;
        const changed = requested !== currentAirport;

        if (changed) {
            socket.emit('leave_airport', { airport: currentAirport });
            currentAirport = requested;
        }

        if (options.ensureInSelect !== false) {
            const ok = await ensureAirportInSelect(currentAirport);
            if (!ok && currentAirport !== 'LSZH') {
                currentAirport = 'LSZH';
                await ensureAirportInSelect(currentAirport);
            }
        }

        if (elements.airportSelect) elements.airportSelect.value = currentAirport;
        updateTheme(currentAirport);
        window.updateFooterText(currentAirport, options.country || '');

        if (changed) {
            socket.emit('join_airport', { airport: currentAirport });
            elements.departureList.innerHTML = '';
            elements.arrivalList.innerHTML = '';
            applyPagination('dep', true);
            applyPagination('arr', true);
        }

        persistAirportSelection(currentAirport);

        if (flightTracker) {
            flightTracker.onAirportChanged(source);
            refreshTrackedRowHighlights();
        }

        return oldAirport !== currentAirport;
    }

    // --- SOCKET LISTENER ---
    socket.on('connect', () => {
        console.log('Connected via WebSockets. Joining:', currentAirport);
        socket.emit('join_airport', { airport: currentAirport, explicit: initialAirportExplicit });
        initialAirportExplicit = true; // subsequent reconnects count as returning visitor
    });

    socket.on('flight_update', (data) => {
        console.log('Flight update received:', data);
        console.log('Country from data:', data.country); // DEBUG
        rawFlightData = data;
        if (flightTracker) {
            flightTracker.processFlightData(data, currentAirport);
        }
        if (data.airport_name) elements.airportName.textContent = data.airport_name;
        // Update ATC and Weather widgets
        updateAtcWidget(data.controllers);
        updateWeatherWidget(data.metar);
        updateSecurityTime(data);
        // Update footer text with country information
        window.updateFooterText(currentAirport, data.country);
        
        renderSection('dep');
        renderSection('arr');
        refreshTrackedRowHighlights();
    });

    if (window.FlightTracker) {
        flightTracker = new window.FlightTracker({
            storageKey: TRACKING_STORAGE_KEY,
            switchCooldownMs: TRACKING_SWITCH_COOLDOWN_MS,
            manualHoldMs: TRACKING_MANUAL_HOLD_MS,
            onSwitchAirport: (icao) => switchAirport(icao, { source: 'tracking' }),
            onStateChange: (state) => renderTrackingChip(state)
        });
        flightTracker.init();
    }

    if (elements.trackingChipStop) {
        elements.trackingChipStop.addEventListener('click', () => {
            if (!flightTracker) return;
            flightTracker.clearTracking();
            refreshTrackedRowHighlights();
        });
    }

    // --- Virtual / VATSIM-specific airlines ---
    // Local logos only — these won't exist on any CDN, so no fallback is attempted.
    const virtualAirlines = new Set([
        'XNO', // AirNOTT
    ]);

    // --- Dynamic Data Sources ---
    const airlineMapping = {
        'SWS': 'LX', 'EZY': 'U2', 'EJU': 'U2', 'EZS': 'DS', 'BEL': 'SN',
        'GWI': '4U', 'EDW': 'WK', 'ITY': 'AZ', 'FDX': 'FX', 'UPS': '5X',
        'GEC': 'LH', 'BCS': 'QY', 'SAZ': 'REGA', 'SHT': 'BA'
    };
    // Brand-level logo aliases for airlines operating multiple AOCs/ICAO prefixes.
    // These map to the logo code we want to display, which may differ from the
    // airline's actual IATA code used operationally.
    const airlineLogoAliasGroups = {
        BA: ['SHT'],
        W6: ['WAU', 'WAZ', 'WIZ', 'WMT', 'WUK', 'WVL', 'WZZ']
    };
    const airlineLogoAliases = Object.entries(airlineLogoAliasGroups).reduce((acc, [logoCode, prefixes]) => {
        prefixes.forEach(prefix => {
            acc[String(prefix).toUpperCase()] = logoCode;
        });
        return acc;
    }, {});
    const airportMapping = {}; 
    const airportJapaneseMapping = {};
    const euMembers = new Set();
    const defaultThemeMap = {
        EDDF: { css: '/static/css/themes/eddf.css', class: 'theme-eddf' },
        LSZH: { css: '/static/css/themes/lszh.css', class: 'theme-lszh' },
        LSGG: { css: '/static/css/themes/lsgg.css', class: 'theme-lsgg' },
        LFSB: { css: '/static/css/themes/lfsb.css', class: 'theme-lfsb' },
        LFPG: { css: '/static/css/themes/lfpg.css', class: 'theme-lfpg' },
        EGLL: { css: '/static/css/themes/egll.css', class: 'theme-egll' },
        EGLC: { css: '/static/css/themes/eglc.css', class: 'theme-eglc' },
        EGKK: { css: '/static/css/themes/egkk.css', class: 'theme-egkk' },
        EGSS: { css: '/static/css/themes/egss.css', class: 'theme-egss' },
        EGCC: { css: '/static/css/themes/egcc.css', class: 'theme-egcc' },
        EHAM: { css: '/static/css/themes/eham.css', class: 'theme-eham' },
        KJFK: { css: '/static/css/themes/kjfk.css', class: 'theme-kjfk' },
        RJTT: { css: '/static/css/themes/rjtt.css', class: 'theme-rjtt' }
    };
    let themeMap = { ...defaultThemeMap };

    async function loadThemeMap() {
        try {
            const response = await fetch('/api/theme_map');
            if (!response.ok) return;
            const data = await response.json();
            if (data && typeof data === 'object') {
                themeMap = { ...defaultThemeMap, ...data };
            }
        } catch (e) {
            console.warn('Theme map API unavailable, using defaults.', e);
        }
    }

    async function loadDatabases() {
        // This is the missing block that fixes logos
        try {
            const response = await fetch('https://cdn.jsdelivr.net/gh/npow/airline-codes@master/airlines.json');
            if (response.ok) {
                const data = await response.json();
                data.forEach(a => {
                    if (a.icao && a.iata && a.active === 'Y' && !airlineMapping[a.icao]) {
                        airlineMapping[a.icao] = a.iata;
                    }
                });
            }
        } catch (e) { console.warn('Airline DB failed', e); }

        // existing airport logic
        try {
            const response = await fetch('https://raw.githubusercontent.com/mwgg/Airports/master/airports.json');
            if (response.ok) {
                const data = await response.json();
                const manualRenames = {
                    "EGLL": "London Heathrow", "EGKK": "London Gatwick", "EGSS": "London Stansted", "EGCC": "Manchester",
                    "EGGW": "London Luton", "EGLC": "London City", "KJFK": "New York JFK",
                    "KEWR": "Newark", "KLGA": "New York LaGuardia", "LFPG": "Paris CDG",
                    "LFPO": "Paris Orly", "LFPG": "Paris CDG", "EDDF": "Frankfurt", "EDDM": "Munich",
                    "OMDB": "Dubai", "VHHH": "Hong Kong", "WSSS": "Singapore",
                    "KBOS": "Boston", "LLBG": "Tel Aviv", "LSHD": "Zurich Heliport",
                    "LIBG": "Taranto-Grottaglie"
                };

                for (const [icao, details] of Object.entries(data)) {
                    let displayName;
                    if (manualRenames[icao]) displayName = manualRenames[icao];
                    else if (details.city) displayName = details.city;
                    else displayName = details.name;

                    // Store both name AND country code
                    airportMapping[icao] = {
                        name: displayName
                            .replace(/\b(Airport|International|Intl|Field|Airfield)\b/g, '')
                            .replace(/\s+/g, ' ')
                            .trim(),
                        country_code: details.country  // This is the ISO 2-letter code
                    };
                }
            }
        } catch (e) { console.warn('Airport DB failed', e); }

        try {
            const response = await fetch('/static/data/eu_members.json');
            if (response.ok) {
                const data = await response.json();
                data.forEach(code => euMembers.add(String(code).toUpperCase()));
            }
        } catch (e) { console.warn('EU member list failed', e); }

        await loadJapaneseAirportNames();

        // Ensure flags render once airport metadata is available
        updateFlags(currentAirport);
    }

    async function loadJapaneseAirportNames() {
        const sources = [
            '/static/data/airport_names_ja.json',
            '/static/js/airport_names_ja.json'
        ];

        for (const source of sources) {
            try {
                const response = await fetch(source);
                if (response.ok) {
                    const data = await response.json();
                    Object.assign(airportJapaneseMapping, data);
                }
            } catch (e) {
                console.warn('Japanese airport DB failed', source, e);
            }
        }
    }
    loadDatabases();
    
    function updateTheme(airportCode) {
        Array.from(document.body.classList)
            .filter(cls => cls.indexOf('theme-') === 0)
            .forEach(cls => document.body.classList.remove(cls));
        
        const themeLink = document.getElementById('airportTheme');
        
        // Check if this is a configured airport with a specific theme
        if (themeMap[airportCode] && themeMap[airportCode].css) {
            const theme = themeMap[airportCode];
            const v = window.ASSET_VERSION || Date.now();
            themeLink.href = theme.css + '?v=' + v;
            if (theme.class) {
                document.body.classList.add(theme.class);
            }
        } else {
            // Dynamic airport - use default theme
            const v = window.ASSET_VERSION || Date.now();
            themeLink.href = '/static/css/themes/default.css?v=' + v;
            document.body.classList.add('theme-default');
        }
        
        // Update flags (works for both configured and dynamic airports)
        updateFlags(airportCode);

        // Move flags to left group for EDDF to free up center space
        const flagContainer = document.getElementById('flagContainer');
        const footerLeft = document.querySelector('.footer-group.left');
        const footerCenterLeft = document.querySelector('.footer-group.center-left');
        if (airportCode === 'EDDF') {
            if (flagContainer && footerLeft && flagContainer.parentElement !== footerLeft) {
                footerLeft.appendChild(flagContainer);
            }
        } else {
            if (flagContainer && footerCenterLeft && flagContainer.parentElement !== footerCenterLeft) {
                footerCenterLeft.appendChild(flagContainer);
            }
        }

        updateEventTicker(airportCode);
        syncAirportNameCycle();
        applyDestinationNameMode();

    }

    async function ensureAirportInSelect(icao) {
        if (!elements.airportSelect) return false;
        const exists = Array.from(elements.airportSelect.options).some(opt => opt.value === icao);
        if (exists) return true;

        try {
            const response = await fetch('/api/search_airport', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ icao })
            });
            const data = await response.json();
            if (response.ok) {
                const option = document.createElement('option');
                option.value = icao;
                option.textContent = data.name;
                option.title = icao;
                elements.airportSelect.appendChild(option);
                return true;
            }
        } catch (e) {
            console.warn('Failed to preload dynamic airport:', icao, e);
        }

        return false;
    }

    function updateFlags(airportCode) {
        const flagContainer = document.getElementById('flagContainer');
        if (!flagContainer) return;

        const buildFlagImg = (code) => (
            `<img src="https://flagcdn.com/h40/${code.toLowerCase()}.png" alt="${code}" title="${code}">`
        );

        const renderCountryWithEU = (code) => {
            let html = buildFlagImg(code);
            if (euMembers.has(String(code).toUpperCase())) {
                html += buildFlagImg('EU');
            }
            return html;
        };

        const renderMultiCountryWithEU = (codes) => {
            const normalized = codes.map(code => String(code).toUpperCase());
            const anyEU = normalized.some(code => euMembers.has(code));
            const flags = normalized.map(code => buildFlagImg(code)).join('');
            return anyEU ? `${flags}${buildFlagImg('EU')}` : flags;
        };
        
        // Manual overrides for multi-country airports
        const manualFlags = {
            'LSGG': ['ch', 'fr'],  // Geneva: Swiss + French
            'LFSB': ['ch', 'fr']   // Basel: Swiss + French
        };
        
        if (manualFlags[airportCode]) {
            // Multi-country airport
            flagContainer.innerHTML = renderMultiCountryWithEU(manualFlags[airportCode]);
        } else {
            // Single country - get from airport database
            const countryCode = airportMapping[airportCode]?.country_code;
            if (countryCode) {
                flagContainer.innerHTML = renderCountryWithEU(countryCode);
            } else {
                // No flag data available
                flagContainer.innerHTML = '';
            }
        }
    }

    let airportNameCycleIndex = 0;

    function isJapaneseLanguageActive() {
        return window.currentLanguageCode === 'ja';
    }

    function getAirportNameCycleMax() {
        return isJapaneseLanguageActive() ? 3 : 2;
    }

    function syncAirportNameCycle() {
        airportNameCycleIndex = airportNameCycleIndex % getAirportNameCycleMax();
    }

    function getDestinationDisplayData(code, name, jpName) {
        const isJapanese = isJapaneseLanguageActive();
        const hasEnglishName = name && name !== 'undefined' && name !== code;

        if (isJapanese) {
            if (airportNameCycleIndex === 1 && hasEnglishName) {
                return { text: formatAirportNameForTheme(name), lang: 'en' };
            }
            if (airportNameCycleIndex === 2) {
                if (jpName) return { text: jpName, lang: 'ja' };
                if (hasEnglishName) return { text: formatAirportNameForTheme(name), lang: 'en' };
            }
            return { text: code, lang: 'icao' };
        }

        if (airportNameCycleIndex === 1 && hasEnglishName) {
            return { text: formatAirportNameForTheme(name), lang: 'en' };
        }
        return { text: code, lang: 'icao' };
    }

    function applyDestinationNameMode() {
        const destFlaps = document.querySelectorAll('.flap-dest');
        destFlaps.forEach(flap => {
            const code = flap.getAttribute('data-code');
            const name = flap.getAttribute('data-name');
            const jpName = flap.getAttribute('data-jp-name');
            const display = getDestinationDisplayData(code, name, jpName);
            flap.setAttribute('data-display-lang', display.lang);
            updateFlapText(flap, display.text);
        });
    }

    setInterval(() => {
        const max = getAirportNameCycleMax();
        airportNameCycleIndex = (airportNameCycleIndex + 1) % max;
        applyDestinationNameMode();
    }, 4000);

    document.addEventListener('language-change', (event) => {
        if (!event.detail || !event.detail.languageCode) return;
        syncAirportNameCycle();
        applyDestinationNameMode();
    });

    // updateFooterText is defined globally in language_handler.js

    // --- AIRPORT SWITCHER ---
    elements.airportSelect.addEventListener('change', (e) => {
        const next = normalizeIcao(e.target.value);
        switchAirport(next, { source: 'manual' });
    });

    // Initial theme and footer setup
    (async () => {
        await loadThemeMap();
        await switchAirport(currentAirport, { source: 'init' });
    })();

    // --- FULLSCREEN TOGGLE ---
    if (elements.fsBtn) {
        elements.fsBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                // Enter Fullscreen
                document.documentElement.requestFullscreen().catch(err => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                });
            } else {
                // Exit Fullscreen
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
            }
        });
    }

    // --- LOGO FALLBACK HANDLER ---
    window.handleLogoError = function(img) {
        // Track which attempt we're on (0=primary, 1=secondary, 2=tertiary, 3=failed)
        const attempt = parseInt(img.dataset.attempt || '0');
        
        if (attempt === 0 && img.dataset.secondary) {
            // First failure: try secondary
            img.dataset.attempt = '1';
            img.src = img.dataset.secondary;
        } else if (attempt === 1 && img.dataset.tertiary) {
            // Second failure: try tertiary
            img.dataset.attempt = '2';
            img.src = img.dataset.tertiary;
        } else {
            // All failed (or no fallbacks): hide the image
            img.style.display = 'none';
        }
    };

    // --- PAGINATION ENGINE ---
    const PAGE_INTERVAL_MS = 8000;
    const paginationState = {
        dep: { page: 0, rowsPerPage: 1, totalPages: 1, intervalId: null },
        arr: { page: 0, rowsPerPage: 1, totalPages: 1, intervalId: null }
    };

    function applyPagination(type, recompute = true) {
        const state = paginationState[type];
        const container = type === 'dep' ? elements.departureList : elements.arrivalList;
        if (!container) return;

        const scrollArea = container.closest('.table-scroll-area');
        const table = scrollArea ? scrollArea.querySelector('table') : null;
        const header = table ? table.querySelector('thead') : null;
        const rows = Array.from(container.children);

        if (recompute && scrollArea) {
            const headerHeight = header ? header.offsetHeight : 0;
            let rowHeight = rows[0]?.offsetHeight;
            if (!rowHeight) {
                const cssRowHeight = getComputedStyle(document.documentElement)
                    .getPropertyValue('--row-height');
                rowHeight = parseFloat(cssRowHeight) || 42;
            }

            const availableHeight = Math.max(0, scrollArea.clientHeight - headerHeight);
            const rowsPerPage = Math.max(1, Math.floor(availableHeight / rowHeight));
            const totalPages = rows.length ? Math.ceil(rows.length / rowsPerPage) : 1;

            state.rowsPerPage = rowsPerPage;
            state.totalPages = totalPages;
        }

        if (state.page >= state.totalPages) state.page = 0;

        const startIdx = state.page * state.rowsPerPage;
        const endIdx = startIdx + state.rowsPerPage;
        rows.forEach((row, idx) => {
            row.style.display = (idx >= startIdx && idx < endIdx) ? '' : 'none';
        });

        const indicator = document.getElementById(type === 'dep' ? 'depPageInd' : 'arrPageInd');
        if (indicator) {
            if (state.totalPages > 1) {
                indicator.textContent = `${state.page + 1} of ${state.totalPages}`;
                indicator.style.display = 'inline';
            } else {
                indicator.textContent = '';
                indicator.style.display = 'none';
            }
        }

        if (state.totalPages > 1) {
            if (!state.intervalId) {
                state.intervalId = setInterval(() => {
                    const currentState = paginationState[type];
                    if (currentState.totalPages <= 1) return;
                    currentState.page = (currentState.page + 1) % currentState.totalPages;
                    applyPagination(type, false);
                }, PAGE_INTERVAL_MS);
            }
        } else if (state.intervalId) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }
    }

    function initPaginationObservers() {
        const scrollAreas = document.querySelectorAll('.table-scroll-area');
        scrollAreas.forEach(area => {
            const type = area.querySelector('#departureList') ? 'dep'
                : area.querySelector('#arrivalList') ? 'arr'
                : null;
            if (!type) return;
            if ('ResizeObserver' in window) {
                const observer = new ResizeObserver(() => applyPagination(type, true));
                observer.observe(area);
            }
        });
        if (!('ResizeObserver' in window)) {
            window.addEventListener('resize', () => {
                applyPagination('dep', true);
                applyPagination('arr', true);
            });
        }
    }
    initPaginationObservers();

    // --- STATUS FLIP ENGINE (Now with clean CSS fade) ---
    setInterval(() => {
        showingDelayPhase = !showingDelayPhase;
        const cyclingCells = document.querySelectorAll('.col-status[data-has-delay="true"], .col-status[data-is-boarding="true"]');
        
        cyclingCells.forEach(cell => {
            const flapContainer = cell.querySelector('.flap-container');
            const normalStatus = cell.getAttribute('data-status-normal'); 
            const delayText = cell.getAttribute('data-status-delay');     
            const hasDelay = cell.getAttribute('data-has-delay') === 'true';
            const isBoarding = cell.getAttribute('data-is-boarding') === 'true';
            const gate = cell.getAttribute('data-gate');

            let newText, newColorClass;

            if (showingDelayPhase) {
                if (hasDelay) {
                    newText = formatStatusDisplayText(delayText);
                    const isArrivalCell = !!cell.closest('#arrivalList');
                    newColorClass = resolveStatusColorClass('Delayed', delayText, isArrivalCell);
                } else if (isBoarding) {
                    newText = formatStatusDisplayText('GO TO GATE');
                    newColorClass = 'GO TO GATE';
                }
            } else {
                newText = formatStatusDisplayText(normalStatus);
                newColorClass = normalStatus;
            }

            // Only update if text actually changes
            if (flapContainer.textContent !== newText) {
                updateStatusWithFade(flapContainer, cell, newText, newColorClass);
            }
        });
    }, 3000);

    // --- RENDER ENGINE ---
    function renderSection(type) {
        let list, container, indicator;
        if (type === 'dep') {
            list = rawFlightData.departures || [];
            container = elements.departureList;
            indicator = document.getElementById('depPageInd');
        } else if (type === 'arr') {
            list = rawFlightData.arrivals || [];
            container = elements.arrivalList;
            indicator = document.getElementById('arrPageInd');
        } else { return; }

        if (indicator) indicator.style.display = 'none';
        updateTableSmart(list, container, type === 'dep' ? 'Departures' : 'Arrivals');
        applyPagination(type, true);
    }

    function updateTableSmart(flights, container, type) {
        const existingRows = Array.from(container.children);
        const seenIds = new Set();

        flights.forEach(flight => {
            const safeCallsign = String(flight.callsign || '').trim().toUpperCase();
            const rowId = `row-${type === 'Departures' ? 'dep' : 'arr'}-${safeCallsign}`;
            seenIds.add(rowId);
            let row = document.getElementById(rowId);
            
            const prefix = safeCallsign.substring(0, 3).toUpperCase();
            const code = airlineLogoAliases[prefix] || airlineMapping[prefix] || prefix;
            
            // Define cargo/special operators that we have stored locally
            const localOnlyAirlines = ['FX', 'FDX', 'UPS', '5X', 'REGA', 'SAZ'];

            // Determine logo source priority
            let primaryLogo, secondaryLogo, tertiaryLogo;

            if (virtualAirlines.has(prefix)) {
                // Virtual/VATSIM airlines: local only, no CDN fallback
                primaryLogo = `/static/logos/${prefix}.png`;
                secondaryLogo = '';
                tertiaryLogo = '';
            } else if (localOnlyAirlines.includes(code)) {
                // Cargo/special operators: Try local first
                primaryLogo = `/static/logos/${code}.png`;
                secondaryLogo = `https://images.kiwi.com/airlines/64/${code}.png`;
                tertiaryLogo = `https://content.r9cdn.net/rimg/provider-logos/airlines/v/${code}.png`;
            } else {
                // Regular airlines: Try CDN first
                primaryLogo = `https://images.kiwi.com/airlines/64/${code}.png`;
                secondaryLogo = `https://content.r9cdn.net/rimg/provider-logos/airlines/v/${code}.png`;
                tertiaryLogo = `/static/logos/${code}.png`;
            }

            const destIcao = (type === 'Arrivals') ? flight.origin : flight.destination;
            const destName = (airportMapping[destIcao]?.name) || destIcao;
            const timeStr = flight.time_display || "--:--";
            
            let gate = flight.gate || 'TBA'; 
            let isGateWaiting = false;

            if (type === 'Departures') {
                if (flight.status === 'Taxiing' || flight.status === 'Departing') gate = 'CLOSED'; 
            } else if (type === 'Arrivals') {
                if (!gate || gate === 'TBA') {
                    if (flight.status === 'Landed' || flight.status === 'Landing') {
                        gate = 'WAIT';
                        isGateWaiting = true;
                    }
                }
            }

            const canShowDelay = ['Boarding', 'Check-in', 'Pushback', 'Taxiing', 'Departing', 'Approaching', 'Landing'].includes(flight.status);
            const hasDelay = (flight.delay_text && canShowDelay);
            const isBoarding = (flight.status === 'Boarding' && gate && gate !== 'TBA' && gate !== 'CLOSED');

            let displayStatus = flight.status;
            let displayColorClass = flight.status;

            if (!row) {
                row = document.createElement('tr');
                row.id = rowId;
                
                const commonCells = `
                    <td>
                        <div class="flight-cell" id="${rowId}-cell">
                            ${type === 'Departures' ? '<span class="boarding-lights"></span>' : ''}
                            <img src="${primaryLogo}"
                                 data-primary="${primaryLogo}"
                                 data-secondary="${secondaryLogo}"
                                 data-tertiary="${tertiaryLogo}"
                                 class="airline-logo"
                                 style="filter: none;"
                                 onerror="handleLogoError(this)">
                            <div class="flap-container" id="${rowId}-callsign"></div>
                            <button class="gate-info-btn" title="Gate info">ⓘ</button>
                        </div>
                    </td>
                    <td><div class="flap-container flap-dest" id="${rowId}-dest"></div></td>
                    <td><div class="flap-container" id="${rowId}-ac"></div></td>
                `;

                if (type === 'Departures') {
                    row.innerHTML = `
                        ${commonCells}
                        <td><div class="flap-container" id="${rowId}-checkin"></div></td>
                        <td class="col-gate"><div class="flap-container" id="${rowId}-gate"></div></td> 
                        <td><div class="flap-container" id="${rowId}-time"></div></td>
                        <td class="col-status"><div class="flap-container" id="${rowId}-status"></div></td>
                    `;
                } else {
                    row.innerHTML = `
                        ${commonCells}
                        <td></td> 
                        <td class="col-gate"><div class="flap-container" id="${rowId}-gate"></div></td> 
                        <td><div class="flap-container" id="${rowId}-time"></div></td>
                        <td class="col-status"><div class="flap-container" id="${rowId}-status"></div></td>
                    `;
                }
                
                // Add the row to the DOM first
                container.appendChild(row);
            }

            row.setAttribute('data-callsign', safeCallsign);
            row.setAttribute('data-track-origin', String(flight.origin || ''));
            row.setAttribute('data-track-destination', String(flight.destination || ''));
            if (flightTracker) {
                row.classList.toggle('is-tracked', flightTracker.isTrackedCallsign(safeCallsign));
                if (!row.dataset.trackingBound) {
                    row.dataset.trackingBound = '1';
                    const toggleTrackedFlight = () => {
                        const callsign = row.getAttribute('data-callsign');
                        if (!callsign || !flightTracker) return;
                        const origin = row.getAttribute('data-track-origin') || '';
                        const destination = row.getAttribute('data-track-destination') || '';
                        flightTracker.toggleTracking({ callsign, origin, destination });
                        refreshTrackedRowHighlights();
                        flightTracker.processFlightData(rawFlightData, currentAirport);
                    };

                    row.addEventListener('click', () => {
                        // iOS often fires click after touchend; ignore duplicate click toggles.
                        if (Date.now() - lastTouchTrackToggleAt < 600) return;
                        toggleTrackedFlight();
                    });

                    row.addEventListener('touchend', (event) => {
                        event.preventDefault();
                        lastTouchTrackToggleAt = Date.now();
                        toggleTrackedFlight();
                    });
                }
            }

            if (!row.dataset.gateInfoBound) {
                row.dataset.gateInfoBound = '1';
                const gateBtn = row.querySelector('.gate-info-btn');
                if (gateBtn) {
                    gateBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openGateDisplay(safeCallsign, type);
                    });
                    gateBtn.addEventListener('touchend', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        openGateDisplay(safeCallsign, type);
                    });
                }
            }

            // NOW update the flight data attribute (safe because row is in DOM)
            const flightCell = document.getElementById(`${rowId}-cell`);
            if (flightCell) {
                flightCell.setAttribute('data-route', flight.route || 'No route');
                flightCell.setAttribute('data-speed', flight.groundspeed ?? '');
                flightCell.setAttribute('data-altitude', flight.altitude ?? '');
                flightCell.setAttribute('data-squawk', flight.squawk || '');
            }

            updateFlapText(document.getElementById(`${rowId}-callsign`), flight.callsign);
            
            const destFlap = document.getElementById(`${rowId}-dest`);
            const destDisplayName = airportMapping[destIcao]?.name || destIcao;
            const destJapaneseName = airportJapaneseMapping[destIcao] || '';
            destFlap.setAttribute('data-code', destIcao);
            destFlap.setAttribute('data-name', destDisplayName);
            destFlap.setAttribute('data-jp-name', destJapaneseName);
            const display = getDestinationDisplayData(destIcao, destDisplayName, destJapaneseName);
            destFlap.setAttribute('data-display-lang', display.lang);
            updateFlapText(destFlap, display.text);

            updateFlapText(document.getElementById(`${rowId}-ac`), flight.aircraft);
            updateFlapText(document.getElementById(`${rowId}-time`), timeStr);
            
            const checkinFlap = document.getElementById(`${rowId}-checkin`);
            if (checkinFlap) {
                updateFlapText(checkinFlap, formatLszhOperationalLabel(flight.checkin || ""));
                if (flight.checkin === 'CLOSED') {
                    checkinFlap.classList.add('gate-closed');
                } else {
                    checkinFlap.classList.remove('gate-closed');
                }
            } 

            const gateContainer = document.getElementById(`${rowId}-gate`);
            updateFlapText(gateContainer, formatLszhOperationalLabel(gate));
            if (isGateWaiting) {
                gateContainer.classList.add('status-wait');
                gateContainer.classList.remove('gate-closed');
            } else {
                gateContainer.classList.remove('status-wait');
                if (gate === 'CLOSED') {
                    gateContainer.classList.add('gate-closed');
                } else {
                    gateContainer.classList.remove('gate-closed');
                }
            }
            
            const statusCell = row.querySelector('.col-status');
            const statusFlaps = document.getElementById(`${rowId}-status`);
            
            statusCell.setAttribute('data-has-delay', hasDelay ? "true" : "false");
            statusCell.setAttribute('data-is-boarding', isBoarding ? "true" : "false");
            if (flightCell) flightCell.classList.toggle('is-boarding', isBoarding);
            statusCell.setAttribute('data-gate', gate);
            statusCell.setAttribute('data-status-normal', flight.status);
            statusCell.setAttribute('data-status-delay', flight.delay_text || "");
            
            if (showingDelayPhase) {
                if (hasDelay) {
                    displayStatus = flight.delay_text;
                    displayColorClass = resolveStatusColorClass('Delayed', flight.delay_text, type === 'Arrivals');
                } else if (isBoarding) {
                    displayStatus = 'GO TO GATE';
                    displayColorClass = 'GO TO GATE';
                }
            }
            
            // Use fade animation for status updates
            const formattedStatus = formatStatusDisplayText(displayStatus);
            if (statusFlaps.textContent !== formattedStatus) {
                updateStatusWithFade(statusFlaps, statusCell, formattedStatus, displayColorClass);
            } else {
                statusCell.setAttribute('data-status', displayColorClass);
            }

            // CRITICAL FIX: Ensure the row is visually sorted
            // Since 'flights' is already sorted by the backend, appending the row here
            // moves it to the correct chronological position in the table.
            container.appendChild(row);
        });

        existingRows.forEach(row => {
            if (!seenIds.has(row.id)) row.remove();
        });
    }   

    // --- STANDARD: Plain text rendering, or split-flap animation for EDDF ---
    function updateFlapText(container, newText) {
        if (!container) return;
        if (window.SplitFlap) {
            window.SplitFlap.animateContainer(container, String(newText || ''));
        } else {
            container.textContent = String(newText || '');
        }
    }

    // --- SPECIAL: Smooth opacity fade for status changes (split-flap for EDDF) ---
    function updateStatusWithFade(container, statusCell, newText, newColorClass) {
        if (!container) return;

        if (window.SplitFlap && document.body.classList.contains('theme-eddf')) {
            // Colour change is instant; text animates via split-flap
            statusCell.setAttribute('data-status', newColorClass);
            window.SplitFlap.animateContainer(container, newText);
            return;
        }

        // Standard opacity fade for all other themes
        container.classList.add('status-updating');
        setTimeout(() => {
            container.textContent = newText;
            statusCell.setAttribute('data-status', newColorClass);
            container.classList.remove('status-updating');
        }, 175); // Half of the 350ms transition duration
    }

    function updateClock() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false });
        if (elements.lastUpdate) elements.lastUpdate.textContent = timeString;
    }
    updateClock(); 
    setInterval(updateClock, 1000);

    async function updateEventTicker(airportCode) {
        const ticker = document.getElementById('eventTicker');
        const track  = document.getElementById('eventTickerTrack');
        if (!ticker || !track) return;

        try {
            const resp = await fetch(`/api/events?icao=${encodeURIComponent(airportCode)}`);
            if (!resp.ok) throw new Error('fetch failed');
            const { events } = await resp.json();

            if (!events || events.length === 0) {
                ticker.style.display = 'none';
                return;
            }

            const pad = n => String(n).padStart(2, '0');
            const items = events.map(ev => {
                const start = new Date(ev.start);
                const end   = new Date(ev.end);
                const day   = start.toLocaleDateString('en-GB', {
                    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'
                });
                const times = `${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())}\u2013${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}z`;
                return `<span class="event-ticker-item">${ev.name} &mdash; ${day} ${times}</span>`;
            }).join('');

            // Structure: [items][gap][items][gap]
            // The gap is one full viewport width, ensuring the two copies
            // are never on screen at the same time regardless of content length.
            const gap = `<span class="event-ticker-gap"></span>`;
            track.innerHTML = items + gap + items + gap;

            // Show ticker before measuring so scrollWidth is accurate
            ticker.style.display = '';

            // Reset animation, measure loop distance (half of total track), set duration
            track.style.animation = 'none';
            track.offsetHeight; // force reflow
            const loopWidth = track.scrollWidth / 2;
            const duration = Math.max(15, loopWidth / 70);
            track.style.animation = '';
            track.style.animationDuration = `${duration}s`;
        } catch (e) {
            ticker.style.display = 'none';
        }
    }

    function updateSecurityTime(data) {
        const securityEl = document.getElementById('securityTime');
        if (!securityEl) return;
        const depCount = (data && data.departures) ? data.departures.length : 0;
        const arrCount = (data && data.arrivals) ? data.arrivals.length : 0;
        const totalFlights = depCount + arrCount;

        let minutes = 6 + Math.floor(totalFlights / 4);
        minutes = Math.max(5, Math.min(25, minutes));
        securityEl.innerHTML = `${minutes} <small>minutes</small>`;
    }


    function updateAtcWidget(controllers) {
        const atcWidget = document.getElementById('atcWidget');
        const atcIcon = document.getElementById('atcIcon');
        const atcListContent = document.getElementById('atcListContent');
        
        // Filter out OBS (Observer) positions if any sneak in
        const activeControllers = (controllers || []).filter(c => !c.callsign.endsWith('_OBS'));

        if (activeControllers.length > 0) {
            atcWidget.classList.add('active', 'atc-online');
            
            // Sort priority: TWR > APP > GND > DEL
            const typePriority = { 'DEL': 1, 'GND': 2, 'TWR': 3, 'APP': 4, 'DEP': 4, 'CTR': 5 };
            
            activeControllers.sort((a, b) => {
                const typeA = a.callsign.split('_').pop();
                const typeB = b.callsign.split('_').pop();
                return (typePriority[typeB] || 0) - (typePriority[typeA] || 0);
            });

            // Build the tooltip list
            atcListContent.innerHTML = activeControllers.map(c => `
                <li>
                    <span>${c.callsign}</span>
                    <span class="freq">${c.frequency}</span>
                </li>
            `).join('');
        } else {
            atcWidget.classList.remove('active', 'atc-online');
            atcListContent.innerHTML = '<li>No active controllers</li>';
        }
    }

    function updateWeatherWidget(metar) {
        const widget = document.getElementById('weatherWidget');
        const iconEl = document.getElementById('wxIcon');
        const tempEl = document.getElementById('wxTemp');

        updateMetarPopover(metar);

        if (!metar || metar === 'Unavailable') {
            widget.classList.remove('active');
            return;
        }

        widget.classList.add('active');

        // 1. Parse Temperature (Look for pattern "12/10" or "M02/M05")
        // Regex matches 2 digits, optional 'M' prefix, followed by slash
        const tempMatch = metar.match(/(M?\d{2})\/(?:M?\d{2})/);
        if (tempMatch) {
            let temp = tempMatch[1].replace('M', '-'); // Convert "M05" to "-05"
            temp = parseInt(temp, 10); // Remove leading zeros
            tempEl.textContent = `${temp}°`;
        }

        // 2. Determine Conditions for Icon
        let icon = 'wb_sunny'; // Default Clear/Sunny

        // Use Material Icons ligatures that exist in the classic set
        if (metar.includes('TS')) icon = 'flash_on'; // Thunderstorm
        else if (metar.includes('SN') || metar.includes('SG')) icon = 'ac_unit'; // Snow
        else if (metar.includes('RA') || metar.includes('DZ')) icon = 'opacity'; // Rain/Drizzle
        else if (metar.includes('FG') || metar.includes('BR')) icon = 'blur_on'; // Fog/Mist
        else if (metar.includes('OVC') || metar.includes('BKN')) icon = 'cloud'; // Overcast/Broken
        else if (metar.includes('SCT') || metar.includes('FEW')) icon = 'wb_cloudy'; // Scattered/Few
        else if (metar.includes('CAVOK') || metar.includes('CLR') || metar.includes('NSC')) icon = 'wb_sunny'; // Clear

        // 3. Night tweak (based on METAR UTC time group DDHHMMZ)
        if (icon === 'wb_sunny') {
            const timeMatch = metar.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
            if (timeMatch) {
                const hour = parseInt(timeMatch[2], 10);
                const isNightUtc = (hour >= 20 || hour < 6);
                if (isNightUtc) icon = 'bedtime';
            }
        }
        
        iconEl.textContent = icon;
    }
    
    function updateMetarPopover(metar) {
        const rawEl = document.getElementById('metarRaw');
        const decodedEl = document.getElementById('metarDecoded');
        if (!rawEl || !decodedEl) return;

        if (!metar || metar === 'Unavailable') {
            rawEl.textContent = 'No METAR available';
            decodedEl.innerHTML = '';
            return;
        }

        rawEl.textContent = metar;

        const decoded = [];

        // Wind: e.g. 23015KT or 23015G25KT or VRB05KT
        const windMatch = metar.match(/\b(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?KT\b/);
        if (windMatch) {
            const dir = windMatch[1] === 'VRB' ? 'Variable' : `${windMatch[1]}°`;
            const spd = parseInt(windMatch[2]);
            const gust = windMatch[4] ? ` G${parseInt(windMatch[4])}kt` : '';
            decoded.push({ label: 'Wind', value: `${dir} at ${spd}kt${gust}` });
        }

        // Visibility: 4-digit metric (strip time group & wind first to avoid false matches)
        if (metar.includes('CAVOK')) {
            decoded.push({ label: 'Visibility', value: 'CAVOK (≥10km, No Sig. Cloud)' });
        } else {
            const stripped = metar.replace(/\b\d{6}Z\b/, '').replace(/\b(VRB|\d{3})\d{2,3}(G\d{2,3})?KT\b/, '');
            const visMatch = stripped.match(/\b(\d{4})\b/);
            if (visMatch) {
                const vis = parseInt(visMatch[1]);
                decoded.push({ label: 'Visibility', value: vis >= 9999 ? '≥10km' : `${vis}m` });
            }
        }

        // Cloud layers: FEW/SCT/BKN/OVC + 3-digit altitude, or SKC/CLR/NSC
        if (!metar.includes('CAVOK')) {
            const cloudRe = /\b(SKC|CLR|NSC|FEW|SCT|BKN|OVC)(\d{3})?\b/g;
            const layers = [];
            let cm;
            while ((cm = cloudRe.exec(metar)) !== null) {
                if (['SKC', 'CLR', 'NSC'].includes(cm[1])) { layers.push('Clear'); break; }
                const alt = cm[2] ? ` ${parseInt(cm[2]) * 100}ft` : '';
                layers.push(`${cm[1]}${alt}`);
            }
            if (layers.length) decoded.push({ label: 'Cloud', value: layers.join('  ') });
        }

        // Temperature / Dewpoint
        const tMatch = metar.match(/\b(M?\d{2})\/(M?\d{2})\b/);
        if (tMatch) {
            const t = parseInt(tMatch[1].replace('M', '-'));
            const dp = parseInt(tMatch[2].replace('M', '-'));
            decoded.push({ label: 'Temp / Dew', value: `${t}° / ${dp}°C` });
        }

        // Altimeter
        const qMatch = metar.match(/\bQ(\d{4})\b/);
        const aMatch = metar.match(/\bA(\d{4})\b/);
        if (qMatch) decoded.push({ label: 'QNH', value: `${qMatch[1]} hPa` });
        else if (aMatch) decoded.push({ label: 'Altimeter', value: `${aMatch[1].slice(0,2)}.${aMatch[1].slice(2)}" Hg` });

        decodedEl.innerHTML = decoded.map(d =>
            `<div class="metar-row"><span class="metar-label">${d.label}</span><span class="metar-value">${d.value}</span></div>`
        ).join('');
    }

    function openGateDisplay(callsign, type) {
        if (!callsign) return;
        const isDep = type === 'Departures';
        const flights = isDep ? rawFlightData.departures : rawFlightData.arrivals;
        const flight = (flights || []).find(f => (f.callsign || '').toUpperCase() === callsign);
        if (!flight) return;

        const modal = document.getElementById('gateDisplayModal');
        const content = document.getElementById('gateDisplayContent');
        if (!modal || !content) return;

        const airportCode = isDep ? flight.destination : flight.origin;
        const airportName = airportMapping[airportCode]?.name || airportCode;

        // Logo (reuse existing logo resolution logic)
        const prefix = callsign.substring(0, 3);
        const code = airlineLogoAliases[prefix] || airlineMapping[prefix] || prefix;
        const localOnlyAirlines = ['FX', 'FDX', 'UPS', '5X', 'REGA', 'SAZ'];
        let logoSrc;
        if (virtualAirlines.has(prefix)) {
            logoSrc = `/static/logos/${prefix}.png`;
        } else if (localOnlyAirlines.includes(code)) {
            logoSrc = `/static/logos/${code}.png`;
        } else {
            logoSrc = `https://images.kiwi.com/airlines/64/${code}.png`;
        }

        let gate = flight.gate || 'TBA';
        if (isDep && (flight.status === 'Taxiing' || flight.status === 'Departing')) gate = 'CLOSED';

        const status = flight.status || '–';
        const timeLabel = isDep ? 'Departure' : 'Arrival';

        content.innerHTML = `
            <div class="gate-display-header">
                <div class="gate-display-flight-num">${callsign}</div>
                <img src="${logoSrc}" class="gate-display-logo" onerror="this.style.display='none'">
            </div>
            <div class="gate-display-destination">
                <div class="gate-display-city">${airportName}</div>
                <div class="gate-display-icao">${airportCode}</div>
            </div>
            <div class="gate-display-grid">
                <div class="gate-display-cell">
                    <div class="gate-display-cell-label">Status</div>
                    <div class="gate-display-cell-value">
                        <span class="gate-status-badge" data-status="${status}">${status}</span>
                    </div>
                </div>
                <div class="gate-display-cell">
                    <div class="gate-display-cell-label">Gate</div>
                    <div class="gate-display-cell-value">${gate}</div>
                </div>
                <div class="gate-display-cell">
                    <div class="gate-display-cell-label">${timeLabel}</div>
                    <div class="gate-display-cell-value">${flight.time_display || '–'}</div>
                </div>
                <div class="gate-display-cell">
                    <div class="gate-display-cell-label">Aircraft</div>
                    <div class="gate-display-cell-value">${flight.aircraft || '–'}</div>
                </div>
            </div>
        `;

        modal.style.display = 'block';
    }

    // ====== AIRPORT SEARCH MODAL ======
    
    const modal = document.getElementById('airportSearchModal');
    const addBtn = document.getElementById('addAirportBtn');
    const closeBtn = document.getElementsByClassName('close')[0];
    const searchBtn = document.getElementById('searchAirportBtn');
    const searchInput = document.getElementById('airportSearchInput');
    const searchResult = document.getElementById('searchResult');
    const airportSelect = document.getElementById('airportSelect');

    // Open modal
    if (addBtn) {
        addBtn.onclick = function() {
            modal.style.display = 'block';
            searchInput.value = '';
            searchResult.textContent = '';
            searchResult.className = '';
            searchResult.style.display = 'none';
            searchInput.focus();
        }
    }

    // Close modal with X button
    if (closeBtn) {
        closeBtn.onclick = function() {
            modal.style.display = 'none';
        }
    }

    // Close modal when clicking outside
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    }

    // Search button click
    if (searchBtn) {
        searchBtn.onclick = async function() {
            const icao = searchInput.value.toUpperCase().trim();
            
            if (icao.length !== 4) {
                searchResult.textContent = 'Please enter a 4-letter ICAO code';
                searchResult.className = 'error';
                searchResult.style.display = 'block';
                return;
            }
            
            // Show loading state
            searchResult.textContent = 'Searching...';
            searchResult.className = '';
            searchResult.style.display = 'block';
            searchBtn.disabled = true;
            searchBtn.textContent = 'Searching...';
            
            try {
                const response = await fetch('/api/search_airport', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ icao: icao })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    searchResult.textContent = `✓ ${data.name} (${icao}) added!`;
                    searchResult.className = 'success';
                    searchResult.style.display = 'block';
                    
                    // Add to dropdown if not already there
                    const exists = Array.from(airportSelect.options).some(opt => opt.value === icao);
                    if (!exists) {
                        const option = document.createElement('option');
                        option.value = icao;
                        option.textContent = `${data.name}`;
                        option.title = icao;
                        airportSelect.appendChild(option);
                    }
                    
                    // Switch to the new airport
                    airportSelect.value = icao;
                    await switchAirport(icao, {
                        source: 'manual',
                        country: data.country || '',
                        ensureInSelect: false
                    });
                    
                    // Close modal after delay
                    setTimeout(() => {
                        modal.style.display = 'none';
                    }, 1500);
                    
                } else {
                    searchResult.textContent = data.error || 'Airport not found';
                    searchResult.className = 'error';
                    searchResult.style.display = 'block';
                }
            } catch (error) {
                searchResult.textContent = 'Network error. Please try again.';
                searchResult.className = 'error';
                searchResult.style.display = 'block';
                console.error('Search error:', error);
            } finally {
                // Reset button
                searchBtn.disabled = false;
                searchBtn.textContent = 'Search';
            }
        }
    }

    // Enter key to search
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchBtn.click();
            }
        });
        
        // Auto-uppercase and limit to 4 chars
        searchInput.addEventListener('input', function(e) {
            this.value = this.value.toUpperCase().slice(0, 4);
        });
    }
    // ====== HELP MODAL ======
    const helpModal = document.getElementById('helpModal');
    const helpBtn = document.getElementById('helpBtn');
    const helpModalClose = document.getElementById('helpModalClose');

    if (helpBtn) {
        helpBtn.onclick = function() { helpModal.style.display = 'block'; };
    }
    if (helpModalClose) {
        helpModalClose.onclick = function() { helpModal.style.display = 'none'; };
    }
    window.addEventListener('click', function(e) {
        if (e.target === helpModal) helpModal.style.display = 'none';
    });

    // ====== GATE DISPLAY MODAL ======
    const gateDisplayModal = document.getElementById('gateDisplayModal');
    const gateDisplayClose = document.querySelector('.gate-display-close');

    if (gateDisplayClose) {
        gateDisplayClose.onclick = () => { gateDisplayModal.style.display = 'none'; };
    }
    window.addEventListener('click', (e) => {
        if (e.target === gateDisplayModal) gateDisplayModal.style.display = 'none';
    });

    // --- FLIGHT TOOLTIP LOGIC ---
    const tooltip = document.getElementById('flightTooltip');

    document.addEventListener('mouseover', (e) => {
        const cell = e.target.closest('.flight-cell');

        if (cell) {
            const speed = cell.getAttribute('data-speed');
            const altitude = cell.getAttribute('data-altitude');
            const squawk = cell.getAttribute('data-squawk');

            const rows = [];
            if (speed !== null && speed !== '') rows.push({ label: 'Gnd Speed', value: `${speed} kts` });
            if (altitude !== null && altitude !== '') rows.push({ label: 'Altitude', value: `${parseInt(altitude).toLocaleString()} ft` });
            if (squawk) rows.push({ label: 'Squawk', value: squawk });

            if (rows.length) {
                tooltip.innerHTML = rows.map(r =>
                    `<div class="tt-row"><span class="tt-label">${r.label}</span><span class="tt-value">${r.value}</span></div>`
                ).join('');
                tooltip.style.display = 'block';
            } else {
                tooltip.style.display = 'none';
            }
        } else {
            tooltip.style.display = 'none';
        }
    });

    document.addEventListener('mousemove', (e) => {
        // Move tooltip with mouse
        if (tooltip.style.display === 'block') {
            tooltip.style.left = (e.clientX + 15) + 'px';
            tooltip.style.top = (e.clientY + 15) + 'px';
        }
    });
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (gateDisplayModal && gateDisplayModal.style.display === 'block') {
                gateDisplayModal.style.display = 'none';
            }
        }

        const select = elements.airportSelect;
        
        // Arrow keys to cycle through airports
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (select.selectedIndex < select.options.length - 1) {
                select.selectedIndex++;
                select.dispatchEvent(new Event('change'));
            }
        }
        
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (select.selectedIndex > 0) {
                select.selectedIndex--;
                select.dispatchEvent(new Event('change'));
            }
        }
        
        // Number keys for direct airport selection
        const numKey = parseInt(e.key);
        if (numKey >= 1 && numKey <= select.options.length) {
            select.selectedIndex = numKey - 1;
            select.dispatchEvent(new Event('change'));
        }
    });
});
