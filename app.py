from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from apscheduler.schedulers.background import BackgroundScheduler
from vatsim_fetcher import VatsimFetcher
from airport_languages import AirportLanguages
from config import Config
import atexit

app = Flask(__name__)
app.config.from_object(Config)
socketio = SocketIO(app, cors_allowed_origins="*")

flight_fetcher = VatsimFetcher()
# Global store: {'LSZH': {...}, 'LSGG': {...}, 'EDDF': {...}, etc}
current_data = {} 

def update_flights():
    """Fetch all configured airports and broadcast to their respective rooms"""
    global current_data
    print("Fetching flight data...")
    new_data = flight_fetcher.fetch_flights()
    
    if new_data:
        current_data.update(new_data)
        # Broadcast specifically to subscribers of each airport
        for airport_code, airport_data in new_data.items():
            socketio.emit('flight_update', airport_data, to=airport_code)

scheduler = BackgroundScheduler()
scheduler.add_job(func=update_flights, trigger="interval", seconds=Config.UPDATE_INTERVAL)
scheduler.start()
atexit.register(lambda: scheduler.shutdown())

# Fetch immediately on start
update_flights()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/translations')
def get_translations():
    """Serve all language translations to the frontend"""
    return jsonify(AirportLanguages.get_all_translations())

@app.route('/api/search_airport', methods=['POST'])
def search_airport():
    """Search for a dynamic airport by ICAO code and fetch its data"""
    icao = request.json.get('icao', '').upper().strip()
    
    if not icao or len(icao) != 4:
        return jsonify({'error': 'Please enter a valid 4-letter ICAO code'}), 400
    
    # Check if airport exists in database
    airport_info = flight_fetcher.get_airport_info(icao)
    
    if not airport_info:
        return jsonify({'error': f'Airport {icao} not found in database'}), 404
    
    if airport_info['lat'] is None or airport_info['lon'] is None:
        return jsonify({'error': f'Airport {icao} has no coordinate data'}), 400
    
    # Fetch data for this specific airport
    print(f"Fetching data for dynamic airport: {icao}")
    airport_data = flight_fetcher.fetch_single_airport(icao)
    
    if airport_data:
        # Store in current_data so it persists
        current_data.update(airport_data)
        
        return jsonify({
            'success': True,
            'icao': icao,
            'name': airport_info['name'],
            'country': airport_info.get('country', ''),
            'data': airport_data[icao]
        })
    else:
        return jsonify({'error': f'Failed to fetch data for {icao}'}), 500

@socketio.on('join_airport')
def handle_join(data):
    """Client wants to view a specific airport"""
    airport = data.get('airport', 'LSZH').upper()
    join_room(airport)
    print(f"Client {request.sid} joined {airport}")
    
    # If it's a dynamic airport not in current_data, fetch it
    if airport not in current_data and airport not in flight_fetcher.configured_airports:
        print(f"Fetching dynamic airport on join: {airport}")
        airport_data = flight_fetcher.fetch_single_airport(airport)
        if airport_data:
            current_data.update(airport_data)
            emit('flight_update', airport_data[airport])
            return
    
    # Send immediate update for that airport if we have data
    if airport in current_data:
        emit('flight_update', current_data[airport])

@socketio.on('leave_airport')
def handle_leave(data):
    airport = data.get('airport')
    if airport:
        leave_room(airport)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
