"""
UKCP Stand Assignment API Integration
Fetches real-time stand assignments from VATSIM UK Controller Panel
"""

import requests
from datetime import datetime, timedelta

class UKCPStandFetcher:
    def __init__(self):
        self.api_url = 'https://ukcp.vatsim.uk/api/stand/assignment'
        self.cache = {}
        self.cache_duration = timedelta(minutes=2)  # Cache for 2 minutes
        self.last_fetch = None
        
        # UK airports supported by UKCP
        self.uk_airports = [
            'EGLL', 'EGKK', 'EGGW', 'EGSS', 'EGLC',  # London area
            'EGCC', 'EGBB', 'EGNX', 'EGNM',          # Midlands
            'EGPH', 'EGPF', 'EGAA', 'EGGP',          # Scotland & Northern
            'EGNT', 'EGNR', 'EGSH', 'EGGD'           # Regional
        ]
    
    def should_fetch(self):
        """Check if we need to refresh the cache"""
        if self.last_fetch is None:
            return True
        return datetime.utcnow() - self.last_fetch > self.cache_duration
    
    def fetch_stand_assignments(self):
        """
        Fetch all stand assignments from UKCP API
        Returns: dict of {callsign: stand_assignment_data}
        """
        if not self.should_fetch():
            return self.cache
        
        try:
            # UKCP has CORS restrictions, so this MUST be server-side
            response = requests.get(
                self.api_url,
                timeout=5,
                headers={
                    'User-Agent': 'VATSIM-FlightBoard/1.0',
                    'Accept': 'application/json'
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Process the response into a usable format
                self.cache = {}
                for assignment in data:
                    callsign = assignment.get('callsign')
                    if callsign:
                        self.cache[callsign] = {
                            'stand': assignment.get('stand_id'),
                            'airport': assignment.get('airport'),
                            'type': assignment.get('type', 'arrival'),  # arrival or departure
                            'assigned_at': assignment.get('assigned_at'),
                            'requested': assignment.get('requested', False)
                        }
                
                self.last_fetch = datetime.utcnow()
                print(f"UKCP: Fetched {len(self.cache)} stand assignments")
                return self.cache
            else:
                print(f"UKCP API returned status {response.status_code}")
                return self.cache
                
        except requests.exceptions.Timeout:
            print("UKCP API timeout")
            return self.cache
        except Exception as e:
            print(f"Error fetching UKCP stands: {e}")
            return self.cache
    
    def get_stand_for_flight(self, callsign, airport_code):
        """
        Get stand assignment for a specific flight
        
        Args:
            callsign: Aircraft callsign
            airport_code: ICAO code of the airport
            
        Returns:
            Stand identifier or None
        """
        # Only works for UK airports
        if airport_code not in self.uk_airports:
            return None
        
        # Ensure we have fresh data
        assignments = self.fetch_stand_assignments()
        
        if callsign in assignments:
            assignment = assignments[callsign]
            # Verify the assignment is for the correct airport
            if assignment['airport'] == airport_code:
                return assignment['stand']
        
        return None
    
    def is_uk_airport(self, icao):
        """Check if an airport is covered by UKCP"""
        return icao in self.uk_airports
    
    def get_assignment_info(self, callsign):
        """
        Get full assignment info for a callsign
        Returns dict with stand, airport, type, etc. or None
        """
        assignments = self.fetch_stand_assignments()
        return assignments.get(callsign)


# Example usage in vatsim_fetcher.py:
"""
from ukcp_stand_fetcher import UKCPStandFetcher

class VatsimFetcher:
    def __init__(self):
        # ... existing code ...
        self.ukcp_fetcher = UKCPStandFetcher()
    
    def find_stand(self, pilot_lat, pilot_lon, airport_code, groundspeed, altitude, callsign):
        # Try UKCP first for UK airports
        if self.ukcp_fetcher.is_uk_airport(airport_code):
            ukcp_stand = self.ukcp_fetcher.get_stand_for_flight(callsign, airport_code)
            if ukcp_stand:
                return ukcp_stand
        
        # Fall back to geofencing method
        if groundspeed > 5 or altitude > 10000:
            return None
        # ... rest of existing geofencing logic ...
"""
