import requests
import math
from datetime import datetime, timedelta

class VatsimFetcher:
    def __init__(self):
        self.vatsim_url = 'https://data.vatsim.net/v3/vatsim-data.json'
        self.airport_code = 'LSZH'
        self.airport_lat = 47.4647
        self.airport_lon = 8.5492
        
        # Filters
        self.cleanup_dist_dep = 80   # km (Dep flights disappear after this dist)
        self.radar_range_arr = 1000  # km (Arr flights appear within this dist)
        self.ground_range = 15       # km (Must be this close to show as Boarding/Taxiing)
    
    def fetch_flights(self):
        try:
            response = requests.get(self.vatsim_url, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            pilots = data.get('pilots', [])
            
            departures = []
            arrivals = []
            enroute = []
            
            for pilot in pilots:
                flight_plan = pilot.get('flight_plan')
                if not flight_plan:
                    continue
                
                dep_airport = flight_plan.get('departure')
                arr_airport = flight_plan.get('arrival')
                
                # Calculate distance
                pilot_lat = pilot.get('latitude')
                pilot_lon = pilot.get('longitude')
                distance_km = self.calculate_distance(
                    pilot_lat, pilot_lon, 
                    self.airport_lat, self.airport_lon
                )

                # --- 1. DEPARTURES ---
                if dep_airport == self.airport_code:
                    flight_info = self.format_flight(pilot, 'DEP')
                    status = flight_info['status_raw']
                    
                    if status in ['Boarding', 'Taxiing'] and distance_km < self.ground_range:
                        departures.append(flight_info)
                    elif status == 'Departing' and distance_km < self.cleanup_dist_dep:
                        departures.append(flight_info)
                    elif status == 'En Route' and distance_km < self.cleanup_dist_dep:
                        enroute.append(flight_info)
                        
                # --- 2. ARRIVALS ---
                elif arr_airport == self.airport_code:
                    flight_info = self.format_flight(pilot, 'ARR')
                    status = flight_info['status_raw']
                    
                    if status in ['Landed', 'Landing', 'Approaching']:
                        arrivals.append(flight_info)
                    elif distance_km < self.radar_range_arr:
                        enroute.append(flight_info)
            
            return {
                'departures': departures,
                'arrivals': arrivals,
                'enroute': enroute,
                'metar': self.get_metar(),
                'controllers': self.get_controllers(data)
            }
            
        except Exception as e:
            print(f"Error: {e}")
            return {'departures': [], 'arrivals': [], 'enroute': [], 'metar': 'Unavailable', 'controllers': []}

    def format_flight(self, pilot, direction):
        flight_plan = pilot.get('flight_plan', {})
        raw_status = self.determine_status(pilot, direction)
        
        display_status = raw_status
        
        # Delay Logic
        if direction == 'DEP' and raw_status in ['Boarding', 'Taxiing']:
            # We pass both the Filed Time AND the Logon Time
            delay_min = self.calculate_delay(
                flight_plan.get('deptime', '0000'), 
                pilot.get('logon_time')
            )
            
            # Logic: Show delay ONLY if reasonable (15 mins to 5 hours)
            if 15 < delay_min < 300: 
                if delay_min < 60:
                    display_status = f"Delayed {delay_min} min"
                else:
                    hours = delay_min // 60
                    mins = delay_min % 60
                    display_status = f"Delayed {hours}h {mins:02d}m"

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

    def calculate_delay(self, scheduled_time_str, logon_time_str):
        """Calculates delay, but returns 0 if pilot logged on AFTER scheduled time"""
        try:
            # 1. Parse Filed Time (HHMM) -> Minutes from midnight
            sch_h = int(scheduled_time_str[:2])
            sch_m = int(scheduled_time_str[2:])
            sched_total = sch_h * 60 + sch_m
            
            # 2. Parse Current Time -> Minutes from midnight
            now = datetime.utcnow()
            current_total = now.hour * 60 + now.minute
            
            # 3. Parse Logon Time -> Minutes from midnight
            # VATSIM Format: "2023-11-20T17:23:45.1234567Z" or similar
            if logon_time_str:
                # Truncate fractional seconds for safer parsing if needed
                logon_clean = logon_time_str.split('.')[0].replace('Z', '') 
                logon_dt = datetime.strptime(logon_clean, "%Y-%m-%dT%H:%M:%S")
                logon_total = logon_dt.hour * 60 + logon_dt.minute
            else:
                logon_total = current_total # Fallback
            
            # --- THE CHECK ---
            # Calculate difference between Logon Time and Sched Time
            start_diff = logon_total - sched_total
            
            # Handle Midnight Crossover for start_diff
            if start_diff < -1000: start_diff += 1440
            elif start_diff > 1000: start_diff -= 1440
            
            # If pilot logged on > 15 mins AFTER filed time, assume fresh flight (No Delay)
            if start_diff > 15:
                return 0

            # --- CALCULATE ACTUAL DELAY ---
            diff = current_total - sched_total
            # Handle Midnight Crossover for current diff
            if diff < -1000: diff += 1440
            elif diff > 1000: diff -= 1440
                
            return max(0, diff)
        except Exception as e:
            # print(f"Delay calc error: {e}") # Debug only
            return 0

    def calculate_distance(self, lat1, lon1, lat2, lon2):
        if lat1 is None or lon1 is None: return 99999
        R = 6371
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
        c = 2*math.atan2(math.sqrt(a), math.sqrt(1-a))
        return R*c

    def determine_status(self, pilot, direction):
        altitude = pilot.get('altitude', 0)
        groundspeed = pilot.get('groundspeed', 0)
        
        if direction == 'DEP':
            if groundspeed < 5: return 'Boarding'
            elif altitude < 500 and groundspeed < 40: return 'Taxiing'
            elif altitude < 2000: return 'Departing'
            else: return 'En Route'
        else:
            if altitude < 100 and groundspeed < 40: return 'Landed'
            elif altitude < 1000: return 'Landing'
            elif altitude < 10000: return 'Approaching'
            else: return 'En Route'

    def get_metar(self):
        try:
            resp = requests.get(f'https://metar.vatsim.net/{self.airport_code}', timeout=5)
            return resp.text.strip() if resp.status_code == 200 else 'Unavailable'
        except: return 'Unavailable'

    def get_controllers(self, data):
        ctrls = []
        for c in data.get('controllers', []):
            if c.get('callsign', '').startswith(('LSZH', 'LSAS')):
                ctrls.append({'callsign': c['callsign'], 'frequency': c['frequency']})
        return ctrls