import requests
import math
import traceback
import json
import os
from datetime import datetime, timedelta

class VatsimFetcher:
    def __init__(self):
        self.vatsim_url = 'https://data.vatsim.net/v3/vatsim-data.json'
        
        self.airports = {
            'LSZH': { 'name': 'Zurich Airport', 'lat': 47.4647, 'lon': 8.5492, 'ceiling': 6000 },
            'LSGG': { 'name': 'Geneva Airport', 'lat': 46.2370, 'lon': 6.1091, 'ceiling': 8000 },
            'LFSB': { 'name': 'EuroAirport Basel', 'lat': 47.5900, 'lon': 7.5290, 'ceiling': 5000 }
        }
        
        self.stands = self.load_stands()
        self.cleanup_dist_dep = 80
        self.radar_range_arr = 1000
        self.ground_range = 15
    
    def load_stands(self):
        try:
            stands_path = os.path.join('static', 'stands.json')
            if not os.path.exists(stands_path): stands_path = 'stands.json'
            with open(stands_path, 'r') as f: return json.load(f)
        except: return {'LSZH': [], 'LSGG': [], 'LFSB': []}
    
    def calculate_distance_m(self, lat1, lon1, lat2, lon2):
        if None in [lat1, lon1, lat2, lon2]: return 999999
        R = 6371000
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
        c = 2*math.atan2(math.sqrt(a), math.sqrt(1-a))
        return R*c

    def find_stand(self, pilot_lat, pilot_lon, airport_code, groundspeed, altitude):
        if groundspeed > 5 or altitude > 10000: return None
        if pilot_lat is None or pilot_lon is None: return None
        
        airport_stands = self.stands.get(airport_code, [])
        closest_stand = None
        min_distance = float('inf')
        
        for stand in airport_stands:
            dist = self.calculate_distance_m(pilot_lat, pilot_lon, stand['lat'], stand['lon'])
            # Use 100m for broader detection (pushbacks), 40m for tight contact stands
            limit = stand.get('radius', 40)
            if dist <= limit:
                if dist < min_distance:
                    min_distance = dist
                    closest_stand = stand['name']
        return closest_stand

    def fetch_flights(self):
        results = {}
        for code in self.airports:
            results[code] = {
                'departures': [], 'arrivals': [], 'enroute': [],
                'metar': 'Unavailable', 'controllers': [],
                'airport_name': self.airports[code]['name']
            }

        try:
            response = requests.get(self.vatsim_url, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            for pilot in data.get('pilots', []):
                fp = pilot.get('flight_plan')
                if not fp: continue
                
                dep, arr = fp.get('departure'), fp.get('arrival')
                if dep in self.airports:
                    self.process_flight(pilot, dep, 'DEP', results[dep])
                if arr in self.airports:
                    self.process_flight(pilot, arr, 'ARR', results[arr])

            for code in self.airports:
                results[code]['metar'] = self.get_metar(code)
                results[code]['controllers'] = self.get_controllers(data.get('controllers', []), code)
            
            return results
        except Exception as e:
            print(f"Error: {e}")
            traceback.print_exc()
            return results

    def process_flight(self, pilot, airport_code, direction, airport_data):
        ac = self.airports[airport_code]
        dist_km = self.calculate_distance_m(pilot['latitude'], pilot['longitude'], ac['lat'], ac['lon']) / 1000.0
        
        flight_info = self.format_flight(pilot, direction, ac['ceiling'], airport_code)
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

    def calculate_times(self, deptime, enroute_time, direction):
        # Default fallback
        display_time = "--:--"
        
        try:
            # Parse Departure Time (e.g., "1400" -> 14, 0)
            if not deptime or len(deptime) < 4: return display_time
            dep_h = int(deptime[:2])
            dep_m = int(deptime[2:4])
            
            if direction == 'DEP':
                # For departures, just show the filed departure time
                return f"{dep_h:02d}:{dep_m:02d}"
            
            # For Arrivals, calculate STA (Scheduled Time of Arrival)
            # STA = DepTime + EnrouteTime
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

    def format_flight(self, pilot, direction, ceiling, airport_code):
        fp = pilot.get('flight_plan', {})
        raw_status = self.determine_status(pilot, direction, ceiling)
        
        # --- FIXED GATE LOGIC ---
        gate = None
        
        # Check gate if:
        # 1. Departure is at the stand (Boarding/Ready/Pushback)
        # 2. Arrival has landed and is potentially parked (find_stand checks speed < 5)
        if (direction == 'DEP' and raw_status in ['Boarding', 'Ready', 'Pushback']) or \
           (direction == 'ARR' and raw_status == 'Landed'):
            
            gate = self.find_stand(
                pilot['latitude'], 
                pilot['longitude'], 
                airport_code, 
                pilot['groundspeed'], 
                pilot['altitude']
            )
        # ------------------------
            
        # Calculate Delay Text
        delay_text = None
        if direction == 'DEP' and raw_status in ['Boarding', 'Ready']:
            delay_min = self.calculate_delay(fp.get('deptime', '0000'), pilot.get('logon_time'))
            if 15 < delay_min < 300: 
                h, m = divmod(delay_min, 60)
                delay_text = f"Delayed {h}h {m:02d}m" if h > 0 else f"Delayed {m} min"

        # Calculate Time Column
        time_display = self.calculate_times(fp.get('deptime'), fp.get('enroute_time'), direction)

        return {
            'callsign': pilot.get('callsign', 'N/A'),
            'aircraft': fp.get('aircraft_short', 'N/A'),
            'origin': fp.get('departure', 'N/A'),
            'destination': fp.get('arrival', 'N/A'),
            'altitude': pilot.get('altitude', 0),
            'groundspeed': pilot.get('groundspeed', 0),
            'status': raw_status,
            'delay_text': delay_text,
            'gate': gate or 'TBA',
            'time_display': time_display,
            'direction': direction,
            'status_raw': raw_status
        }

    def determine_status(self, pilot, direction, ceiling):
        alt = pilot['altitude']
        gs = pilot['groundspeed']
        
        if direction == 'DEP':
            if alt < ceiling: 
                if gs < 5: return 'Pushback' if pilot.get('transponder') not in {'2000','2200','1200','7000','0000'} else 'Boarding'
                if gs < 1: return 'Ready' 
                elif gs < 45: return 'Taxiing'
                else: return 'Departing'
            else: return 'En Route'
        else:
            if alt < 2000 and gs < 40: return 'Landed'
            elif alt < 2500: return 'Landing'
            elif alt < 10000: return 'Approaching'
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