"""Telegram bot for Darren's Finance: add, view, edit and delete daily, date and free spending.

It works on the same saved state as the website (same `_rev` rules), so both always show the same data.
It is wired up by app.py (`configure`, plus the `/telegram/webhook` route); for local testing
`tools/telegram_poll.py` fetches updates from Telegram instead of waiting for the webhook.
Only the Telegram user IDs in TELEGRAM_ALLOWED_IDS can use it.
"""
import calendar
import hashlib
import hmac
import html
import json
import os
import re
import urllib.error
import urllib.request
import zlib
from datetime import date, datetime, timedelta, timezone

WIB = timezone(timedelta(hours=7))   # the app's dates are Jakarta dates, and Vercel runs on UTC
KEYS = ("daily", "date", "free")
MINUS = "−"
PAGE = 8                             # entries per page in the list
WARN_AT = 0.9                        # same as the website: a day turns "near cap" from 90% of the cap
_cfg = {}


class BotError(Exception):
    """A problem to show to the user as a normal message."""


def configure(load, save, db, base):
    """load/save are app.py's `_load_state` / `_save_state`; db is its `_db` (or None when running on local files)."""
    cats = json.loads((base / "static" / "categories.json").read_text(encoding="utf-8"))["cats"]
    _cfg.update(
        load=load, save=save, db=db, base=base, cats=cats,
        token=os.environ.get("TELEGRAM_BOT_TOKEN", "").strip(),
        allowed={int(x) for x in re.findall(r"\d+", os.environ.get("TELEGRAM_ALLOWED_IDS", ""))},
    )


def enabled():
    return bool(_cfg.get("token") and _cfg.get("allowed"))


def secret():
    """The secret Telegram sends with every webhook call; derived from the token, so there is nothing more to configure."""
    return hashlib.sha256(("webhook:" + _cfg["token"]).encode()).hexdigest()[:48]


def verify(header):
    return enabled() and hmac.compare_digest(header or "", secret())


# ---------- Telegram API ----------
def api(method, **params):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{_cfg['token']}/{method}",
        data=json.dumps(params).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return json.load(e)
        except Exception:
            return {"ok": False}
    except Exception:
        return {"ok": False}


def _markup(rows):
    return {"inline_keyboard": [[{"text": t, "callback_data": d} for t, d in row] for row in rows]}


def show(chat, mid, ui):
    """Edit the message in place when we have one, otherwise send a new one."""
    text, rows = ui
    params = dict(chat_id=chat, text=text, parse_mode="HTML", reply_markup=_markup(rows), disable_web_page_preview=True)
    if mid:
        r = api("editMessageText", message_id=mid, **params)
        if r.get("ok") or "not modified" in str(r.get("description", "")):
            return
    api("sendMessage", **params)


# ---------- formats (same as the website) ----------
def money(n):
    return f"IDR {int(n):,}"


def outflow(n):
    return f"{MINUS}{money(n)}"


def fdate(iso):
    d = date.fromisoformat(iso)
    return f"{d:%a}, {d.day} {d:%b %Y}"


def today():
    return datetime.now(WIB).date().isoformat()


def esc(s):
    return html.escape(str(s), quote=False)


def parse_amount(text):
    """'25000 lunch', '25.000 lunch', '25k lunch', '1.5jt rent' -> (25000, 'lunch'). Returns None if there is no amount."""
    m = re.match(r"^\s*(?:idr|rp)?\s*(\d[\d.,]*)\s*(k|rb|jt)?(?![a-z])\s*(.*)$", text, re.I | re.S)
    if not m:
        return None
    num, suf, rest = m.group(1), (m.group(2) or "").lower(), m.group(3).strip()
    try:
        if suf:   # with k / rb / jt a dot or comma is a decimal point: 12.5k = 12,500
            amt = round(float(num.replace(",", ".")) * (1_000_000 if suf == "jt" else 1000))
        else:     # without a suffix a dot or comma is a thousands separator: 25.000 = 25,000
            amt = int(re.sub(r"[.,]", "", num))
    except ValueError:
        return None
    return (amt, rest) if 0 < amt < 10**10 else None


# ---------- data ----------
def latest(s):
    """The bot always works on the newest pay cycle, whatever cycle the website happens to be showing."""
    return max(s["cycles"], key=lambda c: c["payday"])


def sig(x):
    """Short fingerprint of an entry. Entries have no id, so buttons carry list position plus this, and a stale button is refused."""
    return format(zlib.crc32(f"{x['date']}|{x['cat']}|{x.get('note', '')}|{x['amt']}".encode()) & 0xFFFF, "04x")


def find(s, key, idx, h):
    sp = latest(s)["env"][key]["spends"]
    if 0 <= idx < len(sp) and sig(sp[idx]) == h:
        return sp[idx]
    raise BotError("That entry changed or was removed in the meantime. Open the list again.")


def mutate(fn):
    """Read, change and save the state, retrying if the website (or another device) saved in between."""
    for _ in range(4):
        s = _cfg["load"]()
        if s is None:
            raise BotError("There is no saved data yet. Open the website once first.")
        result = fn(s)
        if _cfg["save"](s, s.get("_rev", 0), False) is not None:
            return result
    raise BotError("The data kept changing while saving. Please try again.")


def cat_sorted():
    """Same order as the website's dropdowns: A to Z, Other last."""
    return sorted(_cfg["cats"], key=lambda n: (n == "Other", n.lower()))


def day_status(e, d):
    cap = e.get("cap") or 60000
    tot = sum(x["amt"] for x in e["spends"] if x["date"] == d)
    word = "over the cap" if tot > cap else "near the cap" if tot >= cap * WARN_AT else "under the cap"
    return f"{fdate(d)}: {money(tot)} of the {money(cap)} cap ({word})"


# ---------- pending conversations (kept in the database, because Vercel keeps no memory between calls) ----------
def _pend_file():
    return _cfg["base"] / "data" / "bot_pending.json"


def pend_get(chat):
    if _cfg["db"]:
        with _cfg["db"]() as conn:
            row = conn.execute("select data from bot_pending where chat_id = %s", [str(chat)]).fetchone()
        return row[0] if row else None
    f = _pend_file()
    return (json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}).get(str(chat))


def pend_set(chat, p):
    if _cfg["db"]:
        from psycopg.types.json import Jsonb

        with _cfg["db"]() as conn:
            if p is None:
                conn.execute("delete from bot_pending where chat_id = %s", [str(chat)])
            else:
                conn.execute(
                    "insert into bot_pending (chat_id, data) values (%s, %s) "
                    "on conflict (chat_id) do update set data = excluded.data, updated_at = now()",
                    [str(chat), Jsonb(p)],
                )
        return
    f = _pend_file()
    allp = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    if p is None:
        allp.pop(str(chat), None)
    else:
        allp[str(chat)] = p
    f.parent.mkdir(exist_ok=True)
    f.write_text(json.dumps(allp), encoding="utf-8")


# ---------- screens: each returns (text, button rows) ----------
def ui_menu(s, note=""):
    c = latest(s)
    text = (note + "\n\n" if note else "") + f"<b>Darren's Finance</b>\nCycle: {esc(c['label'])}\nWhat do you want to do?"
    return text, [[("Add spending", "a")], [("View, edit or delete", "l")]]


def ui_budgets(s, action, title):
    c = latest(s)
    rows = [[(c["env"][k]["name"], f"{action}:{k}")] for k in KEYS]
    rows.append([("Cancel", "m")])
    return title, rows


def ui_cats(prefix, suffix, title, back, selected=None):
    """Category buttons, two per row. `prefix` and `suffix` build the callback data around the category's number."""
    order = cat_sorted()
    names = sorted(order, key=lambda n: (n != selected, n == "Other", n.lower())) if selected else order   # the chosen one first, as on the site
    btns = [(n, f"{prefix}:{order.index(n)}{suffix}") for n in names]
    rows = [btns[i:i + 2] for i in range(0, len(btns), 2)]
    rows.append([("Cancel", back)])
    return title, rows


def ui_dates(ctx, title, back):
    t = date.fromisoformat(today())
    y = t - timedelta(days=1)
    return title, [
        [(f"Today, {t.day} {t:%b}", f"dp:{t}:{ctx}"), (f"Yesterday, {y.day} {y:%b}", f"dp:{y}:{ctx}")],
        [("Pick another date", f"cm:{t:%Y-%m}:{ctx}")],
        [("Cancel", back)],
    ]


def ui_calendar(ym, ctx, back, mark=None):
    y, m = map(int, ym.split("-"))
    first = date(y, m, 1)
    prev = first - timedelta(days=1)
    nxt = (first + timedelta(days=31)).replace(day=1)
    t = today()
    rows = [[("‹", f"cm:{prev:%Y-%m}:{ctx}"), (f"{calendar.month_name[m]} {y}", "x"), ("›", f"cm:{nxt:%Y-%m}:{ctx}")],
            [(d, "x") for d in ("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su")]]
    for week in calendar.Calendar(0).monthdayscalendar(y, m):
        row = []
        for d in week:
            if not d:
                row.append((" ", "x"))
                continue
            iso = f"{y}-{m:02d}-{d:02d}"
            row.append((f"[{d}]" if iso == t else str(d), f"dp:{iso}:{ctx}"))
        rows.append(row)
    rows.append([("Today", f"dp:{t}:{ctx}"), ("Cancel", back)])
    return "Pick a date.", rows


def ui_list(s, key, page=0):
    c = latest(s)
    e = c["env"][key]
    items = sorted(enumerate(e["spends"]), key=lambda t: (t[1]["date"], t[0]), reverse=True)
    spent = sum(x["amt"] for x in e["spends"])
    head = f"<b>{esc(e['name'])}</b> · {esc(c['label'])}\n"
    head += f"Spent: {money(spent)}" + (f" of {money(e['amount'])}" if key != "free" else "") + "\n"
    if key == "daily":
        head += day_status(e, today()) + "\n"
    pages = max(1, -(-len(items) // PAGE))
    page = min(max(page, 0), pages - 1)
    head += "\nTap an entry to edit or delete it." if items else "\nNo entries yet."
    rows = []
    for i, x in items[page * PAGE:(page + 1) * PAGE]:
        d = date.fromisoformat(x["date"])
        rows.append([(f"{d.day} {d:%b} · {x['cat']} · {money(x['amt'])}", f"ev:{key}:{i}:{sig(x)}")])
    nav = []
    if page > 0:
        nav.append(("‹ Newer", f"l:{key}:{page - 1}"))
    if page < pages - 1:
        nav.append(("Older ›", f"l:{key}:{page + 1}"))
    if nav:
        rows.append(nav)
    rows.append([("Add here", f"ab:{key}"), ("Back", "l"), ("Menu", "m")])
    return head, rows


def ui_entry(s, key, idx, h, note=""):
    x = find(s, key, idx, h)
    e = latest(s)["env"][key]
    ref = f"{key}:{idx}:{h}"
    text = (note + "\n\n" if note else "") + (
        f"<b>{esc(e['name'])}</b>\n{fdate(x['date'])}\n{esc(x['cat'])}\n"
        f"Remarks: {esc(x.get('note') or '(none)')}\n{outflow(x['amt'])}"
    )
    return text, [
        [("Edit category", f"ee:c:{ref}"), ("Edit date", f"ee:d:{ref}")],
        [("Edit amount", f"ee:a:{ref}"), ("Edit remarks", f"ee:n:{ref}")],
        [("Delete", f"dl:{ref}")],
        [("Back to list", f"l:{key}")],
    ]


def ui_saved(s, p, e):
    text = (
        f"<b>Saved</b>\n{esc(e['name'])} · {esc(p['cat'])}\n{fdate(p['date'])}\n"
        f"{outflow(p['amt'])}" + (f" · {esc(p['note'])}" if p.get("note") else "")
    )
    if p["key"] == "daily":
        text += "\n\n" + day_status(e, p["date"])
    return text, [[("Add another", "a"), (f"View {e['name']}", f"l:{p['key']}")], [("Menu", "m")]]


# ---------- actions ----------
def save_new(chat, p):
    def fn(s):
        e = latest(s)["env"][p["key"]]
        e["spends"].append({"date": p["date"], "cat": p["cat"], "note": p.get("note", ""), "amt": p["amt"]})
        return s, e

    s, e = mutate(fn)
    pend_set(chat, None)
    return ui_saved(s, p, e)


def edit_entry(key, idx, h, **changes):
    def fn(s):
        x = find(s, key, idx, h)
        x.update(changes)
        return s, sig(x)

    s, new_h = mutate(fn)
    return ui_entry(s, key, idx, new_h, note="<b>Updated</b>")


def ask_text(chat, mid, p, prompt):
    pend_set(chat, p)
    return prompt, [[("Cancel", "m" if p["mode"] == "add" else f"ev:{p['key']}:{p['idx']}:{p['h']}")]]


def after_date(chat, p):
    """The add flow has its date. If the amount is already known (quick add) it saves now, otherwise it asks for it."""
    if p.get("amt"):
        return save_new(chat, p)
    p["await"] = "amt_note"
    pend_set(chat, p)
    return (
        f"<b>{esc(p['cat'])}</b> · {fdate(p['date'])}\nSend the amount and remarks, for example: <code>25000 lunch</code>",
        [[("Cancel", "m")]],
    )


def on_callback(chat, mid, data):
    s = _cfg["load"]()
    if s is None:
        raise BotError("There is no saved data yet. Open the website once first.")
    a = data.split(":")
    op = a[0]
    if op == "x":
        return None
    if op == "m":
        pend_set(chat, None)
        return ui_menu(s)
    if op == "a":   # start adding: choose the budget first
        pend_set(chat, None)
        return ui_budgets(s, "ab", "<b>Add spending</b>\nWhich budget?")
    if op == "ab":  # budget chosen -> category (keeps an amount from a quick add)
        p = pend_get(chat) or {}
        pend_set(chat, {"mode": "add", "key": a[1], "amt": p.get("amt") if p.get("mode") == "add" else None,
                        "note": p.get("note", "") if p.get("mode") == "add" else ""})
        return ui_cats("ac", "", f"<b>{esc(latest(s)['env'][a[1]]['name'])}</b>\nChoose a category.", "m")
    if op == "ac":  # category chosen -> date
        p = pend_get(chat)
        if not p or p.get("mode") != "add":
            raise BotError("That step has expired. Start again.")
        p["cat"] = cat_sorted()[int(a[1])]
        pend_set(chat, p)
        return ui_dates("a", f"<b>{esc(p['cat'])}</b>\nWhich date?", "m")
    if op == "cm":  # calendar month; a[2:] is the context
        ctx = ":".join(a[2:])
        return ui_calendar(a[1], ctx, "m" if ctx == "a" else f"ev:{ctx}")
    if op == "dp":  # a date was picked
        iso, ctx = a[1], ":".join(a[2:])
        if ctx == "a":
            p = pend_get(chat)
            if not p or p.get("mode") != "add" or not p.get("cat"):
                raise BotError("That step has expired. Start again.")
            p["date"] = iso
            return after_date(chat, p)
        key, idx, h = ctx.split(":")
        return edit_entry(key, int(idx), h, date=iso)
    if op == "l":   # list: l (choose budget) or l:key[:page]
        if len(a) == 1:
            return ui_budgets(s, "l", "<b>View, edit or delete</b>\nWhich budget?")
        return ui_list(s, a[1], int(a[2]) if len(a) > 2 else 0)
    if op == "ev":
        return ui_entry(s, a[1], int(a[2]), a[3])
    if op == "ee":  # edit one field of an entry: ee:field:key:idx:h
        field, key, idx, h = a[1], a[2], int(a[3]), a[4]
        x = find(s, key, idx, h)
        back = f"ev:{key}:{idx}:{h}"
        if field == "c":
            return ui_cats("ec", f":{key}:{idx}:{h}", f"Choose a new category (now: {esc(x['cat'])}).", back, selected=x["cat"])
        if field == "d":
            return ui_dates(f"{key}:{idx}:{h}", f"Choose a new date (now: {fdate(x['date'])}).", back)
        p = {"mode": "edit", "key": key, "idx": idx, "h": h, "await": "edit_amt" if field == "a" else "edit_note"}
        if field == "a":
            return ask_text(chat, mid, p, f"Send the new amount (now: {money(x['amt'])}).")
        return ask_text(chat, mid, p, "Send the new remarks (now: " + esc(x.get("note") or "none") + "). Send a dash (-) to clear them.")
    if op == "ec":  # ec:catIndex:key:idx:h
        return edit_entry(a[2], int(a[3]), a[4], cat=cat_sorted()[int(a[1])])
    if op == "dl":  # ask before deleting
        key, idx, h = a[1], int(a[2]), a[3]
        x = find(s, key, idx, h)
        return (
            f"<b>Delete this expense?</b>\n{fdate(x['date'])} · {esc(x['cat'])} · {outflow(x['amt'])}\nThis cannot be undone.",
            [[("Delete", f"dy:{key}:{idx}:{h}"), ("Cancel", f"ev:{key}:{idx}:{h}")]],
        )
    if op == "dy":
        key, idx, h = a[1], int(a[2]), a[3]

        def fn(st):
            find(st, key, idx, h)
            latest(st)["env"][key]["spends"].pop(idx)
            return st

        st = mutate(fn)
        text, rows = ui_list(st, key)
        return "<b>Deleted.</b>\n\n" + text, rows
    raise BotError("I did not understand that button.")


def on_text(chat, text):
    """Return a screen for a typed message."""
    s = _cfg["load"]()
    if s is None:
        raise BotError("There is no saved data yet. Open the website once first.")
    t = text.strip()
    cmd = t.split()[0].split("@")[0].lower() if t.startswith("/") else ""
    if cmd in ("/start", "/menu"):
        pend_set(chat, None)
        return ui_menu(s)
    if cmd == "/cancel":
        pend_set(chat, None)
        return ui_menu(s, "Cancelled.")
    if cmd == "/help":
        return (
            "<b>How to use this bot</b>\nTap <b>Add spending</b> and follow the buttons: budget, category, date, then the amount.\n\n"
            "Shortcut: just send an amount and remarks, like <code>25000 lunch</code> or <code>25k coffee</code>, "
            "and I will ask for the budget, category and date.\n\n/menu shows the main menu and /cancel stops what you are doing.",
            [[("Menu", "m")]],
        )
    p = pend_get(chat)
    if p and p.get("await") == "amt_note":
        r = parse_amount(t)
        if not r:
            return "I could not find an amount. Send it like this: <code>25000 lunch</code>", [[("Cancel", "m")]]
        p["amt"], p["note"] = r
        return save_new(chat, p)
    if p and p.get("await") == "edit_amt":
        r = parse_amount(t)
        if not r:
            return "I could not read that amount. Send just a number, like <code>25000</code>.", [[("Cancel", f"ev:{p['key']}:{p['idx']}:{p['h']}")]]
        pend_set(chat, None)
        return edit_entry(p["key"], p["idx"], p["h"], amt=r[0])
    if p and p.get("await") == "edit_note":
        pend_set(chat, None)
        return edit_entry(p["key"], p["idx"], p["h"], note="" if t == "-" else t)
    r = parse_amount(t)   # quick add: "25000 lunch"
    if r:
        pend_set(chat, {"mode": "add", "amt": r[0], "note": r[1]})
        return ui_budgets(s, "ab", f"<b>Add {money(r[0])}</b>" + (f" · {esc(r[1])}" if r[1] else "") + "\nWhich budget?")
    return ui_menu(s, "I did not understand that. Send an amount like <code>25000 lunch</code>, or use the buttons.")


# ---------- entry point ----------
def handle_update(u):
    if not enabled():
        return
    cb = u.get("callback_query")
    msg = u.get("message")
    if cb:
        uid, chat = cb["from"]["id"], cb["message"]["chat"]["id"]
        mid = cb["message"]["message_id"]
    elif msg and msg.get("text"):
        uid, chat, mid = msg["from"]["id"], msg["chat"]["id"], None
    else:
        return
    if uid not in _cfg["allowed"] or msg and msg["chat"].get("type") != "private":
        if msg:   # the ID is shown so it can be added to TELEGRAM_ALLOWED_IDS
            api("sendMessage", chat_id=chat, text=f"This bot is private. Your Telegram ID is {uid}.")
        return
    try:
        if cb:
            api("answerCallbackQuery", callback_query_id=cb["id"])
            ui = on_callback(chat, mid, cb["data"])
        else:
            ui = on_text(chat, msg["text"])
    except BotError as e:
        ui = (esc(e), [[("Menu", "m")]])
    if ui:
        show(chat, mid, ui)
