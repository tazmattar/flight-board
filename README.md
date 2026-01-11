# VATSIM Flight Information Display System 
A professional, real-time Flight Information Display System (FIDS) designed for VATSIM operations. This application replicates the visual style and functionality of modern airport information screens found at major international airports.

It is optimised for use on dedicated display monitors in both portrait and landscape orientations.

## Features

### Core Functionality
* **Multi-Airport Support:** Seamless switching between LSZH (Zurich), LSGG (Geneva), LFSB (Basel), and EGLL (London Heathrow) via the header dropdown.
* **Real-Time Data:** Automatically fetches and refreshes pilot and flight plan data from the VATSIM Public Data API (v3) every 60 seconds.
* **Live WebSockets:** Uses Socket.IO to push updates immediately to the client without requiring a page refresh.
* **Responsive Layout:**
    * **Landscape Mode:** Displays Departures and Arrivals side-by-side.
    * **Portrait Mode:** Automatically stacks tables vertically for optimal use on vertical monitors.
* **Auto-Scroll Engine:** Smart scrolling logic detects overflow. If the list of flights exceeds the screen height, it automatically scrolls to show hidden flights, then loops back to the top.

### Intelligent Logic
* **Status Detection:** Automatically determines flight phases (Boarding, Taxiing, Departing, Landing) based on transponder codes, ground speed, and altitude.
* **Smart Delay Calculation:** Compares scheduled departure times against current UTC time to generate accurate delay warnings.
* **Geospatial Filtering:**
    * **Departures:** Visible while at the gate and until they leave the immediate terminal airspace (>80 km).
    * **Arrivals:** Appear when within realistic radar range (<15,000 km) and persist until parked.
* **Gate Logic:**
    * Dynamically assigns gates based on coordinate proximity to a defined stand database.
    * Automatically switches gate status to "CLOSED" once the aircraft pushes back.
* **Smart Check-In Allocation:** Deterministically assigns check-in desks based on airline and terminal, with airport-specific logic for each hub.

### Visual Design & Dynamic Theming
* **Modular Theme System:** Each airport has its own CSS theme file for easy customization and scalability.
* **Dynamic Theme Loading:** Themes are loaded on-demand when switching airports for optimal performance.
* **Airport-Specific Branding:** The interface automatically adapts its color scheme to match real-world airport branding:
    * **LSZH (Zurich):** High-contrast White/Black header with Yellow accents.
    * **LSGG (Geneva):** Geneva Blue headers with White text.
    * **LFSB (Basel):** Immersive "EuroAirport Blue" background with transparent panels.
    * **EGLL (Heathrow):** Classic Heathrow Yellow header with Black text and Yellow destination highlights.
* **Hybrid Display Style:**
    * **Flight Data:** Rendered as clean, high-visibility text.
    * **Status Column:** Rendered as solid, edge-to-edge colored blocks (Green for Boarding, Pink for Go to Gate, Red for Delays) for instant readability from a distance.
* **Logo Handling:** Implements a robust 3-tier fallback system for airline logos:
    1.  **Local Storage:** Prioritizes locally stored images (critical for cargo/special ops like FedEx or Rega).
    2.  **Kiwi.com API:** Primary source for commercial passenger airlines.
    3.  **Kayak API:** Backup source for obscure carriers.

## Screenshots

### Zurich (LSZH) - Classic Style
![Zurich Board](screenshots/LSZH.png)

### Geneva (LSGG) - Blue Header Theme
![Geneva Board](screenshots/LSGG.png)

### Basel (LFSB) - EuroAirport Blue Theme
![Basel Board](screenshots/LFSB.png)

### London Heathrow (EGLL) - Yellow Theme
![Heathrow Board](screenshots/EGLL.png)

## Technical Stack

* **Backend:** Python 3.8+, Flask, Flask-SocketIO
* **Scheduler:** APScheduler (Background data fetching)
* **Frontend:** HTML5, CSS3 (Flexbox/Grid), JavaScript (ES6+)
* **Data Source:** VATSIM Data API v3
* **Theme System:** Modular CSS architecture with dynamic loading

## Installation

### Prerequisites
* Python 3.8 or higher
* pip (Python package installer)

### Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/vatsim-flight-board.git
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

### Adding Logos Manually
To ensure cargo or special operators (e.g., FedEx, Rega) have logos:
1.  Save the logo as a PNG file (e.g., `FX.png` for FedEx).
2.  Place the file in `static/logos/`.
3.  Ensure the ICAO-to-IATA mapping exists in `static/js/app.js` under `airlineMapping`.

### Adding New Airports

Adding a new airport requires updates to 4 files:

#### 1. vatsim_fetcher.py
Add the airport to the `self.airports` dictionary:
```python
self.airports = {
    'LSZH': { 'name': 'Zurich Airport', 'lat': 47.4647, 'lon': 8.5492, 'ceiling': 6000 },
    'LSGG': { 'name': 'Geneva Airport', 'lat': 46.2370, 'lon': 6.1091, 'ceiling': 8000 },
    'LFSB': { 'name': 'EuroAirport Basel', 'lat': 47.5900, 'lon': 7.5290, 'ceiling': 5000 },
    'EGLL': { 'name': 'London Heathrow', 'lat': 51.4700, 'lon': -0.4543, 'ceiling': 7000 },
    'KJFK': { 'name': 'New York JFK', 'lat': 40.6413, 'lon': -73.7781, 'ceiling': 7000 }
}
```

Add check-in desk logic to the `get_checkin_area()` method with terminal/airline mappings.

#### 2. static/stands.json
Add stand coordinates for the new airport:
```json
{
  "LSZH": [...],
  "KJFK": [
    {"name": "1", "lat": 40.6413, "lon": -73.7781, "radius": 35, "type": "contact"},
    ...
  ]
}
```

#### 3. templates/index.html
Add the airport to the dropdown menu:
```html
<select id="airportSelect">
    <option value="LSZH">Zurich Airport - LSZH</option>
    <option value="LSGG">Geneva Airport - LSGG</option>
    <option value="LFSB">Basel Airport - LFSB</option>
    <option value="EGLL">London Heathrow - EGLL</option>
    <option value="KJFK">New York JFK - KJFK</option>
</select>
```

#### 4. Create Airport Theme (Optional but Recommended)

Create `static/css/themes/kjfk.css`:
```css
/* JFK Theme */
body.theme-kjfk {
    --jfk-blue: #003DA5;
}

body.theme-kjfk .fids-header {
    background-color: var(--jfk-blue);
    border-bottom: 4px solid #ffffff;
}

body.theme-kjfk .airport-selector select,
body.theme-kjfk .clock-container {
    color: #ffffff !important;
}

/* Add other theme-specific styles */
```

Update `static/js/app.js` to include the new theme:
```javascript
const themeMap = {
    'LSZH': '/static/css/themes/lszh.css',
    'LSGG': '/static/css/themes/lsgg.css',
    'LFSB': '/static/css/themes/lfsb.css',
    'EGLL': '/static/css/themes/egll.css',
    'KJFK': '/static/css/themes/kjfk.css'
};

// Add theme class application
if (airportCode === 'KJFK') {
    document.body.classList.add('theme-kjfk');
}
```

Update flags and footer text in the `updateTheme()` and `updateFooterText()` functions as needed.

## Theme System Architecture

### Modular Design
The theme system uses a modular architecture where each airport has its own CSS file in `static/css/themes/`. This approach:

- **Scales effortlessly** to hundreds of airports without bloating the main stylesheet
- **Improves performance** by loading only the active airport's theme
- **Simplifies maintenance** with isolated, self-contained theme files
- **Enables parallel development** where multiple themes can be worked on simultaneously

### Core + Theme Pattern
- `static/css/style.css` - Contains layout, tables, animations, and base styling
- `static/css/themes/{airport}.css` - Contains airport-specific color schemes and branding

### Dynamic Loading
Themes are loaded dynamically via JavaScript when the user switches airports. The `#airportTheme` link element updates its `href` to load the appropriate CSS file on demand.

## Deployment

### Production Deployment
For production use with Gunicorn:
```bash
gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:5000 app:app
```

### Systemd Service
Create `/etc/systemd/system/vatsim-flight-board.service`:
```ini
[Unit]
Description=VATSIM Flight Board
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/vatsim-flight-board
ExecStart=/usr/bin/gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:5000 app:app
Restart=always

[Install]
WantedBy=multi-user.target
```

Then enable and start:
```bash
sudo systemctl enable vatsim-flight-board
sudo systemctl start vatsim-flight-board
```

## Current Airports

| ICAO | Name | Terminals | Stands | Theme |
|------|------|-----------|--------|-------|
| LSZH | Zurich Airport | Multiple piers | 152 | White/Black/Yellow |
| LSGG | Geneva Airport | Main + French | 31 | Geneva Blue |
| LFSB | EuroAirport Basel | French/Swiss sectors | 79 | EuroAirport Blue |
| EGLL | London Heathrow | T1, T2, T3, T4, T5 | 248 | Heathrow Yellow |

## License

This project is open-source and available under the MIT License.

## Acknowledgements

* **Data:** VATSIM Network
* **Logos:** Kiwi.com, Kayak, and airline-codes database
* **Fonts:** Roboto Condensed and JetBrains Mono via Google Fonts
* **Stand Data:** Extracted from airport charts and Google Earth

## Roadmap

- [ ] Add more European airports (LFPG, EDDF, LEMD, LIRF)
- [ ] Add North American airports (KJFK, KLAX, CYYZ, CYVR)
- [ ] Add Asian Pacific airports (VHHH, WSSS, YSSY)
- [ ] Implement custom themes for major hub airports
- [ ] Add METAR/weather display toggle
- [ ] Add ATC/Controller information panel
- [ ] Aircraft type silhouettes/icons
- [ ] Historical flight data logging
