import requests
import math
import traceback
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
        
        self.cleanup_dist_dep = 80   # km
        self.radar_range_arr = 1000  # km
        self.ground_range = 15       # km
    
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
            print(f"DEBUG: VATSIM data received. Total connected pilots: {len(pilots)}")
            
            # Counters for debug
            counts = {code: {'dep': 0, 'arr': 0} for code in self.airports}
            
            for pilot in pilots:
                flight_plan = pilot.get('flight_plan')
                if not flight_plan:
                    continue
                
                dep = flight_plan.get('departure')
                arr = flight_plan.get('arrival')
                
                if dep in self.airports:
                    self.process_flight(pilot, dep, 'DEP', results[dep])
                    counts[dep]['dep'] += 1
                    
                if arr in self.airports:
                    self.process_flight(pilot, arr, 'ARR', results[arr])
                    counts[arr]['arr'] += 1

            # Get Meta
            for code in self.airports:
                results[code]['metar'] = self.get_metar(code)
                results[code]['controllers'] = self.get_controllers(data.get('controllers', []), code)
            
            # Print Summary
            for code in self.airports:
                d = len(results[code]['departures'])
                a = len(results[code]['arrivals'])
                print(f"DEBUG {code}: Found {d} Deps (of {counts[code]['dep']} total), {a} Arrs (of {counts[code]['arr']} total)")
            
            return results
            
        except Exception as e:
            print(f"CRITICAL ERROR in fetch_flights: {e}")
            traceback.print_exc()
            return results

    def process_flight(self, pilot, airport_code, direction, airport_data):
        airport_config = self.airports[airport_code]
        distance_km = self.calculate_distance(
            pilot.get('latitude'), pilot.get('longitude'), 
            airport_config['lat'], airport_config['lon']
        )
        
        flight_info = self.format_flight(pilot, direction, airport_config['ceiling'])
        status = flight_info['status_raw']
        
        # Apply Logic
        added = False
        if direction == 'DEP':
            if status in ['Boarding', 'Ready', 'Pushback', 'Taxiing'] and distance_km < self.ground_range:
                airport_data['departures'].append(flight_info)
                added = True
            elif status == 'Departing' and distance_km < self.cleanup_dist_dep:
                airport_data['departures'].append(flight_info)
                added = True
            elif status == 'En Route' and distance_km < self.cleanup_dist_dep:
                airport_data['enroute'].append(flight_info)
        
        elif direction == 'ARR':
            if status in ['Landed', 'Landing', 'Approaching']:
                airport_data['arrivals'].append(flight_info)
                added = True
            elif distance_km < self.radar_range_arr:
                airport_data['enroute'].append(flight_info)

    def format_flight(self, pilot, direction, ceiling):
        flight_plan = pilot.get('flight_plan', {})
        raw_status = self.determine_status(pilot, direction, ceiling)
        
        delay_text = None
        if direction == 'DEP' and raw_status in ['Boarding', 'Ready']:
            delay_min = self.calculate_delay(flight_plan.get('deptime', '0000'), pilot.get('logon_time'))
            if 15 < delay_min < 300: 
                if delay_min < 60: delay_text = f"Delayed {delay_min} min"
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
            'status': raw_status,
            'delay_text': delay_text,
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
                if gs < 1: return 'Boarding' if squawk in default_squawks else 'Ready'
                elif gs < 5: return 'Pushback'
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
                clean_logon = logon.split('.')[0].replace('Z','')
                l_dt = datetime.strptime(clean_logon, "%Y-%m-%dT%H:%M:%S")
                log_total = l_dt.hour * 60 + l_dt.minute
                if (log_total - sch_total) > 15: return 0 
                if (log_total - sch_total) < -1000: pass # simplified check

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
            return requests.get(f'https://metar.vatsim.net/{airport_code}', timeout=2).text.strip()
        except: return 'Unavailable'

    def get_controllers(self, all_controllers, airport_code):
        ctrls = []
        prefixes = (airport_code, 'LSAS', 'LSAZ') 
        for c in all_controllers:
            if c.get('callsign', '').startswith(prefixes):
                ctrls.append({'callsign': c['callsign'], 'frequency': c['frequency']})
        return ctrls