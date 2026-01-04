# VATSIM Flight Board - Zurich Airport (LSZH)

Real-time flight information display system for Zurich Airport, showing live VATSIM flight simulator traffic in a clean, professional web interface.

## Features

- **Real-time Flight Tables**
  - Departures: Aircraft boarding or taxiing at LSZH
  - Arrivals: Aircraft landing, approaching, or landed at LSZH
  - En Route: All other LSZH-related flights currently airborne

- **Smart Status Detection**
  - Automatic flight phase detection based on altitude and groundspeed
  - Color-coded status badges for quick visual reference

- **Professional UI**
  - Clean design inspired by real airport displays
  - Airline logos via free CDN
  - Nunito font for modern aesthetic
  - Live METAR weather data
  - Online ATC controllers with frequencies
  - UTC timestamps

- **Live Updates**
  - Auto-refresh every 60 seconds via SocketIO
  - No page reload required

## Tech Stack

- **Backend:** Python, Flask, SocketIO
- **Frontend:** HTML, CSS, JavaScript
- **Data Sources:** VATSIM API, METAR API
- **Deployment:** Gunicorn with eventlet workers, systemd

## Installation

### Prerequisites
- Python 3.x
- Debian/Ubuntu Linux (or similar)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/tazmattar/flight-board.git
cd flight-board
```

2. Install dependencies:
```bash
pip install flask flask-socketio eventlet requests
```

3. Run in development:
```bash
python app.py
```

Access at `http://localhost:5000`

## Production Deployment

### Using Gunicorn + systemd

1. Install Gunicorn:
```bash
pip install gunicorn
```

2. Create systemd service file at `/etc/systemd/system/flight-board.service`:
```ini
[Unit]
Description=VATSIM Flight Board
After=network.target

[Service]
User=root
WorkingDirectory=/opt/flight-board
ExecStart=/usr/local/bin/gunicorn -k eventlet -w 1 -b 0.0.0.0:5000 app:app
Restart=always

[Install]
WantedBy=multi-user.target
```

3. Enable and start:
```bash
systemctl daemon-reload
systemctl enable flight-board
systemctl start flight-board
```

## Configuration

The system is currently configured for Zurich Airport (LSZH). To change airports, modify the `AIRPORT_ICAO` variable in `app.py`.

## API Information

- **VATSIM API:** Free, unlimited, updates every 60 seconds
- **METAR Data:** CheckWX API (free tier)

## License

MIT

## Author

Taz - [GitHub](https://github.com/tazmattar)
