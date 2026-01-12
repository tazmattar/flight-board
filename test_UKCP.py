import requests
import json

def debug_raw():
    url = 'https://ukcp.vatsim.uk/api/stand/assignment'
    print(f"--- FETCHING RAW DATA FROM {url} ---")
    
    try:
        r = requests.get(url, headers={'User-Agent': 'VATSIM-FlightBoard/1.0'})
        data = r.json()
        
        print(f"Status Code: {r.status_code}")
        print(f"Items found: {len(data)}")
        
        if len(data) > 0:
            print("\n--- RAW JSON STRUCTURE (First Item) ---")
            # Dump the first item exactly as the API sends it
            print(json.dumps(data[0], indent=4))
            
            # Also check if there's a valid one with a stand further down
            for item in data:
                # print any item that looks like it has stand data
                if item.get('stand') or item.get('code') or item.get('allocation'):
                    print("\n--- ITEM WITH POTENTIAL STAND DATA ---")
                    print(json.dumps(item, indent=4))
                    break
        else:
            print("API returned an empty list.")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    debug_raw()