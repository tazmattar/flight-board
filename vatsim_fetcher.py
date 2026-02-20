import requests
import math
import traceback
import json
import os
from datetime import datetime, timedelta
from checkin_assignments import CheckinAssignments

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
            'EGLC': { 'name': 'London City', 'ceiling': 5000, 'has_stands': True },
            'EGLL': { 'name': 'London Heathrow', 'ceiling': 7000, 'has_stands': True },
            'EGKK': { 'name': 'London Gatwick', 'ceiling': 7000, 'has_stands': True },
            'EGSS': { 'name': 'London Stansted', 'ceiling': 7000, 'has_stands': True },
            'KJFK': { 'name': 'New York JFK', 'ceiling': 5000, 'has_stands': True },
            'RJTT': { 'name': 'Tokyo Haneda', 'ceiling': 6000, 'has_stands': True  },
            'EHAM': { 'name': 'Amsterdam Schiphol', 'ceiling': 6000, 'has_stands': True },
        }
        
        # Load Geofencing Stands (Coordinate based)
        self.stands = self.load_stands()
        
        # Load UKCP ID Mapping (ID -> Name based)
        self.ukcp_mapping = self.load_ukcp_map()
        
        # Initialize Check-in Assignment System
        self.checkin_system = CheckinAssignments()

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
        if groundspeed > 15 or altitude > 10000: return None
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
    
    def _get_sortable_time(self, time_str):
        """
        Converts a time string (HH:MM) into a sortable datetime object,
        accounting for day wrapping (e.g. 00:05 is 'tomorrow' relative to 23:50).
        """
        if not time_str or len(time_str) != 5: # Expecting "HH:MM"
            return datetime.max # Push undefined times to the end
        
        try:
            now = datetime.utcnow()
            h, m = map(int, time_str.split(':'))
            # Create a datetime for "today" at this time
            dt = now.replace(hour=h, minute=m, second=0, microsecond=0)
            
            # Calculate difference from now
            diff = (dt - now).total_seconds()
            
            # Logic: If the time is more than 12 hours away, assume it belongs to the adjacent day.
            # Example 1: Now=23:00, Flight=00:30. Diff = -22.5h. -> Shift to Tomorrow (Diff +1.5h)
            # Example 2: Now=01:00, Flight=23:30. Diff = +22.5h. -> Shift to Yesterday (Diff -1.5h)
            
            if diff < -12 * 3600:
                dt += timedelta(days=1)
            elif diff > 12 * 3600:
                dt -= timedelta(days=1)
                
            return dt
        except:
            return datetime.max

    def _arrival_status_priority(self, status_raw):
        """
        Lower number means higher display priority in arrivals.
        """
        priority = {
            'Landed': 0,
            'Landing': 1,
            'Approaching': 2,
            'En Route': 3,
        }
        return priority.get(status_raw, 99)

    def _arrival_sort_key(self, flight):
        return (
            self._arrival_status_priority(flight.get('status_raw', '')),
            self._get_sortable_time(flight.get('time_display', ''))
        )

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
                # Use smart sorting for both lists
                results[code]['departures'].sort(key=lambda x: self._get_sortable_time(x.get('time_display', '')))
                results[code]['arrivals'].sort(key=self._arrival_sort_key)
                
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

            # Use smart sorting for both lists
            result['departures'].sort(key=lambda x: self._get_sortable_time(x.get('time_display', '')))
            result['arrivals'].sort(key=self._arrival_sort_key)
            
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
            if status in ['Landed', 'Landing', 'Approaching', 'En Route']:
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

    def check_late_arrival(self, deptime, enroute_time, dist_km, groundspeed):
        """
        Check if an arrival is running late based on planned arrival time vs ETA.
        """
        try:
            if not deptime or not enroute_time or groundspeed < 50: 
                return None
            
            now = datetime.utcnow()
            
            # 1. Parse Departure Time
            if len(deptime) != 4 or not deptime.isdigit(): return None
            dep_h = int(deptime[:2])
            dep_m = int(deptime[2:4])
            
            # Use logic similar to calculate_delay to determine the correct date for departure
            # Assuming flight departed within the last 24 hours
            dep_dt = now.replace(hour=dep_h, minute=dep_m, second=0, microsecond=0)
            
            diff = (now - dep_dt).total_seconds()
            
            # If dep_dt is >12h ahead of now (e.g. now=01:00, dep=23:00), it implies departure was yesterday
            if diff < -12 * 3600: 
                dep_dt -= timedelta(days=1)
            # If dep_dt is >12h behind now (e.g. now=23:00, dep=01:00), it implies departure was today (but just long ago) 
            # OR if it's erroneously tomorrow (unlikely)
            # The standard window +/- 12h handles the day wrapping nicely for short-haul/medium-haul
            elif diff > 12 * 3600:
                # If departure was theoretically 13h ago, it might be valid. 
                # But if we follow the 'closest time' logic:
                dep_dt += timedelta(days=1)
            
            # 2. Add Enroute Time to get Planned Arrival
            if len(enroute_time) != 4 or not enroute_time.isdigit(): return None
            enr_h = int(enroute_time[:2])
            enr_m = int(enroute_time[2:4])
            
            planned_arrival_dt = dep_dt + timedelta(hours=enr_h, minutes=enr_m)
            
            # 3. Calculate ETA based on current distance and groundspeed
            # speed is in knots, dist is in km
            # 1 knot = 1.852 km/h
            speed_kmh = groundspeed * 1.852
            if speed_kmh <= 0: return None
            
            hours_remaining = dist_km / speed_kmh
            eta_dt = now + timedelta(hours=hours_remaining)
            
            # 4. Compare ETA vs Planned
            # Threshold: 15 minutes late
            delay_seconds = (eta_dt - planned_arrival_dt).total_seconds()
            
            if delay_seconds > 15 * 60:
                return "LATE ARRIVAL"
            
            return None
        except Exception:
            return None

    def get_checkin_area(self, callsign, airport_code):
        """
        Get check-in desk assignment for a flight.
        Delegates to the CheckinAssignments module for cleaner code organisation.
        """
        return self.checkin_system.get_checkin_desk(callsign, airport_code)

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
        
        # --- NEW: Arrival Delay Logic ---
        if direction == 'ARR' and raw_status == 'Approaching':
            late_status = self.check_late_arrival(
                fp.get('deptime'), 
                fp.get('enroute_time'), 
                dist_km, 
                pilot.get('groundspeed', 0)
            )
            if late_status:
                delay_text = late_status

        gate_display = gate or 'TBA'
        if direction == 'DEP':
            if raw_status == 'Check-in': gate_display = 'TBA'
            elif raw_status == 'Pushback': gate_display = gate or 'TBA'  # show stand the aircraft just left
            elif raw_status in ['Taxiing', 'Departing', 'En Route']: gate_display = 'CLOSED'
        
        # STATUS OVERRIDE ("At Gate") & REALITY CHECK
        display_status = raw_status
        
        if direction == 'ARR' and gate:
            if pilot['groundspeed'] < 5:
                display_status = 'At Gate'
                
                # --- NEW: CHECK REALITY ---
                # The pilot has parked. Let's see where they REALLY are.
                # We call find_stand() with callsign=None to FORCE a coordinate check (bypassing UKCP API)
                real_location = self.find_stand(
                    pilot['latitude'], 
                    pilot['longitude'], 
                    airport_code, 
                    pilot['groundspeed'], 
                    pilot['altitude'], 
                    callsign=None  # <--- This is the secret key! Forces geofencing.
                )
                
                # If they are at a valid stand in our database, override the API assignment
                if real_location:
                    gate_display = real_location

        return {
            'callsign': callsign, 'aircraft': fp.get('aircraft_short', 'N/A'),
            'origin': fp.get('departure', 'N/A'), 'destination': fp.get('arrival', 'N/A'),
            'altitude': pilot.get('altitude', 0), 'groundspeed': pilot.get('groundspeed', 0),
            'status': display_status, 'status_raw': raw_status, 'delay_text': delay_text,
            'gate': gate_display, 'checkin': checkin_area, 'time_display': time_display,
            'direction': direction, 'distance': dist_km,
            'route': fp.get('route', 'No route available')
        }

    def determine_status(self, pilot, direction, ceiling, dist_km, gate_found, airport_code):
        alt, gs = pilot['altitude'], pilot['groundspeed']
        if direction == 'DEP':
            if alt < ceiling: 
                minutes_online = 0
                if pilot.get('logon_time'):
                    try: minutes_online = (datetime.utcnow() - datetime.fromisoformat(pilot['logon_time'][:19])).total_seconds() / 60
                    except: pass
                
                neutral_squawks = {'2000', '2200', '1200', '7000', '0000'}
                is_non_neutral_squawk = pilot.get('transponder') not in neutral_squawks

                # Stationary aircraft should never be shown as Taxiing.
                if gs < 1:
                    if minutes_online < 5: return 'Check-in'
                    return 'Boarding'

                # Low-speed ground movement: pushback if near a stand or squawking.
                if gs < 5:
                    if gate_found or is_non_neutral_squawk: return 'Pushback'
                    return 'Taxiing'
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
