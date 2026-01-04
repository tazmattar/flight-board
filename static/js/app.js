document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    
    const elements = {
        departureList: document.getElementById('departureList'),
        arrivalList: document.getElementById('arrivalList'),
        enrouteList: document.getElementById('enrouteList'),
        lastUpdate: document.getElementById('lastUpdate'),
        metar: document.getElementById('metar'),
        controllers: document.getElementById('controllers')
    };

    // 1. Manual Overrides (VATSIM specific quirks or Virtual Airlines)
    // These take priority over the dynamic list.
    const manualOverrides = {
        'SWS': 'LX',  // Common mistake for Swiss
        'EZY': 'U2',  // easyJet (often missing in old DBs)
        'EZS': 'DS',  // easyJet Switzerland
        'BEL': 'SN',  // Brussels Airlines
        'GWI': '4U',  // Germanwings
        'EDW': 'WK'   // Edelweiss
    };

    // 2. Global Mapping (Will be populated via fetch)
    let airlineMapping = { ...manualOverrides };

    // --- Fetch Airline Database (Dynamic Mapping) ---
    async function loadAirlineDatabase() {
        try {
            // Using a free open-source dataset from GitHub (via jsDelivr CDN)
            // Source: https://github.com/npow/airline-codes
            const response = await fetch('https://cdn.jsdelivr.net/gh/npow/airline-codes@master/airlines.json');
            if (!response.ok) throw new Error("Failed to load airline DB");
            
            const data = await response.json();
            
            // Populate our mapping object
            data.forEach(airline => {
                // Only map if we have both codes and it's active
                if (airline.icao && airline.iata && airline.active === 'Y') {
                    // Don't overwrite our manual overrides
                    if (!airlineMapping[airline.icao]) {
                        airlineMapping[airline.icao] = airline.iata;
                    }
                }
            });
            console.log(`Loaded ${Object.keys(airlineMapping).length} airline codes dynamically.`);
            
        } catch (error) {
            console.warn('Could not load dynamic airline codes, falling back to manuals.', error);
        }
    }

    // Call immediately on load
    loadAirlineDatabase();

    // --- Socket Event Listeners ---

    socket.on('connect', () => {
        console.log('Connected to VATSIM data stream');
        showConnectionStatus(true);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        showConnectionStatus(false);
    });

    socket.on('flight_update', (data) => {
        if (!data) return;
        
        renderTable(data.departures || [], elements.departureList, 'Departures');
        renderTable(data.arrivals || [], elements.arrivalList, 'Arrivals');
        renderTable(data.enroute || [], elements.enrouteList, 'En Route');
        
        updateMetar(data.metar);
        updateControllers(data.controllers);
        updateTimestamp();
    });

    // --- Rendering Functions ---

    function renderTable(flights, container, type) {
        container.innerHTML = '';

        if (flights.length === 0) {
            container.innerHTML = `<tr><td colspan="6" class="loading-cell">No active ${type.toLowerCase()}</td></tr>`;
            return;
        }

        flights.forEach(flight => {
            const row = document.createElement('tr');
            
            // 1. Get ICAO prefix (e.g., "SWR")
            const callsignPrefix = flight.callsign.substring(0, 3).toUpperCase();
            
            // 2. Lookup IATA code (e.g., "LX") using our dynamic map
            // Fallback to prefix if not found (sometimes logo APIs accept ICAO)
            const airlineCode = airlineMapping[callsignPrefix] || callsignPrefix;
            
            const logoUrl = `https://images.kiwi.com/airlines/64/${airlineCode}.png`;
            
            const statusClass = getStatusClass(flight.status);
            const formattedStatus = capitalize(flight.status);
            const formattedAltitude = flight.altitude.toLocaleString();
            
            row.innerHTML = `
                <td>
                    <div class="flight-cell">
                        <img src="${logoUrl}" 
                             alt="${airlineCode}" 
                             class="airline-logo" 
                             onerror="this.style.display='none'"> 
                             <span class="flight-number">${flight.callsign}</span>
                    </div>
                </td>
                <td><span class="destination-code">${type === 'Arrivals' ? flight.origin : flight.destination}</span></td>
                <td><span class="aircraft-type">${flight.aircraft}</span></td>
                <td><span class="altitude-data">${formattedAltitude} ft</span></td>
                <td><span class="speed-data">${flight.groundspeed} kts</span></td>
                <td><span class="status-badge ${statusClass}">${formattedStatus}</span></td>
            `;
            container.appendChild(row);
        });
    }

    function updateMetar(metarData) {
        elements.metar.textContent = metarData || 'METAR unavailable';
    }

    function updateControllers(controllers) {
        elements.controllers.innerHTML = '';

        if (!controllers || controllers.length === 0) {
            elements.controllers.innerHTML = '<span class="no-controllers">No ATC Online</span>';
            return;
        }

        controllers.forEach(ctrl => {
            const badge = document.createElement('div');
            badge.className = 'controller-badge';
            badge.innerHTML = `
                <span>${ctrl.callsign}</span>
                <span class="controller-freq">${ctrl.frequency}</span>
            `;
            elements.controllers.appendChild(badge);
        });
    }

    function getStatusClass(status) {
        if (!status) return '';
        return `status-${status.toLowerCase().replace(/\s+/g, '-')}`;
    }

    function capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function updateTimestamp() {
        const now = new Date();
        const timeString = new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC'
        }).format(now);
        elements.lastUpdate.textContent = `${timeString} Z`;
    }

    function showConnectionStatus(isConnected) {
        const indicator = document.querySelector('.live-indicator');
        if (indicator) {
            indicator.style.color = isConnected ? '#ef4444' : '#64748b';
            indicator.textContent = isConnected ? '● LIVE' : '● OFFLINE';
        }
    }
});