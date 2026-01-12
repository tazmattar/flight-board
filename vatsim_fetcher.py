import requests
import math
import traceback
import json
import os
from datetime import datetime, timedelta

# UKCP Stand API Integration
try:
    from ukcp_stand_fetcher import UKCPStandFetcher
    UKCP_AVAILABLE = True
except ImportError:
    UKCP_AVAILABLE = False
    print("UKCP Stand Fetcher not available")

class VatsimFetcher:
    def __init__(self):
        self.vatsim_url = 'https://data.vatsim.net/v3/vatsim-data.json'
        
        # Load airport database on init
        print("Loading airport database...")
        self.airport_db = self.load_airport_database()
        
        # Pre-configured airports
        self.configured_airports = {
            'LSZH': { 'name': 'Zurich Airport', 'ceiling': 6000, 'has_stands': True },
            'LSGG': { 'name': 'Geneva Airport', 'ceiling': 8000, 'has_stands': True },
            'LFSB': { 'name': 'EuroAirport Basel', 'ceiling': 5000, 'has_stands': True },
            'EGLL': { 'name': 'London Heathrow', 'ceiling': 7000, 'has_stands': True },
            'KJFK': { 'name': 'New York JFK', 'ceiling': 5000, 'has_stands': True }
        }
        
        # Load Geofencing Stands (Coordinate based)
        self.stands = self.load_stands()
        
        # Load UKCP ID Mapping (ID -> Name based)
        self.ukcp_mapping = self.load_ukcp_map()

        self.cleanup_dist_dep = 80
        self.ground_range = 15
        
        if UKCP_AVAILABLE:
            self.ukcp_fetcher = UKCPStandFetcher()
            print(f"UKCP Stand API enabled. Loaded {len(self.ukcp_mapping)} ID mappings.")
        else:
            self.ukcp_fetcher = None
    
    def load_airport_database(self):
        try:
            response = requests.get('https://raw.githubusercontent.com/mwgg/Airports/master/airports.json', timeout=10)
            if response.ok: return response.json()
        except: return {}
        return {}
    
    def get_airport_info(self, icao):
        icao = icao.upper()
        if icao in self.configured_airports:
            config = self.configured_airports[icao]
            db_data = self.airport_db.get(icao, {})
            return {
                'name': config.get('name', icao),
                'lat': db_data.get('lat'),
                'lon': db_data.get('lon'),
                'ceiling': config.get('ceiling', 6000),
                'has_stands': config.get('has_stands', False),
                'country': db_data.get('country', '')
            }
        
        if icao in self.airport_db:
            data = self.airport_db[icao]
            is_ukcp = False
            if self.ukcp_fetcher and self.ukcp_fetcher.is_uk_airport(icao):
                is_ukcp = True
            return {
                'name': data.get('name', icao),
                'lat': data.get('lat'),
                'lon': data.get('lon'),
                'ceiling': 6000,
                'has_stands': is_ukcp,
                'country': data.get('country', '')
            }
        return None
    
    def load_stands(self):
        """Loads the coordinate-based stands for geofencing"""
        try:
            stands_path = os.path.join('static', 'stands.json')
            if not os.path.exists(stands_path): stands_path = 'stands.json'
            with open(stands_path, 'r') as f: return json.load(f)
        except: return {}

    def load_ukcp_map(self):
        """Loads the UKCP ID->Name mapping (e.g. 1231 -> '1B')"""
        try:
            # Look for the NEW file you created: static/ukcp_stands.json
            path = os.path.join('static', 'ukcp_stands.json')
            if not os.path.exists(path): return {}
            
            with open(path, 'r') as f:
                raw_data = json.load(f)
            
            # Flatten the data into a single lookup: {1231: "1B", 461: "1"}
            mapping = {}
            for airport, stands in raw_data.items():
                for stand in stands:
                    # Map both the integer ID and string ID just in case
                    mapping[stand['id']] = stand['identifier']
                    mapping[str(stand['id'])] = stand['identifier']
            return mapping
        except Exception as e:
            print(f"Error loading UKCP mapping: {e}")
            return {}

    def calculate_distance_m(self, lat1, lon1, lat2, lon2):
        if None in [lat1, lon1, lat2, lon2]: return 999999
        R = 6371000
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
        c = 2*math.atan2(math.sqrt(a), math.sqrt(1-a))
        return R*c

    def find_stand(self, pilot_lat, pilot_lon, airport_code, groundspeed, altitude, callsign=None):
        # --- PRIORITY 1: UKCP API ---
        if self.ukcp_fetcher and callsign and self.ukcp_fetcher.is_uk_airport(airport_code):
            
            # Fetch the numeric ID
            ukcp_id = self.ukcp_fetcher.get_stand_for_flight(callsign, airport_code)
            
            if ukcp_id:
                print(f"[DEBUG] UKCP found ID {ukcp_id} for {callsign}") # <--- DEBUG PRINT
                
                # Try to convert to name
                readable_name = self.ukcp_mapping.get(str(ukcp_id)) or self.ukcp_mapping.get(ukcp_id)
                
                if readable_name:
                    print(f"[DEBUG] Mapped ID {ukcp_id} -> {readable_name}") # <--- DEBUG PRINT
                    return readable_name
                else:
                    print(f"[DEBUG] Warning: ID {ukcp_id} not found in ukcp_stands.json") # <--- DEBUG PRINT
                    return str(ukcp_id)
            # else:
            #    print(f"[DEBUG] No UKCP stand for {callsign}") 

        # --- PRIORITY 2: GEOFENCING (Existing logic) ---
        if groundspeed > 5 or altitude > 10000: return None
        if pilot_lat is None or pilot_lon is None: return None
        
        airport_stands = self.stands.get(airport_code, [])
        if not airport_stands: return None
            
        closest_stand = None
        min_distance = float('inf')
        
        for stand in airport_stands:
            dist = self.calculate_distance_m(pilot_lat, pilot_lon, stand['lat'], stand['lon'])
            limit = stand.get('radius', 40)
            if dist <= limit:
                if dist < min_distance:
                    min_distance = dist
                    closest_stand = stand['name']
        return closest_stand

    def fetch_flights(self):
        results = {}
        for code in self.configured_airports:
            info = self.get_airport_info(code)
            if info and info['lat'] is not None:
                results[code] = {
                    'departures': [], 'arrivals': [], 'metar': 'Unavailable', 
                    'controllers': [], 'airport_name': info['name'],
                    'has_stands': info.get('has_stands', False), 'country': info.get('country', '')
                }

        try:
            response = requests.get(self.vatsim_url, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            for pilot in data.get('pilots', []):
                fp = pilot.get('flight_plan')
                if not fp: continue
                dep, arr = fp.get('departure'), fp.get('arrival')
                
                if dep in results:
                    info = self.get_airport_info(dep)
                    self.process_flight(pilot, dep, 'DEP', results[dep], info)
                if arr in results:
                    info = self.get_airport_info(arr)
                    self.process_flight(pilot, arr, 'ARR', results[arr], info)

            for code in results:
                results[code]['departures'].sort(key=lambda x: x.get('time_display', ''))
                results[code]['arrivals'].sort(key=lambda x: x.get('time_display', ''))
                results[code]['metar'] = self.get_metar(code)
                results[code]['controllers'] = self.get_controllers(data.get('controllers', []), code)
            
            return results
        except Exception as e:
            print(f"Error: {e}")
            traceback.print_exc()
            return results

    def fetch_single_airport(self, airport_code):
        airport_code = airport_code.upper()
        info = self.get_airport_info(airport_code)
        if not info or info['lat'] is None: return None
        
        result = {
            'departures': [], 'arrivals': [], 'metar': 'Unavailable', 
            'controllers': [], 'airport_name': info['name'],
            'has_stands': info.get('has_stands', False), 'country': info.get('country', '')
        }

        try:
            response = requests.get(self.vatsim_url, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            for pilot in data.get('pilots', []):
                fp = pilot.get('flight_plan')
                if not fp: continue
                dep, arr = fp.get('departure'), fp.get('arrival')
                
                if dep == airport_code: self.process_flight(pilot, airport_code, 'DEP', result, info)
                if arr == airport_code: self.process_flight(pilot, airport_code, 'ARR', result, info)

            result['departures'].sort(key=lambda x: x.get('time_display', ''))
            result['arrivals'].sort(key=lambda x: x.get('time_display', ''))
            result['metar'] = self.get_metar(airport_code)
            result['controllers'] = self.get_controllers(data.get('controllers', []), airport_code)
            return {airport_code: result}
        except Exception as e:
            print(f"Error fetching {airport_code}: {e}")
            traceback.print_exc()
            return None

    def process_flight(self, pilot, airport_code, direction, airport_data, airport_info):
        dist_km = self.calculate_distance_m(pilot['latitude'], pilot['longitude'], airport_info['lat'], airport_info['lon']) / 1000.0
        flight_info = self.format_flight(pilot, direction, airport_info['ceiling'], airport_code, dist_km, airport_info.get('has_stands', False))
        status = flight_info['status_raw']
        
        if direction == 'DEP':
            if status in ['Check-in', 'Boarding', 'Pushback', 'Taxiing'] and dist_km < self.ground_range:
                airport_data['departures'].append(flight_info)
            elif status == 'Departing' and dist_km < self.cleanup_dist_dep:
                airport_data['departures'].append(flight_info)
        elif direction == 'ARR':
            if status in ['Landed', 'Landing', 'Approaching']:
                airport_data['arrivals'].append(flight_info)

    def calculate_times(self, deptime, enroute_time, direction):
        display_time = "--:--"
        try:
            if not deptime or len(deptime) < 4: return display_time
            dep_h = int(deptime[:2])
            dep_m = int(deptime[2:4])
            if direction == 'DEP': return f"{dep_h:02d}:{dep_m:02d}"
            
            if not enroute_time or len(enroute_time) < 4: return "--:--"
            enr_h, enr_m = int(enroute_time[:2]), int(enroute_time[2:4])
            total_m = dep_m + enr_m
            add_h = total_m // 60
            rem_m = total_m % 60
            final_h = (dep_h + enr_h + add_h) % 24
            return f"{final_h:02d}:{rem_m:02d}"
        except: return display_time

    def calculate_delay(self, scheduled_time, logon_time_str):
        if not scheduled_time or len(scheduled_time) < 4: return 0
        try:
            now = datetime.utcnow()
            sched_hour = int(scheduled_time[:2])
            sched_min = int(scheduled_time[2:4])
            sched_dt = now.replace(hour=sched_hour, minute=sched_min, second=0, microsecond=0)
            diff = now - sched_dt
            if diff.total_seconds() < -12 * 3600: sched_dt -= timedelta(days=1); diff = now - sched_dt
            elif diff.total_seconds() > 12 * 3600: sched_dt += timedelta(days=1); diff = now - sched_dt
            delay_minutes = int(diff.total_seconds() / 60)
            if delay_minutes < 0 or delay_minutes > 720: return 0
            return delay_minutes
        except: return 0

    def get_checkin_area(self, callsign, airport_code):
        if not callsign: return ""
        seed = sum(ord(c) for c in callsign) 
        desk = (seed % 20) + 1
        return f"{desk:02d}"

    def format_flight(self, pilot, direction, ceiling, airport_code, dist_km, has_stands):
        fp = pilot.get('flight_plan', {})
        callsign = pilot.get('callsign', 'N/A')
        
        checkin_area = None
        if direction == 'DEP': checkin_area = self.get_checkin_area(callsign, airport_code)

        gate = None
        if has_stands:
            gate = self.find_stand(pilot['latitude'], pilot['longitude'], airport_code, pilot['groundspeed'], pilot['altitude'], callsign)

        raw_status = self.determine_status(pilot, direction, ceiling, dist_km, gate, airport_code)
        
        if direction == 'DEP' and raw_status != 'Check-in': checkin_area = 'CLOSED'

        time_display = self.calculate_times(fp.get('deptime'), fp.get('enroute_time'), direction)

        delay_text = None
        if direction == 'DEP' and raw_status in ['Boarding', 'Check-in']:
            delay_min = self.calculate_delay(fp.get('deptime', '0000'), pilot.get('logon_time'))
            if 15 < delay_min < 300: 
                h, m = divmod(delay_min, 60)
                delay_text = f"Delayed {h}h {m:02d}m" if h > 0 else f"Delayed {m} min"

        gate_display = gate or 'TBA'
        if direction == 'DEP':
            if raw_status == 'Check-in': gate_display = 'TBA'
            elif raw_status in ['Pushback', 'Taxiing', 'Departing', 'En Route']: gate_display = 'CLOSED'
        
        display_status = raw_status
        if direction == 'ARR' and gate: display_status = 'At Gate'

        return {
            'callsign': callsign, 'aircraft': fp.get('aircraft_short', 'N/A'),
            'origin': fp.get('departure', 'N/A'), 'destination': fp.get('arrival', 'N/A'),
            'altitude': pilot.get('altitude', 0), 'groundspeed': pilot.get('groundspeed', 0),
            'status': display_status, 'status_raw': raw_status, 'delay_text': delay_text,
            'gate': gate_display, 'checkin': checkin_area, 'time_display': time_display,
            'direction': direction, 'distance': dist_km
        }

    def determine_status(self, pilot, direction, ceiling, dist_km, gate_found, airport_code):
        alt, gs = pilot['altitude'], pilot['groundspeed']
        if direction == 'DEP':
            if alt < ceiling: 
                minutes_online = 0
                if pilot.get('logon_time'):
                    try: minutes_online = (datetime.utcnow() - datetime.fromisoformat(pilot['logon_time'][:19])).total_seconds() / 60
                    except: pass
                
                if gs < 1:
                    if gate_found: return 'Check-in' if minutes_online < 5 else 'Boarding'
                    if len(self.stands.get(airport_code, [])) > 0: return 'Taxiing' # Hardcoded
                    # Dynamic airport heuristics
                    if minutes_online < 5: return 'Check-in'
                    if pilot.get('transponder') not in {'2000','2200','1200','7000','0000'}: return 'Taxiing'
                    return 'Taxiing' if minutes_online > 35 else 'Boarding'
                if gs < 5: return 'Pushback' if pilot.get('transponder') not in {'2000','2200','1200','7000','0000'} else ('Boarding' if gate_found else 'Taxiing')
                elif gs < 45: return 'Taxiing'
                else: return 'Departing'
            else: return 'En Route'
        else:
            if alt < 2000 and gs < 40: return 'Landed' if dist_km < 50 else 'Scheduled'
            elif alt < 4000 and dist_km < 25: return 'Landing'
            elif dist_km < 250: return 'Approaching'
            else: return 'En Route'

    def get_metar(self, code):
        try: return requests.get(f'https://metar.vatsim.net/{code}', timeout=2).text.strip()
        except: return 'Unavailable'

    def get_controllers(self, ctrls, code):
        res = []
        for c in ctrls:
            if c['callsign'].startswith(code):
                res.append({'callsign': c['callsign'], 'frequency': c['frequency'], 'position': c['callsign'].split('_')[-1]})
        return res