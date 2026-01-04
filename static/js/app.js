document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    
    // State
    let currentAirport = 'LSZH';

    const elements = {
        airportSelect: document.getElementById('airportSelect'),
        airportName: document.getElementById('airportName'),
        departureList: document.getElementById('departureList'),
        arrivalList: document.getElementById('arrivalList'),
        enrouteList: document.getElementById('enrouteList'),
        lastUpdate: document.getElementById('lastUpdate'),
        metar: document.getElementById('metar'),
        controllers: document.getElementById('controllers')
    };

    // --- Dynamic Airline Data Loading (Same as before) ---
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

    // --- Airport Switching Logic ---
    
    // 1. Join default airport on load
    socket.emit('join_airport', { airport: currentAirport });

    // 2. Handle dropdown change
    elements.airportSelect.addEventListener('change', (e) => {
        const newAirport = e.target.value;
        
        // Leave old room, join new room
        socket.emit('leave_airport', { airport: currentAirport });
        currentAirport = newAirport;
        socket.emit('join_airport', { airport: currentAirport });
        
        // Clear tables to show loading state
        clearTables();
    });

    // --- Socket Events ---

    socket.on('flight_update', (data) => {
        // Update Header Name (e.g., "Geneva Airport")
        if (data.airport_name) {
            elements.airportName.textContent = data.airport_name;
        }

        renderTable(data.departures || [], elements.departureList, 'Departures');
        renderTable(data.arrivals || [], elements.arrivalList, 'Arrivals');
        renderTable(data.enroute || [], elements.enrouteList, 'En Route');
        
        updateMetar(data.metar);
        updateControllers(data.controllers);
        updateTimestamp();
    });

    // --- Helpers ---
    
    function clearTables() {
        const loadingRow = '<tr><td colspan="6" class="loading-cell">Loading...</td></tr>';
        elements.departureList.innerHTML = loadingRow;
        elements.arrivalList.innerHTML = loadingRow;
        elements.enrouteList.innerHTML = loadingRow;
        elements.metar.textContent = 'Loading...';
        elements.controllers.innerHTML = 'Loading...';
    }

    function renderTable(flights, container, type) {
        container.innerHTML = '';
        if (flights.length === 0) {
            container.innerHTML = `<tr><td colspan="6" class="loading-cell">No active ${type.toLowerCase()}</td></tr>`;
            return;
        }

        flights.forEach(flight => {
            const row = document.createElement('tr');
            const prefix = flight.callsign.substring(0, 3).toUpperCase();
            const code = airlineMapping[prefix] || prefix;
            const logoUrl = `https://images.kiwi.com/airlines/64/${code}.png`;
            const statusClass = getStatusClass(flight.status);
            
            row.innerHTML = `
                <td>
                    <div class="flight-cell">
                        <img src="${logoUrl}" class="airline-logo" onerror="this.style.display='none'"> 
                        <span class="flight-number">${flight.callsign}</span>
                    </div>
                </td>
                <td><span class="destination-code">${type === 'Arrivals' ? flight.origin : flight.destination}</span></td>
                <td><span class="aircraft-type">${flight.aircraft}</span></td>
                <td><span class="altitude-data">${flight.altitude.toLocaleString()} ft</span></td>
                <td><span class="speed-data">${flight.groundspeed} kts</span></td>
                <td><span class="status-badge ${statusClass}">${flight.status}</span></td>
            `;
            container.appendChild(row);
        });
    }

    function getStatusClass(status) {
        if (!status) return '';
        // Handle the dynamic delay status (starts with "Delayed")
        if (status.startsWith('Delayed')) return 'status-delayed'; 
        return `status-${status.toLowerCase().replace(/\s+/g, '-')}`;
    }

    function updateMetar(metar) { elements.metar.textContent = metar || 'Unavailable'; }
    
    function updateControllers(ctrls) {
        elements.controllers.innerHTML = '';
        if (!ctrls || ctrls.length === 0) {
            elements.controllers.innerHTML = '<span class="no-controllers">No ATC Online</span>';
            return;
        }
        ctrls.forEach(c => {
            const div = document.createElement('div');
            div.className = 'controller-badge';
            div.innerHTML = `<span>${c.callsign}</span><span class="controller-freq">${c.frequency}</span>`;
            elements.controllers.appendChild(div);
        });
    }

    function updateTimestamp() {
        const now = new Date();
        elements.lastUpdate.textContent = now.toLocaleTimeString('en-GB', {timeZone:'UTC'}) + ' Z';
    }
});