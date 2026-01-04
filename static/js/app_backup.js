const socket = io();

const departureList = document.getElementById('departureList');
const arrivalList = document.getElementById('arrivalList');
const enrouteList = document.getElementById('enrouteList');
const lastUpdate = document.getElementById('lastUpdate');
const metarDisplay = document.getElementById('metar');
const controllersDisplay = document.getElementById('controllers');

// Callsign prefix to IATA code mapping
const airlineMapping = {
    'SWR': 'LX',  // Swiss
    'SWS': 'LX',  // Swiss (incorrect callsign)
    'DLH': 'LH',  // Lufthansa
    'BAW': 'BA',  // British Airways
    'AFR': 'AF',  // Air France
    'KLM': 'KL',  // KLM
    'UAE': 'EK',  // Emirates
    'THY': 'TK',  // Turkish Airlines
    'AUA': 'OS',  // Austrian
    'SAS': 'SK',  // SAS
    'IBE': 'IB',  // Iberia
    'RYR': 'FR',  // Ryanair
    'EZY': 'U2',  // easyJet
    'AEE': 'A3',  // Aegean
    'TAP': 'TP',  // TAP Portugal
    'EDW': 'WK',  // Edelweiss
    'DAL': 'DL',  // Delta Airlines
    'DKH': 'HO',  // Juneyao Airlines
};

socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

socket.on('flight_update', (data) => {
    console.log('Received flight update:', data);
    updateFlightDisplay(data);
    updateMetar(data.metar);
    updateControllers(data.controllers);
    updateLastUpdateTime();
});

function updateFlightDisplay(data) {
    displayFlights(data.departures || [], departureList, 'departures');
    displayFlights(data.arrivals || [], arrivalList, 'arrivals');
    displayFlights(data.enroute || [], enrouteList, 'en route flights');
}

function displayFlights(flights, container, type) {
    container.innerHTML = '';
    
    if (flights.length === 0) {
        container.innerHTML = `<tr><td colspan="6" class="loading-cell">No ${type}</td></tr>`;
        return;
    }
    
    flights.forEach(flight => {
        const row = document.createElement('tr');
        const statusClass = getStatusClass(flight.status);
        
        // Extract airline code from callsign (first 3 letters)
        const callsignPrefix = flight.callsign.substring(0, 3).toUpperCase();
        const airlineCode = airlineMapping[callsignPrefix] || callsignPrefix;
        const logoUrl = `https://images.kiwi.com/airlines/64/${airlineCode}.png`;
        
        row.innerHTML = `
            <td>
                <div class="flight-cell">
                    <img src="${logoUrl}" alt="${airlineCode}" class="airline-logo" onerror="this.style.display='none'">
                    <span class="flight-number">${flight.callsign}</span>
                </div>
            </td>
            <td><span class="destination-code">${flight.destination}</span></td>
            <td><span class="aircraft-type">${flight.aircraft}</span></td>
            <td><span class="altitude-data">${flight.altitude.toLocaleString()} ft</span></td>
            <td><span class="speed-data">${flight.groundspeed} kts</span></td>
            <td><span class="status-badge ${statusClass}">${flight.status}</span></td>
        `;
        
        container.appendChild(row);
    });
}

function getStatusClass(status) {
    const statusLower = status.toLowerCase().replace(/\s+/g, '-');
    return `status-${statusLower}`;
}

function updateMetar(metar) {
    metarDisplay.textContent = metar || 'METAR not available';
}

function updateControllers(controllers) {
    controllersDisplay.innerHTML = '';
    
    if (!controllers || controllers.length === 0) {
        controllersDisplay.innerHTML = '<span class="no-controllers">No ATC online</span>';
        return;
    }
    
    controllers.forEach(controller => {
        const badge = document.createElement('div');
        badge.className = 'controller-badge';
        
        badge.innerHTML = `
            <span>${controller.callsign}</span>
            <span class="controller-freq">${controller.frequency}</span>
        `;
        
        controllersDisplay.appendChild(badge);
    });
}

function updateLastUpdateTime() {
    const now = new Date();
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    lastUpdate.textContent = `${hours}:${minutes}:${seconds} UTC`;
}

updateLastUpdateTime();
