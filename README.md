# Darren's Finance

A personal finance tracker that I built for myself, and for my partner, to see where our money goes each month and how our wealth is growing.

**Live site:** https://darrens-finance.vercel.app (the real data is private, but you can click **Try the demo** on the login page to explore it with random data)

## Why I built it

Spreadsheets and bank apps never matched how I actually think about money. I get paid once a month, on a date that moves around the last week of the month, and I split every salary the same way:

- **20%** goes straight into a cash saving.
- The rest pays my **fixed expenses**, then funds three budgets: **daily**, **date** and **free to use**.
- Whatever is left in a budget can be moved into cash saving, or carried over to the next month.
- New money for investing (stocks and gold) is taken from cash saving, so my wealth is always honest.

So I made a small website that follows exactly those rules.

## What it does

- **Salary:** a flow diagram that shows how one salary branches into savings, fixed expenses and budgets, and what is left in each.
- **Wealth:** cash saving, stocks (Stockbit) and gold (Treasury) in one place, with live prices and profit or loss.
- **Spending:** every expense by budget, with a daily cap that turns each day green or red.
- **Pay cycles:** start a new cycle every payday. Past cycles stay saved and can be opened any time.
- **Privacy eye:** one button that hides every number on screen, like in a banking app.
- **Works on phones, tablets and laptops.**
- **Guest demo:** a visitor gets randomly generated data and simulated prices. Nothing is saved, and the server refuses to hand guests any real data.

## How it is built

| Part | Choice |
|---|---|
| Backend | Python and Flask |
| Frontend | Plain HTML, CSS and JavaScript (no framework, no build step) |
| Design | A "liquid glass" look with bank brand colors and Fluent UI System Icons |
| Prices | Yahoo Finance through `yfinance` (stocks, gold futures and USD/IDR) |
| Database | Supabase Postgres on the live site, a local JSON file when running on my laptop |
| Login | Google sign-in with an allow-list, plus a password as a backup |
| Hosting | Vercel (every push to `main` deploys automatically) |
| Python tooling | [uv](https://docs.astral.sh/uv/) |

The same code runs both locally and on the web. If `DATABASE_URL` is set, it uses the database. If not, it keeps everything in `data/` and needs no login.

## Run it yourself

You need Python 3.14 and [uv](https://docs.astral.sh/uv/).

```powershell
uv run python app.py
```

Then open http://127.0.0.1:5000. On a fresh clone the app starts with an empty cycle, so you can enter your own salary and budgets.

To use the login and the database, set these environment variables (a local `.env` file works):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (use a pooler URL on Vercel) |
| `SITE_PASSWORD` | Password sign-in |
| `SECRET_KEY` | Signs the session cookie |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in |
| `ALLOWED_EMAILS` | Comma-separated emails allowed to sign in with Google |
| `GUEST_DEMO=0` | Optional. Turns the demo off |

## Project layout

```
app.py              Flask app: pages, API, login, price cache
templates/          Login page and the app shell
static/js/app.js    All app logic and views
static/js/demo.js   Random demo data and simulated prices
static/css/         The whole theme, including every responsive rule
tools/              Helper scripts (icon builder, database import, backup)
```

## A note on privacy

This repository is public, so it contains **no personal or financial data and no credentials**. My real data lives only in the private database, and secrets live only in environment variables.

## License

The code is released under the [MIT License](LICENSE). The license covers my code only. The logos and icons keep their own licenses, listed below.

## Credits

- Icons: [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons) by Microsoft (MIT license, see `static/icons/`).
- Bank and wallet logos for BCA, Jago and GoPay come from [hafidznoor/idn-finlogos](https://github.com/hafidznoor/idn-finlogos) (CC BY-NC 4.0, personal use). The Stockbit and Treasury logos belong to their owners. All brand names and logos are trademarks of their respective companies, and I am not affiliated with any of them.
- Font: [Nunito](https://fonts.google.com/specimen/Nunito) from Google Fonts.

This is a personal project and not financial advice. Prices from Yahoo Finance are unofficial and delayed.
