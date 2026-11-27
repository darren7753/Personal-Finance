"""Run the Telegram bot on this computer by fetching updates from Telegram (no public URL needed).

    uv run python tools/telegram_poll.py            # start polling (Ctrl+C to stop)
    uv run python tools/telegram_poll.py setup      # set the bot's menu commands and description
    uv run python tools/telegram_poll.py webhook https://darrens-finance.vercel.app/telegram/webhook   # go live
    uv run python tools/telegram_poll.py unhook     # back to polling

Telegram allows either a webhook or polling, never both: while the webhook is set, polling does not work.
With no DATABASE_URL in .env this writes to the local sandbox data (data/state.json), not the live data.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app  # noqa: E402  (loads .env and wires the bot)

bot = app.telegram_bot


def main():
    if not bot.enabled():
        sys.exit("Set TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_IDS in .env first.")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "poll"
    if cmd == "setup":
        bot.api("setMyCommands", commands=[
            {"command": "menu", "description": "Show the main menu"},
            {"command": "summary", "description": "Send the finance summary picture"},
            {"command": "cancel", "description": "Cancel what you are doing"},
            {"command": "help", "description": "How to use this bot"},
        ])
        bot.api("setMyDescription", description="Add, edit and delete your daily, date and free spending. Private bot.")
        print("Commands and description set.")
    elif cmd == "webhook":
        r = bot.api("setWebhook", url=sys.argv[2], secret_token=bot.secret(), allowed_updates=["message", "callback_query"],
                    drop_pending_updates=True)
        print(r.get("ok"), r.get("description", ""))
    elif cmd == "unhook":
        print(bot.api("deleteWebhook").get("ok"))
    else:
        bot.api("deleteWebhook")
        print("Polling Telegram. Message the bot now. Ctrl+C to stop.")
        offset = None
        while True:
            r = bot.api("getUpdates", timeout=25, offset=offset, allowed_updates=["message", "callback_query"])
            for u in r.get("result", []):
                offset = u["update_id"] + 1
                try:
                    bot.handle_update(u)
                except Exception as e:  # keep running; show what went wrong
                    print("error:", repr(e))
            if not r.get("ok"):
                time.sleep(3)


if __name__ == "__main__":
    main()
