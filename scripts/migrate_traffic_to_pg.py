#!/usr/bin/env python3
"""
One-off migration: traffic_stats.json → PostgreSQL

Safe to re-run (idempotent):
  - Totals: ON CONFLICT DO UPDATE with greatest values
  - Daily / path_views / airport_joins: ON CONFLICT DO UPDATE with greatest values
  - Visitors: ON CONFLICT DO NOTHING (won't clobber live data)

Usage:
    DATABASE_URL=postgresql://flightboard:PASSWORD@10.29.29.139/flightboard \
        python3 scripts/migrate_traffic_to_pg.py
"""

import json
import os
import sys
import psycopg2

JSON_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'traffic_stats.json')
DATABASE_URL = os.environ.get('DATABASE_URL')


def load_json():
    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def migrate(conn, data):
    totals = data.get('totals', {})
    daily = data.get('daily', [])
    first_seen = data.get('visitor_first_seen', {})
    last_seen = data.get('visitor_last_seen', {})

    with conn.cursor() as cur:
        # --- Totals ---
        cur.execute("""
            INSERT INTO traffic_totals (id, page_views, unique_visitors, airport_joins, updated_at)
            VALUES (1, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                page_views      = GREATEST(traffic_totals.page_views,      EXCLUDED.page_views),
                unique_visitors = GREATEST(traffic_totals.unique_visitors,  EXCLUDED.unique_visitors),
                airport_joins   = GREATEST(traffic_totals.airport_joins,    EXCLUDED.airport_joins),
                updated_at      = GREATEST(traffic_totals.updated_at,       EXCLUDED.updated_at)
        """, (
            int(totals.get('page_views', 0) or 0),
            int(totals.get('unique_visitors', 0) or 0),
            int(totals.get('airport_joins', 0) or 0),
            int(data.get('updated_at', 0) or 0),
        ))
        print(f"  Totals upserted: page_views={totals.get('page_views')}, "
              f"unique_visitors={totals.get('unique_visitors')}, "
              f"airport_joins={totals.get('airport_joins')}")

        # --- Daily rows ---
        daily_count = 0
        path_count = 0
        airport_count = 0
        for item in daily:
            date_str = item.get('date', '')
            if not date_str:
                continue

            cur.execute("""
                INSERT INTO traffic_daily (date, page_views, unique_visitors, airport_joins)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (date) DO UPDATE SET
                    page_views      = GREATEST(traffic_daily.page_views,      EXCLUDED.page_views),
                    unique_visitors = GREATEST(traffic_daily.unique_visitors,  EXCLUDED.unique_visitors),
                    airport_joins   = GREATEST(traffic_daily.airport_joins,    EXCLUDED.airport_joins)
            """, (
                date_str,
                int(item.get('page_views', 0) or 0),
                int(item.get('unique_visitors', 0) or 0),
                int(item.get('airport_joins', 0) or 0),
            ))
            daily_count += 1

            for path, views in (item.get('path_views') or {}).items():
                cur.execute("""
                    INSERT INTO traffic_path_views (date, path, views)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (date, path) DO UPDATE SET
                        views = GREATEST(traffic_path_views.views, EXCLUDED.views)
                """, (date_str, path, int(views or 0)))
                path_count += 1

            for icao, joins in (item.get('airport_joins_by_icao') or {}).items():
                cur.execute("""
                    INSERT INTO traffic_airport_joins (date, icao, joins)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (date, icao) DO UPDATE SET
                        joins = GREATEST(traffic_airport_joins.joins, EXCLUDED.joins)
                """, (date_str, icao, int(joins or 0)))
                airport_count += 1

        print(f"  Daily rows: {daily_count}, path_views rows: {path_count}, airport_joins rows: {airport_count}")

        # --- Visitors ---
        visitor_count = 0
        skipped = 0
        for vid, fs in first_seen.items():
            ls = last_seen.get(vid, fs)
            cur.execute("""
                INSERT INTO traffic_visitors (visitor_id, first_seen, last_seen)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (str(vid)[:32], fs, ls))
            if cur.rowcount:
                visitor_count += 1
            else:
                skipped += 1
        print(f"  Visitors inserted: {visitor_count}, already existed (skipped): {skipped}")

    conn.commit()


def main():
    if not DATABASE_URL:
        print("ERROR: DATABASE_URL environment variable is not set.", file=sys.stderr)
        print("Usage: DATABASE_URL=postgresql://... python3 scripts/migrate_traffic_to_pg.py", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(JSON_PATH):
        print(f"ERROR: JSON file not found: {JSON_PATH}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading {JSON_PATH} ...")
    data = load_json()
    print(f"Connecting to PostgreSQL ...")
    conn = psycopg2.connect(DATABASE_URL)
    try:
        print("Migrating ...")
        migrate(conn, data)
        print("Done. Migration complete.")
    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == '__main__':
    main()
