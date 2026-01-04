import json

def parse_coord(coord_str):
    """Convert Jeppesen format (N47 27.2) to Decimal Degrees"""
    parts = coord_str.split()
    
    # Latitude: N47 27.2 -> 47 + (27.2/60)
    lat_deg = float(parts[0][1:])
    lat_min = float(parts[1])
    lat = lat_deg + (lat_min / 60.0)
    if parts[0].startswith('S'): lat = -lat
    
    # Longitude: E008 33.5 -> 8 + (33.5/60)
    lon_deg = float(parts[2][1:])
    lon_min = float(parts[3])
    lon = lon_deg + (lon_min / 60.0)
    if parts[2].startswith('W'): lon = -lon
    
    return lat, lon

def expand_stands(name_range, coord_str, type_override="contact", radius=30):
    """
    Parses ranges like "A02 thru A05" and applies a fan-out offset
    so stands don't share the exact same coordinate.
    """
    lat, lon = parse_coord(coord_str)
    names = []
    
    # --- 1. Parse the Range String ---
    if "thru" in name_range:
        try:
            parts = name_range.split(" thru ")
            start, end = parts[0].strip(), parts[1].strip()
            
            # Extract numbers (e.g., "A02" -> 2, "A05" -> 5)
            s_num = int(''.join(filter(str.isdigit, start)))
            e_num = int(''.join(filter(str.isdigit, end)))
            
            # Extract prefix (e.g., "A")
            # Filter keeps alpha chars. For "6A" it might keep "A", so we handle logic carefully.
            prefix = ''.join([c for c in start if c.isalpha()])
            
            # Heuristic: If prefix is at start (A02), use it. If suffix (6A), ignoring for sequence logic usually works.
            is_prefix = start.startswith(prefix) if prefix else False

            for i in range(s_num, e_num + 1):
                # Reconstruct Name
                num_str = str(i)
                if is_prefix:
                    # Maintain padding if present (A02 vs A2)
                    if '0' in start and i < 10: num_str = f"0{i}"
                    names.append(f"{prefix}{num_str}")
                else:
                    # Handle suffix style if needed, or just plain numbers
                    # For LFSB "6A thru 11A", we'll generate "6A", "7A"...
                    suffix = ''.join([c for c in start if c.isalpha()])
                    names.append(f"{i}{suffix}")
        except:
            # Fallback for complex text, just add the endpoints
            names = [parts[0], parts[1]]
    elif "," in name_range:
        names = [x.strip() for x in name_range.split(",")]
    else:
        names = [name_range]

    # --- 2. Create Stand Objects with Fan-Out ---
    stands = []
    for i, name in enumerate(names):
        # Shift coordinates slightly (~30m) for each stand in a group
        # This allows the proximity logic to tell Stand 2 from Stand 3
        lat_offset = 0
        lon_offset = 0
        
        if len(names) > 1:
            offset_val = 0.0003 # approx 30 meters
            if i % 2 == 0:
                lon_offset = (i // 2) * offset_val
            else:
                lon_offset = -((i // 2) + 1) * offset_val
                
        stands.append({
            "name": name,
            "lat": round(lat + lat_offset, 6),
            "lon": round(lon + lon_offset, 6),
            "radius": radius,
            "type": type_override
        })
        
    return stands

# --- RAW CHART DATA (Transcribed from Images) ---
lszh_raw = [
    ("A02", "N47 27.2 E008 33.5"), ("A03", "N47 27.2 E008 33.7"), ("A04", "N47 27.2 E008 33.5"),
    ("A05, A07", "N47 27.2 E008 33.6"), ("A08", "N47 27.2 E008 33.4"), ("A09", "N47 27.2 E008 33.6"),
    ("A10", "N47 27.2 E008 33.4"), ("A11", "N47 27.3 E008 33.5"), ("A13", "N47 27.3 E008 33.4"),
    ("A15", "N47 27.3 E008 33.4"), ("A17", "N47 27.3 E008 33.4"), ("A44", "N47 27.2 E008 33.6"),
    ("A46", "N47 27.2 E008 33.5"), ("A48", "N47 27.2 E008 33.5"), ("A49", "N47 27.2 E008 33.5"),
    ("A57", "N47 27.3 E008 33.3"), ("B31", "N47 27.1 E008 33.6"), ("B33", "N47 27.1 E008 33.6"),
    ("B35, B37", "N47 27.1 E008 33.5"), ("B38", "N47 27.0 E008 33.5"), ("B39", "N47 27.1 E008 33.5"),
    ("B41, B43", "N47 27.1 E008 33.4"), ("B45", "N47 27.1 E008 33.4"), ("C50 thru C53", "N47 26.9 E008 33.7"),
    ("C54", "N47 26.8 E008 33.7"), ("C55", "N47 26.8 E008 33.8"), ("C56 thru C60", "N47 26.8 E008 33.8"),
    ("D01 thru D05", "N47 26.9 E008 33.5"), ("D06 thru D11", "N47 26.8 E008 33.6"),
    ("D12 thru D17", "N47 26.7 E008 33.7"), ("E4M", "N47 27.6 E008 33.3", "remote"),
    ("E5M", "N47 27.7 E008 33.1", "remote"), ("E19", "N47 27.7 E008 33.5", "remote"),
    ("E20", "N47 27.6 E008 33.5", "remote"), ("E23", "N47 27.7 E008 33.5", "remote"),
    ("E26", "N47 27.6 E008 33.4", "remote"), ("E27", "N47 27.7 E008 33.4", "remote"),
    ("E32", "N47 27.6 E008 33.4", "remote"), ("E33", "N47 27.7 E008 33.4", "remote"),
    ("E34 thru E36", "N47 27.6 E008 33.4", "remote"), ("E37", "N47 27.7 E008 33.3", "remote"),
    ("E42", "N47 27.6 E008 33.3", "remote"), ("E43 thru E47", "N47 27.7 E008 33.3", "remote"),
    ("E48 thru E54", "N47 27.6 E008 33.2", "remote"), ("E55 thru E58", "N47 27.7 E008 33.1", "remote"),
    ("E62 thru E67", "N47 27.7 E008 33.1", "remote"), ("F70 thru F72", "N47 27.3 E008 34.0"),
    ("G01 thru G06", "N47 26.5 E008 33.7", "cargo"), ("G11 thru G14", "N47 26.5 E008 33.8", "cargo"),
    ("H11 thru H14", "N47 27.3 E008 33.6"), ("I01 thru I05", "N47 27.4 E008 33.4"),
    ("P31 thru P37", "N47 27.8 E008 33.1"), ("T41 thru T44", "N47 26.6 E008 34.0"),
    ("T45 thru T56", "N47 26.8 E008 33.9"), ("T60 thru T63", "N47 26.7 E008 33.8"),
    ("W01 thru W05", "N47 26.9 E008 33.0", "remote"), ("W21 thru W30", "N47 26.9 E008 33.0", "remote"),
    ("W40 thru W47", "N47 27.2 E008 32.7", "remote"), ("W50 thru W60", "N47 27.1 E008 32.8", "remote")
]

lsgg_raw = [
    ("1", "N46 13.7 E006 06.2"), ("2 thru 5", "N46 13.8 E006 06.3"), ("8", "N46 13.8 E006 06.4"),
    ("9, 10", "N46 13.9 E006 06.4"), ("11, 12", "N46 13.9 E006 06.5"), ("14", "N46 14.0 E006 06.5"),
    ("15, 16", "N46 14.0 E006 06.6"), ("17, 18", "N46 14.1 E006 06.7"), ("19", "N46 14.1 E006 06.8"),
    ("21 thru 26", "N46 13.8 E006 06.2"), ("27, 28", "N46 13.9 E006 06.2"),
    ("31 thru 34", "N46 13.9 E006 06.3"), ("42", "N46 13.9 E006 06.4"), ("43, 44", "N46 14.0 E006 06.4"),
    ("48", "N46 14.7 E006 07.5", "remote"), ("54 thru 58", "N46 14.5 E006 07.2", "remote"),
    ("61 thru 66", "N46 14.1 E006 06.5"), ("67 thru 72", "N46 14.2 E006 06.7"),
    ("73 thru 76", "N46 14.3 E006 06.9"), ("83 thru 88", "N46 13.7 E006 06.0"),
    ("121 thru 127", "N46 13.8 E006 06.2"), ("141, 142", "N46 13.9 E006 06.5"),
    ("151, 152", "N46 14.0 E006 06.6"), ("181, 182", "N46 14.1 E006 06.7"),
    ("191, 192", "N46 14.1 E006 06.8"), ("A1 thru A9", "N46 13.6 E006 05.8"),
    ("D1 thru D5", "N46 13.5 E006 05.8"), ("E1 thru F5", "N46 14.2 E006 06.0", "remote"),
    ("F6 thru G4", "N46 14.2 E006 05.9", "remote"), ("I1, I2", "N46 14.1 E006 05.9"),
    ("L0 thru L10", "N46 14.1 E006 06.0"), ("PC1 thru PC10", "N46 14.7 E006 07.5", "remote"),
    ("PE1, PF1, PF2", "N46 14.7 E006 07.5", "remote")
]

lfsb_raw = [
    ("1", "N47 35.8 E007 31.9"), ("2 thru 5", "N47 35.9 E007 31.9"),
    ("6A thru 11A", "N47 35.9 E007 31.8"), ("12A", "N47 35.8 E007 31.8"),
    ("14A", "N47 35.8 E007 31.7"), ("16A", "N47 35.8 E007 31.7"),
    ("17 thru 24", "N47 35.9 E007 31.7"), ("26 thru 36", "N47 36.0 E007 31.7"),
    ("37 thru 44", "N47 36.1 E007 31.7"), ("45 thru 48", "N47 36.2 E007 31.5"),
    ("F1 thru F3", "N47 35.6 E007 31.9", "remote"), ("F4 thru F11", "N47 35.7 E007 31.9", "remote"),
    ("A1", "N47 34.9 E007 31.7"), ("F21, F22", "N47 35.3 E007 32.2", "remote"),
    ("G7 thru G20", "N47 36.2 E007 31.5", "remote"), ("G30, G31", "N47 36.2 E007 31.4", "remote"),
    ("J1 thru J4", "N47 35.4 E007 32.3", "remote")
]

# --- 3. Build & Write JSON ---
full_db = {}
for code, raw_data in [("LSZH", lszh_raw), ("LSGG", lsgg_raw), ("LFSB", lfsb_raw)]:
    stands = []
    for entry in raw_data:
        r = entry[0]
        c = entry[1]
        t = entry[2] if len(entry) > 2 else "contact"
        stands.extend(expand_stands(r, c, t))
    full_db[code] = stands

with open('stands.json', 'w') as f:
    json.dump(full_db, f, indent=2)

print("Successfully generated stands.json with full database.")