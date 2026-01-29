# VATSIM Flight Information Display System 
A professional, real-time Flight Information Display System (FIDS) designed for VATSIM operations. This application replicates the visual style and functionality of modern airport information screens found at major international airports.

It is optimised for use on dedicated display monitors in both portrait and landscape orientations.

## Features

### Core Functionality
* **Universal Airport Support:** Instantly load *any* airport on the VATSIM network by searching for its ICAO code in the UI.
* **Pre-Configured Hubs:** One-click switching between major hubs: LSZH, LSGG, LFSB, EGLL, EGKK, and KJFK.
* **Real-Time Data:** Automatically fetches and refreshes pilot and flight plan data from the VATSIM Public Data API (v3) every 60 seconds.
* **Live WebSockets:** Uses Socket.IO to push updates immediately to the client without requiring a page refresh.
* **Header Widgets:** Live ATC status with controller popover, plus METAR-driven weather icon and temperature display.
* **Responsive Layout:**
    * **Landscape Mode:** Displays Departures and Arrivals side-by-side.
    * **Portrait Mode:** Automatically stacks tables vertically for optimal use on vertical monitors.
* **Auto-Scroll Engine:** Smart scrolling logic detects overflow. If the list of flights exceeds the screen height, it automatically scrolls to show hidden flights, then loops back to the top.

### Intelligent Logic
* **UKCP Stand Integration:** Direct integration with the VATSIM UK Controller Panel API to display real-time stand assignments for UK airports (EGLL, EGKK, etc.).
* **Status Detection:** Automatically determines flight phases (Boarding, Taxiing, Departing, Landing) based on transponder codes, ground speed, and altitude.
* **Smart Delay Calculation:** Compares scheduled departure times against current UTC time to generate accurate delay warnings.
* **Geospatial Filtering:**
    * **Departures:** Visible while at the gate and until they leave the immediate terminal airspace (>80 km).
    * **Arrivals:** Appear when within realistic radar range (<250 km) and persist until parked.
* **Smart Check-In Allocation:** Deterministically assigns check-in desks based on airline and terminal, with airport-specific logic for supported hubs.

### Visual Design & Dynamic Theming
* **Modular Theme System:** Each airport has its own CSS theme file for easy customization.
* **Dynamic Theme Loading:** Themes are loaded on-demand. Non-configured airports automatically use a high-contrast "Default" theme.
* **Airport-Specific Branding:** The interface adapts to match real-world airport branding:
    * **LSZH (Zurich):** High-contrast White/Black header with Yellow accents.
    * **LSGG (Geneva):** Geneva Blue headers with White text.
    * **LFSB (Basel):** Immersive "EuroAirport Blue" background.
    * **EGLL (Heathrow):** Classic Heathrow Yellow header with Black text.
    * **EGKK (Gatwick):** Distinctive Gatwick Yellow and Black styling.
    * **KJFK (New York):** Retro "Solari" split-flap style with the custom B612 font.
* **Hybrid Display Style:**
    * **Flight Data:** Rendered as clean, high-visibility text.
    * **Status Column:** Rendered as solid, edge-to-edge colored blocks for instant readability.
* **Advanced Logo Handling:** * **Dynamic Resolution:** Automatically fetches and maps airline codes (ICAO to IATA) to pull high-quality logos from the web.
    * **Fallback System:** Prioritizes local files for special ops (FedEx, Rega), then falls back to Kiwi.com and Kayak APIs for commercial carriers.

## Screenshots

### Zurich (LSZH) - Classic Style
![Zurich Board](screenshots/LSZH.png)

### Geneva (LSGG) - Blue Header Theme
![Geneva Board](screenshots/LSGG.png)

### Basel (LFSB) - EuroAirport Blue Theme
![Basel Board](screenshots/LFSB.png)

### London Heathrow (EGLL) - Yellow Theme
![Heathrow Board](screenshots/EGLL.png)

### London Gatwick (EGLL) - Yellow Theme
![Gatwick Board](screenshots/EGKK.png)

### London City (EGLC) - Yellow Theme
![City Board](screenshots/EGLC.png)

### Tokyo Haneda (RJTT) - Haneda Theme
![Haneda Board](screenshots/RJTT.png)

## Technical Stack

* **Backend:** Python 3.8+, Flask, Flask-SocketIO
* **Scheduler:** APScheduler (Background data fetching)
* **Frontend:** HTML5, CSS3 (Flexbox/Grid), JavaScript (ES6+)
* **Data Sources:** * VATSIM Data API v3
    * UKCP API (Stand assignments)
    * GitHub Airline Codes Database (Logo mapping)
* **Theme System:** Modular CSS architecture with dynamic loading

## Installation

### Prerequisites
* Python 3.8 or higher
* pip (Python package installer)

### Setup

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/yourusername/vatsim-flight-board.git](https://github.com/yourusername/vatsim-flight-board.git)
    cd vatsim-flight-board
    ```

2.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```
    *If requirements.txt is missing:*
    ```bash
    pip install flask flask-socketio requests apscheduler eventlet python-dotenv
    ```

3.  **Run the application:**
    ```bash
    python app.py
    ```

4.  **Access the board:**
    Open a web browser and navigate to `http://localhost:5000`

## Configuration

### Remote Airport Switching (API)
Perfect for **kiosk mode deployments** on external machines (Raspberry Pi, dedicated displays, etc.). Remotely switch all connected clients to a different airport without manual interaction using the broadcast API endpoint:

**Endpoint:** `GET /api/switch_airport/<airport_code>`

**Use Cases:**
* Multiple display kiosks showing different airport data simultaneously
* Automated airport switching schedules on Raspberry Pi displays
* Control multiple displays from a central management system
* Rotate through airports on dedicated information screens

**Examples:**
```bash
# Using curl
curl http://your-proxmox-ip:5000/api/switch_airport/EGLL

# Using your browser
http://your-proxmox-ip:5000/api/switch_airport/EGLL

# Switch to different airports
http://your-proxmox-ip:5000/api/switch_airport/KJFK
http://your-proxmox-ip:5000/api/switch_airport/LSZH
```

**Response:**
```json
{
  "success": true,
  "airport": "EGLL",
  "message": "Switched all clients to EGLL"
}
```

**Validation:** The endpoint validates that the airport code is exactly 4 letters and alphabetic. Invalid codes return a 400 error.

### Adding Logos Manually
To ensure cargo or special operators (e.g., FedEx, Rega) have logos:
1.  Save the logo as a PNG file (e.g., `FX.png` for FedEx).
2.  Place the file in `static/logos/`.
3.  The system will automatically prioritize this local file over web sources.

### Customizing Airports
You can add specific logic for new airports in `checkin_assignments.py` (for desk rules) and `static/stands.json` (for geofenced gate logic). However, the system now supports **Universal Search**, so any valid ICAO code will work out-of-the-box with the Default theme.

## Current Configured Airports

| ICAO | Name | Terminals | Stands | Theme |
|------|------|-----------|--------|-------|
| LSZH | Zurich Airport | Multiple piers | 152 | White/Black/Yellow |
| LSGG | Geneva Airport | Main + French | 31 | Geneva Blue |
| LFSB | EuroAirport Basel | French/Swiss | 79 | EuroAirport Blue |
| EGLL | London Heathrow | T2, T3, T4, T5 | 248 | Heathrow Yellow |
| EGKK | London Gatwick | North/South | UKCP | Gatwick Yellow |
| KJFK | New York JFK | T1, T4, T5, T7, T8 | 35 | Solari Split-Flap |

*Note: Any other airport can be loaded via the "+" button in the UI.*

## License

This project is open-source and available under the MIT License.

## Acknowledgements

* **Data:** VATSIM Network & UK Controller Panel (UKCP)
* **Logos:** Kiwi.com, Kayak, and airline-codes database
* **Fonts:** Roboto Condensed, JetBrains Mono, and B612 via Google Fonts
* **Stand Data:** Extracted from airport charts and Google Earth

## Roadmap

- [x] Add more European airports (EGKK added)
- [x] Add North American airports (KJFK added)
- [x] Implement custom themes for major hub airports
- [x] Universal Airport Search (Dynamic loading)
- [ ] Asian Pacific airports (VHHH, WSSS, YSSY)
- [x] Add METAR/weather display widget
- [x] Add ATC/controller widget with live popover
- [ ] Aircraft type silhouettes/icons
