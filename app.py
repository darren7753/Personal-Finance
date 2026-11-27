import contextlib
import hmac
import json
import os
import tempfile
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from authlib.integrations.flask_client import OAuth
from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

BASE = Path(__file__).parent


def _load_env_file():
    """Read KEY=value lines from a local .env file (never uploaded). Real environment variables win."""
    f = BASE / ".env"
    if not f.exists():
        return
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env_file()

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)  # behind Vercel's proxy: keep https in generated URLs
app.secret_key = os.environ.get("SECRET_KEY", "local-dev-only-not-secret")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(os.environ.get("VERCEL")),
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 30,
)

DATABASE_URL = os.environ.get("DATABASE_URL")  # set on Vercel (Supabase); empty locally -> use data/*.json files
SITE_PASSWORD = os.environ.get("SITE_PASSWORD")
# Google sign-in is on only when all three are set. ALLOWED_EMAILS (comma separated) is required,
# otherwise any Google account could sign in.
GOOGLE_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
ALLOWED_EMAILS = {e.strip().lower() for e in os.environ.get("ALLOWED_EMAILS", "").split(",") if e.strip()}
GOOGLE_ENABLED = bool(GOOGLE_ID and GOOGLE_SECRET and ALLOWED_EMAILS)
GUEST_DEMO = os.environ.get("GUEST_DEMO", "1") != "0"  # "Try the demo" with random data; set GUEST_DEMO=0 to switch it off
ON_VERCEL = bool(os.environ.get("VERCEL"))
DATA = BASE / "data" / "state.json"
QUOTES = BASE / "data" / "quotes.json"
SLIPS_DIR = BASE / "secrets" / "slips"  # local copy of the salary slips: <yyyymm>.pdf (git-ignored). On the live site they are in the private Supabase table `slips`; `tools/sync_slips.py` (run automatically on git push) copies new ones there.
QUOTE_TTL = 10  # seconds: don't hit Yahoo more often than this unless ?refresh=1


# ---------- login ----------
oauth = OAuth(app)
if GOOGLE_ENABLED:
    oauth.register(
        name="google",
        client_id=GOOGLE_ID,
        client_secret=GOOGLE_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email"},
    )


@app.before_request
def require_login():
    if request.endpoint in ("static", "login", "auth_google", "auth_callback", "guest", "telegram_webhook"):  # the webhook checks Telegram's secret header itself
        return None
    if not SITE_PASSWORD and not GOOGLE_ENABLED:
        if ON_VERCEL:  # never serve finance data publicly without a login
            return "No login is configured on the server (set SITE_PASSWORD or the Google sign-in settings).", 503
        return None  # local use: no login needed
    if session.get("ok"):
        return None
    if session.get("guest"):  # demo visitors get the pages, never the real data (the demo data is made up in their browser)
        if request.path.startswith("/api/"):
            return jsonify(error="not available in demo mode"), 403
        return None
    if request.path.startswith("/api/"):
        return jsonify(error="login required"), 401
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    error = request.args.get("error")  # set by the Google sign-in routes
    if request.method == "POST":
        if SITE_PASSWORD and hmac.compare_digest(request.form.get("password", ""), SITE_PASSWORD):
            session.clear()
            session.permanent = True
            session["ok"] = True
            return redirect(url_for("index"))
        time.sleep(1)  # slow down password guessing
        error = "password"
    return (
        render_template(
            "login.html", error=error, google=GOOGLE_ENABLED, password=bool(SITE_PASSWORD), guest_enabled=GUEST_DEMO
        ),
        (401 if error else 200),
    )


@app.get("/auth/google")
def auth_google():
    if not GOOGLE_ENABLED:
        return redirect(url_for("login"))
    return oauth.google.authorize_redirect(url_for("auth_callback", _external=True), prompt="select_account")


@app.get("/auth/callback")
def auth_callback():
    if not GOOGLE_ENABLED:
        return redirect(url_for("login"))
    try:
        info = oauth.google.authorize_access_token().get("userinfo") or {}
    except Exception:
        return redirect(url_for("login", error="google"))
    if info.get("email_verified") and str(info.get("email", "")).lower() in ALLOWED_EMAILS:
        session.clear()
        session.permanent = True
        session["ok"] = True
        return redirect(url_for("index"))
    return redirect(url_for("login", error="denied"))


@app.post("/guest")
def guest():
    if not GUEST_DEMO:
        return redirect(url_for("login"))
    session.clear()
    session["guest"] = True  # not permanent: the demo ends when the browser is closed
    return redirect(url_for("index"))


@app.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


def _slip_months():
    if DATABASE_URL:
        with _db() as conn:
            return [r[0] for r in conn.execute("select ym from slips order by ym").fetchall()]
    return sorted(f.stem for f in SLIPS_DIR.glob("??????.pdf")) if SLIPS_DIR.is_dir() else []


@app.get("/api/slips")
def slips_list():
    """Months (yyyymm) that have a salary slip stored."""
    try:
        return jsonify(_slip_months())
    except Exception:
        return jsonify([])


@app.get("/api/slip/<ym>")
def slip(ym):
    if not (len(ym) == 6 and ym.isdigit()):
        return "Not found", 404
    if DATABASE_URL:
        with _db() as conn:
            row = conn.execute("select data from slips where ym = %s", [ym]).fetchone()
        data = bytes(row[0]) if row else None
    else:
        f = SLIPS_DIR / f"{ym}.pdf"
        data = f.read_bytes() if f.is_file() else None
    if data is None:
        return "Not found", 404
    resp = app.response_class(data, mimetype="application/pdf")
    resp.headers["Content-Disposition"] = f'inline; filename="salary-slip-{ym}.pdf"'
    resp.headers["Cache-Control"] = "private, no-store"
    return resp


@app.get("/")
def index():
    is_guest = bool(session.get("guest"))
    # the Log out button only makes sense when the site has a login (not in plain local use) or in demo mode
    return render_template("index.html", can_logout=bool(SITE_PASSWORD or GOOGLE_ENABLED) or is_guest, guest=is_guest)


# ---------- storage: Postgres (Supabase) when DATABASE_URL is set, otherwise local files ----------
_shared = threading.local()  # holds the one connection a Telegram update reuses (see shared_db)


def _connect():
    import psycopg

    # prepare_threshold=None: required by Supabase's transaction pooler
    return psycopg.connect(DATABASE_URL, prepare_threshold=None, connect_timeout=10)


class _KeepOpen:
    """Stands in for a connection inside `with _db() as conn:`: commits at the end of the block but does not close,
    so several steps of one Telegram update can share one connection (opening one is the slow part)."""

    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        (self.conn.rollback if exc_type else self.conn.commit)()
        return False


@contextlib.contextmanager
def shared_db():
    """Within this block every `_db()` call reuses one connection. Without a database (local files) it does nothing."""
    if not DATABASE_URL:
        yield
        return
    real = _connect()
    _shared.conn = _KeepOpen(real)
    try:
        yield
    finally:
        _shared.conn = None
        real.close()


def _db():
    return getattr(_shared, "conn", None) or _connect()


def _load_state():
    """Return the saved state (with its `_rev`) or None if nothing is saved yet."""
    if DATABASE_URL:
        with _db() as conn:
            row = conn.execute("select rev, data from app_state where id = 1").fetchone()
        if row is None:
            return None
        state = row[1]
        state["_rev"] = row[0]
        return state
    if DATA.exists():
        return json.loads(DATA.read_text(encoding="utf-8"))
    return None


def _save_state(new, current_rev, is_first):
    """Save and return the new revision, or None if another tab saved first (stale)."""
    if DATABASE_URL:
        from psycopg.types.json import Jsonb

        with _db() as conn:
            if is_first:
                cur = conn.execute(
                    "insert into app_state (id, rev, data) values (1, 1, %s) on conflict do nothing returning rev",
                    [Jsonb(new)],
                )
            else:
                cur = conn.execute(
                    "update app_state set data = %s, rev = rev + 1, updated_at = now() "
                    "where id = 1 and rev = %s returning rev",
                    [Jsonb(new), current_rev],
                )
            row = cur.fetchone()
        return row[0] if row else None
    new["_rev"] = current_rev + 1
    DATA.parent.mkdir(exist_ok=True)
    DATA.write_text(json.dumps(new, indent=2), encoding="utf-8")
    return new["_rev"]


@app.get("/api/state")
def get_state():
    state = _load_state()
    if state is not None:
        state.setdefault("_rev", 0)
    return jsonify(state)


@app.put("/api/state")
def put_state():
    """Save the whole state. Each save bumps `_rev`; a tab holding an older revision is refused
    so a stale tab can never overwrite newer data."""
    new = request.get_json()
    current = _load_state()
    current_rev = (current or {}).get("_rev", 0)
    if current is not None and new.get("_rev") != current_rev:
        return jsonify(error="stale", rev=current_rev), 409
    rev = _save_state(new, current_rev, is_first=current is None)
    if rev is None:  # someone saved between our read and write
        return jsonify(error="stale", rev=current_rev), 409
    return jsonify(ok=True, rev=rev)


def _load_quotes(symbols):
    if DATABASE_URL:
        if not symbols:
            return {}
        with _db() as conn:
            rows = conn.execute(
                "select symbol, price, prev, ts from quotes where symbol = any(%s)", [symbols]
            ).fetchall()
        return {r[0]: {"price": r[1], "prev": r[2], "ts": r[3]} for r in rows}
    if QUOTES.exists():
        try:
            return json.loads(QUOTES.read_text(encoding="utf-8"))
        except ValueError:
            pass
    return {}


def _save_quotes(cache, updated):
    if not updated:
        return
    if DATABASE_URL:
        with _db() as conn:
            for s in updated:
                q = cache[s]
                conn.execute(
                    "insert into quotes (symbol, price, prev, ts) values (%s, %s, %s, %s) "
                    "on conflict (symbol) do update set price = excluded.price, prev = excluded.prev, ts = excluded.ts",
                    [s, q["price"], q["prev"], q["ts"]],
                )
        return
    QUOTES.parent.mkdir(exist_ok=True)
    QUOTES.write_text(json.dumps(cache), encoding="utf-8")


TREASURY_API = "https://webv2-api.treasury.id/api/v1/external/wp/gold/price"  # the same data behind the chart on treasury.id


def _treasury_gold():
    """Treasury's own gold price per gram: the latest buy and sell price, plus the first of the last 24 hours."""
    now = datetime.now(timezone(timedelta(hours=7)))  # Jakarta time, as the website sends it
    fmt = lambda d: d.strftime("%Y-%m-%d %H:%M:%S")  # noqa: E731
    body = json.dumps(
        {"start_date": fmt(now - timedelta(days=1)), "end_date": fmt(now), "type": "daily", "region": "id", "assetType": "gold"}
    ).encode()
    req = urllib.request.Request(
        TREASURY_API, data=body, headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (personal finance site)"}
    )
    with urllib.request.urlopen(req, timeout=8) as r:
        prices = json.load(r)["data"]["attributes"]["prices"]
    first, last = prices[0], prices[-1]
    # Treasury stamps each price with its own time, like "27/11/26 - 20:14" (Jakarta time); it only publishes a new one every few minutes
    asof = datetime.strptime(last["datetime"], "%d/%m/%y - %H:%M").replace(tzinfo=timezone(timedelta(hours=7))).timestamp()
    return {
        "TREASURY_BUY": (float(last["buy_price"]), float(first["buy_price"]), asof),
        "TREASURY_SELL": (float(last["sell_price"]), float(first["sell_price"]), asof),
    }


@app.get("/api/quotes")
def quotes():
    """Latest prices: stocks and gold futures from Yahoo Finance (unofficial, via yfinance), gold per gram from Treasury.
    Falls back to the last saved price."""
    symbols = [s.strip().upper() for s in request.args.get("symbols", "").split(",") if s.strip()]
    refresh = request.args.get("refresh") == "1"
    cache, now, out, updated = _load_quotes(symbols), time.time(), {}, []
    treasury = None  # one Treasury request fills both its buy and sell price
    for s in symbols:
        c = cache.get(s)
        if c and not refresh and now - c.get("ts", 0) < QUOTE_TTL:
            out[s] = {**c, "stale": False}
            continue
        try:
            if s in ("TREASURY_BUY", "TREASURY_SELL"):
                treasury = treasury or _treasury_gold()
                # ts is the time Treasury stamped on the price (not now), so the page can show it; it also means Treasury is asked again on every call
                q = {"price": treasury[s][0], "prev": treasury[s][1], "ts": treasury[s][2]}
            else:
                import yfinance as yf

                if ON_VERCEL:  # the only writable folder on Vercel is the temp folder
                    yf.set_tz_cache_location(os.path.join(tempfile.gettempdir(), "yf-cache"))
                info = yf.Ticker(s).fast_info
                q = {"price": float(info["last_price"]), "prev": float(info["previous_close"]), "ts": now}
            cache[s] = q
            updated.append(s)
            out[s] = {**q, "stale": False}
        except Exception:
            if c:
                out[s] = {**c, "stale": True}
    _save_quotes(cache, updated)
    return jsonify(out)


# ---------- snapshot of the Dashboard diagram (the picture the Telegram bot sends) ----------
# The browser draws the picture (static/js/snapshot.js) and uploads it here; only the newest one is kept, with the time it
# was taken and the data revision (`rev`) it shows, so the bot can say when the data has changed since.
SNAP_PNG = BASE / "data" / "snapshot.png"
SNAP_META = BASE / "data" / "snapshot.json"
SNAP_MAX = 3_800_000  # bytes; Vercel refuses request bodies above 4.5 MB


def _snap_get(with_png=True):
    """The saved snapshot as {png, rev, sig, label, taken_at (UTC datetime)}, or None."""
    from datetime import datetime, timezone

    if DATABASE_URL:
        cols = "png, rev, sig, label, taken_at" if with_png else "null, rev, sig, label, taken_at"
        with _db() as conn:
            row = conn.execute(f"select {cols} from snapshot where id = 1").fetchone()
        if row is None:
            return None
        return {"png": bytes(row[0]) if row[0] is not None else None, "rev": row[1], "sig": row[2], "label": row[3], "taken_at": row[4]}
    if not (SNAP_META.exists() and SNAP_PNG.exists()):
        return None
    m = json.loads(SNAP_META.read_text(encoding="utf-8"))
    taken = datetime.fromtimestamp(m["taken"], timezone.utc)
    return {"png": SNAP_PNG.read_bytes() if with_png else None, "rev": m["rev"], "sig": m["sig"], "label": m["label"], "taken_at": taken}


def _snap_put(png, rev, sig, label):
    """Save the picture unless the saved one shows newer data (a higher `rev`). Returns True when saved."""
    if DATABASE_URL:
        with _db() as conn:
            cur = conn.execute(
                "insert into snapshot (id, png, rev, sig, label, taken_at) values (1, %s, %s, %s, %s, now()) "
                "on conflict (id) do update set png = excluded.png, rev = excluded.rev, sig = excluded.sig, "
                "label = excluded.label, taken_at = now() where snapshot.rev <= excluded.rev returning 1",
                [png, rev, sig, label],
            )
            return cur.fetchone() is not None
    old = _snap_get(with_png=False)
    if old and old["rev"] > rev:
        return False
    SNAP_PNG.parent.mkdir(exist_ok=True)
    SNAP_PNG.write_bytes(png)
    SNAP_META.write_text(json.dumps({"rev": rev, "sig": sig, "label": label, "taken": time.time()}), encoding="utf-8")
    return True


@app.put("/api/snapshot")
def put_snapshot():
    if (request.content_length or 0) > SNAP_MAX:
        return jsonify(error="picture too large"), 413
    png = request.get_data()
    if not png.startswith(b"\x89PNG\r\n\x1a\n") or len(png) > SNAP_MAX:
        return jsonify(error="not a PNG picture"), 400
    ok = _snap_put(png, request.args.get("rev", 0, type=int), request.args.get("sig", "")[:64], request.args.get("label", "")[:60])
    return jsonify(ok=ok), (200 if ok else 409)


@app.get("/api/snapshot/meta")
def snapshot_meta():
    s = _snap_get(with_png=False)
    return jsonify(sig=s["sig"] if s else "", rev=s["rev"] if s else 0, taken_at=s["taken_at"].isoformat() if s else None)


# ---------- Telegram bot (spending only; see telegram_bot.py) ----------
import telegram_bot  # noqa: E402

telegram_bot.configure(_load_state, _save_state, _db if DATABASE_URL else None, BASE, shared_db, _snap_get)


@app.post("/telegram/webhook")
def telegram_webhook():
    """Telegram calls this for every message. Only calls carrying our secret header are accepted;
    the bot itself then only answers the Telegram user IDs in TELEGRAM_ALLOWED_IDS."""
    if not telegram_bot.verify(request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")):
        return "", 403
    try:
        telegram_bot.handle_update(request.get_json(silent=True) or {})
    except Exception:
        app.logger.exception("telegram update failed")
    return "", 200  # always 200, otherwise Telegram keeps resending the same update


if __name__ == "__main__":
    app.run(debug=True, port=5000)
