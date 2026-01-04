import requests
from datetime import datetime

class VatsimFetcher:
    def __init__(self):
        self.vatsim_url = 'https://data.vatsim.net/v3/vatsim-data.json'
        self.airport_code = 'LSZH'
    
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
                
                if dep_airport == self.airport_code:
                    flight_info = self.format_flight(pilot, 'departure')
                    
                    if flight_info['status'] in ['Boarding', 'Taxiing']:
                        departures.append(flight_info)
                    else:
                        enroute.append(flight_info)
                        
                elif arr_airport == self.airport_code:
                    flight_info = self.format_flight(pilot, 'arrival')
                    
                    if flight_info['status'] in ['Landed', 'Landing', 'Approaching']:
                        arrivals.append(flight_info)
                    else:
                        enroute.append(flight_info)
            
            metar = self.get_metar(data)
            controllers = self.get_controllers(data)
            
            print(f"Found {len(departures)} departures, {len(arrivals)} arrivals, {len(enroute)} en route")
            print(f"Controllers online: {len(controllers)}")
            
            return {
                'departures': departures,
                'arrivals': arrivals,
                'enroute': enroute,
                'metar': metar,
                'controllers': controllers
            }
            
        except requests.exceptions.RequestException as e:
            print(f"Error fetching VATSIM data: {e}")
            return {'departures': [], 'arrivals': [], 'enroute': [], 'metar': '', 'controllers': []}
    
    def format_flight(self, pilot, direction):
        """Format individual flight data"""
        flight_plan = pilot.get('flight_plan', {})
        
        flight_info = {
            'callsign': pilot.get('callsign', 'N/A'),
            'aircraft': flight_plan.get('aircraft_short', 'N/A'),
            'destination': flight_plan.get('arrival' if direction == 'departure' else 'departure', 'N/A'),
            'altitude': pilot.get('altitude', 0),
            'groundspeed': pilot.get('groundspeed', 0),
            'status': self.determine_status(pilot, direction),
            'direction': 'DEP' if direction == 'departure' else 'ARR'
        }
        
        return flight_info
    
    def determine_status(self, pilot, direction):
        """Determine flight status based on altitude and speed"""
        altitude = pilot.get('altitude', 0)
        groundspeed = pilot.get('groundspeed', 0)
        
        if direction == 'departure':
            if altitude < 50 and groundspeed < 2:
                return 'Boarding'
            elif altitude < 100:
                return 'Taxiing'
            elif altitude < 1000:
                return 'Departing'
            else:
                return 'En Route'
        else:
            if groundspeed < 50 and altitude < 500:
                return 'Landing'
            elif groundspeed < 5 and altitude < 100:
                return 'Landed'
            elif altitude < 3000:
                return 'Approaching'
            else:
                return 'En Route'
    
    def get_metar(self, data):
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
            
            if callsign.startswith('LSZH'):
                controllers.append({
                    'callsign': callsign,
                    'name': controller.get('name', 'Unknown'),
                    'frequency': controller.get('frequency', 'N/A'),
                    'rating': self.get_rating_text(controller.get('rating', 0))
                })
        
        return controllers
    
    def get_rating_text(self, rating):
        """Convert rating number to text"""
        ratings = {
            1: 'OBS',
            2: 'S1',
            3: 'S2',
            4: 'S3',
            5: 'C1',
            7: 'C3',
            8: 'I1',
            10: 'I3'
        }
        return ratings.get(rating, 'UNK')
