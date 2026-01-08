    def format_flight(self, pilot, direction, ceiling, airport_code, dist_km):
        # ... (keep existing code) ...
        
        # --- NEW: CHECK-IN ASSIGNMENT ---
        checkin_area = None
        if direction == 'DEP':
            checkin_area = self.get_checkin_area(pilot.get('callsign'))

        return {
            # ... (keep existing fields) ...
            'gate': gate or 'TBA',
            'checkin': checkin_area,  # <--- ADD THIS LINE
            'time_display': time_display,
            # ...
        }
