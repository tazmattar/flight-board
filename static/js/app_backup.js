document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration & Elements ---
    const socket = io();
    
    const elements = {
        departureList: document.getElementById('departureList'),
        arrivalList: document.getElementById('arrivalList'),
        enrouteList: document.getElementById('enrouteList'),
        lastUpdate: document.getElementById('lastUpdate'),
        metar: document.getElementById('metar'),
        controllers: document.getElementById('controllers')
    };

    // Mapping callsigns to IATA codes for logos
    const airlineMapping = {
        'SWR': 'LX', 'SWS': 'LX', // Swiss
        'DLH': 'LH', // Lufthansa
        'BAW': 'BA', 'SHT': 'BA', // British Airways
        'AFR': 'AF', // Air France
        'KLM': 'KL', // KLM
        'UAE': 'EK', // Emirates
        'THY': 'TK', // Turkish Airlines
        'AUA': 'OS', // Austrian
        'SAS': 'SK', // SAS
        'IBE': 'IB', // Iberia
        'RYR': 'FR', // Ryanair
        'EZY': 'U2', // easyJet
        'AEE': 'A3', // Aegean
        'TAP': 'TP', // TAP Portugal
        'EDW': 'WK', // Edelweiss
        'DAL': 'DL', // Delta
        'DKH': 'HO', // Juneyao
        'UAL': 'UA', // United
        'AAL': 'AA', // American
        'QTR': 'QR', // Qatar
        'ETD': 'EY', // Etihad
    };

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
        
        console.log('Data received:', data); // Debugging
        
        // Render all sections
        renderTable(data.departures || [], elements.departureList, 'Departures');
        renderTable(data.arrivals || [], elements.arrivalList, 'Arrivals');
        renderTable(data.enroute || [], elements.enrouteList, 'En Route');
        
        updateMetar(data.metar);
        updateControllers(data.controllers);
        updateTimestamp();
    });

    // --- Rendering Functions ---

    /**
     * Renders a specific flight table (Departures, Arrivals, or En Route)
     */
    function renderTable(flights, container, type) {
        container.innerHTML = '';

        if (flights.length === 0) {
            container.innerHTML = `
                <tr>
                    <td colspan="6" class="loading-cell">
                        No active ${type.toLowerCase()}
                    </td>
                </tr>`;
            return;
        }

        flights.forEach(flight => {
            const row = document.createElement('tr');
            
            // Data processing
            const callsignPrefix = flight.callsign.substring(0, 3).toUpperCase();
            const airlineCode = airlineMapping[callsignPrefix] || callsignPrefix;
            // Fallback to IATA logo, if not found the onerror event in HTML hides it
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
                <td>
                    <span class="destination-code">
                        ${type === 'Arrivals' ? flight.origin : flight.destination}
                    </span>
                </td>
                <td><span class="aircraft-type">${flight.aircraft}</span></td>
                <td><span class="altitude-data">${formattedAltitude} ft</span></td>
                <td><span class="speed-data">${flight.groundspeed} kts</span></td>
                <td>
                    <span class="status-badge ${statusClass}">
                        ${formattedStatus}
                    </span>
                </td>
            `;
            container.appendChild(row);
        });
    }

    function updateMetar(metarData) {
        // If metarData is just a string, display it. 
        // If it's missing, show placeholder.
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

    // --- Helpers ---

    function getStatusClass(status) {
        if (!status) return '';
        // Convert "En Route" -> "en-route", "Landed" -> "landed"
        return `status-${status.toLowerCase().replace(/\s+/g, '-')}`;
    }

    function capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function updateTimestamp() {
        const now = new Date();
        // Use Intl for cleaner UTC formatting
        const timeString = new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'UTC'
        }).format(now);
        
        elements.lastUpdate.textContent = `${timeString} Z`;
    }

    function showConnectionStatus(isConnected) {
        const indicator = document.querySelector('.live-indicator');
        if (indicator) {
            indicator.style.color = isConnected ? '#ef4444' : '#64748b'; // Red for live, grey for offline
            indicator.textContent = isConnected ? '● LIVE' : '● OFFLINE';
        }
    }
});