import requests
import math
import traceback
import json
import os
from datetime import datetime

class VatsimFetcher:
    def __init__(self):
        self.vatsim_url = 'https://data.vatsim.net/v3/vatsim-data.json'
        
        # Supported airports
        self.airports = {
            'LSZH': { 'name': 'Zurich Airport', 'lat': 47.4647, 'lon': 8.5492, 'ceiling': 6000 },
            'LSGG': { 'name': 'Geneva Airport', 'lat': 46.2370, 'lon': 6.1091, 'ceiling': 8000 },
            'LFSB': { 'name': 'EuroAirport Basel', 'lat': 47.5900, 'lon': 7.5290, 'ceiling': 5000 }
        }
        
        # Load stand database
        self.stands = self.load_stands()
        
        self.cleanup_dist_dep = 80   # km
        self.radar_range_arr = 1000  # km
        self.ground_range = 15       # km
    
    def load_stands(self):
        """Load stand coordinates from JSON file"""
        try:
            # Try loading from static directory first
            stands_path = os.path.join('static', 'stands.json')
            if not os.path.exists(stands_path):
                # Fallback to root directory
                stands_path = 'stands.json'
            
            with open(stands_path, 'r') as f:
                stands_data = json.load(f)
            print(f"✓ Loaded stand database from {stands_path}:")
            for airport, stands in stands_data.items():
                print(f"  {airport}: {len(stands)} stands")
            return stands_data
        except Exception as e:
            print(f"⚠️  Could not load stands.json: {e}")
            return {'LSZH': [], 'LSGG': [], 'LFSB': []}
    
    def find_stand(self, pilot_lat, pilot_lon, airport_code, groundspeed, altitude):
        """
        Determine which stand an aircraft is parked at using geofencing.
        """
        # 1. SPEED CHECK: If moving faster than 5kts, not at a stand.
        if groundspeed > 5:
            return None
            
        # 2. ALTITUDE SANITY CHECK:
        # We removed the 'altitude > 100' check because VATSIM sends MSL (Sea Level) altitude.
        # LSZH is ~1400ft. We only ignore planes clearly flying high (e.g. > 10,000ft).
        if altitude > 10000: 
            return None
        
        if pilot_lat is None or pilot_lon is None:
            return None
        
        # Get stands for this airport
        airport_stands = self.stands.get(airport_code, [])
        if not airport_stands:
            return None
        
        # Find closest stand
        closest_stand = None
        min_distance = float('inf')
        
        for stand in airport_stands:
            # Calculate distance in meters
            dist = self.calculate_distance_m(pilot_lat, pilot_lon, stand['lat'], stand['lon'])
            
            # Check if within stand's detection radius (usually 30-40m)
            if dist <= stand.get('radius', 100):
                if dist < min_distance:
                    min_distance = dist
                    closest_stand = stand['name']
        
        return closest_stand
    
    def calculate_distance_m(self, lat1, lon1, lat2, lon2):
        """Accurate distance in meters using Haversine"""
        R = 6371000 # Earth radius in meters
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
        c = 2*math.atan2(math.sqrt(a), math.sqrt(1-a))
        return R*c

    def fetch_flights(self):
        # Initialize results structure
        results = {}
        for code in self.airports:
            results[code] = {
                'departures': [], 'arrivals': [], 'enroute': [],
                'metar': 'Unavailable', 'controllers': [],
                'airport_name': self.airports[code]['name']
            }

        try:
            print("DEBUG: Requesting VATSIM data...")
            response = requests.get(self.vatsim_url, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            pilots = data.get('pilots', [])
            
            for pilot in pilots:
                flight_plan = pilot.get('flight_plan')
                if not flight_plan:
                    continue
                
                dep = flight_plan.get('departure')
                arr = flight_plan.get('arrival')
                
                if dep in self.airports:
                    self.process_flight(pilot, dep, 'DEP', results[dep])
                    
                if arr in self.airports:
                    self.process_flight(pilot, arr, 'ARR', results[arr])

            # Get Meta & Controllers
            for code in self.airports:
                results[code]['metar'] = self.get_metar(code)
                results[code]['controllers'] = self.get_controllers(data.get('controllers', []), code)
            
            return results
            
        except Exception as e:
            print(f"ERROR in fetch_flights: {e}")
            return results

    def process_flight(self, pilot, airport_code, direction, airport_data):
        airport_config = self.airports[airport_code]
        # Quick distance check (km)
        dist_km = self.calculate_distance_m(
            pilot.get('latitude'), pilot.get('longitude'), 
            airport_config['lat'], airport_config['lon']
        ) / 1000.0
        
        flight_info = self.format_flight(pilot, direction, airport_config['ceiling'], airport_code)
        status = flight_info['status_raw']
        
        if direction == 'DEP':
            if status in ['Boarding', 'Ready', 'Pushback', 'Taxiing'] and dist_km < self.ground_range:
                airport_data['departures'].append(flight_info)
            elif status == 'Departing' and dist_km < self.cleanup_dist_dep:
                airport_data['departures'].append(flight_info)
            elif status == 'En Route' and dist_km < self.cleanup_dist_dep:
                airport_data['enroute'].append(flight_info)
        
        elif direction == 'ARR':
            if status in ['Landed', 'Landing', 'Approaching']:
                airport_data['arrivals'].append(flight_info)
            elif dist_km < self.radar_range_arr:
                airport_data['enroute'].append(flight_info)

    def format_flight(self, pilot, direction, ceiling, airport_code):
        flight_plan = pilot.get('flight_plan', {})
        raw_status = self.determine_status(pilot, direction, ceiling)
        
        # Determine gate/stand assignment
        gate = None
        # Only check gate if on the ground and departing/arrived
        if direction == 'DEP' and raw_status in ['Boarding', 'Ready', 'Pushback']:
            gate = self.find_stand(
                pilot.get('latitude'),
                pilot.get('longitude'),
                airport_code,
                pilot.get('groundspeed', 0),
                pilot.get('altitude', 0)
            )
        
        delay_text = None
        if direction == 'DEP' and raw_status in ['Boarding', 'Ready']:
            delay_min = self.calculate_delay(flight_plan.get('deptime', '0000'), pilot.get('logon_time'))
            if 15 < delay_min < 300: 
                h, m = divmod(delay_min, 60)
                delay_text = f"Delayed {h}h {m:02d}m" if h > 0 else f"Delayed {m} min"

        return {
            'callsign': pilot.get('callsign', 'N/A'),
            'aircraft': flight_plan.get('aircraft_short', 'N/A'),
            'origin': flight_plan.get('departure', 'N/A'),
            'destination': flight_plan.get('arrival', 'N/A'),
            'altitude': pilot.get('altitude', 0),
            'groundspeed': pilot.get('groundspeed', 0),
            'status': raw_status,
            'delay_text': delay_text,
            'gate': gate or 'TBA',
            'direction': direction,
            'status_raw': raw_status
        }

    def determine_status(self, pilot, direction, ceiling):
        alt = pilot.get('altitude', 0)
        gs = pilot.get('groundspeed', 0)
        squawk = pilot.get('transponder', '0000')
        default_squawks = {'2000', '2200', '1200', '7000', '0000'}

        if direction == 'DEP':
            if alt < ceiling: 
                if gs < 5: return 'Pushback' if squawk not in default_squawks else 'Boarding'
                if gs < 1: return 'Ready' # Catch-all for stationary with squawk set
                elif gs < 45: return 'Taxiing'
                else: return 'Departing'
            else: return 'En Route'
        else:
            if alt < 2000 and gs < 40: return 'Landed'
            elif alt < 2500: return 'Landing'
            elif alt < 10000: return 'Approaching'
            else: return 'En Route'

    def calculate_delay(self, scheduled, logon):
        try:
            sch_total = int(scheduled[:2]) * 60 + int(scheduled[2:])
            now = datetime.utcnow()
            cur_total = now.hour * 60 + now.minute
            
            if logon:
                l_dt = datetime.strptime(logon.split('.')[0].replace('Z',''), "%Y-%m-%dT%H:%M:%S")
                log_total = l_dt.hour * 60 + l_dt.minute
                if (log_total - sch_total) > 15: return 0 

            diff = cur_total - sch_total
            if diff < -1000: diff += 1440
            elif diff > 1000: diff -= 1440
            return max(0, diff)
        except: return 0

    def get_metar(self, airport_code):
        try:
            return requests.get(f'https://metar.vatsim.net/{airport_code}', timeout=2).text.strip()
        except: return 'Unavailable'

    def get_controllers(self, all_controllers, airport_code):
        ctrls = []
        prefixes = (airport_code, 'LSAS', 'LSAZ') 
        for c in all_controllers:
            if c.get('callsign', '').startswith(prefixes):
                ctrls.append({'callsign': c['callsign'], 'frequency': c['frequency'], 'position': c['callsign'].split('_')[-1]})
        return ctrls