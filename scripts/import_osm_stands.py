#!/usr/bin/env python3
"""
Import airport stand positions from OpenStreetMap (Overpass API) and convert them
to the project's stand schema.

Default behavior generates an isolated output file for manual QA/fixes first.
Optionally, you can merge the result directly into static/stands.json.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests


DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
DEFAULT_OUTPUT_PATH = Path("static/eham_stands.generated.json")
DEFAULT_STANDS_PATH = Path("static/stands.json")
EHAM_ALLOWED_PREFIXES = set("ABCDEFGHJKMPRSUY")


def build_query(icao: str) -> str:
    return f"""
[out:json][timeout:120];
area["icao"="{icao}"]["aeroway"="aerodrome"]->.airport;
(
  node["aeroway"="parking_position"](area.airport);
  way["aeroway"="parking_position"](area.airport);
  relation["aeroway"="parking_position"](area.airport);
);
out center tags;
""".strip()


def fetch_overpass(query: str, overpass_url: str, timeout_s: int) -> Dict:
    response = requests.post(
        overpass_url,
        data={"data": query},
        timeout=timeout_s,
        headers={"User-Agent": "flight-board-osm-stand-importer/1.0"},
    )
    response.raise_for_status()
    return response.json()


def normalize_stand_name(raw_name: str) -> str:
    name = raw_name.strip().upper()
    name = re.sub(r"\s+", "", name)
    return name


def pick_name(tags: Dict[str, str]) -> Optional[str]:
    for key in ("ref", "name", "local_ref"):
        value = tags.get(key)
        if value:
            normalized = normalize_stand_name(value)
            if normalized and normalized not in {"0", "00"}:
                return normalized
    return None


def classify_stand(tags: Dict[str, str]) -> str:
    lower_blob = " ".join(f"{k}={v}" for k, v in tags.items()).lower()
    if any(token in lower_blob for token in ("remote", "cargo", "general_aviation", "ga")):
        return "remote"
    return "contact"


def element_lat_lon(element: Dict) -> Tuple[Optional[float], Optional[float]]:
    lat = element.get("lat")
    lon = element.get("lon")
    if lat is not None and lon is not None:
        return float(lat), float(lon)

    center = element.get("center") or {}
    lat = center.get("lat")
    lon = center.get("lon")
    if lat is not None and lon is not None:
        return float(lat), float(lon)

    return None, None


def convert_elements(elements: List[Dict]) -> Tuple[List[Dict], int]:
    stands_by_name: Dict[str, Dict] = {}
    skipped = 0

    for element in elements:
        tags = element.get("tags") or {}
        name = pick_name(tags)
        if not name:
            skipped += 1
            continue

        lat, lon = element_lat_lon(element)
        if lat is None or lon is None:
            skipped += 1
            continue

        # Keep first occurrence for deterministic behavior.
        if name in stands_by_name:
            continue

        stands_by_name[name] = {
            "name": name,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "radius": 35,
            "type": classify_stand(tags),
        }

    stands = sorted(stands_by_name.values(), key=lambda s: s["name"])
    return stands, skipped


def write_generated_output(output_path: Path, icao: str, stands: List[Dict]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "OpenStreetMap Overpass (aeroway=parking_position)",
        "license_note": "Data from OpenStreetMap contributors (ODbL).",
        "icao": icao,
        "count": len(stands),
        "stands": stands,
    }
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def merge_into_stands_json(stands_path: Path, icao: str, stands: List[Dict]) -> None:
    data = json.loads(stands_path.read_text(encoding="utf-8"))
    data[icao] = stands
    stands_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def apply_airport_specific_filters(icao: str, stands: List[Dict]) -> List[Dict]:
    # EHAM chart convention: only specific stand families are in use.
    if icao == "EHAM":
        stands = [s for s in stands if s["name"] and s["name"][0] in EHAM_ALLOWED_PREFIXES]
    return stands


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import airport stands from OSM Overpass.")
    parser.add_argument("--icao", default="EHAM", help="Airport ICAO code (default: EHAM).")
    parser.add_argument(
        "--overpass-url",
        default=DEFAULT_OVERPASS_URL,
        help=f"Overpass endpoint (default: {DEFAULT_OVERPASS_URL})",
    )
    parser.add_argument(
        "--output",
        default=None,
        help=(
            "Generated output path. Defaults to "
            f"{DEFAULT_OUTPUT_PATH} unless --update-stands-json is used."
        ),
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
        help="HTTP timeout seconds (default: 60).",
    )
    parser.add_argument(
        "--update-stands-json",
        action="store_true",
        help=f"Also write/replace ICAO block in {DEFAULT_STANDS_PATH}.",
    )
    parser.add_argument(
        "--stands-path",
        default=str(DEFAULT_STANDS_PATH),
        help=f"Path to master stands JSON (default: {DEFAULT_STANDS_PATH}).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    icao = args.icao.upper().strip()
    output_path = Path(args.output) if args.output else None
    if output_path is None and not args.update_stands_json:
        output_path = DEFAULT_OUTPUT_PATH
    stands_path = Path(args.stands_path)

    query = build_query(icao)
    payload = fetch_overpass(query, args.overpass_url, args.timeout)
    stands, skipped = convert_elements(payload.get("elements", []))
    stands = apply_airport_specific_filters(icao, stands)

    if output_path is not None:
        write_generated_output(output_path, icao, stands)
        print(f"Generated {len(stands)} stands for {icao} -> {output_path}")
    print(f"Skipped elements without usable name/coords: {skipped}")

    if args.update_stands_json:
        merge_into_stands_json(stands_path, icao, stands)
        print(f"Updated {stands_path} with {icao} stands.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
