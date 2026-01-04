from flask import Flask, render_template
from flask_socketio import SocketIO, emit
from apscheduler.schedulers.background import BackgroundScheduler
from vatsim_fetcher import VatsimFetcher
from config import Config
import atexit

app = Flask(__name__)
app.config.from_object(Config)
socketio = SocketIO(app, cors_allowed_origins="*")

# Initialize VATSIM fetcher
flight_fetcher = VatsimFetcher()
# Store current flights in memory (Global state)
current_flights = {
    'departures': [],
    'arrivals': [],
    'enroute': [],
    'metar': 'Loading...',
    'controllers': []
}

def update_flights():
    """Fetch new flight data and broadcast to connected clients"""
    global current_flights
    print("Fetching flight data...")
    new_data = flight_fetcher.fetch_flights()
    
    if new_data:
        current_flights = new_data
        # Broadcast to all connected clients
        socketio.emit('flight_update', current_flights)

# Set up scheduled updates
scheduler = BackgroundScheduler()
scheduler.add_job(func=update_flights, trigger="interval", seconds=Config.UPDATE_INTERVAL)
scheduler.start()

# Fetch initial data on startup
update_flights()

# Shut down scheduler on exit
atexit.register(lambda: scheduler.shutdown())

@app.route('/')
def index():
    """Main page"""
    return render_template('index.html', airport_code=Config.AIRPORT_CODE)

@socketio.on('connect')
def handle_connect():
    """Send current flights when client connects"""
    print("Client connected")
    # FIX: Emit 'current_flights' directly, matching the structure of 'update_flights'
    emit('flight_update', current_flights)

@socketio.on('disconnect')
def handle_disconnect():
    print("Client disconnected")

@socketio.on('manual_refresh')
def handle_manual_refresh():
    """Allow manual refresh from frontend"""
    print("Manual refresh requested")
    update_flights()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)