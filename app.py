import hmac
import json
import os
import tempfile
import time
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
ON_VERCEL = bool(os.environ.get("VERCEL"))
DATA = BASE / "data" / "state.json"
QUOTES = BASE / "data" / "quotes.json"
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
    if request.endpoint in ("static", "login", "auth_google", "auth_callback"):
        return None
    if not SITE_PASSWORD and not GOOGLE_ENABLED:
        if ON_VERCEL:  # never serve finance data publicly without a login
            return "No login is configured on the server (set SITE_PASSWORD or the Google sign-in settings).", 503
        return None  # local use: no login needed
    if session.get("ok"):
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
        render_template("login.html", error=error, google=GOOGLE_ENABLED, password=bool(SITE_PASSWORD)),
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


@app.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.get("/")
def index():
    return render_template("index.html")


# ---------- storage: Postgres (Supabase) when DATABASE_URL is set, otherwise local files ----------
def _db():
    import psycopg

    # prepare_threshold=None: required by Supabase's transaction pooler
    return psycopg.connect(DATABASE_URL, prepare_threshold=None, connect_timeout=10)


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


@app.get("/api/quotes")
def quotes():
    """Latest prices from Yahoo Finance (unofficial, via yfinance). Falls back to the last saved price."""
    symbols = [s.strip().upper() for s in request.args.get("symbols", "").split(",") if s.strip()]
    refresh = request.args.get("refresh") == "1"
    cache, now, out, updated = _load_quotes(symbols), time.time(), {}, []
    for s in symbols:
        c = cache.get(s)
        if c and not refresh and now - c.get("ts", 0) < QUOTE_TTL:
            out[s] = {**c, "stale": False}
            continue
        try:
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


if __name__ == "__main__":
    app.run(debug=True, port=5000)
