document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- SOCKET LISTENER ---
    
    // Automatically join the current airport when connected
    socket.on('connect', () => {
        console.log('Connected via WebSockets. Joining:', currentAirport);
        socket.emit('join_airport', { airport: currentAirport });
    });

    socket.on('flight_update', (data) => {
        console.log('Flight update received:', data);
        console.log('Country from data:', data.country); // DEBUG
        rawFlightData = data;
        if (data.airport_name) elements.airportName.textContent = data.airport_name;
        // Update ATC and Weather widgets
        updateAtcWidget(data.controllers);
        updateWeatherWidget(data.metar);
        // Update footer text with country information
        window.updateFooterText(currentAirport, data.country);
        
        renderSection('dep');
        renderSection('arr');
    });

    // --- STATE MANAGEMENT ---
    let currentAirport = 'LSZH';
    let rawFlightData = { departures: [], arrivals: [] };
    
    // Global flag to track the display cycle (Status vs Delay)
    let showingDelayPhase = false;

    const elements = {
        airportSelect: document.getElementById('airportSelect'),
        airportName: document.getElementById('airportName'),
        departureList: document.getElementById('departureList'),
        arrivalList: document.getElementById('arrivalList'),
        lastUpdate: document.getElementById('lastUpdate'),
        fsBtn: document.getElementById('fullscreenBtn')
    };

    // --- Dynamic Data Sources ---
    const airlineMapping = { 
        'SWS': 'LX', 'EZY': 'U2', 'EJU': 'U2', 'EZS': 'DS', 'BEL': 'SN', 
        'GWI': '4U', 'EDW': 'WK', 'ITY': 'AZ', 'FDX': 'FX', 'UPS': '5X', 
        'GEC': 'LH', 'BCS': 'QY', 'SAZ': 'REGA', 'SHT': 'BA'
    };
    const airportMapping = {}; 
    const airportJapaneseMapping = {};

    async function loadDatabases() {
        // This is the missing block that fixes your logos
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

        // This is your existing airport logic
        try {
            const response = await fetch('https://raw.githubusercontent.com/mwgg/Airports/master/airports.json');
            if (response.ok) {
                const data = await response.json();
                const manualRenames = {
                    "EGLL": "London Heathrow", "EGKK": "London Gatwick", "EGSS": "London Stansted",
                    "EGGW": "London Luton", "EGLC": "London City", "KJFK": "New York JFK",
                    "KEWR": "Newark", "KLGA": "New York LaGuardia", "LFPG": "Paris CDG",
                    "LFPO": "Paris Orly", "EDDF": "Frankfurt", "EDDM": "Munich",
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

        await loadJapaneseAirportNames();
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
        // Remove all existing theme classes
        document.body.classList.remove('theme-lszh', 'theme-lsgg', 'theme-lfsb', 'theme-egll','theme-eglc', 'theme-kjfk', 'theme-default', 'theme-egkk', 'theme-egss', 'theme-rjtt');
        
        // Theme mapping for configured airports
        const themeMap = {
            'LSZH': {
                css: '/static/css/themes/lszh.css',
                class: 'theme-lszh'
            },
            'LSGG': {
                css: '/static/css/themes/lsgg.css',
                class: 'theme-lsgg'
            },
            'LFSB': {
                css: '/static/css/themes/lfsb.css',
                class: 'theme-lfsb'
            },
            'EGLL': {
                css: '/static/css/themes/egll.css',
                class: 'theme-egll'
            },
            'EGLC': {
                css: '/static/css/themes/eglc.css',
                class: 'theme-eglc'
            },
            'EGKK': {
                css: '/static/css/themes/egkk.css',
                class: 'theme-egkk'
            },
            'EGSS': {
                css: '/static/css/themes/egss.css',
                class: 'theme-egss'
            },
            'KJFK': {
                css: '/static/css/themes/kjfk.css',
                class: 'theme-kjfk'
            },
            'RJTT': {
                css: '/static/css/themes/rjtt.css',
                class: 'theme-rjtt'
            }
        };
        
        const themeLink = document.getElementById('airportTheme');
        
        // Check if this is a configured airport with a specific theme
        if (themeMap[airportCode]) {
            const theme = themeMap[airportCode];
            themeLink.href = theme.css;
            if (theme.class) {
                document.body.classList.add(theme.class);
            }
        } else {
            // Dynamic airport - use default theme
            themeLink.href = '/static/css/themes/default.css';
            document.body.classList.add('theme-default');
        }
        
        // Update flags (works for both configured and dynamic airports)
        updateFlags(airportCode);
        syncAirportNameCycle();
        applyDestinationNameMode();

    }

    function updateFlags(airportCode) {
        const flagContainer = document.getElementById('flagContainer');
        if (!flagContainer) return;
        
        // Manual overrides for multi-country airports
        const manualFlags = {
            'LSGG': ['ch', 'fr'],  // Geneva: Swiss + French
            'LFSB': ['ch', 'fr']   // Basel: Swiss + French
        };
        
        if (manualFlags[airportCode]) {
            // Multi-country airport
            flagContainer.innerHTML = manualFlags[airportCode]
                .map(country => `<img src="https://flagcdn.com/h40/${country}.png" alt="${country}" title="${country}">`)
                .join('');
        } else {
            // Single country - get from airport database
            const countryCode = airportMapping[airportCode]?.country_code;
            if (countryCode) {
                flagContainer.innerHTML = `<img src="https://flagcdn.com/h40/${countryCode.toLowerCase()}.png" alt="${countryCode}" title="${countryCode}">`;
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
                return { text: name.toUpperCase(), lang: 'en' };
            }
            if (airportNameCycleIndex === 2) {
                if (jpName) return { text: jpName, lang: 'ja' };
                if (hasEnglishName) return { text: name.toUpperCase(), lang: 'en' };
            }
            return { text: code, lang: 'icao' };
        }

        if (airportNameCycleIndex === 1 && hasEnglishName) {
            return { text: name.toUpperCase(), lang: 'en' };
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
        socket.emit('leave_airport', { airport: currentAirport });
        currentAirport = e.target.value;
        updateTheme(currentAirport);
        // Country will be updated when flight_update arrives
        window.updateFooterText(currentAirport, '');
        socket.emit('join_airport', { airport: currentAirport });
        elements.departureList.innerHTML = '';
        elements.arrivalList.innerHTML = '';
        applyPagination('dep', true);
        applyPagination('arr', true);
    });

    // Initial theme and footer setup
    updateTheme(currentAirport);
    window.updateFooterText(currentAirport, '');

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
        
        if (attempt === 0) {
            // First failure: try secondary
            img.dataset.attempt = '1';
            img.src = img.dataset.secondary;
        } else if (attempt === 1) {
            // Second failure: try tertiary
            img.dataset.attempt = '2';
            img.src = img.dataset.tertiary;
        } else {
            // All failed: hide the image
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
                    newText = delayText.toUpperCase();
                    newColorClass = 'Delayed';
                } else if (isBoarding) {
                    newText = `GO TO GATE ${gate}`;
                    newColorClass = 'GO TO GATE';
                }
            } else {
                newText = normalStatus.toUpperCase();
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
            const rowId = `row-${flight.callsign}`;
            seenIds.add(rowId);
            let row = document.getElementById(rowId);
            
            const prefix = flight.callsign.substring(0, 3).toUpperCase();
            const code = airlineMapping[prefix] || prefix;
            
            // Define cargo/special operators that we have stored locally
            const localOnlyAirlines = ['FX', 'FDX', 'UPS', '5X', 'REGA', 'SAZ'];
            
            // Determine logo source priority
            let primaryLogo, secondaryLogo, tertiaryLogo;
            
            if (localOnlyAirlines.includes(code)) {
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
                            <img src="${primaryLogo}" 
                                 data-primary="${primaryLogo}"
                                 data-secondary="${secondaryLogo}"
                                 data-tertiary="${tertiaryLogo}"
                                 class="airline-logo" 
                                 style="filter: none;" 
                                 onerror="handleLogoError(this)">
                            <div class="flap-container" id="${rowId}-callsign"></div>
                        </div>
                    </td>
                    <td><div class="flap-container flap-dest" id="${rowId}-dest"></div></td>
                    <td><div class="flap-container" id="${rowId}-ac"></div></td>
                `;

                if (type === 'Departures') {
                    row.innerHTML = `
                        ${commonCells}
                        <td><div class="flap-container" id="${rowId}-checkin"></div></td>
                        <td><div class="flap-container" id="${rowId}-gate"></div></td> 
                        <td><div class="flap-container" id="${rowId}-time"></div></td>
                        <td class="col-status"><div class="flap-container" id="${rowId}-status"></div></td>
                    `;
                } else {
                    row.innerHTML = `
                        ${commonCells}
                        <td></td> 
                        <td><div class="flap-container" id="${rowId}-gate"></div></td> 
                        <td><div class="flap-container" id="${rowId}-time"></div></td>
                        <td class="col-status"><div class="flap-container" id="${rowId}-status"></div></td>
                    `;
                }
                
                // Add the row to the DOM first
                container.appendChild(row);
            }

            // NOW update the flight data attribute (safe because row is in DOM)
            const flightCell = document.getElementById(`${rowId}-cell`);
            if (flightCell) {
                flightCell.setAttribute('data-route', flight.route || 'No route');
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
                updateFlapText(checkinFlap, flight.checkin || "");
                if (flight.checkin === 'CLOSED') {
                    checkinFlap.classList.add('gate-closed');
                } else {
                    checkinFlap.classList.remove('gate-closed');
                }
            } 

            const gateContainer = document.getElementById(`${rowId}-gate`);
            updateFlapText(gateContainer, gate);
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
            statusCell.setAttribute('data-gate', gate); 
            statusCell.setAttribute('data-status-normal', flight.status);
            statusCell.setAttribute('data-status-delay', flight.delay_text || "");
            
            if (showingDelayPhase) {
                if (hasDelay) {
                    displayStatus = flight.delay_text;
                    displayColorClass = 'Delayed';
                } else if (isBoarding) {
                    displayStatus = `GO TO GATE ${gate}`;
                    displayColorClass = 'GO TO GATE';
                }
            }
            
            // Use fade animation for status updates
            if (statusFlaps.textContent !== displayStatus.toUpperCase()) {
                updateStatusWithFade(statusFlaps, statusCell, displayStatus.toUpperCase(), displayColorClass);
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

    // --- STANDARD: Plain text rendering (No animation) ---
    function updateFlapText(container, newText) {
        if (container) {
            container.textContent = String(newText || "");
        }
    }

    // --- SPECIAL: Smooth opacity fade for status changes ---
    function updateStatusWithFade(container, statusCell, newText, newColorClass) {
        if (!container) return;
        
        // Trigger fade out
        container.classList.add('status-updating');
        
        // After fade out completes, update text and color, then fade back in
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
                    
                    // Trigger airport switch
                    socket.emit('leave_airport', { airport: currentAirport });
                    currentAirport = icao;
                    updateTheme(currentAirport);
                    window.updateFooterText(currentAirport, data.country || '');
                    socket.emit('join_airport', { airport: currentAirport });
                    
                    // Clear the board while loading
                    elements.departureList.innerHTML = '';
                    elements.arrivalList.innerHTML = '';
                    
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
    // --- FLIGHT PLAN TOOLTIP LOGIC ---
    const tooltip = document.getElementById('flightTooltip');

    document.addEventListener('mouseover', (e) => {
        // Check if we are hovering over a flight cell (or its children)
        const cell = e.target.closest('.flight-cell');
        
        if (cell && cell.hasAttribute('data-route')) {
            const route = cell.getAttribute('data-route');
            if (route && route !== 'No route available') {
                tooltip.style.display = 'block';
                tooltip.textContent = route;
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
