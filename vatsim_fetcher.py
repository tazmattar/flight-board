import requests
import math
from datetime import datetime

class VatsimFetcher:
    def __init__(self):
        self.vatsim_url = 'https://data.vatsim.net/v3/vatsim-data.json'
        self.airport_code = 'LSZH'
        # LSZH Coordinates for distance calculation
        self.airport_lat = 47.4647
        self.airport_lon = 8.5492
        
        # Configuration for filters
        self.cleanup_dist_dep = 80   # km: Hide outbound flights after they fly this far away (~43nm)
        self.radar_range_arr = 1000  # km: Only show inbound flights within this range (~540nm)
    
    def fetch_flights(self):
        """Fetch flight data from VATSIM"""
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
                
                # Calculate distance from LSZH
                pilot_lat = pilot.get('latitude')
                pilot_lon = pilot.get('longitude')
                distance_km = self.calculate_distance(
                    pilot_lat, pilot_lon, 
                    self.airport_lat, self.airport_lon
                )

                # --- 1. DEPARTURES (Outbound) ---
                if dep_airport == self.airport_code:
                    flight_info = self.format_flight(pilot)
                    
                    if flight_info['status'] in ['Boarding', 'Taxiing', 'Departing']:
                        # Always show active departures
                        departures.append(flight_info)
                    else:
                        # Status is "En Route" (flying away)
                        # ONLY show if they are still within the cleanup distance
                        if distance_km < self.cleanup_dist_dep:
                            enroute.append(flight_info)
                        # Else: Flight has left airspace -> Ignore it (Slim down list)
                        
                # --- 2. ARRIVALS (Inbound) ---       
                elif arr_airport == self.airport_code:
                    flight_info = self.format_flight(pilot)
                    
                    if flight_info['status'] in ['Landed', 'Landing', 'Approaching']:
                        # Always show active arrivals
                        arrivals.append(flight_info)
                    else:
                        # Status is "En Route" (flying towards us)
                        # ONLY show if they are within radar range
                        if distance_km < self.radar_range_arr:
                            enroute.append(flight_info)
                        # Else: Flight is too far away (e.g. still in JFK) -> Ignore it
            
            metar = self.get_metar()
            controllers = self.get_controllers(data)
            
            print(f"Updated: {len(departures)} deps, {len(arrivals)} arrs, {len(enroute)} enroute")
            
            return {
                'departures': departures,
                'arrivals': arrivals,
                'enroute': enroute,
                'metar': metar,
                'controllers': controllers
            }
            
        except requests.exceptions.RequestException as e:
            print(f"Error fetching VATSIM data: {e}")
            return {'departures': [], 'arrivals': [], 'enroute': [], 'metar': 'Unavailable', 'controllers': []}
    
    def calculate_distance(self, lat1, lon1, lat2, lon2):
        """Haversine formula to calculate distance in km"""
        if lat1 is None or lon1 is None:
            return 99999 # Treat missing data as far away
            
        R = 6371 # Earth radius in km
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
        c = 2*math.atan2(math.sqrt(a), math.sqrt(1-a))
        
        return R*c

    def format_flight(self, pilot):
        """Format individual flight data"""
        flight_plan = pilot.get('flight_plan', {})
        dep = flight_plan.get('departure', 'N/A')
        arr = flight_plan.get('arrival', 'N/A')
        
        # Determine direction relative to LSZH
        direction = 'DEP' if dep == self.airport_code else 'ARR'

        flight_info = {
            'callsign': pilot.get('callsign', 'N/A'),
            'aircraft': flight_plan.get('aircraft_short', 'N/A'),
            'origin': dep,
            'destination': arr,
            'altitude': pilot.get('altitude', 0),
            'groundspeed': pilot.get('groundspeed', 0),
            'status': self.determine_status(pilot, direction),
            'direction': direction
        }
        
        return flight_info
    
    def determine_status(self, pilot, direction):
        """Determine flight status based on altitude and speed"""
        altitude = pilot.get('altitude', 0)
        groundspeed = pilot.get('groundspeed', 0)
        
        if direction == 'DEP':
            if groundspeed < 5:
                return 'Boarding'
            elif altitude < 500 and groundspeed < 40:
                return 'Taxiing'
            elif altitude < 2000:
                return 'Departing'
            else:
                return 'En Route'
        else: # ARR
            if altitude < 100 and groundspeed < 40:
                return 'Landed'
            elif altitude < 1000:
                return 'Landing'
            elif altitude < 10000:
                return 'Approaching'
            else:
                return 'En Route'
    
    def get_metar(self):
        """Extract METAR for the airport"""
        try:
            metar_response = requests.get(f'https://metar.vatsim.net/{self.airport_code}', timeout=5)
            if metar_response.status_code == 200:
                return metar_response.text.strip()
        except:
            pass
        return 'METAR not available'
    
    def get_controllers(self, data):
        """Get ATC controllers for this airport"""
        controllers = []
        
        for controller in data.get('controllers', []):
            callsign = controller.get('callsign', '')
            
            if callsign.startswith('LSZH') or callsign.startswith('LSAS'): 
                controllers.append({
                    'callsign': callsign,
                    'frequency': controller.get('frequency', 'N/A'),
                })
        
        return controllers