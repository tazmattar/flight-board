document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let currentAirport = 'LSZH';
    
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

    // --- Dynamic Airline Data ---
    const manualOverrides = { 'SWS': 'LX', 'EZY': 'U2', 'EZS': 'DS', 'BEL': 'SN', 'GWI': '4U', 'EDW': 'WK' };
    let airlineMapping = { ...manualOverrides };
    
    async function loadAirlineDatabase() {
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
        } catch (e) { console.warn('Fallback to manual codes'); }
    }
    loadAirlineDatabase();

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

    socket.on('flight_update', (data) => {
        if (data.airport_name) elements.airportName.textContent = data.airport_name;
        
        updateTableSmart(data.departures || [], elements.departureList, 'Departures');
        updateTableSmart(data.arrivals || [], elements.arrivalList, 'Arrivals');
        updateTableSmart(data.enroute || [], elements.enrouteList, 'En Route');
    });

    // --- THE CYCLE ENGINE (Restores the flashing/flipping behavior) ---
    setInterval(() => {
        showingDelayPhase = !showingDelayPhase;
        
        const delayedCells = document.querySelectorAll('.col-status[data-has-delay="true"]');
        
        delayedCells.forEach(cell => {
            const flapContainer = cell.querySelector('.flap-container');
            const normalStatus = cell.getAttribute('data-status-normal');
            const delayText = cell.getAttribute('data-status-delay');
            
            if (showingDelayPhase) {
                cell.setAttribute('data-status', 'Delayed');
                updateFlapText(flapContainer, delayText.toUpperCase());
            } else {
                cell.setAttribute('data-status', normalStatus);
                updateFlapText(flapContainer, normalStatus.toUpperCase());
            }
        });

    }, 5000);

    // --- SPLIT FLAP ENGINE ---

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

            const dest = type === 'Arrivals' ? flight.origin : flight.destination;
            
            // --- NEW TIME COLUMN LOGIC ---
            // 'time_display' comes from the Python backend (STD for Dep, STA for Arr)
            const timeStr = flight.time_display || "--:--";
            // -----------------------------

            // Gate Logic
            let gate = flight.gate || 'TBA'; 
            if (type === 'En Route') {
                gate = ''; 
            } else if (type === 'Departures') {
                if (flight.status === 'Taxiing' || flight.status === 'Departing') {
                    gate = 'CLOSED'; 
                }
            }

            // Determine logic for Status Column
            // NEW VERSION 
            // Allow delay status for ANY active departure (Boarding, Pushback, Taxiing, Departing)
            const isActiveDeparture = ['Boarding', 'Ready', 'Pushback', 'Taxiing', 'Departing'].includes(flight.status);
            const hasDelay = (flight.delay_text && isActiveDeparture);
            
            let displayStatus = flight.status;
            let displayColorClass = flight.status;

            if (hasDelay && showingDelayPhase) {
                displayStatus = flight.delay_text;
                displayColorClass = 'Delayed';
            }

            if (!row) {
                row = document.createElement('tr');
                row.id = rowId;
                
                // Replaced Alt/Speed cells with a single Time cell
                row.innerHTML = `
                    <td>
                        <div class="flight-cell">
                            <img src="${logoUrl}" class="airline-logo" style="filter: none;" onerror="this.style.display='none'">
                            <div class="flap-container" id="${rowId}-callsign"></div>
                        </div>
                    </td>
                    <td><div class="flap-container" id="${rowId}-dest"></div></td>
                    <td><div class="flap-container" id="${rowId}-ac"></div></td>
                    <td><div class="flap-container" id="${rowId}-gate"></div></td> 
                    <td><div class="flap-container" id="${rowId}-time"></div></td>
                    <td class="col-status"><div class="flap-container" id="${rowId}-status"></div></td>
                `;
                container.appendChild(row);
            }

            // Update Cells
            updateFlapText(document.getElementById(`${rowId}-callsign`), flight.callsign);
            updateFlapText(document.getElementById(`${rowId}-dest`), dest);
            updateFlapText(document.getElementById(`${rowId}-ac`), flight.aircraft);
            updateFlapText(document.getElementById(`${rowId}-gate`), gate);
            updateFlapText(document.getElementById(`${rowId}-time`), timeStr); // Update Time
            
            // Update Status
            const statusCell = row.querySelector('.col-status');
            const statusFlaps = document.getElementById(`${rowId}-status`);
            
            statusCell.setAttribute('data-has-delay', hasDelay ? "true" : "false");
            statusCell.setAttribute('data-status-normal', flight.status);
            statusCell.setAttribute('data-status-delay', flight.delay_text || "");
            
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
});