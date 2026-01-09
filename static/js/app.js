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
    // Added 'FDX': 'FX' and others to ensure cargo mapping works
    const airlineMapping = { 
        'SWS': 'LX', 
        'EZY': 'U2',
        'EJU': 'U2',  // EasyJet Europe
        'EZS': 'DS', 
        'BEL': 'SN', 
        'GWI': '4U', 
        'EDW': 'WK',
        'ITY': 'AZ',  // ITA Airways
        'FDX': 'FX',  // FedEx
        'UPS': '5X',  // UPS
        'GEC': 'LH',  // Lufthansa Cargo (often uses LH logo)
        'BCS': 'QY',   // DHL
        'SAZ': 'REGA'   // Swiss Air Ambulance
    };
    const airportMapping = {}; 

    async function loadDatabases() {
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

    // Helper to switch themes
    function updateTheme(airportCode) {
        document.body.classList.remove('theme-lsgg', 'theme-lfsb'); 
        
        if (airportCode === 'LSGG') {
            document.body.classList.add('theme-lsgg');
        } 
        else if (airportCode === 'LFSB') {
            document.body.classList.add('theme-lfsb');
        }
    }

    // Initialize theme on load
    updateTheme(currentAirport);

    // --- Core Logic ---
    socket.emit('join_airport', { airport: currentAirport });

    elements.airportSelect.addEventListener('change', (e) => {
        socket.emit('leave_airport', { airport: currentAirport });
        currentAirport = e.target.value;
        
        updateTheme(currentAirport); // Apply Theme Switch

        socket.emit('join_airport', { airport: currentAirport });
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
        rawFlightData = data;
        renderSection('dep');
        renderSection('arr');
    });

    // --- AUTO-SCROLL ENGINE ---
    function initAutoScroll() {
        const scrollContainers = document.querySelectorAll('.table-scroll-area');
        
        scrollContainers.forEach(container => {
            if (container.dataset.scrollInterval) return;

            const intervalId = setInterval(() => {
                const maxScroll = container.scrollHeight - container.clientHeight;
                const currentScroll = Math.ceil(container.scrollTop);

                if (maxScroll <= 0) {
                    if (currentScroll > 0) container.scrollTo({ top: 0, behavior: 'smooth' });
                    return;
                }

                if (currentScroll >= maxScroll - 5) { 
                    container.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                    const nextScroll = currentScroll + container.clientHeight;
                    container.scrollTo({ top: nextScroll, behavior: 'smooth' });
                }
            }, 8000); 

            container.dataset.scrollInterval = intervalId;
        });
    }
    
    initAutoScroll();

    // --- STATUS FLIP ENGINE ---
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
                    // FIX 1: Use textContent here too
                    flapContainer.textContent = delayText.toUpperCase();
                } else if (isBoarding) {
                    cell.setAttribute('data-status', 'Boarding');
                    // FIX 2: Use textContent here too
                    flapContainer.textContent = `GO TO GATE ${gate}`;
                }
            } else {
                cell.setAttribute('data-status', normalStatus);
                // FIX 3: Use textContent here too
                flapContainer.textContent = normalStatus.toUpperCase();
            }
        });
    }, 5000); 

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
            
            // --- LOGO LOGIC (3-Step Fallback) ---
            const localLogo = `/static/logos/${code}.png`;
            const kiwiLogo = `https://images.kiwi.com/airlines/64/${code}.png`;
            const kayakLogo = `https://content.r9cdn.net/rimg/provider-logos/airlines/v/${code}.png`;

            const destIcao = (type === 'Arrivals') ? flight.origin : flight.destination;
            const destName = airportMapping[destIcao] || destIcao;
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
                
                // DEPARTURES HTML
                if (type === 'Departures') {
                    row.innerHTML = `
                        <td>
                            <div class="flight-cell">
                                <img src="${localLogo}" 
                                     class="airline-logo" 
                                     style="filter: none;" 
                                     onerror="
                                        if (this.src.includes('static/logos')) { this.src = '${kiwiLogo}'; }
                                        else if (this.src.includes('kiwi.com')) { this.src = '${kayakLogo}'; }
                                        else { this.style.display='none'; }
                                     ">
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
                } 
                // ARRIVALS HTML
                else {
                    row.innerHTML = `
                        <td>
                            <div class="flight-cell">
                                <img src="${localLogo}" 
                                     class="airline-logo" 
                                     style="filter: none;" 
                                     onerror="
                                        if (this.src.includes('static/logos')) { this.src = '${kiwiLogo}'; }
                                        else if (this.src.includes('kiwi.com')) { this.src = '${kayakLogo}'; }
                                        else { this.style.display='none'; }
                                     ">
                                <div class="flap-container" id="${rowId}-callsign"></div>
                            </div>
                        </td>
                        <td><div class="flap-container flap-dest" id="${rowId}-dest"></div></td>
                        <td><div class="flap-container" id="${rowId}-ac"></div></td>
                        <td></td> 
                        <td><div class="flap-container" id="${rowId}-gate"></div></td> 
                        <td><div class="flap-container" id="${rowId}-time"></div></td>
                        <td class="col-status"><div class="flap-container" id="${rowId}-status"></div></td>
                    `;
                }
                container.appendChild(row);
            }

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
            
            // --- FIX 4: THE BIG CHANGE ---
            // Use standard textContent for the Status column only.
            // This prevents "Space Collapsing" caused by the flap spans + CSS gap:0
            statusFlaps.textContent = displayStatus.toUpperCase();
        });

        existingRows.forEach(row => {
            if (!seenIds.has(row.id)) row.remove();
        });
    }   

    function updateFlapText(container, newText) {
        if (!container) return;
        newText = String(newText || "");
        
        // Safety check: Don't use flap logic on the status column if we accidentally called it
        if (container.id && container.id.endsWith('status')) {
            container.textContent = newText;
            return;
        }

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

    function updateClock() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false });
        if (elements.lastUpdate) elements.lastUpdate.textContent = timeString;
    }
    updateClock(); 
    setInterval(updateClock, 1000);

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