document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let currentAirport = 'LSZH';

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
        // Clean wipe on airport change
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
        
        // Update Time
        const now = new Date();
        elements.lastUpdate.textContent = now.toLocaleTimeString('en-GB', {timeZone:'UTC'});
    });

    // --- SPLIT FLAP ENGINE ---

    function updateTableSmart(flights, container, type) {
        // 1. Mark all existing rows as "stale"
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
            const alt = `${flight.altitude.toLocaleString()} ft`;
            const spd = `${flight.groundspeed} kts`;
            
            // Handle Status Text (Merge delay text if exists)
            let statusText = flight.status;
            if (flight.delay_text && (flight.status === 'Boarding' || flight.status === 'Ready')) {
                // If delayed, we alternate or just show delay. 
                // For Split Flap, let's just show the Delay text if it exists to be urgent
                statusText = flight.delay_text.toUpperCase();
            } else {
                statusText = statusText.toUpperCase();
            }

            if (!row) {
                // Create New Row
                row = document.createElement('tr');
                row.id = rowId;
                row.innerHTML = `
                    <td><div class="flap-container" id="${rowId}-callsign"></div></td>
                    <td><div class="flap-container" id="${rowId}-dest"></div></td>
                    <td><div class="flap-container" id="${rowId}-ac"></div></td>
                    <td><div class="flap-container" id="${rowId}-alt"></div></td>
                    <td><div class="flap-container" id="${rowId}-spd"></div></td>
                    <td class="col-status" data-status="${flight.status}"><div class="flap-container" id="${rowId}-status"></div></td>
                `;
                container.appendChild(row);
            }

            // Update Cells with Split Flap Logic
            updateFlapText(document.getElementById(`${rowId}-callsign`), flight.callsign);
            updateFlapText(document.getElementById(`${rowId}-dest`), dest);
            updateFlapText(document.getElementById(`${rowId}-ac`), flight.aircraft);
            updateFlapText(document.getElementById(`${rowId}-alt`), alt);
            updateFlapText(document.getElementById(`${rowId}-spd`), spd);
            
            const statusCell = document.getElementById(`${rowId}-status`);
            // Update parent data-attribute for coloring (Green/Red)
            statusCell.parentElement.setAttribute('data-status', flight.status); 
            if(flight.delay_text) statusCell.parentElement.setAttribute('data-status', 'Delayed');
            
            updateFlapText(statusCell, statusText);
        });

        // Remove rows that are no longer in the data
        existingRows.forEach(row => {
            if (!seenIds.has(row.id)) row.remove();
        });
    }

    /**
     * Updates the text in a container character by character with animation.
     */
    function updateFlapText(container, newText) {
        if (!container) return;
        newText = String(newText || "");
        
        const currentChildren = container.children;
        const maxLen = Math.max(currentChildren.length, newText.length);

        for (let i = 0; i < maxLen; i++) {
            const newChar = newText[i] || ""; // Empty string if shorter
            let span = currentChildren[i];

            if (!span) {
                // Create new character tile
                span = document.createElement('span');
                span.className = 'flap-char';
                span.textContent = newChar; // Set initial directly
                container.appendChild(span);
                // Trigger flip on enter
                triggerFlip(span);
            } else {
                // Check if changed
                if (span.textContent !== newChar) {
                    // It changed! Trigger flip.
                    triggerFlip(span, newChar);
                }
            }
        }
        
        // Remove excess characters if string got shorter
        while (container.children.length > newText.length) {
            container.removeChild(container.lastChild);
        }
    }

    function triggerFlip(element, newChar) {
        // Remove class to reset animation if it's already playing
        element.classList.remove('flipping');
        void element.offsetWidth; // Force reflow (magic CSS reset)
        
        element.classList.add('flipping');
        
        // Change the text halfway through the animation (at 200ms)
        // This makes it look like the tile physically flipped over
        if (newChar !== undefined) {
            setTimeout(() => {
                element.textContent = newChar;
            }, 200); 
        }
    }
});