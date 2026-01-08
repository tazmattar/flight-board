document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

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
    const airlineMapping = { 'SWS': 'LX', 'EZY': 'U2', 'EZS': 'DS', 'BEL': 'SN', 'GWI': '4U', 'EDW': 'WK' };
    const airportMapping = {}; 

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

        // 2. Load Airports
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
        // Clear lists immediately on switch
        elements.departureList.innerHTML = '';
        elements.arrivalList.innerHTML = '';
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
        
        // Render IMMEDIATELY (No pagination logic)
        renderSection('dep');
        renderSection('arr');
    });

    // --- THE CYCLE ENGINE (Flipping Status Behavior) ---
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

            if (showingDelayPhase) {
                if (hasDelay) {
                    cell.setAttribute('data-status', 'Delayed');
                    updateFlapText(flapContainer, delayText.toUpperCase());
                } else if (isBoarding) {
                    cell.setAttribute('data-status', 'Boarding');
                    updateFlapText(flapContainer, `GO TO GATE ${gate}`);
                }
            } else {
                cell.setAttribute('data-status', normalStatus);
                updateFlapText(flapContainer, normalStatus.toUpperCase());
            }
        });
    }, 5000); 

    // --- RENDER ENGINE (REMOVED PAGINATION) ---
    function renderSection(type) {
        let list, container, indicator, label;

        if (type === 'dep') {
            list = rawFlightData.departures || [];
            container = elements.departureList;
            indicator = document.getElementById('depPageInd'); // We will hide this
            label = 'Departures';
        } else if (type === 'arr') {
            list = rawFlightData.arrivals || [];
            container = elements.arrivalList;
            indicator = document.getElementById('arrPageInd'); // We will hide this
            label = 'Arrivals';
        } else {
            return;
        }

        // Hide the page indicator since we are showing ALL flights
        if (indicator) indicator.style.display = 'none';

        // PASS THE FULL LIST (No Slicing)
        updateTableSmart(list, container, label);
    }

    function updateTableSmart(flights, container, type) {
        // Sync rows (Create new ones, update existing, remove old)
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

            // Destination/Origin Logic
            const destIcao = (type === 'Arrivals') ? flight.origin : flight.destination;
            const destName = airportMapping[destIcao] || destIcao;
            
            // Time & Gate
            const timeStr = flight.time_display || "--:--";
            let gate = flight.gate || 'TBA'; 
            let isGateWaiting = false;

            if (type === 'Departures') {
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

            const canShowDelay = ['Boarding', 'Check-in', 'Pushback', 'Taxiing', 'Departing', 'Approaching', 'Landing'].includes(flight.status);
            const hasDelay = (flight.delay_text && canShowDelay);
            const isBoarding = (flight.status === 'Boarding' && gate && gate !== 'TBA' && gate !== 'CLOSED');

            let displayStatus = flight.status;
            let displayColorClass = flight.status;

            // --- ROW CREATION ---
            if (!row) {
                row = document.createElement('tr');
                row.id = rowId;
                
                // DEPARTURES (7 Cols) vs ARRIVALS (7 Cols - with ghost col)
                if (type === 'Departures') {
                    row.innerHTML = `
                        <td>
                            <div class="flight-cell">
                                <img src="${logoUrl}" class="airline-logo" style="filter: none;" onerror="this.style.display='none'">
                                <div class="flap-container" id="${rowId}-callsign"></div>
                            </div>
                        </td>
                        <td><div class="flap-container flap-dest" id="${rowId}-dest"></div></td>
                        <td><div class="flap-container" id="${rowId}-ac"></div></td>
                        <td style="color: var(--fids-amber);"><div class="flap-container" id="${rowId}-checkin"></div></td>
                        <td><div class="flap-container" id="${rowId}-gate"></div></td> 
                        <td><div class="flap-container" id="${rowId}-time"></div></td>
                        <td class="col-status"><div class="flap-container" id="${rowId}-status"></div></td>
                    `;
                } else {
                    // ARRIVALS: Now has 7 Columns (Added Ghost Column)
                    row.innerHTML = `
                        <td>
                            <div class="flight-cell">
                                <img src="${logoUrl}" class="airline-logo" style="filter: none;" onerror="this.style.display='none'">
                                <div class="flap-container" id="${rowId}-callsign"></div>
                            </div>
                        </td>
                        <td><div class="flap-container flap-dest" id="${rowId}-dest"></div></td>
                        <td><div class="flap-container" id="${rowId}-ac"></div></td>
                        
                        <td></td> <td><div class="flap-container" id="${rowId}-gate"></div></td> 
                        <td><div class="flap-container" id="${rowId}-time"></div></td>
                        <td class="col-status"><div class="flap-container" id="${rowId}-status"></div></td>
                    `;
                }
                container.appendChild(row);
            }

            // --- UPDATE FLAPS ---
            updateFlapText(document.getElementById(`${rowId}-callsign`), flight.callsign);
            
            const destFlap = document.getElementById(`${rowId}-dest`);
            destFlap.setAttribute('data-code', destIcao);
            destFlap.setAttribute('data-name', destName);
            
            if (showAirportNames && destName) updateFlapText(destFlap, destName.toUpperCase());
            else updateFlapText(destFlap, destIcao);

            updateFlapText(document.getElementById(`${rowId}-ac`), flight.aircraft);
            updateFlapText(document.getElementById(`${rowId}-time`), timeStr);
            
            const checkinFlap = document.getElementById(`${rowId}-checkin`);
            if (checkinFlap) updateFlapText(checkinFlap, flight.checkin || ""); 

            const gateContainer = document.getElementById(`${rowId}-gate`);
            updateFlapText(gateContainer, gate);
            if (isGateWaiting) gateContainer.classList.add('status-wait');
            else gateContainer.classList.remove('status-wait');
            
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
                    displayColorClass = 'Boarding';
                }
            }

            statusCell.setAttribute('data-status', displayColorClass);
            updateFlapText(statusFlaps, displayStatus.toUpperCase());
        });

        // Cleanup
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
                if (span.textContent !== newChar) triggerFlip(span, newChar);
            }
        }
        while (container.children.length > newText.length) container.removeChild(container.lastChild);
    }

    function triggerFlip(element, newChar) {
        element.classList.remove('flipping');
        void element.offsetWidth;
        element.classList.add('flipping');
        if (newChar !== undefined) setTimeout(() => { element.textContent = newChar; }, 200); 
    }

    // --- REAL-TIME CLOCK ---
    function updateClock() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false });
        if (elements.lastUpdate) elements.lastUpdate.textContent = timeString;
    }
    updateClock(); 
    setInterval(updateClock, 1000);

    // --- DESTINATION FLIPPER ---
    let showAirportNames = false; 
    setInterval(() => {
        showAirportNames = !showAirportNames;
        const destFlaps = document.querySelectorAll('.flap-dest');
        destFlaps.forEach(flap => {
            const code = flap.getAttribute('data-code');
            const name = flap.getAttribute('data-name');
            if (showAirportNames && name && name !== 'undefined') updateFlapText(flap, name.toUpperCase());
            else updateFlapText(flap, code);
        });
    }, 4000); 
});