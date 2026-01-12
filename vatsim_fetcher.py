import requests
import math
import traceback
import json
import os
from datetime import datetime, timedelta

# UKCP Stand API Integration (optional - won't break if not installed)
try:
    from ukcp_stand_fetcher import UKCPStandFetcher
    UKCP_AVAILABLE = True
except ImportError:
    UKCP_AVAILABLE = False
    print("UKCP Stand Fetcher not available - install ukcp_stand_fetcher.py for UK airport stand integration")

class VatsimFetcher:
    def __init__(self):
        self.vatsim_url = 'https://data.vatsim.net/v3/vatsim-data.json'
        
        # Load airport database on init for dynamic airport support
        print("Loading airport database...")
        self.airport_db = self.load_airport_database()
        print(f"Loaded {len(self.airport_db)} airports from database")
        
        # Pre-configured airports with custom settings (full support)
        self.configured_airports = {
            'LSZH': { 'name': 'Zurich Airport', 'ceiling': 6000, 'has_stands': True },
            'LSGG': { 'name': 'Geneva Airport', 'ceiling': 8000, 'has_stands': True },
            'LFSB': { 'name': 'EuroAirport Basel', 'ceiling': 5000, 'has_stands': True },
            'EGLL': { 'name': 'London Heathrow', 'ceiling': 7000, 'has_stands': True },
            'KJFK': { 'name': 'New York JFK', 'ceiling': 5000, 'has_stands': True }
        }
        
        self.stands = self.load_stands()
        self.cleanup_dist_dep = 80
        self.radar_range_arr = 15000 
        self.ground_range = 15
        
        # Initialize UKCP Stand Fetcher if available
        if UKCP_AVAILABLE:
            self.ukcp_fetcher = UKCPStandFetcher()
            print("UKCP Stand API integration enabled for UK airports")
        else:
            self.ukcp_fetcher = None
    
    def load_airport_database(self):
        """Load the mwgg airports database for coordinate lookup"""
        try:
            response = requests.get('https://raw.githubusercontent.com/mwgg/Airports/master/airports.json', timeout=10)
            if response.ok:
                return response.json()
        except Exception as e:
            print(f"Failed to load airport database: {e}")
        return {}
    
    def get_airport_info(self, icao):
        """Get airport info - configured airports or from database"""
        icao = icao.upper()
        
        # Check if it's a pre-configured airport with custom settings
        if icao in self.configured_airports:
            config = self.configured_airports[icao]
            # Get coordinates from database, fallback to config
            db_data = self.airport_db.get(icao, {})
            return {
                'name': config.get('name', icao),
                'lat': db_data.get('lat'),
                'lon': db_data.get('lon'),
                'ceiling': config.get('ceiling', 6000),
                'has_stands': config.get('has_stands', False),
                'country': db_data.get('country', '')
            }
        
        # Otherwise pull from database (dynamic airport)
        if icao in self.airport_db:
            data = self.airport_db[icao]
            
            # Enable UKCP lookup for supported UK airports
            is_ukcp_supported = False
            if self.ukcp_fetcher and self.ukcp_fetcher.is_uk_airport(icao):
                is_ukcp_supported = True

            return {
                'name': data.get('name', icao),
                'lat': data.get('lat'),
                'lon': data.get('lon'),
                'ceiling': 6000,
                'has_stands': is_ukcp_supported, # Set True so format_flight calls find_stand
                'country': data.get('country', '')
            }
        
        return None
    
    def load_stands(self):
        try:
            stands_path = os.path.join('static', 'stands.json')
            if not os.path.exists(stands_path): stands_path = 'stands.json'
            with open(stands_path, 'r') as f: return json.load(f)
        except: return {}
    
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
        """
        Find stand assignment with priority:
        1. UKCP API (UK airports only) - real controller assignments
        2. Geofencing (configured airports) - coordinate-based
        3. None (dynamic airports) - no stand data
        """
        # Priority 1: Try UKCP API for UK airports (if available)
        if self.ukcp_fetcher and callsign and self.ukcp_fetcher.is_uk_airport(airport_code):
            ukcp_stand = self.ukcp_fetcher.get_stand_for_flight(callsign, airport_code)
            if ukcp_stand:
                return ukcp_stand
        
        # Priority 2: Fall back to geofencing for configured airports with stand data
        if groundspeed > 5 or altitude > 10000: return None
        if pilot_lat is None or pilot_lon is None: return None
        
        airport_stands = self.stands.get(airport_code, [])
        if not airport_stands:
            return None  # No stand data available for this airport
            
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
        """Fetch flights for ALL configured airports"""
        results = {}
        
        # Build results structure for all configured airports
        for code in self.configured_airports:
            info = self.get_airport_info(code)
            if info and info['lat'] is not None and info['lon'] is not None:
                results[code] = {
                    'departures': [], 
                    'arrivals': [],
                    'metar': 'Unavailable', 
                    'controllers': [],
                    'airport_name': info['name'],
                    'has_stands': info.get('has_stands', False),
                    'country': info.get('country', '')
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
                # Sort flights
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
        """Fetch flights for a single airport (used for dynamic airports)"""
        airport_code = airport_code.upper()
        info = self.get_airport_info(airport_code)
        
        if not info or info['lat'] is None or info['lon'] is None:
            return None
        
        result = {
            'departures': [], 
            'arrivals': [],
            'metar': 'Unavailable', 
            'controllers': [],
            'airport_name': info['name'],
            'has_stands': info.get('has_stands', False),
            'country': info.get('country', '')
        }

        try:
            response = requests.get(self.vatsim_url, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            for pilot in data.get('pilots', []):
                fp = pilot.get('flight_plan')
                if not fp: continue
                
                dep, arr = fp.get('departure'), fp.get('arrival')
                
                if dep == airport_code:
                    self.process_flight(pilot, airport_code, 'DEP', result, info)
                if arr == airport_code:
                    self.process_flight(pilot, airport_code, 'ARR', result, info)

            # Sort flights
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
        dist_km = self.calculate_distance_m(
            pilot['latitude'], 
            pilot['longitude'], 
            airport_info['lat'], 
            airport_info['lon']
        ) / 1000.0
        
        flight_info = self.format_flight(
            pilot, 
            direction, 
            airport_info['ceiling'], 
            airport_code, 
            dist_km,
            airport_info.get('has_stands', False)
        )
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
            
            if direction == 'DEP':
                return f"{dep_h:02d}:{dep_m:02d}"
            
            if not enroute_time or len(enroute_time) < 4: return "--:--"
            enr_h = int(enroute_time[:2])
            enr_m = int(enroute_time[2:4])
            total_m = dep_m + enr_m
            add_h = total_m // 60
            rem_m = total_m % 60
            final_h = (dep_h + enr_h + add_h) % 24
            return f"{final_h:02d}:{rem_m:02d}"
        except:
            return display_time

    def calculate_delay(self, scheduled_time, logon_time_str):
        if not scheduled_time or len(scheduled_time) < 4:
            return 0
        try:
            now = datetime.utcnow()
            sched_hour = int(scheduled_time[:2])
            sched_min = int(scheduled_time[2:4])
            sched_dt = now.replace(hour=sched_hour, minute=sched_min, second=0, microsecond=0)
            
            diff = now - sched_dt
            
            if diff.total_seconds() < -12 * 3600:
                sched_dt -= timedelta(days=1)
                diff = now - sched_dt
            elif diff.total_seconds() > 12 * 3600:
                sched_dt += timedelta(days=1)
                diff = now - sched_dt
                
            delay_minutes = int(diff.total_seconds() / 60)
            
            if delay_minutes < 0: return 0
            if delay_minutes > 720: return 0 
            return delay_minutes
        except Exception as e:
            print(f"Delay calc error: {e}")
            return 0

    def get_checkin_area(self, callsign, airport_code):
        """Get check-in desk/row assignment"""
        if not callsign: return ""
        
        seed = sum(ord(c) for c in callsign) 
        airline = callsign[:3].upper()
        
        # Use configured logic for pre-configured airports
        if airport_code == 'LSZH':
            if airline in ['SWR', 'EDW', 'DLH', 'AUA', 'BEL', 'CTN', 'AEE', 'DLA']: 
                return "1" 
            if airline in ['EZY', 'EZS', 'PGT', 'BTI']: 
                return "3"
            return "2"

        elif airport_code == 'LSGG':
            if airline in ['EXS', 'TOM', 'TRA', 'JAI']:
                desk = (seed % 10) + 80
                return f"T2-{desk}"
            if airline == 'AFR': 
                desk = (seed % 8) + 70
                return f"F{desk}"
            if airline in ['SWR', 'LX', 'EDW', 'DLH', 'UAE', 'ETD', 'QTR']:
                desk = (seed % 15) + 1
                return f"{desk:02d}"
            desk = (seed % 30) + 20
            return f"{desk:02d}"

        elif airport_code == 'LFSB':
            if airline in ['AFR', 'WZZ', 'RYR', 'ENT']: 
                desk = (seed % 15) + 60
                return f"F{desk}"
            desk = (seed % 40) + 1
            return f"{desk:02d}"
        
        elif airport_code == 'EGLL':
            if airline in ['BAW', 'SHT', 'IBE', 'AAL', 'AER', 'EIN']:
                desk = (seed % 40) + 501
                return f"{desk}"
            if airline in ['DLH', 'SWR', 'AUA', 'SAS', 'UAL', 'ACA', 'SIA', 
                        'THA', 'ANA', 'UAE', 'QFA', 'VIR', 'DAL', 'LOT']:
                desk = (seed % 30) + 301
                return f"{desk}"
            if airline in ['KLM', 'AFR', 'CES', 'KQA', 'ETD', 'MAS', 'RAM']:
                desk = (seed % 25) + 401
                return f"{desk}"
            if airline in ['BEL', 'TAP', 'AIC', 'LH', 'AUA']:
                desk = (seed % 20) + 201
                return f"{desk}"
            desk = (seed % 20) + 221
            return f"{desk}"
        
        elif airport_code == 'KJFK':
            if airline in ['DLH', 'LH', 'SWR', 'LX', 'AUA', 'OS', 'BEL', 'SN', 
                        'AFR', 'AF', 'KLM', 'KL', 'JAL', 'JL', 'KAL', 'KE']:
                row = ((seed % 8) + 1)
                return f"T1-{row}"
            if airline in ['DAL', 'DL', 'AFR', 'AF', 'KLM', 'KL', 'AZA', 'AZ',
                        'CES', 'MU', 'KQA', 'KQ', 'SVA', 'SV', 'ETD', 'EY',
                        'VIR', 'VS', 'UAL', 'UA']:
                if airline in ['VIR', 'VS', 'KQA', 'KQ']:
                    return f"T4-6"
                else:
                    rows = ['1', '1A', '2', '3', '4', '5', '6', '7']
                    return f"T4-{rows[seed % len(rows)]}"
            if airline in ['JBU', 'B6', 'EIN', 'EI', 'SYX', 'SY']:
                row = ((seed % 4) + 1)
                return f"T5-{row}"
            if airline in ['BAW', 'BA', 'IBE', 'IB', 'ASA', 'AS', 'EWG', 'EW',
                        'ICE', 'FI', 'UAE', 'EK']:
                if airline in ['EWG', 'EW']:
                    return f"T7-C"
                else:
                    rows = ['2', '3', '4', '5', '6', 'C']
                    return f"T7-{rows[seed % len(rows)]}"
            if airline in ['AAL', 'AA', 'BAW', 'BA', 'QTR', 'QR', 'CPA', 'CX',
                        'JAL', 'JL', 'FJI', 'FJ']:
                if airline in ['QTR', 'QR']:
                    return f"T8-5"
                else:
                    rows = ['1', '2', '3', '4', '5', '6']
                    return f"T8-{rows[seed % len(rows)]}"
            row = ((seed % 7) + 1)
            return f"T4-{row}"
        
        # Generic check-in for unconfigured/dynamic airports
        desk = (seed % 20) + 1
        return f"{desk:02d}"

    def format_flight(self, pilot, direction, ceiling, airport_code, dist_km, has_stands):
        fp = pilot.get('flight_plan', {})
        callsign = pilot.get('callsign', 'N/A')
        
        # 1. CHECK-IN ASSIGNMENT (Initial Calculation)
        checkin_area = None
        if direction == 'DEP':
            checkin_area = self.get_checkin_area(callsign, airport_code)

        # 2. FIND GATE (UKCP for UK airports, geofencing for configured, None for dynamic)
        gate = None
        if has_stands:
            gate = self.find_stand(
                pilot['latitude'], 
                pilot['longitude'], 
                airport_code, 
                pilot['groundspeed'], 
                pilot['altitude'],
                callsign  # Pass callsign for UKCP API lookup
            )

        # 3. DETERMINE STATUS (Pass airport_code to check for local stands)
        raw_status = self.determine_status(pilot, direction, ceiling, dist_km, gate, airport_code)
        
        # --- OVERWRITE CHECK-IN IF BOARDING OR LATER ---
        if direction == 'DEP' and raw_status != 'Check-in':
            checkin_area = 'CLOSED'

        # 4. CALCULATE TIME
        time_display = self.calculate_times(fp.get('deptime'), fp.get('enroute_time'), direction)

        # 5. DELAY LOGIC
        delay_text = None
        if direction == 'DEP' and raw_status in ['Boarding', 'Check-in']:
            delay_min = self.calculate_delay(fp.get('deptime', '0000'), pilot.get('logon_time'))
            if 15 < delay_min < 300: 
                h, m = divmod(delay_min, 60)
                delay_text = f"Delayed {h}h {m:02d}m" if h > 0 else f"Delayed {m} min"

        elif direction == 'ARR' and raw_status in ['Approaching', 'Landing']:
            if time_display and time_display != "--:--":
                sched_arr_str = time_display.replace(':', '')
                delay_min = self.calculate_delay(sched_arr_str, pilot.get('logon_time'))
                if 15 < delay_min < 300:
                    h, m = divmod(delay_min, 60)
                    delay_text = f"Delayed {h}h {m:02d}m" if h > 0 else f"Delayed {m} min"

        # 6. GATE DISPLAY LOGIC
        gate_display = gate or 'TBA'

        if direction == 'DEP':
            if raw_status == 'Check-in':
                gate_display = 'TBA'
            elif raw_status in ['Pushback', 'Taxiing', 'Departing', 'En Route']:
                gate_display = 'CLOSED'

        # 7. STATUS OVERRIDE ("At Gate")
        display_status = raw_status
        if direction == 'ARR' and gate:
            display_status = 'At Gate'

        return {
            'callsign': callsign,
            'aircraft': fp.get('aircraft_short', 'N/A'),
            'origin': fp.get('departure', 'N/A'),
            'destination': fp.get('arrival', 'N/A'),
            'altitude': pilot.get('altitude', 0),
            'groundspeed': pilot.get('groundspeed', 0),
            'status': display_status,
            'status_raw': raw_status,
            'delay_text': delay_text,
            'gate': gate_display,
            'checkin': checkin_area,
            'time_display': time_display,
            'direction': direction,
            'distance': dist_km
        }


    def determine_status(self, pilot, direction, ceiling, dist_km, gate_found, airport_code):
        alt = pilot['altitude']
        gs = pilot['groundspeed']
        
        if direction == 'DEP':
            if alt < ceiling: 
                minutes_online = 0
                logon_time = pilot.get('logon_time')
                if logon_time:
                    try:
                        logon_dt = datetime.fromisoformat(logon_time[:19])
                        diff = datetime.utcnow() - logon_dt
                        minutes_online = diff.total_seconds() / 60
                    except:
                        pass 

                if gs < 1:
                    # STOPPED
                    if gate_found:
                        # At a KNOWN gate (either from UKCP or local JSON)
                        if minutes_online < 5: return 'Check-in'
                        else: return 'Boarding'
                    else:
                        # Stopped but NO gate found
                        
                        # Case 1: Hardcoded airport (we have local stands)
                        # If you are not at a known stand, you must be holding short.
                        has_local_stands = len(self.stands.get(airport_code, [])) > 0
                        if has_local_stands:
                            return 'Taxiing'
                        
                        # Case 2: Dynamic airport (we have NO stand data)
                        # We can't distinguish Gate vs Runway by position.
                        # Heuristic: Check Squawk Code & Time
                        
                        # If discrete squawk code (assigned by ATC) -> likely holding/active
                        std_squawks = {'2000','2200','1200','7000','0000'}
                        current_squawk = pilot.get('transponder')
                        
                        if minutes_online < 5: 
                            return 'Check-in'
                        elif current_squawk not in std_squawks:
                            return 'Taxiing' # Discrete code implies active flight
                        elif minutes_online > 35:
                            return 'Taxiing' # Online for 35+ mins? Likely taxiing/holding.
                        else:
                            return 'Boarding' # Standard squawk + < 35 mins -> Gate
                    
                if gs < 5: 
                    # MOVING SLOWLY (Pushback or slow taxi)
                    if pilot.get('transponder') not in {'2000','2200','1200','7000','0000'}:
                        return 'Pushback'
                    else:
                        if gate_found: return 'Boarding'
                        else: return 'Taxiing'
                
                elif gs < 45: return 'Taxiing'
                else: return 'Departing'
            else: return 'En Route'
        
        else:
            if alt < 2000 and gs < 40:
                if dist_km < 50: return 'Landed'
                else: return 'Scheduled'
            elif alt < 4000 and dist_km < 25: return 'Landing'
            elif dist_km < 250: return 'Approaching'
            else: return 'En Route'

    def get_metar(self, code):
        try: return requests.get(f'https://metar.vatsim.net/{code}', timeout=2).text.strip()
        except: return 'Unavailable'

    def get_controllers(self, ctrls, code):
        res = []
        prefixes = (code, 'LSAS', 'LSAZ')
        for c in ctrls:
            if c['callsign'].startswith(prefixes):
                res.append({'callsign': c['callsign'], 'frequency': c['frequency'], 'position': c['callsign'].split('_')[-1]})
        return res