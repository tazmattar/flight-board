# VATSIM Flight Information Display System

A professional, real-time Flight Information Display System (FIDS) designed for VATSIM operations. This application replicates the visual style and functionality of modern airport information screens found at major Swiss airports (Zurich, Geneva, Basel).

It is optimized for use on dedicated display monitors in both portrait and landscape orientations.

## Features

### Core Functionality
* **Multi-Airport Support:** Seamless switching between LSZH (Zurich), LSGG (Geneva), and LFSB (Basel) via the header dropdown.
* **Real-Time Data:** Automatically fetches and refreshes pilot, flight plan data from the VATSIM Public Data API (v3) every 60 seconds.
* **Live WebSockets:** Uses Socket.IO to push updates immediately to the client without requiring a page refresh.
* **Responsive Layout:**
    * **Landscape Mode:** Displays Departures and Arrivals side-by-side.
    * **Portrait Mode:** Automatically stacks tables vertically for optimal use on vertical monitors.
* **Auto-Scroll Engine:** Smart scrolling logic detects overflow. If the list of flights exceeds the screen height, it automatically scrolls to show hidden flights, then loops back to the top.

### Intelligent Logic
* **Status Detection:** Automatically determines flight phases (Boarding, Taxiing, Departing, En Route, Landing) based on transponder codes, ground speed, and altitude.
* **Smart Delay Calculation:** Compares scheduled departure times against current UTC time to generate accurate delay warnings.
* **Geospatial Filtering:**
    * **Departures:** Visible while at the gate and until they leave the immediate terminal airspace (>80 km).
    * **Arrivals:** Appear when within realistic radar range (<15,000 km) and persist until parked.
* **Gate Logic:**
    * Dynamically assigns gates based on coordinate proximity to a defined stand database.
    * Automatically switches gate status to "CLOSED" once the aircraft pushes back.

### Visual Design & Theming
* **Dynamic Theming:** The interface automatically adapts its color scheme to match the real-world branding of the selected airport:
    * **LSZH (Zurich):** High-contrast White/Black header with Yellow accents.
    * **LSGG (Geneva):** Specific "Geneva Blue" headers with White text.
    * **LFSB (Basel):** Immersive "EuroAirport Blue" background with transparent panels.
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

## Technical Stack

* **Backend:** Python 3.8+, Flask, Flask-SocketIO
* **Scheduler:** APScheduler (Background data fetching)
* **Frontend:** HTML5, CSS3 (Flexbox/Grid), JavaScript (ES6+)
* **Data Source:** VATSIM Data API v3

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

### Adding Logos manually
To ensure cargo or special operators (e.g., FedEx, Rega) have logos:
1.  Save the logo as a PNG file (e.g., `FX.png` for FedEx).
2.  Place the file in `static/logos/`.
3.  Ensure the ICAO-to-IATA mapping exists in `static/js/app.js` under `airlineMapping`.

### Adding New Airports
1.  Open `vatsim_fetcher.py`.
2.  Add the airport ICAO, coordinates, and ceiling limit to the `self.airports` dictionary.
3.  Update `templates/index.html` to add the airport to the dropdown menu.
4.  (Optional) Add specific stands to `static/stands.json` for accurate gate detection.
5.  (Optional) Add a custom CSS theme in `static/css/style.css`.

## License

This project is open-source and available under the MIT License.

## Acknowledgements

* **Data:** VATSIM Network
* **Logos:** Kiwi.com, Kayak, and airline-codes database
* **Fonts:** Roboto Condensed and JetBrains Mono via Google Fonts
