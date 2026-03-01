# PostgreSQL Traffic Stats — Setup Guide

## Background

Traffic stats were migrated from `data/traffic_stats.json` to PostgreSQL on 2026-03-01.
The app code (`app.py`) is already updated and deployed. The service starts cleanly but
logs a warning and skips traffic recording until the database credentials are configured.

---

## What is already done

- `psycopg2` installed on the app server (`apt install python3-psycopg2`, v2.9.10)
- `app.py` updated: all JSON traffic functions removed, replaced with PostgreSQL equivalents
- `_init_db()` auto-creates all 5 tables on first successful connection
- DB errors are caught gracefully — the app stays up even if the DB is unreachable
- `/etc/systemd/system/flightboard.service` has the `DATABASE_URL` line with a placeholder password
- Migration script ready at `scripts/migrate_traffic_to_pg.py`

---

## Steps still to complete

### Step 1 — Create the database user and database (on the PostgreSQL VM)

SSH into `10.29.29.139` and run as the `postgres` superuser:

```bash
sudo -u postgres psql
```

```sql
CREATE USER flightboard WITH PASSWORD 'yourpassword';
CREATE DATABASE flightboard OWNER flightboard;
\q
```

Replace `yourpassword` with the actual password you choose.

---

### Step 2 — Set the real password in the service file (on the app server)

Edit `/etc/systemd/system/flightboard.service` and replace `CHANGE_ME`:

```ini
Environment="DATABASE_URL=postgresql://flightboard:yourpassword@10.29.29.139/flightboard"
```

The line is already present — only the password needs updating.

---

### Step 3 — Reload systemd and restart the app

```bash
systemctl daemon-reload
systemctl restart flightboard
```

On startup, `_init_db()` will connect to PostgreSQL and create all 5 tables automatically:

- `traffic_totals` — single-row running totals
- `traffic_daily` — one row per UTC day
- `traffic_path_views` — page path hit counts per day
- `traffic_airport_joins` — per-ICAO join counts per day
- `traffic_visitors` — visitor_id → first_seen / last_seen

Check the logs to confirm a clean start:

```bash
journalctl -u flightboard -n 30 --no-pager
```

Expected log line: `PostgreSQL traffic DB initialised.`

If you still see the auth error, the password or DATABASE_URL is wrong — double-check
Step 2 and re-run Step 3.

---

### Step 4 — Verify tables were created

```bash
psql postgresql://flightboard:yourpassword@10.29.29.139/flightboard -c "\dt"
```

Expected output — five tables:

```
              List of relations
 Schema |          Name           | Type  |    Owner
--------+-------------------------+-------+-------------
 public | traffic_airport_joins   | table | flightboard
 public | traffic_daily           | table | flightboard
 public | traffic_path_views      | table | flightboard
 public | traffic_totals          | table | flightboard
 public | traffic_visitors        | table | flightboard
```

---

### Step 5 — Migrate historical data from JSON

The JSON file contains ~11 days of history. Run the migration script once:

```bash
cd /opt/flight-board
DATABASE_URL=postgresql://flightboard:yourpassword@10.29.29.139/flightboard \
    python3 scripts/migrate_traffic_to_pg.py
```

The script is idempotent — safe to re-run. It uses `ON CONFLICT DO UPDATE` with `GREATEST()`
for numeric columns, and `ON CONFLICT DO NOTHING` for visitors (so re-running won't clobber
any live visitor data already written by the app).

Expected output:

```
Loading /opt/flight-board/data/traffic_stats.json ...
Connecting to PostgreSQL ...
Migrating ...
  Totals upserted: page_views=8577, unique_visitors=4133, airport_joins=12684
  Daily rows: 11, path_views rows: NNN, airport_joins rows: NNN
  Visitors inserted: NNNN, already existed (skipped): 0
Done. Migration complete.
```

---

### Step 6 — Verify the migrated data

```bash
# Totals match the JSON?
psql postgresql://flightboard:yourpassword@10.29.29.139/flightboard \
    -c "SELECT * FROM traffic_totals;"

# 11 daily rows present?
psql postgresql://flightboard:yourpassword@10.29.29.139/flightboard \
    -c "SELECT date, page_views, unique_visitors, airport_joins FROM traffic_daily ORDER BY date;"

# Live write test — load the site in a browser, then:
psql postgresql://flightboard:yourpassword@10.29.29.139/flightboard \
    -c "SELECT page_views FROM traffic_daily WHERE date = CURRENT_DATE;"
# Should increment each time you load a page.

# Admin API shape correct?
curl -s http://localhost:5000/api/admin/traffic_stats \
    -H "Cookie: session=ADMIN_SESSION" | python3 -m json.tool
```

---

### Step 7 — Commit the code changes

The following files were modified and should be committed:

```
app.py
scripts/migrate_traffic_to_pg.py   (new file)
docs/postgres_setup.md             (this file)
```

Do **not** commit:
- `/etc/systemd/system/flightboard.service` (contains credentials, lives outside the repo)
- `data/traffic_stats.json` (already in `.gitignore` / excluded per CLAUDE.md)

```bash
cd /opt/flight-board
git add app.py scripts/migrate_traffic_to_pg.py docs/postgres_setup.md
git commit -m "traffic stats: migrate from JSON file to PostgreSQL"
```

---

## Schema reference

```sql
-- Single-row running totals
CREATE TABLE traffic_totals (
    id              INTEGER PRIMARY KEY DEFAULT 1,
    page_views      BIGINT  NOT NULL DEFAULT 0,
    unique_visitors BIGINT  NOT NULL DEFAULT 0,
    airport_joins   BIGINT  NOT NULL DEFAULT 0,
    updated_at      BIGINT  NOT NULL DEFAULT 0,   -- Unix timestamp
    CONSTRAINT single_row CHECK (id = 1)
);

-- One row per UTC day
CREATE TABLE traffic_daily (
    date             DATE    PRIMARY KEY,
    page_views       INTEGER NOT NULL DEFAULT 0,
    unique_visitors  INTEGER NOT NULL DEFAULT 0,
    airport_joins    INTEGER NOT NULL DEFAULT 0
);

-- Per-path hit counts per day
CREATE TABLE traffic_path_views (
    date   DATE    NOT NULL,
    path   TEXT    NOT NULL,
    views  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, path)
);

-- Per-ICAO join counts per day
CREATE TABLE traffic_airport_joins (
    date   DATE        NOT NULL,
    icao   VARCHAR(4)  NOT NULL,
    joins  INTEGER     NOT NULL DEFAULT 0,
    PRIMARY KEY (date, icao)
);

-- Visitor deduplication (capped at MAX_TRACKED_VISITORS = 20 000)
CREATE TABLE traffic_visitors (
    visitor_id  CHAR(32) PRIMARY KEY,
    first_seen  DATE     NOT NULL,
    last_seen   DATE     NOT NULL
);
CREATE INDEX idx_visitors_last_seen ON traffic_visitors (last_seen);
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `password authentication failed` in logs | Wrong password in `DATABASE_URL` | Re-check Step 2, daemon-reload, restart |
| `connection refused` or timeout | PG not listening / firewall | Check `pg_hba.conf` allows connections from the app server IP; check `postgresql.conf` `listen_addresses` |
| `role "flightboard" does not exist` | Step 1 not done | Run the `CREATE USER` SQL on the PG VM |
| `database "flightboard" does not exist` | Step 1 partial | Run `CREATE DATABASE flightboard OWNER flightboard;` |
| Admin panel shows `{"error": "DATABASE_URL not configured"}` | `DATABASE_URL` env var missing | Check service file, daemon-reload, restart |
| Totals don't increment after migration | `_init_db()` error on startup | Check logs; fix connection, restart |
