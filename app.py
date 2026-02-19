from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room
from apscheduler.schedulers.background import BackgroundScheduler
from vatsim_fetcher import VatsimFetcher
from airport_languages import AirportLanguages
from config import Config
import json
import os
import re
import atexit
import time

app = Flask(__name__)
app.config.from_object(Config)
socketio = SocketIO(app, cors_allowed_origins="*")

flight_fetcher = VatsimFetcher()
# Global store: {'LSZH': {...}, 'LSGG': {...}, 'EDDF': {...}, etc}
current_data = {}

# Track active airport rooms so dynamic airports can be refreshed
active_airport_counts = {}
client_airports = {}

THEME_MAP_PATH = os.path.join(app.static_folder, 'data', 'theme_map.json')
STANDS_PATH = os.path.join(app.static_folder, 'stands.json')
THEME_CSS_PREFIX = '/static/css/themes/'
ICAO_PATTERN = re.compile(r'^[A-Z]{4}$')
ADMIN_SESSION_KEY = 'admin_authenticated'
FAILED_LOGIN_ATTEMPTS = {}
LOGIN_LOCKOUTS = {}

DEFAULT_THEME_MAP = {
    'LSZH': {'css': '/static/css/themes/lszh.css', 'class': 'theme-lszh'},
    'LSGG': {'css': '/static/css/themes/lsgg.css', 'class': 'theme-lsgg'},
    'LFSB': {'css': '/static/css/themes/lfsb.css', 'class': 'theme-lfsb'},
    'EGLL': {'css': '/static/css/themes/egll.css', 'class': 'theme-egll'},
    'EGLC': {'css': '/static/css/themes/eglc.css', 'class': 'theme-eglc'},
    'EGKK': {'css': '/static/css/themes/egkk.css', 'class': 'theme-egkk'},
    'EGSS': {'css': '/static/css/themes/egss.css', 'class': 'theme-egss'},
    'EHAM': {'css': '/static/css/themes/eham.css', 'class': 'theme-eham'},
    'KJFK': {'css': '/static/css/themes/kjfk.css', 'class': 'theme-kjfk'},
    'RJTT': {'css': '/static/css/themes/rjtt.css', 'class': 'theme-rjtt'}
}

def _read_json(path, fallback):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return fallback

def _write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=True)
        f.write('\n')

def _normalize_icao(code):
    code = str(code or '').strip().upper()
    if not ICAO_PATTERN.fullmatch(code):
        return None
    return code

def _theme_css_exists(css_path):
    if not css_path.startswith(THEME_CSS_PREFIX):
        return False
    rel = css_path.replace('/static/', '', 1)
    full = os.path.join(app.static_folder, rel.replace('static/', '', 1))
    return os.path.exists(full)

def _validate_theme_map(raw_map):
    if not isinstance(raw_map, dict):
        raise ValueError('Theme map must be an object keyed by ICAO code.')

    cleaned = {}
    for icao, value in raw_map.items():
        normalized_icao = _normalize_icao(icao)
        if not normalized_icao:
            raise ValueError(f'Invalid ICAO code: {icao}')
        if not isinstance(value, dict):
            raise ValueError(f'Invalid theme config for {normalized_icao}')

        css_path = str(value.get('css', '')).strip()
        css_class = str(value.get('class', '')).strip()

        if not css_path:
            raise ValueError(f'Missing css value for {normalized_icao}')
        if not _theme_css_exists(css_path):
            raise ValueError(f'CSS file not found or invalid path for {normalized_icao}: {css_path}')
        if css_class and not re.fullmatch(r'[a-z0-9-]+', css_class):
            raise ValueError(f'Invalid class for {normalized_icao}: {css_class}')

        cleaned[normalized_icao] = {'css': css_path, 'class': css_class}

    return dict(sorted(cleaned.items()))

def _validate_stands(payload):
    if not isinstance(payload, list):
        raise ValueError('Stands payload must be an array.')

    cleaned = []
    for index, stand in enumerate(payload):
        if not isinstance(stand, dict):
            raise ValueError(f'Stand at index {index} must be an object.')

        name = str(stand.get('name', '')).strip()
        if not name:
            raise ValueError(f'Stand at index {index} is missing name.')

        try:
            lat = float(stand.get('lat'))
            lon = float(stand.get('lon'))
            radius = float(stand.get('radius', 40))
        except (TypeError, ValueError):
            raise ValueError(f'Stand at index {index} has invalid numeric values.')

        stand_type = str(stand.get('type', 'contact')).strip().lower()
        if stand_type not in {'contact', 'remote'}:
            raise ValueError(f'Stand at index {index} has invalid type: {stand_type}')

        cleaned.append({
            'name': name,
            'lat': lat,
            'lon': lon,
            'radius': radius,
            'type': stand_type
        })

    return cleaned

def _load_theme_map():
    raw = _read_json(THEME_MAP_PATH, DEFAULT_THEME_MAP)
    try:
        return _validate_theme_map(raw)
    except ValueError:
        return DEFAULT_THEME_MAP

def _theme_options():
    themes_dir = os.path.join(app.static_folder, 'css', 'themes')
    names = []
    if os.path.isdir(themes_dir):
        for filename in os.listdir(themes_dir):
            if filename.endswith('.css'):
                names.append(filename)
    names.sort()
    return [{'name': n, 'css': f'/static/css/themes/{n}'} for n in names]

def _is_admin_authenticated():
    return bool(session.get(ADMIN_SESSION_KEY))

def _get_client_ip():
    xff = request.headers.get('X-Forwarded-For', '')
    if xff:
        # First hop is the original client.
        return xff.split(',')[0].strip()
    return request.remote_addr or 'unknown'

def _prune_failed_attempts(key, now_ts):
    window_seconds = int(app.config.get('ADMIN_LOGIN_WINDOW_SECONDS', 300))
    attempts = FAILED_LOGIN_ATTEMPTS.get(key, [])
    if not attempts:
        return []
    cutoff = now_ts - window_seconds
    pruned = [ts for ts in attempts if ts >= cutoff]
    FAILED_LOGIN_ATTEMPTS[key] = pruned
    return pruned

def _lockout_remaining_seconds(key, now_ts):
    locked_until = LOGIN_LOCKOUTS.get(key, 0)
    if locked_until > now_ts:
        return int(locked_until - now_ts)
    if key in LOGIN_LOCKOUTS:
        LOGIN_LOCKOUTS.pop(key, None)
    return 0

def _record_failed_attempt(key, now_ts):
    max_attempts = int(app.config.get('ADMIN_MAX_LOGIN_ATTEMPTS', 5))
    lockout_seconds = int(app.config.get('ADMIN_LOCKOUT_SECONDS', 900))
    attempts = _prune_failed_attempts(key, now_ts)
    attempts.append(now_ts)
    FAILED_LOGIN_ATTEMPTS[key] = attempts

    if len(attempts) >= max_attempts:
        LOGIN_LOCKOUTS[key] = now_ts + lockout_seconds
        FAILED_LOGIN_ATTEMPTS.pop(key, None)
        return lockout_seconds
    return 0

def _clear_failed_attempts(key):
    FAILED_LOGIN_ATTEMPTS.pop(key, None)
    LOGIN_LOCKOUTS.pop(key, None)

def _sanitize_next_url(next_url):
    if not next_url:
        return url_for('admin')
    if isinstance(next_url, str) and next_url.startswith('/'):
        return next_url
    return url_for('admin')

@app.before_request
def _protect_admin_routes():
    path = request.path or ''
    protected = path == '/admin' or path.startswith('/api/admin/')
    if not protected:
        return None

    if _is_admin_authenticated():
        return None

    if path.startswith('/api/admin/'):
        return jsonify({'error': 'Unauthorized'}), 401

    next_url = request.full_path if request.query_string else request.path
    return redirect(url_for('admin_login', next=next_url))

def _increment_airport(airport):
    active_airport_counts[airport] = active_airport_counts.get(airport, 0) + 1

def _decrement_airport(airport):
    count = active_airport_counts.get(airport, 0)
    if count <= 1:
        active_airport_counts.pop(airport, None)
    else:
        active_airport_counts[airport] = count - 1

def update_flights():
    """Fetch all configured airports and broadcast to their respective rooms"""
    global current_data
    print("Fetching flight data...")
    new_data = flight_fetcher.fetch_flights()

    # Refresh any active dynamic airports (not in configured list)
    dynamic_airports = [
        code for code in active_airport_counts.keys()
        if code not in flight_fetcher.configured_airports
    ]
    for code in dynamic_airports:
        airport_data = flight_fetcher.fetch_single_airport(code)
        if airport_data:
            new_data.update(airport_data)

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
    return render_template('index.html', asset_version=int(time.time()))

@app.route('/admin')
def admin():
    return render_template('admin.html')

@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    client_key = _get_client_ip()
    now_ts = time.time()
    remaining_lockout = _lockout_remaining_seconds(client_key, now_ts)

    if request.method == 'GET':
        if _is_admin_authenticated():
            return redirect(url_for('admin'))
        if remaining_lockout > 0:
            return render_template(
                'admin_login.html',
                error=f'Too many failed attempts. Try again in {remaining_lockout} seconds.'
            ), 429
        return render_template('admin_login.html', error=None)

    if remaining_lockout > 0:
        response = render_template(
            'admin_login.html',
            error=f'Too many failed attempts. Try again in {remaining_lockout} seconds.'
        )
        return response, 429, {'Retry-After': str(remaining_lockout)}

    username = str(request.form.get('username', '')).strip()
    password = str(request.form.get('password', ''))
    expected_username = app.config.get('ADMIN_USERNAME', 'admin')
    expected_password = app.config.get('ADMIN_PASSWORD', '')

    if not expected_password:
        return render_template('admin_login.html', error='Admin password is not configured.'), 500

    if username == expected_username and password == expected_password:
        _clear_failed_attempts(client_key)
        session[ADMIN_SESSION_KEY] = True
        session['admin_username'] = expected_username
        next_url = _sanitize_next_url(request.form.get('next') or request.args.get('next'))
        return redirect(next_url)

    locked_for = _record_failed_attempt(client_key, now_ts)
    if locked_for > 0:
        return (
            render_template(
                'admin_login.html',
                error=f'Too many failed attempts. Try again in {locked_for} seconds.'
            ),
            429,
            {'Retry-After': str(locked_for)}
        )

    return render_template('admin_login.html', error='Invalid credentials.'), 401

@app.route('/admin/logout', methods=['POST'])
def admin_logout():
    session.pop(ADMIN_SESSION_KEY, None)
    session.pop('admin_username', None)
    return redirect(url_for('admin_login'))

@app.route('/api/translations')
def get_translations():
    """Serve all language translations to the frontend"""
    return jsonify(AirportLanguages.get_all_translations())

@app.route('/api/theme_map')
def get_theme_map():
    return jsonify(_load_theme_map())

@app.route('/api/admin/theme_options')
def get_theme_options():
    return jsonify(_theme_options())

@app.route('/api/admin/theme_map', methods=['GET', 'POST'])
def admin_theme_map():
    if request.method == 'GET':
        return jsonify(_load_theme_map())

    payload = request.json or {}
    incoming = payload.get('theme_map')
    if incoming is None:
        return jsonify({'error': 'Missing theme_map payload'}), 400

    try:
        validated = _validate_theme_map(incoming)
        _write_json(THEME_MAP_PATH, validated)
        return jsonify({'success': True, 'theme_map': validated})
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

@app.route('/api/admin/stands/<icao>', methods=['GET', 'POST'])
def admin_stands(icao):
    normalized_icao = _normalize_icao(icao)
    if not normalized_icao:
        return jsonify({'error': 'Invalid ICAO code'}), 400

    all_stands = _read_json(STANDS_PATH, {})
    if not isinstance(all_stands, dict):
        all_stands = {}

    if request.method == 'GET':
        return jsonify({
            'icao': normalized_icao,
            'stands': all_stands.get(normalized_icao, [])
        })

    payload = request.json or {}
    incoming = payload.get('stands')
    if incoming is None:
        return jsonify({'error': 'Missing stands payload'}), 400

    try:
        validated = _validate_stands(incoming)
        all_stands[normalized_icao] = validated
        _write_json(STANDS_PATH, all_stands)
        flight_fetcher.stands = flight_fetcher.load_stands()
        return jsonify({
            'success': True,
            'icao': normalized_icao,
            'stands_count': len(validated)
        })
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

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
    previous = client_airports.get(request.sid)
    if previous and previous != airport:
        leave_room(previous)
        _decrement_airport(previous)

    join_room(airport)
    client_airports[request.sid] = airport
    _increment_airport(airport)
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
        airport = airport.upper()
        leave_room(airport)
        if client_airports.get(request.sid) == airport:
            client_airports.pop(request.sid, None)
        _decrement_airport(airport)

@socketio.on('disconnect')
def handle_disconnect():
    airport = client_airports.pop(request.sid, None)
    if airport:
        _decrement_airport(airport)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
