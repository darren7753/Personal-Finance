# darren's finance

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

- **Dashboard:** a flow diagram that shows how one salary branches into savings, fixed expenses and budgets, and what is left in each, plus spending charts (a donut by category and a daily trend).
- **Wealth:** cash saving, stocks (Stockbit) and gold (Treasury) in one place, with live prices, profit or loss, and buying and selling that moves money to and from cash saving. The stock maths copies Stockbit's own, so my numbers match the app.
- **Spending:** every expense by budget, with a daily cap that turns each day green or red.
- **Pay cycles:** start a new cycle every payday. Past cycles stay saved and can be opened any time.
- **Copy as image:** one button copies the Dashboard diagram as a picture, ready to paste into a chat.
- **Privacy eye:** one button that hides every number on screen, like in a banking app.
- **Telegram bot:** I can add, view, edit and delete spending, and ask for a picture of my finance summary, from my phone (see below).
- **Remembers my place:** a refresh keeps the same page, tab and scroll position.
- **Works on phones, tablets and laptops.**
- **Guest demo:** a visitor gets randomly generated data and simulated prices. Nothing is saved, and the server refuses to hand guests any real data.

## The big picture

Everything runs on free tiers. GitHub holds the code, Vercel runs it, and Supabase stores the data. Every push to `main` deploys by itself.

```mermaid
flowchart LR
    subgraph users["Me and my partner"]
        B["Browser or phone<br/>HTML, CSS, JavaScript"]
        T["Telegram app"]
    end

    subgraph vercel["Vercel, Singapore"]
        F["Flask app<br/>pages, API, login, bot webhook"]
    end

    subgraph supa["Supabase Postgres"]
        D1[("app_state<br/>all my finance data")]
        D2[("quotes<br/>price cache")]
        D3[("bot_pending<br/>unfinished bot chats")]
        D4[("slips<br/>salary slips")]
        D5[("snapshot<br/>picture of the Dashboard")]
    end

    Y["Yahoo Finance<br/>stock prices"]
    TR["Treasury website<br/>gold prices"]
    TG["Telegram servers"]
    G["GitHub<br/>public repo"]

    B -- "HTTPS, signed-in session" --> F
    B -- "live gold feed, WebSocket" --> TR
    T --> TG
    TG -- "webhook" --> F
    F --> D1
    F --> D2
    F --> D3
    F --> D4
    F --> D5
    F -- "yfinance" --> Y
    F -- "gold price history" --> TR
    G -- "push to main deploys automatically" --> F

    classDef app fill:#fff4e0,stroke:#e08a00,color:#222
    classDef data fill:#e6f0ff,stroke:#0060af,color:#222
    classDef ext fill:#f1f1f1,stroke:#777,color:#222
    class B,T,F app
    class D1,D2,D3,D4,D5 data
    class Y,TR,TG,G ext
```

The same code also runs on my laptop. Without `DATABASE_URL` it keeps everything in local JSON files, needs no login, and works as a sandbox.

## Inside the website

After signing in (Google, a password, or the demo), there are four pages. They all read one in-memory copy of the data and calculate every number from it, so a number can never differ between two pages.

```mermaid
flowchart TD
    L["Login page<br/>Google, password or Try the demo"] -->|"owner session"| APP
    L -->|"guest session"| DEMO["Demo<br/>random data made in the browser<br/>nothing saved, server answers 403"]
    DEMO --> APP

    subgraph APP["App, one page that switches views"]
        direction TB
        S[("Data in memory<br/>cycles, budgets, wealth")]
        CALC["calcAll<br/>derives every number"]
        S --> CALC
        CALC --> P1["Dashboard<br/>KPI cards, salary flow,<br/>wealth map, spending charts"]
        CALC --> P2["Wealth<br/>Cash saving, Stocks, Gold"]
        CALC --> P3["Spending<br/>Fixed expenses, Daily, Date,<br/>Free to use, Cash saving"]
        CALC --> P4["Pay cycles<br/>start and edit cycles"]
    end

    APP -- "GET and PUT /api/state" --> DB[("Supabase<br/>app_state")]

    classDef page fill:#fff4e0,stroke:#e08a00,color:#222
    classDef data fill:#e6f0ff,stroke:#0060af,color:#222
    class P1,P2,P3,P4 page
    class S,DB data
```

### The money rules the site follows

This is the whole idea behind the app: one salary, split the same way every month.

```mermaid
flowchart TD
    SAL["Salary<br/>paid on payday, starts a new cycle"] --> CASH["20% to Cash saving"]
    SAL --> REST["Remaining 80%"]
    REST --> FIX["Fixed expenses<br/>copied to every new cycle"]
    FIX --> DAILY["Daily budget<br/>with a per-day cap"]
    FIX --> DATE["Date budget"]
    FIX --> FREE["Free to use<br/>whatever is left"]

    DAILY -- "leftover moved in" --> CASH
    DATE -- "leftover moved in" --> CASH
    FREE -- "leftover moved in" --> CASH
    DAILY -. "not moved: carries over" .-> NEXT["Same budget in the next cycle"]
    DATE -.-> NEXT
    FREE -.-> NEXT

    CASH -- "top up" --> STK["Stocks"]
    CASH -- "buy" --> GLD["Gold"]
    STK -- "sell or withdraw" --> CASH
    GLD -- "sell" --> CASH
    CASH --> W["Total wealth<br/>Cash saving + Stocks + Gold"]
    STK --> W
    GLD --> W

    classDef inflow fill:#e3f6e8,stroke:#2e9d4f,color:#222
    classDef box fill:#fff4e0,stroke:#e08a00,color:#222
    classDef wealth fill:#ece8ff,stroke:#2f2590,color:#222
    class SAL,CASH inflow
    class REST,FIX,DAILY,DATE,FREE,NEXT box
    class STK,GLD,W wealth
```

### Saving without overwriting myself

Each browser tab holds the whole data and saves all of it, so two open devices could overwrite each other. A revision number (`_rev`) prevents that. The server refuses a save from a tab that is behind, and that tab reloads. The Telegram bot follows the same rule.

```mermaid
sequenceDiagram
    participant A as Laptop tab
    participant S as Server
    participant B as Phone or bot

    A->>S: load data
    S-->>A: data, revision 5
    B->>S: load data
    S-->>B: data, revision 5
    B->>S: save a new expense, based on revision 5
    S-->>B: saved, now revision 6
    A->>S: save an edit, based on revision 5
    S-->>A: 409, your data is out of date
    A->>S: reload data
    S-->>A: data, revision 6
```

## Live prices for stocks and gold

Stocks and gold are tracked live with no paid data source. Neither Stockbit nor Treasury has a public API for my account, so I type in my lots and purchases once. The site then prices them with live market data, and it never touches my real accounts.

### Stocks: Yahoo Finance

```mermaid
flowchart LR
    subgraph browser["Browser"]
        POLL["Price timer<br/>every 15 s while the market is open<br/>every 2 min when closed<br/>paused when the tab is hidden"]
        STK["Stocks value<br/>lots × 100 shares × price"]
    end

    subgraph server["Flask on Vercel"]
        CHK{"Saved in the quotes table<br/>less than 10 s ago?"}
        YF["yfinance"]
        SAVE["Save price and trade time<br/>in the quotes table"]
        OLD["Use the last saved price<br/>marked as stale"]
    end

    YAHOO["Yahoo Finance"]

    POLL -- "GET /api/quotes<br/>TICKER.JK" --> CHK
    CHK -- "yes" --> OUT["Prices sent back"]
    CHK -- "no" --> YF
    YF <--> YAHOO
    YF -- "got a price" --> SAVE --> OUT
    YF -- "Yahoo failed" --> OLD --> OUT
    OUT --> STK

    classDef app fill:#fff4e0,stroke:#e08a00,color:#222
    classDef ext fill:#f1f1f1,stroke:#777,color:#222
    classDef calc fill:#e3f6e8,stroke:#2e9d4f,color:#222
    class POLL,CHK,YF,SAVE,OLD,OUT app
    class YAHOO ext
    class STK calc
```

- **Prices:** Indonesian stocks use the `.JK` ending on Yahoo. They are delayed by about 10 minutes, and the site only polls quickly during trading hours (Monday to Friday, 09:00 to 16:00 Jakarta time). The header shows both when the price was traded ("price from") and when the site last checked ("updated").
- **Cache:** the `quotes` table means many page loads share one Yahoo request, which keeps the site fast and polite to Yahoo.
- **Fallback:** if Yahoo is down or blocks the request, the last saved price is shown and marked as stale instead of an error.
- **Stockbit's maths:** I worked out how Stockbit calculates things and copied it exactly. A buy costs shares × price × 1.0015 (the fee), the average price is kept to 4 decimals, and a sell leaves the average unchanged. Stockbit keeps the decimals inside and cuts them off on screen, never rounds, so the site does the same. After the market closed, every number on my Stocks tab matched the app.
- **Selling:** an **Auto** and **Manual** switch. Auto works out the amount received from the lots and the live price after the 0.25% sell fee. Manual lets me type the exact amount.

### Gold: Treasury

Yahoo has no Indonesian gold price, and a rough estimate from world gold futures was off by about 1%. So the site now uses Treasury's own price per gram, the same data its website shows. It tries four sources, newest first, and always says which one is in use.

```mermaid
flowchart TD
    subgraph treasury["Treasury website data"]
        WS["Live feed<br/>WebSocket, a new price every minute"]
        REST["Price history API<br/>a new point every 5 minutes"]
    end

    BR["Browser listens to the live feed<br/>and reconnects if it drops"]
    FL["Flask asks the history API<br/>browser checks every 15 s"]
    YE["Yahoo estimate<br/>GC=F × USDIDR ÷ 31.1035 × 0.998"]
    SV["Last saved price"]
    PRICE{{"Gold price per gram<br/>buy and sell<br/>the newest price wins"}}

    WS --> BR --> PRICE
    REST --> FL --> PRICE
    YE -. "only if Treasury fails" .-> PRICE
    SV -. "only if nothing loads" .-> PRICE
    PRICE --> VAL["Gold value and profit<br/>shown with the time of the price"]

    classDef app fill:#fff4e0,stroke:#e08a00,color:#222
    classDef ext fill:#f1f1f1,stroke:#777,color:#222
    classDef calc fill:#e3f6e8,stroke:#2e9d4f,color:#222
    class BR,FL,YE,SV app
    class WS,REST ext
    class PRICE,VAL calc
```

- **Why the browser listens to the live feed:** a serverless function on Vercel cannot keep a WebSocket open, so the browser connects directly. The server only handles the slower history API.
- **Buying:** I enter the amount paid and the buy price per gram, and the site works out the grams (rounded down to 6 decimals, like the app).
- **Yahoo fallback:** `GC=F` is gold futures in US dollars per troy ounce, and one troy ounce is 31.1035 grams. I multiply by `USDIDR=X` to get rupiah per gram, then by 0.998, a factor I calibrated against the Treasury app.
- **Demo:** guests get simulated prices made in the browser, and never call Yahoo or Treasury.
- **Unofficial data:** these are not published developer APIs. If either source changes, the site drops to the next one, and the label under the price says so.

## Telegram bot

Opening a website every time I buy a coffee is too much effort, so I added a private Telegram bot. It works on the **daily, date and free spending** budgets, and it uses the same data and rules as the site.

- **Quick add:** send a message that starts with the amount, such as `25000 lunch`, `25k coffee` or `1.5jt rent`. The bot then asks for the budget, the category and the date with buttons. The `k`, `rb` and `jt` suffixes mean thousand, thousand and million.
- **Guided add:** `/menu` shows **Add spending**, **View, edit or delete** and **Finance summary**.
- **Finance summary:** the bot sends me a picture of my Dashboard diagram with the time it was taken, plus a **Full size file** button because Telegram shrinks photos (see the last diagram below).
- **View, edit and delete:** the daily budget is listed day by day with its total and whether it is under, near or over the daily cap. The date and free budgets are listed newest first. Delete always asks first.
- **Private:** only the Telegram IDs on my allow-list get an answer, and Telegram's webhook secret is checked on every request.
- **Shared categories:** the website and the bot read the same list, `static/categories.json`.

Here is what happens when I send `25k coffee`:

```mermaid
sequenceDiagram
    actor Me
    participant TG as Telegram
    participant W as Webhook on Vercel
    participant DB as Supabase

    Me->>TG: 25k coffee
    TG->>W: POST /telegram/webhook
    W->>W: Check Telegram secret header
    W->>W: Check my Telegram ID is on the allow-list
    W->>W: Read amount 25,000 and remark coffee
    W->>DB: Remember this unfinished chat in bot_pending
    W-->>TG: Which budget? with buttons
    TG-->>Me: Daily, Date, Free to use
    Me->>TG: Tap a budget, a category, then a date
    TG->>W: One callback per tap
    W-->>TG: Acknowledge the tap right away
    W->>DB: Load data, add the expense, save with the revision check
    W->>DB: Clear the unfinished chat
    W-->>TG: Saved
    TG-->>Me: Confirmation
```

Anyone who is not on the allow-list only gets "This bot is private" and their own Telegram ID, so I can add my partner later.

There are two ways to add spending, and both end in the same place:

```mermaid
flowchart TD
    START(["Message to the bot"]) --> Q{"Starts with an amount?"}
    Q -- "yes: 25000 lunch" --> QA["Amount and remark are known"]
    Q -- "no: /menu" --> MENU["Menu<br/>Add spending, or View, edit or delete"]
    MENU --> AS["Add spending"]
    QA --> BUD["Choose budget"]
    AS --> BUD
    BUD --> CAT["Choose category<br/>A to Z, Other last"]
    CAT --> DT["Choose date<br/>Today, Yesterday or a calendar"]
    DT --> K{"Amount known?"}
    K -- "yes" --> SAVED["Saved to the newest cycle"]
    K -- "no" --> ASK["Send the amount and remarks"] --> SAVED
    MENU --> VIEW["View, edit or delete"]
    VIEW --> LIST["Daily: days with under, near or over cap<br/>Date and Free: newest first"]
    LIST --> ENT["Pick an entry<br/>edit category, date, amount or remarks, or delete"]

    classDef step fill:#fff4e0,stroke:#e08a00,color:#222
    classDef done fill:#e3f6e8,stroke:#2e9d4f,color:#222
    class QA,MENU,AS,BUD,CAT,DT,ASK,VIEW,LIST,ENT step
    class SAVED done
```

### How the finance summary picture gets to Telegram

The diagram depends on live prices that only the browser has, so the browser draws the picture and the bot only passes it on. That means the picture is only as new as the last time the website was open, which is why the caption shows when it was taken.

```mermaid
sequenceDiagram
    participant B as Browser, site open
    participant S as Server
    participant DB as Supabase snapshot table
    participant TG as Telegram bot
    actor Me

    B->>B: Draw the Dashboard diagram as a PNG
    B->>S: Upload the picture, only if it changed
    S->>DB: Keep one picture with its time and data revision
    Me->>TG: Finance summary
    TG->>DB: Read the picture
    TG-->>Me: Photo with the time it was taken
    Note over B,DB: A picture from an older tab never replaces a newer one
    Note over TG,Me: If the data changed since, the caption says to open the website
```

The same drawing powers the **Copy as image** button on the website. When the privacy eye is on, the copied picture has dots instead of numbers. The picture for the bot always has the real numbers, and only the people on the allow-list can ask for it.

The bot runs as a webhook on the same Vercel deployment (`/telegram/webhook`, code in `telegram_bot.py`). It shares the data, the rules and the category list with the website, and Vercel runs in Singapore, next to the database, to keep every tap fast. To try it locally without a webhook, run `tools/telegram_poll.py`.

## How it is built

| Part | Choice |
|---|---|
| Backend | Python and Flask |
| Frontend | Plain HTML, CSS and JavaScript (no framework, no build step) |
| Design | A "liquid glass" look with bank brand colors and Fluent UI System Icons |
| Stock prices | Yahoo Finance through `yfinance` |
| Gold prices | Treasury's live feed (WebSocket) and price history, with a Yahoo estimate as a backup |
| Charts and pictures | Chart.js for the charts, html-to-image for the diagram picture |
| Database | Supabase Postgres on the live site, a local JSON file when running on my laptop |
| Login | Google sign-in with an allow-list, plus a password as a backup |
| Bot | Telegram Bot API through a webhook |
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
| `TELEGRAM_BOT_TOKEN` | Token from BotFather (only if you want the bot) |
| `TELEGRAM_ALLOWED_IDS` | Comma-separated Telegram IDs allowed to use the bot |
| `GUEST_DEMO=0` | Optional. Turns the demo off |

## Project layout

```
app.py              Flask app: pages, API, login, price cache, bot webhook
telegram_bot.py     The Telegram bot
templates/          Login page and the app shell
static/js/app.js    All app logic and views
static/js/charts.js The two Dashboard charts
static/js/snapshot.js  Copy as image, and the picture the bot sends
static/js/demo.js   Random demo data and simulated prices
static/css/         The whole theme, including every responsive rule
static/categories.json  The category list shared by the site and the bot
tools/              Helper scripts (icon builder, database import, backup, local bot polling)
```

## A note on privacy

This repository is public, so it contains **no personal or financial data and no credentials**. My real data lives only in the private database, and secrets live only in environment variables.

## License

The code is released under the [MIT License](LICENSE). The license covers my code only. The logos and icons keep their own licenses, listed below.

## Credits

- Icons: [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons) by Microsoft (MIT license, see `static/icons/`).
- Charts use [Chart.js](https://www.chartjs.org/) (MIT license), included in `static/vendor/`.
- Bank and wallet logos for BCA, Jago and GoPay come from [hafidznoor/idn-finlogos](https://github.com/hafidznoor/idn-finlogos) (CC BY-NC 4.0, personal use). The Stockbit and Treasury logos belong to their owners. All brand names and logos are trademarks of their respective companies, and I am not affiliated with any of them.
- The diagram picture uses [html-to-image](https://github.com/bubkoo/html-to-image) (MIT license), included in `static/vendor/`.
- Font: [Nunito](https://fonts.google.com/specimen/Nunito) from Google Fonts.

This is a personal project and not financial advice. Prices from Yahoo Finance and Treasury come from unofficial sources, and stock prices are delayed.
