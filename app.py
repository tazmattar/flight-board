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
import uuid
from threading import Lock
from datetime import datetime, timezone

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
TRAFFIC_STATS_PATH = os.path.join(app.root_path, 'data', 'traffic_stats.json')
THEME_CSS_PREFIX = '/static/css/themes/'
ICAO_PATTERN = re.compile(r'^[A-Z]{4}$')
ADMIN_SESSION_KEY = 'admin_authenticated'
FAILED_LOGIN_ATTEMPTS = {}
LOGIN_LOCKOUTS = {}
TRAFFIC_STATS_LOCK = Lock()

MAX_DAILY_STATS_DAYS = 60
MAX_TRACKED_VISITORS = 20000

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


def _today_utc():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def _new_daily_stats(date_str):
    return {
        'date': date_str,
        'page_views': 0,
        'unique_visitors': 0,
        'airport_joins': 0,
        'path_views': {},
        'airport_joins_by_icao': {}
    }


def _traffic_default():
    today = _today_utc()
    return {
        'totals': {
            'page_views': 0,
            'unique_visitors': 0,
            'airport_joins': 0
        },
        'daily': [_new_daily_stats(today)],
        'visitor_first_seen': {},
        'visitor_last_seen': {},
        'updated_at': int(time.time())
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


def _normalize_traffic_stats(raw):
    if not isinstance(raw, dict):
        return _traffic_default()

    stats = _traffic_default()

    incoming_totals = raw.get('totals', {})
    if isinstance(incoming_totals, dict):
        stats['totals']['page_views'] = int(incoming_totals.get('page_views', 0) or 0)
        stats['totals']['unique_visitors'] = int(incoming_totals.get('unique_visitors', 0) or 0)
        stats['totals']['airport_joins'] = int(incoming_totals.get('airport_joins', 0) or 0)

    daily = raw.get('daily', [])
    cleaned_daily = []
    if isinstance(daily, list):
        for item in daily:
            if not isinstance(item, dict):
                continue
            date_str = str(item.get('date', '')).strip()
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date_str):
                continue
            cleaned_daily.append({
                'date': date_str,
                'page_views': int(item.get('page_views', 0) or 0),
                'unique_visitors': int(item.get('unique_visitors', 0) or 0),
                'airport_joins': int(item.get('airport_joins', 0) or 0),
                'path_views': item.get('path_views', {}) if isinstance(item.get('path_views'), dict) else {},
                'airport_joins_by_icao': item.get('airport_joins_by_icao', {}) if isinstance(item.get('airport_joins_by_icao'), dict) else {}
            })

    if cleaned_daily:
        cleaned_daily.sort(key=lambda x: x['date'])
        stats['daily'] = cleaned_daily[-MAX_DAILY_STATS_DAYS:]

    first_seen = raw.get('visitor_first_seen', {})
    last_seen = raw.get('visitor_last_seen', {})
    if isinstance(first_seen, dict):
        stats['visitor_first_seen'] = {
            str(k): str(v)
            for k, v in first_seen.items()
            if isinstance(k, str) and isinstance(v, str)
        }
    if isinstance(last_seen, dict):
        stats['visitor_last_seen'] = {
            str(k): str(v)
            for k, v in last_seen.items()
            if isinstance(k, str) and isinstance(v, str)
        }

    stats['updated_at'] = int(raw.get('updated_at', int(time.time())) or int(time.time()))
    return stats


def _load_traffic_stats():
    raw = _read_json(TRAFFIC_STATS_PATH, _traffic_default())
    return _normalize_traffic_stats(raw)


def _save_traffic_stats(stats):
    stats['updated_at'] = int(time.time())
    _write_json(TRAFFIC_STATS_PATH, stats)


def _ensure_today_bucket(stats, today):
    daily = stats.get('daily', [])
    if not daily:
        daily = [_new_daily_stats(today)]
        stats['daily'] = daily
        return daily[0]

    last = daily[-1]
    if last.get('date') == today:
        return last

    for item in daily:
        if item.get('date') == today:
            return item

    daily.append(_new_daily_stats(today))
    stats['daily'] = daily[-MAX_DAILY_STATS_DAYS:]
    return stats['daily'][-1]


def _prune_visitors(stats, today):
    last_seen = stats.get('visitor_last_seen', {})
    first_seen = stats.get('visitor_first_seen', {})
    if len(last_seen) <= MAX_TRACKED_VISITORS:
        return

    ordered = sorted(last_seen.items(), key=lambda kv: kv[1], reverse=True)
    keep = {k for k, _ in ordered[:MAX_TRACKED_VISITORS]}
    stats['visitor_last_seen'] = {k: v for k, v in last_seen.items() if k in keep}
    stats['visitor_first_seen'] = {k: v for k, v in first_seen.items() if k in keep}


def _record_page_view(path, visitor_id):
    today = _today_utc()
    with TRAFFIC_STATS_LOCK:
        stats = _load_traffic_stats()
        day = _ensure_today_bucket(stats, today)

        stats['totals']['page_views'] += 1
        day['page_views'] += 1
        day['path_views'][path] = int(day['path_views'].get(path, 0)) + 1

        first_seen = stats.get('visitor_first_seen', {})
        last_seen = stats.get('visitor_last_seen', {})
        is_new_visitor = visitor_id not in first_seen
        if is_new_visitor:
            first_seen[visitor_id] = today
            stats['totals']['unique_visitors'] += 1

        if last_seen.get(visitor_id) != today:
            day['unique_visitors'] += 1
        last_seen[visitor_id] = today

        _prune_visitors(stats, today)
        _save_traffic_stats(stats)


def _record_airport_join(airport):
    normalized = _normalize_icao(airport)
    if not normalized:
        return
    today = _today_utc()
    with TRAFFIC_STATS_LOCK:
        stats = _load_traffic_stats()
        day = _ensure_today_bucket(stats, today)
        stats['totals']['airport_joins'] += 1
        day['airport_joins'] += 1
        day['airport_joins_by_icao'][normalized] = int(day['airport_joins_by_icao'].get(normalized, 0)) + 1
        _save_traffic_stats(stats)


def _get_traffic_summary():
    with TRAFFIC_STATS_LOCK:
        stats = _load_traffic_stats()

    today = _today_utc()
    day = None
    for item in stats.get('daily', []):
        if item.get('date') == today:
            day = item
            break
    if day is None:
        day = _new_daily_stats(today)

    last_7_days = sorted(stats.get('daily', []), key=lambda x: x.get('date', ''))[-7:]
    recent_airports = {}
    for item in last_7_days:
        for icao, count in item.get('airport_joins_by_icao', {}).items():
            recent_airports[icao] = recent_airports.get(icao, 0) + int(count or 0)
    top_airports = sorted(recent_airports.items(), key=lambda kv: kv[1], reverse=True)[:10]

    return {
        'totals': stats.get('totals', {}),
        'today': {
            'date': today,
            'page_views': int(day.get('page_views', 0) or 0),
            'unique_visitors': int(day.get('unique_visitors', 0) or 0),
            'airport_joins': int(day.get('airport_joins', 0) or 0),
            'top_paths': sorted(day.get('path_views', {}).items(), key=lambda kv: kv[1], reverse=True)[:10]
        },
        'last_7_days': [
            {
                'date': item.get('date'),
                'page_views': int(item.get('page_views', 0) or 0),
                'unique_visitors': int(item.get('unique_visitors', 0) or 0),
                'airport_joins': int(item.get('airport_joins', 0) or 0)
            }
            for item in last_7_days
        ],
        'top_airports_7d': top_airports,
        'updated_at': int(stats.get('updated_at', int(time.time())) or int(time.time()))
    }

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


def _should_track_page_request():
    if request.method != 'GET':
        return False
    path = request.path or ''
    if not path:
        return False
    if path.startswith('/static/'):
        return False
    if path.startswith('/socket.io'):
        return False
    if path.startswith('/api/'):
        return False
    return True


def _get_or_create_visitor_id():
    visitor_id = str(session.get('visitor_id', '')).strip()
    if not visitor_id:
        visitor_id = uuid.uuid4().hex
        session['visitor_id'] = visitor_id
    return visitor_id

def _get_client_ip():
    xff = request.headers.get('X-Forwarded-For', '')
    if xff:
        # First hop is the original client.
        return xff.split(',')[0].strip()
    return request.remote_addr or 'unknown'


def _is_tracking_excluded_ip():
    client_ip = _get_client_ip()
    excluded = app.config.get('TRACKING_EXCLUDE_IPS', set())
    return client_ip in excluded

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


@app.before_request
def _track_page_requests():
    if not _should_track_page_request():
        return None
    if _is_tracking_excluded_ip():
        return None
    visitor_id = _get_or_create_visitor_id()
    _record_page_view(request.path, visitor_id)
    return None

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


@app.route('/api/admin/traffic_stats')
def admin_traffic_stats():
    return jsonify(_get_traffic_summary())

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
    if not _is_tracking_excluded_ip():
        _record_airport_join(airport)
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
