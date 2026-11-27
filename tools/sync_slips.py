"""Copy new or changed salary slips to the private `slips` table in the live database.

Put a slip PDF in  secrets/slips/  named <yyyymm>.pdf  (for example 202612.pdf; the original name SlipGaji202612_....pdf also works, it is renamed). Then run this, or just `git push`:
the pre-push hook (tools/hooks/pre-push) runs it. Slips are never committed to git.

Needs SLIPS_DATABASE_URL in .env (the same Transaction pooler string as DATABASE_URL on Vercel). It has a different name on purpose:
a plain DATABASE_URL in .env would make the local site use the live database. Without it this tool only says so and does nothing.
"""
import hashlib
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / "secrets" / "slips"


def env(name):
    if os.environ.get(name):
        return os.environ[name]
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def month_of(name):
    m = re.fullmatch(r"(\d{6})\.pdf", name) or re.fullmatch(r"SlipGaji(\d{6})_.*\.pdf", name)
    return m.group(1) if m else None


def main():
    LOCAL.mkdir(parents=True, exist_ok=True)
    files = {month_of(f.name): f for f in LOCAL.glob("*.pdf") if month_of(f.name)}
    for f in LOCAL.glob("SlipGaji*.pdf"):  # a long-named file dropped here is renamed to <yyyymm>.pdf
        ym = month_of(f.name)
        if ym and not (LOCAL / f"{ym}.pdf").exists():
            f.rename(LOCAL / f"{ym}.pdf")
            files[ym] = LOCAL / f"{ym}.pdf"
    url = env("SLIPS_DATABASE_URL")
    if not url:
        print("slips: SLIPS_DATABASE_URL is not set in .env, so nothing was sent to the live site.")
        return
    import psycopg

    sent = 0
    with psycopg.connect(url, prepare_threshold=None, connect_timeout=10) as conn:
        have = dict(conn.execute("select ym, md5(data) from slips").fetchall())
        for ym, f in sorted(files.items()):
            data = f.read_bytes()
            if not data.startswith(b"%PDF"):
                print(f"slips: {f.name} is not a PDF, skipped")
                continue
            if have.get(ym) == hashlib.md5(data).hexdigest():
                continue
            conn.execute(
                "insert into slips (ym, data) values (%s, %s) on conflict (ym) do update set data = excluded.data, updated_at = now()",
                [ym, data],
            )
            sent += 1
            print(f"slips: uploaded {ym}")
    print(f"slips: {sent} uploaded, {len(files) - sent} already up to date")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # never block a git push because of the slips
        print("slips: skipped,", e)
    sys.exit(0)
