import requests
import math
from datetime import datetime

class VatsimFetcher:
    def __init__(self):
        self.vatsim_url = 'https://data.vatsim.net/v3/vatsim-data.json'
        
        # Configuration for supported airports
        self.airports = {
            'LSZH': {'name': 'Zurich Airport', 'lat': 47.4647, 'lon': 8.5492},
            'LSGG': {'name': 'Geneva Airport', 'lat': 46.2370, 'lon': 6.1091},
            'LFSB': {'name': 'EuroAirport Basel', 'lat': 47.5900, 'lon': 7.5290}
        }
        
        # Filters (Constants)
        self.cleanup_dist_dep = 80   # km
        self.radar_range_arr = 1000  # km
        self.ground_range = 15       # km
    
    def fetch_flights(self):
        try:
            response = requests.get(self.vatsim_url, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            pilots = data.get('pilots', [])
            controllers_data = data.get('controllers', [])
            
            # Initialize empty results for ALL supported airports
            results = {}
            for code in self.airports:
                results[code] = {
                    'departures': [],
                    'arrivals': [],
                    'enroute': [],
                    'metar': 'Loading...',
                    'controllers': [],
                    'airport_name': self.airports[code]['name']
                }

            # --- 1. Process Pilots ---
            for pilot in pilots:
                flight_plan = pilot.get('flight_plan')
                if not flight_plan:
                    continue
                
                dep = flight_plan.get('departure')
                arr = flight_plan.get('arrival')
                
                # Check if this flight matches ANY of our supported airports
                
                # Is it a Departure from a supported airport?
                if dep in self.airports:
                    self.process_flight(pilot, dep, 'DEP', results[dep])
                    
                # Is it an Arrival to a supported airport?
                if arr in self.airports:
                    self.process_flight(pilot, arr, 'ARR', results[arr])

            # --- 2. Process Metadata (METAR & ATC) for each airport ---
            for code in self.airports:
                results[code]['metar'] = self.get_metar(code)
                results[code]['controllers'] = self.get_controllers(controllers_data, code)
            
            return results
            
        except Exception as e:
            print(f"Error: {e}")
            return {}

    def process_flight(self, pilot, airport_code, direction, airport_data):
        """Analyze a flight relative to a specific airport and add to lists"""
        # Get coordinates for the SPECIFIC airport we are checking against
        ref_lat = self.airports[airport_code]['lat']
        ref_lon = self.airports[airport_code]['lon']
        
        pilot_lat = pilot.get('latitude')
        pilot_lon = pilot.get('longitude')
        
        distance_km = self.calculate_distance(pilot_lat, pilot_lon, ref_lat, ref_lon)
        
        # Format the flight data relative to this airport
        flight_info = self.format_flight(pilot, direction)
        status = flight_info['status_raw']
        
        # Apply Logic based on direction
        if direction == 'DEP':
            if status in ['Boarding', 'Taxiing'] and distance_km < self.ground_range:
                airport_data['departures'].append(flight_info)
            elif status == 'Departing' and distance_km < self.cleanup_dist_dep:
                airport_data['departures'].append(flight_info)
            elif status == 'En Route' and distance_km < self.cleanup_dist_dep:
                airport_data['enroute'].append(flight_info)
        
        elif direction == 'ARR':
            if status in ['Landed', 'Landing', 'Approaching']:
                airport_data['arrivals'].append(flight_info)
            elif distance_km < self.radar_range_arr:
                airport_data['enroute'].append(flight_info)

    def format_flight(self, pilot, direction):
        flight_plan = pilot.get('flight_plan', {})
        raw_status = self.determine_status(pilot, direction)
        display_status = raw_status
        
        # Delay Logic
        if direction == 'DEP' and raw_status in ['Boarding', 'Taxiing']:
            delay_min = self.calculate_delay(
                flight_plan.get('deptime', '0000'), 
                pilot.get('logon_time')
            )
            if 15 < delay_min < 300: 
                if delay_min < 60:
                    display_status = f"Delayed {delay_min} min"
                else:
                    h, m = divmod(delay_min, 60)
                    display_status = f"Delayed {h}h {m:02d}m"

        return {
            'callsign': pilot.get('callsign', 'N/A'),
            'aircraft': flight_plan.get('aircraft_short', 'N/A'),
            'origin': flight_plan.get('departure', 'N/A'),
            'destination': flight_plan.get('arrival', 'N/A'),
            'altitude': pilot.get('altitude', 0),
            'groundspeed': pilot.get('groundspeed', 0),
            'status': display_status,
            'status_raw': raw_status,
            'direction': direction
        }

    def calculate_delay(self, scheduled, logon):
        try:
            sch_total = int(scheduled[:2]) * 60 + int(scheduled[2:])
            now = datetime.utcnow()
            cur_total = now.hour * 60 + now.minute
            
            # Logon check
            if logon:
                l_dt = datetime.strptime(logon.split('.')[0].replace('Z',''), "%Y-%m-%dT%H:%M:%S")
                log_total = l_dt.hour * 60 + l_dt.minute
                start_diff = log_total - sch_total
                if start_diff < -1000: start_diff += 1440
                elif start_diff > 1000: start_diff -= 1440
                if start_diff > 15: return 0 # Late logon = Fresh flight

            diff = cur_total - sch_total
            if diff < -1000: diff += 1440
            elif diff > 1000: diff -= 1440
            return max(0, diff)
        except: return 0

    def calculate_distance(self, lat1, lon1, lat2, lon2):
        if None in [lat1, lon1, lat2, lon2]: return 99999
        R = 6371
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
        c = 2*math.atan2(math.sqrt(a), math.sqrt(1-a))
        return R*c

    def determine_status(self, pilot, direction):
        alt = pilot.get('altitude', 0)
        gs = pilot.get('groundspeed', 0)
        if direction == 'DEP':
            if gs < 5: return 'Boarding'
            elif alt < 500 and gs < 40: return 'Taxiing'
            elif alt < 2000: return 'Departing'
            else: return 'En Route'
        else:
            if alt < 100 and gs < 40: return 'Landed'
            elif alt < 1000: return 'Landing'
            elif alt < 10000: return 'Approaching'
            else: return 'En Route'

    def get_metar(self, airport_code):
        try:
            resp = requests.get(f'https://metar.vatsim.net/{airport_code}', timeout=5)
            return resp.text.strip() if resp.status_code == 200 else 'Unavailable'
        except: return 'Unavailable'

    def get_controllers(self, all_controllers, airport_code):
        ctrls = []
        # Match callsigns starting with the airport code (e.g. LSZH_TWR)
        # OR special cases like LSAS (Swiss Radar) covering all Swiss airports
        prefixes = (airport_code, 'LSAS', 'LSAZ') 
        
        for c in all_controllers:
            callsign = c.get('callsign', '')
            if callsign.startswith(prefixes):
                ctrls.append({'callsign': callsign, 'frequency': c['frequency']})
        return ctrls