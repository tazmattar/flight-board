document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- STATE MANAGEMENT ---
    let currentAirport = 'LSZH';
    let rawFlightData = { departures: [], arrivals: [], enroute: [] };
    
    // Independent Page Counters
    let pages = { dep: 0, arr: 0, enr: 0 };
    const PAGE_SIZE = 12; 
    
    // Global flag to track the display cycle (Status vs Delay)
    let showingDelayPhase = false;

    const elements = {
        airportSelect: document.getElementById('airportSelect'),
        airportName: document.getElementById('airportName'),
        departureList: document.getElementById('departureList'),
        arrivalList: document.getElementById('arrivalList'),
        enrouteList: document.getElementById('enrouteList'),
        lastUpdate: document.getElementById('lastUpdate'),
        metar: document.getElementById('metar'),
        controllers: document.getElementById('controllers'),
        fsBtn: document.getElementById('fullscreenBtn')
    };

    // --- Dynamic Data Sources ---
    const airlineMapping = { 'SWS': 'LX', 'EZY': 'U2', 'EZS': 'DS', 'BEL': 'SN', 'GWI': '4U', 'EDW': 'WK' };
    const airportMapping = {}; // Stores ICAO -> "Zurich"

    async function loadDatabases() {
        // 1. Load Airlines
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

        // 2. Load Airports (Improved Naming Logic)
        try {
            const response = await fetch('https://raw.githubusercontent.com/mwgg/Airports/master/airports.json');
            if (response.ok) {
                const data = await response.json();
                
                // Specific overrides for when City name isn't enough or you want a specific format
                const manualRenames = {
                    "EGLL": "London Heathrow",
                    "EGKK": "London Gatwick",
                    "EGSS": "London Stansted",
                    "EGGW": "London Luton",
                    "EGLC": "London City",
                    "KJFK": "New York JFK",
                    "KEWR": "Newark",
                    "KLGA": "New York LaGuardia",
                    "LFPG": "Paris CDG",
                    "LFPO": "Paris Orly",
                    "EDDF": "Frankfurt",
                    "EDDM": "Munich",
                    "OMDB": "Dubai",
                    "VHHH": "Hong Kong",
                    "WSSS": "Singapore",
                    "KBOS": "Boston",  // Explicit fix just in case
                    "LLBG": "Tel Aviv", // Fix for Ben Gurion
                    "LSHD": "Zurich Heliport", // Fix for Zurich Heliport
                    "LIBG": "Taranto-Grottaglie" // Fix for Grottaglie
                };

                for (const [icao, details] of Object.entries(data)) {
                    let displayName;

                    // 1. Check for manual override first
                    if (manualRenames[icao]) {
                        displayName = manualRenames[icao];
                    } 
                    // 2. Otherwise, prefer the CITY name (e.g. "Boston" instead of "Gen. Edward Lawrence...")
                    else if (details.city) {
                        displayName = details.city;
                    } 
                    // 3. Fallback to airport name if city is missing
                    else {
                        displayName = details.name;
                    }

                    // Final cleanup to remove junk words just in case
                    airportMapping[icao] = displayName
                        .replace(/\b(Airport|International|Intl|Field|Airfield)\b/g, '')
                        .replace(/\s+/g, ' ')
                        .trim();
                }
            }
        } catch (e) { console.warn('Airport DB failed', e); }
    }
    loadDatabases();

    // --- Core Logic ---
    socket.emit('join_airport', { airport: currentAirport });

    elements.airportSelect.addEventListener('change', (e) => {
        socket.emit('leave_airport', { airport: currentAirport });
        currentAirport = e.target.value;
        socket.emit('join_airport', { airport: currentAirport });
        elements.departureList.innerHTML = '';
        elements.arrivalList.innerHTML = '';
        elements.enrouteList.innerHTML = '';
    });

    if (elements.fsBtn) {
        elements.fsBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(console.log);
            else if (document.exitFullscreen) document.exitFullscreen();
        });
    }

    // --- SOCKET LISTENER ---
    socket.on('flight_update', (data) => {
        if (data.airport_name) elements.airportName.textContent = data.airport_name;
        
        // Update raw data
        rawFlightData = data;
        
        // Refresh all lists immediately (keeping current page index)
        renderSection('dep');
        renderSection('arr');
        renderSection('enr');
    });

    // --- THE CYCLE ENGINE (Flipping Status Behavior) ---
    setInterval(() => {
        showingDelayPhase = !showingDelayPhase;
        
        // Select both Delayed cells AND Boarding cells
        const cyclingCells = document.querySelectorAll('.col-status[data-has-delay="true"], .col-status[data-is-boarding="true"]');
        
        cyclingCells.forEach(cell => {
            const flapContainer = cell.querySelector('.flap-container');
            const normalStatus = cell.getAttribute('data-status-normal'); // e.g. "BOARDING"
            const delayText = cell.getAttribute('data-status-delay');     // e.g. "DELAYED 15 MIN"
            
            const hasDelay = cell.getAttribute('data-has-delay') === 'true';
            const isBoarding = cell.getAttribute('data-is-boarding') === 'true';
            const gate = cell.getAttribute('data-gate');

            if (showingDelayPhase) {
                // Priority 1: Show Delay
                if (hasDelay) {
                    cell.setAttribute('data-status', 'Delayed');
                    updateFlapText(flapContainer, delayText.toUpperCase());
                } 
                // Priority 2: Show "GO TO GATE" instruction
                else if (isBoarding) {
                    // Keep status as 'Boarding' so it stays Green
                    cell.setAttribute('data-status', 'Boarding');
                    updateFlapText(flapContainer, `GO TO GATE ${gate}`);
                }
            } else {
                // Revert to Normal (e.g. "BOARDING")
                cell.setAttribute('data-status', normalStatus);
                updateFlapText(flapContainer, normalStatus.toUpperCase());
            }
        });

    }, 5000); // Cycles every 5 seconds

    // --- SPLIT FLAP ENGINE ---

    // --- INDEPENDENT PAGINATION ENGINE ---
    
    // Helper to render a specific section
    function renderSection(type) {
        let list, container, indicator, pageKey, label;

        // Map abstract type to real elements
        if (type === 'dep') {
            list = rawFlightData.departures || [];
            container = elements.departureList;
            indicator = document.getElementById('depPageInd');
            pageKey = 'dep';
            label = 'Departures';
        } else if (type === 'arr') {
            list = rawFlightData.arrivals || [];
            container = elements.arrivalList;
            indicator = document.getElementById('arrPageInd');
            pageKey = 'arr';
            label = 'Arrivals';
        } else {
            list = rawFlightData.enroute || [];
            container = elements.enrouteList;
            indicator = document.getElementById('enrPageInd');
            pageKey = 'enr';
            label = 'En Route';
        }

        // Calculate Pages
        const totalItems = list.length;
        const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
        
        // Wrap around if data shrank and we are on a non-existent page
        if (pages[pageKey] >= totalPages) pages[pageKey] = 0;

        // Update Indicator
        if (indicator) {
            // Only show indicator if there is more than 1 page
            if (totalPages > 1) {
                indicator.textContent = `${pages[pageKey] + 1}/${totalPages}`;
                indicator.style.display = 'block';
            } else {
                indicator.style.display = 'none';
            }
        }

        // Slice Data
        const start = pages[pageKey] * PAGE_SIZE;
        const end = start + PAGE_SIZE;
        const pageData = list.slice(start, end);

        // Render
        updateTableSmart(pageData, container, label);
    }

    // --- STAGGERED TIMERS ---
    // This prevents the "all at once" flip effect.
    
    // 1. Departures: Flips every 15s (Start immediately)
    setInterval(() => {
        advancePage('dep');
    }, 15000);

    // 2. Arrivals: Flips every 15s (Start with 5s delay)
    setTimeout(() => {
        setInterval(() => {
            advancePage('arr');
        }, 15000);
    }, 5000);

    // 3. En Route: Flips every 15s (Start with 10s delay)
    setTimeout(() => {
        setInterval(() => {
            advancePage('enr');
        }, 15000);
    }, 10000);

    function advancePage(type) {
        let list = (type === 'dep') ? (rawFlightData.departures || []) : 
                   (type === 'arr') ? (rawFlightData.arrivals || []) : 
                   (rawFlightData.enroute || []);
                   
        const totalPages = Math.ceil(list.length / PAGE_SIZE) || 1;
        
        // Only flip if we actually have multiple pages
        if (totalPages > 1) {
            pages[type] = (pages[type] + 1) % totalPages;
            renderSection(type);
        }
    }

    function updateTableSmart(flights, container, type) {
        const existingRows = Array.from(container.children);
        const seenIds = new Set();

        flights.forEach(flight => {
            const rowId = `row-${flight.callsign}`;
            seenIds.add(rowId);
            
            let row = document.getElementById(rowId);
            
            // Format Data
            const prefix = flight.callsign.substring(0, 3).toUpperCase();
            const code = airlineMapping[prefix] || prefix;
            const logoUrl = `https://images.kiwi.com/airlines/64/${code}.png`; 

            // --- CHANGED LOGIC HERE ---
            // If it's Arrivals OR En Route, show the Origin. Otherwise (Departures), show Destination.
            const destIcao = (type === 'Arrivals' || type === 'En Route') ? flight.origin : flight.destination;
            const destName = airportMapping[destIcao] || destIcao;
            // --------------------------
            
            // Time Column
            const timeStr = flight.time_display || "--:--";

            // ... (rest of the function remains the same)

            // Gate Logic
            let gate = flight.gate || 'TBA'; 
            let isGateWaiting = false;

            if (type === 'En Route') {
                gate = ''; 
            } else if (type === 'Departures') {
                if (flight.status === 'Taxiing' || flight.status === 'Departing') {
                    gate = 'CLOSED'; 
                }
            } else if (type === 'Arrivals') {
                if (!gate || gate === 'TBA') {
                    if (flight.status === 'Landed' || flight.status === 'Landing') {
                        gate = 'WAIT';
                        isGateWaiting = true;
                    }
                }
            }

            // Status Logic
            // Renaming this to 'canShowDelay' to be more accurate
            const canShowDelay = [
                'Boarding', 'Check-in', 'Pushback', 'Taxiing', 'Departing', // Deps
                'Approaching', 'Landing'                                    // Arrs
            ].includes(flight.status);

            const hasDelay = (flight.delay_text && canShowDelay);
            
            // NEW: Detect if we should cycle the Boarding message
            // Must be Boarding, have a real gate, and not be closed
            const isBoarding = (flight.status === 'Boarding' && gate && gate !== 'TBA' && gate !== 'CLOSED');

            let displayStatus = flight.status;
            let displayColorClass = flight.status;

            if (!row) {
                row = document.createElement('tr');
                row.id = rowId;
                
                // Note the class "flap-dest" added to the destination container below
                row.innerHTML = `
                    <td>
                        <div class="flight-cell">
                            <img src="${logoUrl}" class="airline-logo" style="filter: none;" onerror="this.style.display='none'">
                            <div class="flap-container" id="${rowId}-callsign"></div>
                        </div>
                    </td>
                    <td><div class="flap-container flap-dest" id="${rowId}-dest"></div></td>
                    <td><div class="flap-container" id="${rowId}-ac"></div></td>
                    <td><div class="flap-container" id="${rowId}-gate"></div></td> 
                    <td><div class="flap-container" id="${rowId}-time"></div></td>
                    <td class="col-status"><div class="flap-container" id="${rowId}-status"></div></td>
                `;
                container.appendChild(row);
            }

            // Update Cells
            updateFlapText(document.getElementById(`${rowId}-callsign`), flight.callsign);
            
            // --- UPDATE DESTINATION WITH METADATA ---
            const destFlap = document.getElementById(`${rowId}-dest`);
            
            // Store data for the cycle engine
            destFlap.setAttribute('data-code', destIcao);
            destFlap.setAttribute('data-name', destName);
            
            // Decide what to show RIGHT NOW (so it doesn't flicker on update)
            if (showAirportNames && destName) {
                updateFlapText(destFlap, destName.toUpperCase());
            } else {
                updateFlapText(destFlap, destIcao);
            }
            // ----------------------------------------

            updateFlapText(document.getElementById(`${rowId}-ac`), flight.aircraft);
            updateFlapText(document.getElementById(`${rowId}-time`), timeStr);
            
            const gateContainer = document.getElementById(`${rowId}-gate`);
            updateFlapText(gateContainer, gate);
            if (isGateWaiting) gateContainer.classList.add('status-wait');
            else gateContainer.classList.remove('status-wait');
            
            const statusCell = row.querySelector('.col-status');
            const statusFlaps = document.getElementById(`${rowId}-status`);
            
            statusCell.setAttribute('data-has-delay', hasDelay ? "true" : "false");
            statusCell.setAttribute('data-is-boarding', isBoarding ? "true" : "false");
            statusCell.setAttribute('data-gate', gate); // Store gate for the cycle engine
            
            statusCell.setAttribute('data-status-normal', flight.status);
            statusCell.setAttribute('data-status-delay', flight.delay_text || "");
            
            // Set Initial State
            // If we are currently in the "Delay/Alt" phase, show the alt text immediately to avoid flickering
            if (showingDelayPhase) {
                if (hasDelay) {
                    displayStatus = flight.delay_text;
                    displayColorClass = 'Delayed';
                } else if (isBoarding) {
                    displayStatus = `GO TO GATE ${gate}`;
                    displayColorClass = 'Boarding';
                }
            }

            statusCell.setAttribute('data-status', displayColorClass);
            updateFlapText(statusFlaps, displayStatus.toUpperCase());
        });

        existingRows.forEach(row => {
            if (!seenIds.has(row.id)) row.remove();
        });
    }   

    function updateFlapText(container, newText) {
        if (!container) return;
        newText = String(newText || "");
        
        const currentChildren = container.children;
        const maxLen = Math.max(currentChildren.length, newText.length);

        for (let i = 0; i < maxLen; i++) {
            const newChar = newText[i] || "";
            let span = currentChildren[i];

            if (!span) {
                span = document.createElement('span');
                span.className = 'flap-char';
                span.textContent = newChar;
                container.appendChild(span);
                triggerFlip(span);
            } else {
                if (span.textContent !== newChar) {
                    triggerFlip(span, newChar);
                }
            }
        }
        
        while (container.children.length > newText.length) {
            container.removeChild(container.lastChild);
        }
    }

    function triggerFlip(element, newChar) {
        element.classList.remove('flipping');
        void element.offsetWidth;
        element.classList.add('flipping');
        if (newChar !== undefined) {
            setTimeout(() => { element.textContent = newChar; }, 200); 
        }
    }

    // --- REAL-TIME CLOCK ENGINE ---
    function updateClock() {
        const now = new Date();
        // Format time as HH:MM:SS
        const timeString = now.toLocaleTimeString('en-GB', { 
            timeZone: 'UTC', 
            hour12: false 
        });
        
        if (elements.lastUpdate) {
            elements.lastUpdate.textContent = timeString;
        }
    }

    // Start the clock immediately and update every 1000ms (1 second)
    updateClock(); 
    setInterval(updateClock, 1000);

    // --- DESTINATION FLIPPER ENGINE ---
    let showAirportNames = false; // Toggle state

    // Flip every 4 seconds
    setInterval(() => {
        showAirportNames = !showAirportNames;
        
        // Find all destination flap containers
        const destFlaps = document.querySelectorAll('.flap-dest');
        
        destFlaps.forEach(flap => {
            const code = flap.getAttribute('data-code');
            const name = flap.getAttribute('data-name');
            
            // If we have a name and we are in "Name Mode", show it. Otherwise show ICAO.
            if (showAirportNames && name && name !== 'undefined') {
                updateFlapText(flap, name.toUpperCase());
            } else {
                updateFlapText(flap, code);
            }
        });
    }, 4000); // 4 Seconds per cycle
});