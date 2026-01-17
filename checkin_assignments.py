"""
Airport Check-in Desk Assignment Logic
Provides realistic, deterministic check-in desk assignments based on airline and terminal operations
"""

class CheckinAssignments:
    """
    Manages check-in desk assignments for all supported airports.
    Each airport has logic tailored to its real-world terminal and airline operations.
    """
    
    def __init__(self):
        """Initialize the check-in assignment system"""
        pass
    
    def get_checkin_desk(self, callsign, airport_code):
        """
        Get check-in desk assignment for a flight
        
        Args:
            callsign: Aircraft callsign (e.g., 'SWR123')
            airport_code: ICAO airport code (e.g., 'LSZH')
            
        Returns:
            str: Check-in desk identifier (e.g., '1', 'T2-85', 'N105')
        """
        if not callsign:
            return ""
        
        # Deterministic seed based on callsign
        seed = sum(ord(c) for c in callsign)
        airline = callsign[:3].upper()
        
        # Route to airport-specific logic
        if airport_code == 'LSZH':
            return self._zurich(airline, seed)
        elif airport_code == 'LSGG':
            return self._geneva(airline, seed)
        elif airport_code == 'LFSB':
            return self._basel(airline, seed)
        elif airport_code == 'EGLL':
            return self._heathrow(airline, seed)
        elif airport_code == 'EGKK':
            return self._gatwick(airline, seed)
        elif airport_code == 'EGSS':
            return self._stansted(airline, seed)
        elif airport_code == 'EGLC':
            return self._london_city(airline, seed)
        elif airport_code == 'KJFK':
            return self._jfk(airline, seed)
        else:
            # Generic fallback for unknown airports
            return self._generic(seed)
    
    # ==================== SWITZERLAND ====================
    
    def _zurich(self, airline, seed):
        """Zurich Airport (LSZH) check-in assignments"""
        # Desk 1: Star Alliance & Swiss partners
        if airline in ['SWR', 'EDW', 'DLH', 'AUA', 'BEL', 'CTN', 'AEE', 'DLA']:
            return "1"
        
        # Desk 3: Budget carriers
        if airline in ['EZY', 'EZS', 'PGT', 'BTI']:
            return "3"
        
        # Desk 2: All others
        return "2"
    
    def _geneva(self, airline, seed):
        """Geneva Airport (LSGG) check-in assignments"""
        # Terminal 2: Winter charters
        if airline in ['EXS', 'TOM', 'TRA', 'JAI']:
            desk = (seed % 10) + 80
            return f"T2-{desk}"
        
        # French Sector: Air France
        if airline == 'AFR':
            desk = (seed % 8) + 70
            return f"F{desk}"
        
        # Main Terminal - Star Alliance & Premium
        if airline in ['SWR', 'LX', 'EDW', 'DLH', 'UAE', 'ETD', 'QTR']:
            desk = (seed % 15) + 1
            return f"{desk:02d}"
        
        # Main Terminal - Others
        desk = (seed % 30) + 20
        return f"{desk:02d}"
    
    def _basel(self, airline, seed):
        """EuroAirport Basel (LFSB) check-in assignments"""
        # French Sector
        if airline in ['AFR', 'WZZ', 'RYR', 'ENT']:
            desk = (seed % 15) + 60
            return f"F{desk}"
        
        # Swiss Sector
        desk = (seed % 40) + 1
        return f"{desk:02d}"
    
    # ==================== UNITED KINGDOM ====================
    
    def _heathrow(self, airline, seed):
        """London Heathrow (EGLL) check-in assignments"""
        # Terminal 5: British Airways & oneworld
        if airline in ['BAW', 'SHT', 'IBE', 'AAL', 'AER', 'EIN']:
            desk = (seed % 40) + 501
            return f"{desk}"
        
        # Terminal 3: Star Alliance & Middle East carriers
        if airline in ['DLH', 'SWR', 'AUA', 'SAS', 'UAL', 'ACA', 'SIA',
                      'THA', 'ANA', 'UAE', 'QFA', 'VIR', 'DAL', 'LOT']:
            desk = (seed % 30) + 301
            return f"{desk}"
        
        # Terminal 4: SkyTeam & independents
        if airline in ['KLM', 'AFR', 'CES', 'KQA', 'ETD', 'MAS', 'RAM']:
            desk = (seed % 25) + 401
            return f"{desk}"
        
        # Terminal 2: Star Alliance overflow
        if airline in ['BEL', 'TAP', 'AIC', 'LH', 'AUA']:
            desk = (seed % 20) + 201
            return f"{desk}"
        
        # Default: Terminal 2 for unknown carriers
        desk = (seed % 20) + 221
        return f"{desk}"
    
    def _gatwick(self, airline, seed):
        """London Gatwick (EGKK) check-in assignments"""
        # North Terminal: Major carriers
        if airline in ['BAW', 'EZY', 'EZS', 'VIR', 'TOM', 'NAX']:
            desk = (seed % 30) + 101
            return f"N{desk}"
        
        # South Terminal: Others
        desk = (seed % 25) + 201
        return f"S{desk}"

    def _stansted(self, airline, seed):
        """London Stansted (EGSS) check-in assignments"""
        # Jet2: Dedicated desks 14-28
        if airline in ['EXS']:
            desk = (seed % 15) + 14
            return f"{desk}"
            
        # EasyJet: Zone A (Desks 1-12)
        if airline in ['EZY', 'EJU']:
            desk = (seed % 12) + 1
            return f"{desk}"
            
        # TUI: Zone B (Desks 30-39)
        if airline in ['TOM']:
            desk = (seed % 10) + 30
            return f"{desk}"
            
        # Ryanair: Zones C/D (Desks 40-99) - Massive operator presence
        if airline in ['RYR', 'RUK']:
            desk = (seed % 60) + 40
            return f"{desk}"
            
        # Emirates: Premium Zone (e.g., Desks 100-105)
        if airline in ['UAE']:
            desk = (seed % 6) + 100
            return f"{desk}"
            
        # Others: General check-in
        desk = (seed % 20) + 110
        return f"{desk}"

    def _london_city(self, airline, seed):
        """London City (EGLC) check-in assignments"""
        # British Airways (CityFlyer) - Dominant carrier
        if airline in ['BAW', 'CFE', 'SHT']:
            desk = (seed % 8) + 2  # Desks 2-9
            return f"{desk}"
            
        # Star Alliance (Swiss, Lufthansa)
        if airline in ['SWR', 'LX', 'DLH', 'LH']:
            desk = (seed % 2) + 1  # Desks 1-2
            return f"{desk}"
            
        # SkyTeam (KLM, ITA) & Others (Luxair, Loganair)
        if airline in ['KLM', 'KL', 'ITY', 'AZ', 'LGL', 'LG', 'LOG', 'LM']:
            desk = (seed % 6) + 10 # Desks 10-15
            return f"{desk}"
            
        # General Aviation / Other
        desk = (seed % 5) + 16
        return f"{desk}"
    
    # ==================== UNITED STATES ====================
    
    def _jfk(self, airline, seed):
        """New York JFK (KJFK) check-in assignments"""
        # Terminal 1: Star Alliance mix, European long-haul
        if airline in ['DLH', 'LH', 'SWR', 'LX', 'AUA', 'OS', 'BEL', 'SN',
                      'AFR', 'AF', 'KLM', 'KL', 'JAL', 'JL', 'KAL', 'KE']:
            row = ((seed % 8) + 1)
            return f"T1-{row}"
        
        # Terminal 4: Delta hub + SkyTeam + Middle East
        if airline in ['DAL', 'DL', 'AFR', 'AF', 'KLM', 'KL', 'AZA', 'AZ',
                      'CES', 'MU', 'KQA', 'KQ', 'SVA', 'SV', 'ETD', 'EY',
                      'VIR', 'VS', 'UAL', 'UA']:
            # Known specific assignments
            if airline in ['VIR', 'VS', 'KQA', 'KQ']:
                return "T4-6"
            rows = ['1', '1A', '2', '3', '4', '5', '6', '7']
            return f"T4-{rows[seed % len(rows)]}"
        
        # Terminal 5: JetBlue base
        if airline in ['JBU', 'B6', 'EIN', 'EI', 'SYX', 'SY']:
            row = ((seed % 4) + 1)
            return f"T5-{row}"
        
        # Terminal 7: Star/non-alliance mix
        if airline in ['BAW', 'BA', 'IBE', 'IB', 'ASA', 'AS', 'EWG', 'EW',
                      'ICE', 'FI', 'UAE', 'EK']:
            if airline in ['EWG', 'EW']:
                return "T7-C"
            rows = ['2', '3', '4', '5', '6', 'C']
            return f"T7-{rows[seed % len(rows)]}"
        
        # Terminal 8: American hub + oneworld
        if airline in ['AAL', 'AA', 'BAW', 'BA', 'QTR', 'QR', 'CPA', 'CX',
                      'JAL', 'JL', 'FJI', 'FJ']:
            if airline in ['QTR', 'QR']:
                return "T8-5"
            rows = ['1', '2', '3', '4', '5', '6']
            return f"T8-{rows[seed % len(rows)]}"
        
        # Default: Terminal 4 (largest/most diverse)
        row = ((seed % 7) + 1)
        return f"T4-{row}"
    
    # ==================== GENERIC FALLBACK ====================
    
    def _generic(self, seed):
        """Generic check-in assignment for airports without specific logic"""
        desk = (seed % 20) + 1
        return f"{desk:02d}"