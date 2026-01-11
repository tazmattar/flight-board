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
    const airlineMapping = { 
        'SWS': 'LX', 'EZY': 'U2', 'EJU': 'U2', 'EZS': 'DS', 'BEL': 'SN', 
        'GWI': '4U', 'EDW': 'WK', 'ITY': 'AZ', 'FDX': 'FX', 'UPS': '5X', 
        'GEC': 'LH', 'BCS': 'QY', 'SAZ': 'REGA'
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

    // --- THEME & FLAGS ENGINE ---
    function updateTheme(airportCode) {
        document.body.classList.remove('theme-lsgg', 'theme-lfsb'); 
        
        if (airportCode === 'LSGG') {
            document.body.classList.add('theme-lsgg');
        } 
        else if (airportCode === 'LFSB') {
            document.body.classList.add('theme-lfsb');
        }

        const flagContainer = document.getElementById('flagContainer');
        if (!flagContainer) return;

        const swissFlag = '<img src="https://flagcdn.com/h40/ch.png" alt="Switzerland" title="Switzerland">';
        const frenchFlag = '<img src="https://flagcdn.com/h40/fr.png" alt="France" title="France">';

        if (airportCode === 'LSZH') {
            flagContainer.innerHTML = swissFlag;
        } else {
            flagContainer.innerHTML = swissFlag + frenchFlag;
        }
    }

    updateTheme(currentAirport);

    // --- Core Logic ---
    socket.emit('join_airport', { airport: currentAirport });

    elements.airportSelect.addEventListener('change', (e) => {
        socket.emit('leave_airport', { airport: currentAirport });
        currentAirport = e.target.value;
        updateTheme(currentAirport); 
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
                
                const commonCells = `
                    <td>
                        <div class="flight-cell">
                            <img src="${localLogo}" class="airline-logo" style="filter: none;" 
                                 onerror="if (this.src.includes('static/logos')) { this.src = '${kiwiLogo}'; }
                                          else if (this.src.includes('kiwi.com')) { this.src = '${kayakLogo}'; }
                                          else { this.style.display='none'; }">
                            <div class="flap-container" id="${rowId}-callsign"></div>
                        </div>
                    </td>
                    <td><div class="flap-container flap-dest" id="${rowId}-dest"></div></td>
                    <td><div class="flap-container" id="${rowId}-ac"></div></td>
                `;

                if (type === 'Departures') {
                    row.innerHTML = `
                        ${commonCells}
                        <td style="color: var(--fids-amber);"><div class="flap-container" id="${rowId}-checkin"></div></td>
                        <td style="color: var(--fids-amber);"><div class="flap-container" id="${rowId}-gate"></div></td> 
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
                    displayColorClass = 'GO TO GATE';
                }
            }
            
            // Use fade animation for status updates
            if (statusFlaps.textContent !== displayStatus.toUpperCase()) {
                updateStatusWithFade(statusFlaps, statusCell, displayStatus.toUpperCase(), displayColorClass);
            } else {
                statusCell.setAttribute('data-status', displayColorClass);
            }
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
