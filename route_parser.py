"""
Route parser for flight plan route strings.

Navdata sources (all in data/navdata/, gitignored):
  VATSpy.dat       — airport lat/lon (VATSpy Data Project)
  earth_fix.dat    — waypoint fixes (X-Plane 12 format)
  earth_nav.dat    — VORs and NDBs (X-Plane 12 format)

If any navdata file is missing, resolve_route() returns [] gracefully.
"""

import math
import os
import logging
import re

log = logging.getLogger(__name__)

_NAVDATA_DIR = os.path.join(os.path.dirname(__file__), 'data', 'navdata')

# Loaded once at import time
airports: dict = {}   # ICAO → (lat, lon)
fixes: dict = {}      # ident → [(lat, lon), ...]
navaids: dict = {}    # ident → [(lat, lon), ...]

_loaded = False


def _parse_vatspy(path: str) -> dict:
    result = {}
    in_airports = False
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                line = line.strip()
                if line == '[Airports]':
                    in_airports = True
                    continue
                if line.startswith('[') and line.endswith(']'):
                    in_airports = False
                    continue
                if not in_airports or not line or line.startswith(';'):
                    continue
                parts = line.split('|')
                if len(parts) < 4:
                    continue
                icao = parts[0].strip().upper()
                try:
                    lat = float(parts[2])
                    lon = float(parts[3])
                except ValueError:
                    continue
                result[icao] = (lat, lon)
    except FileNotFoundError:
        log.warning('VATSpy.dat not found at %s', path)
    except Exception as e:
        log.warning('Error parsing VATSpy.dat: %s', e)
    return result


def _parse_fixes(path: str) -> dict:
    result: dict = {}
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('I') or line.startswith('A') or line.startswith('99'):
                    continue
                parts = line.split()
                if len(parts) < 3:
                    continue
                try:
                    lat = float(parts[0])
                    lon = float(parts[1])
                except ValueError:
                    continue
                ident = parts[2].upper()
                result.setdefault(ident, []).append((lat, lon))
    except FileNotFoundError:
        log.warning('earth_fix.dat not found at %s', path)
    except Exception as e:
        log.warning('Error parsing earth_fix.dat: %s', e)
    return result


def _parse_navaids(path: str) -> dict:
    """Parse earth_nav.dat. Only keep types 2 (NDB) and 3 (VOR)."""
    result: dict = {}
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('I') or line.startswith('A') or line.startswith('99'):
                    continue
                parts = line.split()
                if len(parts) < 9:
                    continue
                try:
                    nav_type = int(parts[0])
                except ValueError:
                    continue
                if nav_type not in (2, 3):
                    continue
                try:
                    lat = float(parts[1])
                    lon = float(parts[2])
                except ValueError:
                    continue
                ident = parts[7].upper()
                result.setdefault(ident, []).append((lat, lon))
    except FileNotFoundError:
        log.warning('earth_nav.dat not found at %s', path)
    except Exception as e:
        log.warning('Error parsing earth_nav.dat: %s', e)
    return result


def _load_navdata():
    global airports, fixes, navaids, _loaded
    if _loaded:
        return
    airports = _parse_vatspy(os.path.join(_NAVDATA_DIR, 'VATSpy.dat'))
    fixes = _parse_fixes(os.path.join(_NAVDATA_DIR, 'earth_fix.dat'))
    navaids = _parse_navaids(os.path.join(_NAVDATA_DIR, 'earth_nav.dat'))
    log.info('Navdata loaded: %d airports, %d fix idents, %d navaid idents',
             len(airports), len(fixes), len(navaids))
    _loaded = True


# ── Great-circle helpers ────────────────────────────────────────────────────

def _haversine(lat1, lon1, lat2, lon2) -> float:
    """Great-circle distance in km."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))



def _pick_closest(candidates, ref):
    """Return the candidate (lat, lon) closest to ref by great-circle distance."""
    if len(candidates) == 1:
        return candidates[0]
    return min(candidates, key=lambda c: _haversine(ref[0], ref[1], c[0], c[1]))


# ── Token classification ────────────────────────────────────────────────────

_SPEED_ALT_RE = re.compile(r'^[NKM]\d{4}[FSAM]\d{3,4}$', re.IGNORECASE)
_SKIP_WORDS = frozenset(['DCT', 'SID', 'STAR', 'TRANS', 'RNAV'])


def _strip_runway_suffix(token: str) -> str:
    """EGLL/27R → EGLL"""
    if '/' in token:
        return token.split('/')[0]
    return token


# ── Public API ──────────────────────────────────────────────────────────────

def resolve_route(route_str: str, origin_icao: str, dest_icao: str) -> list:
    """
    Parse a VATSIM flight plan route string into an ordered list of waypoints.

    Returns a list of dicts: [{name, lat, lon, type}, ...]
    where type is one of: 'airport', 'fix', 'navaid'

    Returns [] if navdata is unavailable or route cannot be resolved.
    """
    _load_navdata()

    if not airports:
        return []  # navdata not loaded

    origin_icao = (origin_icao or '').strip().upper()
    dest_icao = (dest_icao or '').strip().upper()

    origin_coords = airports.get(origin_icao)
    dest_coords = airports.get(dest_icao)

    waypoints = []

    if origin_coords:
        waypoints.append({'name': origin_icao, 'lat': origin_coords[0], 'lon': origin_coords[1], 'type': 'airport'})

    # Tracks the last known position for nearest-neighbour disambiguation
    last_coords = origin_coords or dest_coords or (0.0, 0.0)

    for raw_token in (route_str or '').split():
        token = _strip_runway_suffix(raw_token).upper()

        if not token:
            continue
        if token in _SKIP_WORDS:
            continue
        if _SPEED_ALT_RE.match(token):
            continue
        # 4-letter ICAO airport?
        if len(token) == 4 and token.isalpha():
            # Skip if it's the origin or destination (already added as endpoints)
            if token in (origin_icao, dest_icao):
                continue
            coords = airports.get(token)
            if coords:
                waypoints.append({'name': token, 'lat': coords[0], 'lon': coords[1], 'type': 'airport'})
                last_coords = coords
                continue

        # 2-5 char alphanumeric — try fix, then navaid
        if 2 <= len(token) <= 5 and token.isalnum():
            candidates = fixes.get(token) or navaids.get(token)
            nav_type = 'fix' if fixes.get(token) else 'navaid'
            if candidates:
                chosen = _pick_closest(candidates, last_coords)
                waypoints.append({'name': token, 'lat': chosen[0], 'lon': chosen[1], 'type': nav_type})
                last_coords = chosen
                continue

        # Unknown token — skip silently

    if dest_coords:
        waypoints.append({'name': dest_icao, 'lat': dest_coords[0], 'lon': dest_coords[1], 'type': 'airport'})

    return waypoints
