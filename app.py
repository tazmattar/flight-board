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
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import requests
import psycopg2

app = Flask(__name__)
app.config.from_object(Config)
socketio = SocketIO(app, cors_allowed_origins="*")

flight_fetcher = VatsimFetcher()
# Global store: {'LSZH': {...}, 'LSGG': {...}, 'EDDF': {...}, etc}
current_data = {}

# Track active airport rooms so dynamic airports can be refreshed
active_airport_counts = {}
client_airports = {}

# VATSIM events cache (refreshed every 15 minutes)
_events_cache = {'data': [], 'fetched_at': 0}
EVENTS_CACHE_TTL = 15 * 60

def fetch_vatsim_events():
    """Fetch upcoming VATSIM events, cached for 15 minutes."""
    now = time.time()
    if now - _events_cache['fetched_at'] < EVENTS_CACHE_TTL:
        return _events_cache['data']
    try:
        resp = requests.get('https://vatsim.net/api/events', timeout=8)
        resp.raise_for_status()
        _events_cache['data'] = resp.json()
        _events_cache['fetched_at'] = now
    except Exception as e:
        app.logger.warning(f'VATSIM events fetch failed: {e}')
    return _events_cache['data']

THEME_MAP_PATH = os.path.join(app.static_folder, 'data', 'theme_map.json')
STANDS_PATH = os.path.join(app.static_folder, 'stands.json')
CUSTOM_AIRPORTS_PATH = os.path.join(app.root_path, 'data', 'custom_airports.json')
THEME_CSS_PREFIX = '/static/css/themes/'
ICAO_PATTERN = re.compile(r'^[A-Z]{4}$')
ADMIN_SESSION_KEY = 'admin_authenticated'
FAILED_LOGIN_ATTEMPTS = {}
LOGIN_LOCKOUTS = {}

DATABASE_URL = os.environ.get('DATABASE_URL')

MAX_TRACKED_VISITORS = 20000

DEFAULT_THEME_MAP = {
    'LSZH': {'css': '/static/css/themes/lszh.css', 'class': 'theme-lszh'},
    'LSGG': {'css': '/static/css/themes/lsgg.css', 'class': 'theme-lsgg'},
    'LFSB': {'css': '/static/css/themes/lfsb.css', 'class': 'theme-lfsb'},
    'EGLL': {'css': '/static/css/themes/egll.css', 'class': 'theme-egll'},
    'EGLC': {'css': '/static/css/themes/eglc.css', 'class': 'theme-eglc'},
    'EGKK': {'css': '/static/css/themes/egkk.css', 'class': 'theme-egkk'},
    'EGSS': {'css': '/static/css/themes/egss.css', 'class': 'theme-egss'},
    'EGCC': {'css': '/static/css/themes/egcc.css', 'class': 'theme-egcc'},
    'EHAM': {'css': '/static/css/themes/eham.css', 'class': 'theme-eham'},
    'KJFK': {'css': '/static/css/themes/kjfk.css', 'class': 'theme-kjfk'},
    'RJTT': {'css': '/static/css/themes/rjtt.css', 'class': 'theme-rjtt'}
}


def _today_utc():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


@contextmanager
def _db():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _init_db():
    """Create tables if they don't exist. Called once at startup."""
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS traffic_totals (
                    id              INTEGER PRIMARY KEY DEFAULT 1,
                    page_views      BIGINT  NOT NULL DEFAULT 0,
                    unique_visitors BIGINT  NOT NULL DEFAULT 0,
                    airport_joins   BIGINT  NOT NULL DEFAULT 0,
                    updated_at      BIGINT  NOT NULL DEFAULT 0,
                    CONSTRAINT single_row CHECK (id = 1)
                );
                INSERT INTO traffic_totals VALUES (1,0,0,0,0) ON CONFLICT DO NOTHING;

                CREATE TABLE IF NOT EXISTS traffic_daily (
                    date             DATE    PRIMARY KEY,
                    page_views       INTEGER NOT NULL DEFAULT 0,
                    unique_visitors  INTEGER NOT NULL DEFAULT 0,
                    airport_joins    INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS traffic_path_views (
                    date   DATE    NOT NULL,
                    path   TEXT    NOT NULL,
                    views  INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (date, path)
                );

                CREATE TABLE IF NOT EXISTS traffic_airport_joins (
                    date   DATE        NOT NULL,
                    icao   VARCHAR(4)  NOT NULL,
                    joins  INTEGER     NOT NULL DEFAULT 0,
                    PRIMARY KEY (date, icao)
                );

                CREATE TABLE IF NOT EXISTS traffic_visitors (
                    visitor_id  CHAR(32) PRIMARY KEY,
                    first_seen  DATE     NOT NULL,
                    last_seen   DATE     NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON traffic_visitors (last_seen);
            """)


def _record_page_view(path, visitor_id):
    if not DATABASE_URL:
        return
    try:
        _record_page_view_db(path, visitor_id)
    except Exception as e:
        app.logger.warning(f'_record_page_view failed: {e}')


def _record_page_view_db(path, visitor_id):
    today = _today_utc()
    with _db() as conn:
        with conn.cursor() as cur:
            # Upsert daily page views
            cur.execute("""
                INSERT INTO traffic_daily (date, page_views, unique_visitors, airport_joins)
                VALUES (%s, 1, 0, 0)
                ON CONFLICT (date) DO UPDATE SET page_views = traffic_daily.page_views + 1
            """, (today,))

            # Upsert path views for today
            cur.execute("""
                INSERT INTO traffic_path_views (date, path, views)
                VALUES (%s, %s, 1)
                ON CONFLICT (date, path) DO UPDATE SET views = traffic_path_views.views + 1
            """, (today, path))

            # Increment totals page_views
            cur.execute("""
                UPDATE traffic_totals SET page_views = page_views + 1, updated_at = %s WHERE id = 1
            """, (int(time.time()),))

            # Handle visitor tracking
            cur.execute("""
                SELECT first_seen, last_seen FROM traffic_visitors WHERE visitor_id = %s
            """, (visitor_id,))
            row = cur.fetchone()

            if row is None:
                # New visitor — insert and increment both totals and today's unique count
                cur.execute("""
                    INSERT INTO traffic_visitors (visitor_id, first_seen, last_seen)
                    VALUES (%s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (visitor_id, today, today))
                cur.execute("""
                    UPDATE traffic_totals SET unique_visitors = unique_visitors + 1 WHERE id = 1
                """)
                cur.execute("""
                    UPDATE traffic_daily SET unique_visitors = unique_visitors + 1 WHERE date = %s
                """, (today,))
            else:
                _first_seen, last_seen_date = row
                last_seen_str = last_seen_date.strftime('%Y-%m-%d') if hasattr(last_seen_date, 'strftime') else str(last_seen_date)
                if last_seen_str != today:
                    # Returning visitor, first visit today
                    cur.execute("""
                        UPDATE traffic_daily SET unique_visitors = unique_visitors + 1 WHERE date = %s
                    """, (today,))
                cur.execute("""
                    UPDATE traffic_visitors SET last_seen = %s WHERE visitor_id = %s
                """, (today, visitor_id))

            # Prune excess visitors
            cur.execute("SELECT COUNT(*) FROM traffic_visitors")
            count = cur.fetchone()[0]
            if count > MAX_TRACKED_VISITORS:
                excess = count - MAX_TRACKED_VISITORS
                cur.execute("""
                    DELETE FROM traffic_visitors
                    WHERE visitor_id IN (
                        SELECT visitor_id FROM traffic_visitors
                        ORDER BY last_seen ASC
                        LIMIT %s
                    )
                """, (excess,))


def _record_airport_join(airport):
    if not DATABASE_URL:
        return
    normalized = _normalize_icao(airport)
    if not normalized:
        return
    try:
        _record_airport_join_db(normalized)
    except Exception as e:
        app.logger.warning(f'_record_airport_join failed: {e}')


def _record_airport_join_db(normalized):
    today = _today_utc()
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO traffic_daily (date, page_views, unique_visitors, airport_joins)
                VALUES (%s, 0, 0, 1)
                ON CONFLICT (date) DO UPDATE SET airport_joins = traffic_daily.airport_joins + 1
            """, (today,))
            cur.execute("""
                INSERT INTO traffic_airport_joins (date, icao, joins)
                VALUES (%s, %s, 1)
                ON CONFLICT (date, icao) DO UPDATE SET joins = traffic_airport_joins.joins + 1
            """, (today, normalized))
            cur.execute("""
                UPDATE traffic_totals
                SET airport_joins = airport_joins + 1, updated_at = %s
                WHERE id = 1
            """, (int(time.time()),))


def _get_traffic_summary():
    if not DATABASE_URL:
        return {'error': 'DATABASE_URL not configured'}
    today = _today_utc()
    with _db() as conn:
        with conn.cursor() as cur:
            # Totals row
            cur.execute("SELECT page_views, unique_visitors, airport_joins, updated_at FROM traffic_totals WHERE id = 1")
            totals_row = cur.fetchone() or (0, 0, 0, 0)
            totals = {
                'page_views': totals_row[0],
                'unique_visitors': totals_row[1],
                'airport_joins': totals_row[2],
            }
            updated_at = int(totals_row[3])

            # Today's daily row
            cur.execute("""
                SELECT page_views, unique_visitors, airport_joins
                FROM traffic_daily WHERE date = %s
            """, (today,))
            today_row = cur.fetchone() or (0, 0, 0)

            # Top 10 paths today
            cur.execute("""
                SELECT path, views FROM traffic_path_views
                WHERE date = %s ORDER BY views DESC LIMIT 10
            """, (today,))
            top_paths = cur.fetchall()

            # Last 7 daily rows
            cur.execute("""
                SELECT date, page_views, unique_visitors, airport_joins
                FROM traffic_daily ORDER BY date DESC LIMIT 7
            """)
            last_7_rows = cur.fetchall()

            # Top 10 airports last 7 days
            cur.execute("""
                SELECT icao, SUM(joins) AS total FROM traffic_airport_joins
                WHERE date >= CURRENT_DATE - INTERVAL '6 days'
                GROUP BY icao ORDER BY total DESC LIMIT 10
            """)
            top_airports = [(r[0], int(r[1])) for r in cur.fetchall()]

    last_7_days = [
        {
            'date': str(r[0]),
            'page_views': int(r[1]),
            'unique_visitors': int(r[2]),
            'airport_joins': int(r[3]),
        }
        for r in sorted(last_7_rows, key=lambda x: x[0])
    ]

    return {
        'totals': totals,
        'today': {
            'date': today,
            'page_views': int(today_row[0]),
            'unique_visitors': int(today_row[1]),
            'airport_joins': int(today_row[2]),
            'top_paths': [(p, int(v)) for p, v in top_paths],
        },
        'last_7_days': last_7_days,
        'top_airports_7d': top_airports,
        'updated_at': updated_at,
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

def _write_stands_json(path, data):
    """Write stands.json with one stand object per line for easy manual review."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = ["{"]
    airports = list(data.keys())
    for i, icao in enumerate(airports):
        stands = data[icao]
        comma = "," if i < len(airports) - 1 else ""
        lines.append(f'  "{icao}": [')
        for j, stand in enumerate(stands):
            sc = "," if j < len(stands) - 1 else ""
            lines.append(f'    {json.dumps(stand, ensure_ascii=True)}{sc}')
        lines.append(f'  ]{comma}')
    lines.append("}")
    with open(path, 'w', encoding='utf-8') as f:
        f.write("\n".join(lines) + "\n")


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

if DATABASE_URL:
    try:
        _init_db()
        app.logger.info('PostgreSQL traffic DB initialised.')
    except Exception as _db_init_err:
        app.logger.error(f'_init_db() failed: {_db_init_err}. Traffic stats will be unavailable until DB is reachable.')

# Fetch immediately on start
update_flights()

@app.route('/')
def index():
    return render_template('index.html', asset_version=int(time.time()), bmc_url=app.config.get('BUY_ME_A_COFFEE_URL', ''))

@app.route('/admin')
def admin():
    return render_template('admin.html', asset_version=int(time.time()))

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
        _write_stands_json(STANDS_PATH, all_stands)
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


def _validate_custom_airports(payload):
    if not isinstance(payload, dict):
        raise ValueError('Custom airports must be an object keyed by ICAO code.')

    cleaned = {}
    for icao, entry in payload.items():
        normalized = _normalize_icao(icao)
        if not normalized:
            raise ValueError(f'Invalid ICAO code: {icao}')
        if not isinstance(entry, dict):
            raise ValueError(f'Entry for {normalized} must be an object.')

        name = str(entry.get('name', '') or '').strip()
        country = str(entry.get('country', '') or '').strip()

        try:
            lat = float(entry['lat'])
            lon = float(entry['lon'])
        except (KeyError, TypeError, ValueError):
            raise ValueError(f'Entry for {normalized} must have numeric lat and lon.')

        ceiling = int(entry.get('ceiling', 6000) or 6000)
        has_stands = bool(entry.get('has_stands', False))

        cleaned[normalized] = {
            'name': name or normalized,
            'country': country,
            'lat': lat,
            'lon': lon,
            'ceiling': ceiling,
            'has_stands': has_stands
        }

    return dict(sorted(cleaned.items()))


@app.route('/api/admin/custom_airports', methods=['GET', 'POST'])
def admin_custom_airports():
    if request.method == 'GET':
        data = _read_json(CUSTOM_AIRPORTS_PATH, {})
        return jsonify(data if isinstance(data, dict) else {})

    payload = request.json or {}
    incoming = payload.get('custom_airports')
    if incoming is None:
        return jsonify({'error': 'Missing custom_airports payload'}), 400

    try:
        validated = _validate_custom_airports(incoming)
        _write_json(CUSTOM_AIRPORTS_PATH, validated)
        flight_fetcher.reload_custom_airports()
        return jsonify({'success': True, 'count': len(validated)})
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

@app.route('/api/events')
def get_events():
    """Return active/upcoming VATSIM events for the given airport ICAO."""
    icao = request.args.get('icao', '').upper().strip()
    all_events = fetch_vatsim_events()

    now = datetime.utcnow()
    cutoff = now + timedelta(hours=24)

    relevant = []
    for ev in all_events:
        try:
            # Strip Z or offset so fromisoformat works across Python 3.7-3.10
            raw_start = ev.get('startTime', '').rstrip('Z').split('+')[0]
            raw_end   = ev.get('endTime',   '').rstrip('Z').split('+')[0]
            start = datetime.fromisoformat(raw_start)
            end   = datetime.fromisoformat(raw_end)
        except (KeyError, ValueError):
            continue
        # Skip events that have ended or start more than 24 h from now
        if end < now or start > cutoff:
            continue
        # Airport filter
        if icao:
            icao_list = [a.get('icao', '').upper() for a in ev.get('airports', [])]
            if icao not in icao_list:
                continue
        relevant.append({
            'name':  ev.get('name', ''),
            'start': ev.get('startTime', ''),
            'end':   ev.get('endTime', ''),
        })

    return jsonify({'events': relevant})

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
    if not _is_tracking_excluded_ip() and data.get('explicit', True):
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
