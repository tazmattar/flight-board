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
        
        # --- FIX 1: INCREASED RANGE TO GLOBAL COVERAGE ---
        self.radar_range_arr = 15000 
        # -------------------------------------------------
        
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
                # Sort Departures by Time
                results[code]['departures'].sort(key=lambda x: x.get('time_display', ''))

                # Sort Arrivals by Time
                results[code]['arrivals'].sort(key=lambda x: x.get('time_display', ''))

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
        
        flight_info = self.format_flight(pilot, direction, ac['ceiling'], airport_code, dist_km)
        status = flight_info['status_raw']
        
        if direction == 'DEP':
            if status in ['Check-in', 'Boarding', 'Pushback', 'Taxiing'] and dist_km < self.ground_range:
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

    # --- MULTI-AIRPORT CHECK-IN LOGIC ---
    def get_checkin_area(self, callsign, airport_code):
        if not callsign: return ""
        
        # 1. Deterministic "Random" Desk
        seed = sum(ord(c) for c in callsign) 
        
        airline = callsign[:3].upper()
        
        # --- ZURICH (LSZH) ---
        if airport_code == 'LSZH':
            if airline in ['SWR', 'EDW', 'DLH', 'AUA', 'BEL', 'CTN', 'AEE', 'DLA']: 
                return "1" 
            if airline in ['EZY', 'EZS', 'PGT', 'BTI']: 
                return "3"
            return "2"

        # --- GENEVA (LSGG) ---
        elif airport_code == 'LSGG':
            # Terminal 2 (Winter Charters)
            if airline in ['EXS', 'TOM', 'TRA', 'JAI']:
                desk = (seed % 10) + 80  # Desks 80-89
                return f"T2-{desk}"
            
            # French Sector (Air France)
            if airline == 'AFR': 
                desk = (seed % 8) + 70   # Desks 70-77
                return f"F{desk}"
                
            # Main Terminal - Star Alliance
            if airline in ['SWR', 'LX', 'EDW', 'DLH', 'UAE', 'ETD', 'QTR']:
                desk = (seed % 15) + 1   # Desks 01-15
                return f"{desk:02d}"
            
            # Main Terminal - Others
            desk = (seed % 30) + 20      # Desks 20-49
            return f"{desk:02d}"

        # --- BASEL (LFSB) ---
        elif airport_code == 'LFSB':
            # French Sector
            if airline in ['AFR', 'WZZ', 'RYR', 'ENT']: 
                desk = (seed % 15) + 60  # Desks 60-74
                return f"F{desk}"
            
            # Swiss Sector
            desk = (seed % 40) + 1       # Desks 01-40
            return f"{desk:02d}"
            
        return ""

    def format_flight(self, pilot, direction, ceiling, airport_code, dist_km):
        fp = pilot.get('flight_plan', {})
        
        # 1. CHECK-IN ASSIGNMENT
        checkin_area = None
        if direction == 'DEP':
            # FIX: Now passing both callsign AND airport_code
            checkin_area = self.get_checkin_area(pilot.get('callsign'), airport_code)

        # 2. FIND GATE
        gate = self.find_stand(
            pilot['latitude'], 
            pilot['longitude'], 
            airport_code, 
            pilot['groundspeed'], 
            pilot['altitude']
        )

        # 3. DETERMINE STATUS
        raw_status = self.determine_status(pilot, direction, ceiling, dist_km, gate)
        
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

        # 6. STATUS OVERRIDE ("At Gate")
        display_status = raw_status
        if direction == 'ARR' and gate:
            display_status = 'At Gate'

        return {
            'callsign': pilot.get('callsign', 'N/A'),
            'aircraft': fp.get('aircraft_short', 'N/A'),
            'origin': fp.get('departure', 'N/A'),
            'destination': fp.get('arrival', 'N/A'),
            'altitude': pilot.get('altitude', 0),
            'groundspeed': pilot.get('groundspeed', 0),
            'status': display_status,
            'status_raw': raw_status,
            'delay_text': delay_text,
            'gate': gate or 'TBA',
            'checkin': checkin_area,
            'time_display': time_display,
            'direction': direction,
            'distance': dist_km
        }

    def determine_status(self, pilot, direction, ceiling, dist_km, gate_found):
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
                    if gate_found:
                        if minutes_online < 5: 
                            return 'Check-in'
                        else: 
                            return 'Boarding'
                    else: 
                        return 'Taxiing'
                    
                if gs < 5: 
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
