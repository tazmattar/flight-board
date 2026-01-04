**VATSIM Flight Board - Swiss Radar Edition**

A professional, real-time Flight Information Display System (FIDS) for VATSIM, designed to mimic modern airport displays. Currently configured for major Swiss airports (Zurich, Geneva, Basel).

🚀 **Features**

**Core Functionality**
- Multi-Airport Support: Live switching between LSZH (Zurich), LSGG (Geneva), and LFSB (Basel) via a dropdown menu.
- Real-Time Updates: Auto-refreshes flight data every 60 seconds using WebSockets (Socket.IO).
- Live VATSIM Data: Pulls pilots, flight plans, and online ATC controllers directly from the VATSIM Data API.

**"Smart" Logic**
- Intelligent Status Detection: Automatically determines if a flight is Boarding, Taxiing, Departing, En Route, or Landing based on physics (altitude/speed) and geospatial location.
- Smart Delay Calculation:
  - Calculates delays based on filed departure time vs. current time.
  - Auto-Correction: Detects "stale" flight plans (e.g., pilot reused a plan from yesterday) and hides unrealistic delays (>5 hours).
  - Fresh Flight Detection: Ignores delays if the pilot logged on after their scheduled time.
- Geospatial Filtering:
  - Departures: Automatically removed from the board once they leave the terminal airspace (>80 km).
  - Arrivals: Only appear when they enter realistic radar range (<1000 km).
  - Return Flight Fix: Prevents aircraft at destination airports from appearing as "Boarding" at the origin.

🎨 **UI/UX Design**
- "Midnight Radar" Theme: Dark mode aesthetic with high-contrast text for readability.
- Dynamic Airline Logos: Fetches airline logos automatically using an open-source ICAO-to-IATA database (no API key required).
- Visual Alerts:
  - Flashing Red Badges for delayed flights.
  - Neon Status Badges for different flight phases.
- ATC Presence: Shows active controllers (Tower, Ground, Approach) with their frequencies.
- METAR Integration: Displays live weather reports for the selected airport.

🛠️ **Tech Stack**
- Backend: Python, Flask, Flask-SocketIO
- Task Scheduling: APScheduler (background fetches)
- Frontend: HTML5, CSS3 (Grid/Flexbox), JavaScript (ES6+)
- Data: VATSIM Public Data API (v3)

📦 **Installation**

**Prerequisites**
- Python 3.8+
- pip

**Setup**

1. Clone the repository:
```bash
git clone https://github.com/yourusername/vatsim-flight-board.git
cd vatsim-flight-board
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```
(If requirements.txt is missing, install manually: `pip install flask flask-socketio requests apscheduler eventlet`)

3. Run the application:
```bash
python app.py
```

4. Access the board:
Open your browser to `http://localhost:5000`

⚙️ **Configuration**

Adding New Airports

To add more airports, edit `vatsim_fetcher.py`. Add the airport ICAO, name, and coordinates to the `self.airports` dictionary:

```python
self.airports = {
    'LSZH': {'name': 'Zurich Airport', 'lat': 47.4647, 'lon': 8.5492},
    'EGLL': {'name': 'London Heathrow', 'lat': 51.47, 'lon': -0.4543}, # Example
    # ...
}
```

Don't forget to update the dropdown menu in `templates/index.html` to match.

📂 **Project Structure**

```
├── app.py                 # Main Flask application & Socket.IO server
├── vatsim_fetcher.py      # Logic for fetching, parsing, and filtering VATSIM data
├── config.py              # Configuration settings
├── templates/
│   └── index.html         # Main dashboard (HTML structure)
└── static/
    ├── css/
    │   └── style.css      # Dark theme & animations
    └── js/
        └── app.js         # Frontend logic (WebSockets, dynamic logos)
```

📝 **License**

This project is open-source and available under the MIT License.

🤝 **Acknowledgements**
- Data Source: VATSIM (https://vatsim.net/)
- Airline Logos: Kiwi.com (https://kiwi.com) & Airline Codes Dataset (https://github.com/npow/airline-codes)
- Fonts: Inter & JetBrains Mono (Google Fonts)
