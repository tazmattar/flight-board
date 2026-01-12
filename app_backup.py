from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
from apscheduler.schedulers.background import BackgroundScheduler
from vatsim_fetcher import VatsimFetcher
from config import Config
import atexit

app = Flask(__name__)
app.config.from_object(Config)
socketio = SocketIO(app, cors_allowed_origins="*")

flight_fetcher = VatsimFetcher()
# Global store: {'LSZH': {...}, 'LSGG': {...}}
current_data = {} 

def update_flights():
    """Fetch all airports and broadcast to their respective rooms"""
    global current_data
    print("Fetching flight data...")
    new_data = flight_fetcher.fetch_flights()
    
    if new_data:
        current_data = new_data
        # Broadcast specifically to subscribers of each airport
        for airport_code, airport_data in current_data.items():
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

@socketio.on('join_airport')
def handle_join(data):
    """Client wants to view a specific airport"""
    airport = data.get('airport', 'LSZH')
    # Leave previous rooms if any (optional, but cleaner)
    # Join the new room
    join_room(airport)
    print(f"Client {request.sid} joined {airport}")
    
    # Send immediate update for that airport so they don't wait for next tick
    if airport in current_data:
        emit('flight_update', current_data[airport])

@socketio.on('leave_airport')
def handle_leave(data):
    airport = data.get('airport')
    leave_room(airport)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)