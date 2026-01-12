from ukcp_stand_fetcher import UKCPStandFetcher
import json

def test_ukcp():
    print("--- STARTING UKCP API TEST ---")
    fetcher = UKCPStandFetcher()
    
    print(f"Fetching from: {fetcher.api_url}")
    
    # Force a fetch
    data = fetcher.fetch_stand_assignments()
    
    # 1. Check if we got ANY data
    if not data:
        print("❌ RESULT: No data returned (Empty Dictionary)")
        print("Possible causes: API down, connection blocked, or no assignments exists network-wide.")
        return

    print(f"✅ RESULT: Successfully fetched {len(data)} assignments.")
    
    # 2. Look specifically for EGKK (Gatwick)
    print("\n--- SEARCHING FOR EGKK ASSIGNMENTS ---")
    egkk_found = False
    for callsign, info in data.items():
        if info['airport'] == 'EGKK':
            egkk_found = True
            print(f"✈️  {callsign}: Stand {info['stand']} (Type: {info['type']})")
    
    if not egkk_found:
        print("⚠️  No assignments found specifically for EGKK right now.")
    
    # 3. Dump a sample of the raw data to check format
    print("\n--- RAW DATA SAMPLE (First item) ---")
    first_key = next(iter(data))
    print(json.dumps({first_key: data[first_key]}, indent=2))

if __name__ == "__main__":
    test_ukcp()