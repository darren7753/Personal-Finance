"""Backup: copy the live data from Supabase into data/state.json (one-way, live -> local).

Run from the project folder:
    uv run python tools/pull_state.py

Needs the Supabase connection string in the .env file under the name BACKUP_DATABASE_URL
(a different name from DATABASE_URL on purpose: DATABASE_URL would make your local app
read and write the live data). The existing data/state.json is first saved as
data/state.backup.json, so one step back is always possible.
"""
import json
import os
import shutil
import sys
from pathlib import Path

import psycopg

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
import app  # noqa: E402,F401  (loads .env as a side effect)

url = os.environ.get("BACKUP_DATABASE_URL") or os.environ.get("DATABASE_URL")
if not url:
    sys.exit("BACKUP_DATABASE_URL is not set. Add it to the .env file first.")

with psycopg.connect(url, prepare_threshold=None, connect_timeout=10) as conn:
    row = conn.execute("select rev, data from app_state where id = 1").fetchone()
if row is None:
    sys.exit("The database has no saved data yet. Nothing changed.")

state = row[1]
state["_rev"] = row[0]
target = BASE / "data" / "state.json"
target.parent.mkdir(exist_ok=True)
if target.exists():
    shutil.copy2(target, target.with_name("state.backup.json"))
target.write_text(json.dumps(state, indent=2), encoding="utf-8")
print(f"Saved the live data (revision {row[0]}) to data/state.json. The previous file is data/state.backup.json.")
