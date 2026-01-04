import requests
import math
import traceback
from datetime import datetime

class VatsimFetcher:
    def __init__(self):
        self.vatsim_url = 'https://data.vatsim.net/v3/vatsim-data.json'
        
        # Configuration for supported airports
        # 'ceiling': Altitude (ft) below which a plane is "Departing" vs "En Route"
        self.airports = {
            'LSZH': {
                'name': 'Zurich Airport', 
                'lat': 47.4647, 'lon': 8.5492, 
                'ceiling': 6000 
            },
            'LSGG': {
                'name': 'Geneva Airport', 
                'lat': 46.2370, 'lon': 6.1091, 
                'ceiling': 8000 
            },
            'LFSB': {
                'name': 'EuroAirport Basel', 
                'lat': 47.5900, 'lon': 7.5290, 
                'ceiling': 5000 
            }
        }
        
        # Filters (Constants)
        self.cleanup_dist_dep = 80   # km
        self.radar_range_arr = 1000  # km
        self.ground_range = 15       # km
    
    def fetch_flights(self):
        # 1. Initialize the structure FIRST so we can return it even if the API fails
        results = {}
        for code in self.airports:
            results[code] = {
                'departures': [],
                'arrivals': [],
                'enroute': [],
                'metar': 'Unavailable',
                'controllers': [],
                'airport_name': self.airports[code]['name']
            }

        try:
            response = requests.get(self.vatsim_url, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            pilots = data.get('pilots', [])
            controllers_data = data.get('controllers', [])
            
            # --- Process Pilots ---
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

            # --- Process Metadata ---
            for code in self.airports:
                results[code]['metar'] = self.get_metar(code)
                results[code]['controllers'] = self.get_controllers(controllers_data, code)
            
            return results
            
        except Exception:
            # Print the FULL error to the console so we can debug
            traceback.print_exc()
            # Return the empty results so the frontend clears the "Loading..." text
            return results

    def process_flight(self, pilot, airport_code, direction, airport_data):
        """Analyze a flight relative to a specific airport"""
        # Get config for this airport
        airport_config = self.airports[airport_code]
        
        distance_km = self.calculate_distance(
            pilot.get('latitude'), pilot.get('longitude'), 
            airport_config['lat'], airport_config['lon']
        )
        
        # Pass the specific airport ceiling to format_flight
        flight_info = self.format_flight(pilot, direction, airport_config['ceiling'])
        status = flight_info['status_raw']
        
        # Apply Logic based on direction
        if direction == 'DEP':
            if status in ['Boarding', 'Ready', 'Pushback', 'Taxiing'] and distance_km < self.ground_range:
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

    def format_flight(self, pilot, direction, ceiling):
        flight_plan = pilot.get('flight_plan', {})
        
        # Determine status using the dynamic ceiling
        raw_status = self.determine_status(pilot, direction, ceiling)
        
        # 2. Calculate Delay (but don't overwrite the status yet)
        delay_text = None
        
        # Delay Logic: Only checked if at gate (Boarding or Ready)
        if direction == 'DEP' and raw_status in ['Boarding', 'Ready']:
            delay_min = self.calculate_delay(
                flight_plan.get('deptime', '0000'), 
                pilot.get('logon_time')
            )
            
            if 15 < delay_min < 300: # 15m to 5h window
                if delay_min < 60:
                    delay_text = f"Delayed {delay_min} min"
                else:
                    h, m = divmod(delay_min, 60)
                    delay_text = f"Delayed {h}h {m:02d}m"

        return {
            'callsign': pilot.get('callsign', 'N/A'),
            'aircraft': flight_plan.get('aircraft_short', 'N/A'),
            'origin': flight_plan.get('departure', 'N/A'),
            'destination': flight_plan.get('arrival', 'N/A'),
            'altitude': pilot.get('altitude', 0),
            'groundspeed': pilot.get('groundspeed', 0),
            'status': raw_status,       # ALWAYS send "Boarding" or "Ready"
            'delay_text': delay_text,   # Send delay info separately
            'direction': direction,
            'status_raw': raw_status    # Keep raw status for logic
        }

    def determine_status(self, pilot, direction, ceiling):
        """Determine status with dynamic altitude ceiling"""
        altitude = pilot.get('altitude', 0)
        groundspeed = pilot.get('groundspeed', 0)
        squawk = pilot.get('transponder', '0000')
        default_squawks = {'2000', '2200', '1200', '7000', '0000'}

        if direction == 'DEP':
            # Use the dynamic ceiling (e.g., 6000 for LSZH)
            if altitude < ceiling: 
                if groundspeed < 1:
                    return 'Boarding' if squawk in default_squawks else 'Ready'
                elif groundspeed < 5:
                    return 'Pushback'
                elif groundspeed < 45:
                    return 'Taxiing'
                else:
                    return 'Departing'
            else:
                return 'En Route'
                
        else: # ARRIVALS
            if altitude < 2000 and groundspeed < 40: return 'Landed'
            elif altitude < 2500: return 'Landing'
            elif altitude < 10000: return 'Approaching'
            else: return 'En Route'

    def calculate_delay(self, scheduled, logon):
        try:
            sch_total = int(scheduled[:2]) * 60 + int(scheduled[2:])
            now = datetime.utcnow()
            cur_total = now.hour * 60 + now.minute
            
            if logon:
                # Robust parsing of logon time (handles microseconds and Z)
                clean_logon = logon.split('.')[0].replace('Z','')
                l_dt = datetime.strptime(clean_logon, "%Y-%m-%dT%H:%M:%S")
                log_total = l_dt.hour * 60 + l_dt.minute
                
                start_diff = log_total - sch_total
                if start_diff < -1000: start_diff += 1440
                elif start_diff > 1000: start_diff -= 1440
                
                # If they logged on > 15m AFTER scheduled time, it's a fresh flight (no delay)
                if start_diff > 15: return 0 

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

    def get_metar(self, airport_code):
        try:
            resp = requests.get(f'https://metar.vatsim.net/{airport_code}', timeout=5)
            return resp.text.strip() if resp.status_code == 200 else 'Unavailable'
        except: return 'Unavailable'

    def get_controllers(self, all_controllers, airport_code):
        ctrls = []
        prefixes = (airport_code, 'LSAS', 'LSAZ') 
        for c in all_controllers:
            callsign = c.get('callsign', '')
            if callsign.startswith(prefixes):
                ctrls.append({'callsign': callsign, 'frequency': c['frequency']})
        return ctrls