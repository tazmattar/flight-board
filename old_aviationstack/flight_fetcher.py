import requests
from datetime import datetime
from config import Config

class FlightFetcher:
    def __init__(self):
        self.api_key = Config.AVIATIONSTACK_API_KEY
        self.base_url = Config.AVIATIONSTACK_BASE_URL
        self.airport_code = Config.AIRPORT_CODE
    
    def fetch_flights(self):
        """Fetch flight data from AviationStack API"""
        all_flights = []
        
        try:
            endpoint = f"{self.base_url}/flights"
            params = {
                'access_key': self.api_key,
                'dep_iata': self.airport_code,
                'limit': 10
            }
            
            response = requests.get(endpoint, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            if 'data' in data:
                departures = self.format_flights(data['data'], 'departure')
                all_flights.extend(departures)
        except requests.exceptions.RequestException as e:
            print(f"Error fetching departures: {e}")
        
        try:
            endpoint = f"{self.base_url}/flights"
            params = {
                'access_key': self.api_key,
                'arr_iata': self.airport_code,
                'limit': 10
            }
            
            response = requests.get(endpoint, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            if 'data' in data:
                arrivals = self.format_flights(data['data'], 'arrival')
                all_flights.extend(arrivals)
        except requests.exceptions.RequestException as e:
            print(f"Error fetching arrivals: {e}")
        
        return all_flights
    
    def format_flights(self, flights_data, direction):
        """Format flight data for display"""
        formatted_flights = []
        
        for flight in flights_data:
            try:
                airline_iata = flight.get('airline', {}).get('iata', '')
                if airline_iata != 'LX':
                    continue
                
                flight_info = {
                    'flight_number': flight.get('flight', {}).get('iata', 'N/A'),
                    'airline': flight.get('airline', {}).get('name', 'Unknown'),
                    'destination': self.get_destination(flight, direction),
                    'scheduled_time': self.format_time(flight, direction),
                    'gate': flight.get('departure', {}).get('gate') or flight.get('arrival', {}).get('gate') or 'TBA',
                    'status': self.get_status(flight),
                    'terminal': flight.get('departure', {}).get('terminal') or flight.get('arrival', {}).get('terminal') or '-',
                    'direction': 'DEP' if direction == 'departure' else 'ARR',
                    'flight_status': flight.get('flight_status', 'Unknown')
                }
                
                formatted_flights.append(flight_info)
                
            except Exception as e:
                print(f"Error formatting flight: {e}")
                continue
        
        return formatted_flights
    
    def get_destination(self, flight, direction):
        """Get destination airport IATA code"""
        if direction == 'departure':
            return flight.get('arrival', {}).get('iata', 'N/A')
        else:
            return flight.get('departure', {}).get('iata', 'N/A')
    
    def format_time(self, flight, direction):
        """Format flight time"""
        if direction == 'departure':
            time_str = flight.get('departure', {}).get('scheduled')
        else:
            time_str = flight.get('arrival', {}).get('scheduled')
        
        if not time_str:
            return 'TBA'
        
        try:
            dt = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
            return dt.strftime('%H:%M')
        except:
            return 'TBA'
    
    def get_status(self, flight):
        """Determine flight status"""
        status = flight.get('flight_status', '').lower()
        
        status_map = {
            'scheduled': 'On Time',
            'active': 'In Flight',
            'landed': 'Landed',
            'cancelled': 'Cancelled',
            'incident': 'Delayed',
            'diverted': 'Diverted'
        }
        
        return status_map.get(status, 'Unknown')
