# OSM Stand Import Guide

This guide explains how to use the Python importer script to pull stand coordinates from OpenStreetMap (Overpass) for any airport and convert them to this project format.

## Script Location

- `scripts/import_osm_stands.py`

## What It Produces

- Project stand format entries:
  - `name`
  - `lat`
  - `lon`
  - `radius` (default `35`)
  - `type` (`contact` / `remote`)

## Basic Workflow

1. Generate a standalone file (recommended first):
   ```bash
   python3 scripts/import_osm_stands.py --icao EHAM --output static/eham_stands.generated.json
   ```

2. Review and manually refine the generated output if needed.

3. Merge into main stands file:
   - Option A (automatic merge by script):
     ```bash
     python3 scripts/import_osm_stands.py --icao EHAM --update-stands-json --stands-path static/stands.json
     ```
   - Option B (manual copy/merge), if you want stricter control over formatting/content.

## Useful Flags

- `--icao XXXX`  
  ICAO code to import (default: `EHAM`).

- `--output path.json`  
  Standalone output file path.

- `--update-stands-json`  
  Replace/add the airport block directly in `stands.json`.

- `--stands-path static/stands.json`  
  Target stands file when using `--update-stands-json`.

- `--overpass-url URL`  
  Use a different Overpass instance if needed.

- `--timeout 60`  
  HTTP timeout in seconds.

## Notes About Accuracy

- OSM is usually very good, but not perfect.
- Best practice:
  1. Import from OSM.
  2. Compare with airport charts.
  3. Manually correct outliers/missing stands.

## EHAM-Specific Filter

The script currently includes an EHAM-specific prefix filter to keep only stand families used on your Schiphol chart:

- Allowed: `A, B, C, D, E, F, G, H, J, K, M, P, R, S, U, Y`

If you import other airports, no such airport-specific filter is applied unless you add one in:

- `apply_airport_specific_filters()` in `scripts/import_osm_stands.py`

## License / Attribution

OSM-derived data is from OpenStreetMap contributors (ODbL).  
Keep attribution when using imported datasets.
