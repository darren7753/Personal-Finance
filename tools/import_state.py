"""One-time import: copy data/state.json into the Supabase database.

Run from the project folder, with DATABASE_URL set in the .env file:
    uv run python tools/import_state.py

It refuses to overwrite data that is already in the database (pass --force to replace it).
"""
import json
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
import app  # noqa: E402  (loads .env as a side effect)

if not app.DATABASE_URL:
    sys.exit("DATABASE_URL is not set. Add it to the .env file first.")

state = json.loads((BASE / "data" / "state.json").read_text(encoding="utf-8"))
rev = int(state.get("_rev", 0)) + 1  # +1 so any tab still open on the old data is treated as stale

with psycopg.connect(app.DATABASE_URL, prepare_threshold=None) as conn:
    exists = conn.execute("select rev from app_state where id = 1").fetchone()
    if exists and "--force" not in sys.argv:
        sys.exit(f"The database already has data (revision {exists[0]}). Nothing changed. Use --force to replace it.")
    conn.execute(
        "insert into app_state (id, rev, data) values (1, %s, %s) "
        "on conflict (id) do update set rev = excluded.rev, data = excluded.data, updated_at = now()",
        [rev, Jsonb(state)],
    )
print(f"Imported data/state.json into the database (revision {rev}).")
