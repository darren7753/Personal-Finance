// Guest demo mode. Everything here runs in the visitor's browser: random data is generated on every page load,
// stock and gold prices are simulated, and nothing is read from or written to the database.
const GUEST = document.body.dataset.guest === '1';

const { demoState, demoQuotes } = (() => {
  const R = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;          // random whole number from a to b
  const roundTo = (n, step) => Math.round(n / step) * step;
  const pick = list => list[R(0, list.length - 1)];
  const shuffle = list => list.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(p => p[1]);
  const ymd = d => d.toLocaleDateString('sv-SE');
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const sum = list => list.reduce((a, x) => a + x, 0);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------- simulated prices ----------
  const BASE = {BBCA: 9400, BBRI: 4200, TLKM: 3300, ASII: 4800, UNVR: 2100, ICBP: 10500, 'GC=F': 3600, 'USDIDR=X': 16500};
  const base = {}, drift = {}, prevDrift = {};
  const tick = p => (p < 200 ? 1 : p < 500 ? 2 : p < 2000 ? 5 : p < 5000 ? 10 : 25);
  function quote(symbol) {
    const key = symbol.replace(/\.JK$/, '');
    if (!base[key]) {                                    // unknown ticker typed by the visitor: invent a stable price
      base[key] = BASE[key] || R(500, 8000);
      drift[key] = (Math.random() - 0.5) * 0.02;
      prevDrift[key] = (Math.random() - 0.5) * 0.03;
    }
    drift[key] = clamp(drift[key] + (Math.random() - 0.5) * 0.004, -0.03, 0.03);   // small random walk on every refresh
    const fx = v => key === 'GC=F' ? Math.round(v * 10) / 10 : key === 'USDIDR=X' ? Math.round(v) : roundTo(v, tick(v));
    return {price: fx(base[key] * (1 + drift[key])), prev: fx(base[key] * (1 + prevDrift[key])), ts: Date.now() / 1000, stale: false};
  }
  function demoQuotes(symbols) {
    const out = {};
    symbols.forEach(s => { out[s] = quote(s); });
    return out;
  }

  // ---------- random starting data ----------
  const POOL = [
    ['Subscriptions', 'Streaming subscription', 55000, 190000], ['Subscriptions', 'Cloud storage', 15000, 35000],
    ['Bills & utilities', 'Internet', 280000, 450000], ['Bills & utilities', 'Electricity token', 150000, 350000],
    ['Bills & utilities', 'Mobile credit', 50000, 150000], ['Installments', 'Laptop installment', 700000, 1800000],
    ['Health', 'Gym membership', 150000, 400000],
  ];
  const DAILY = [
    ['Food & drink', ['Lunch', 'Dinner', 'Breakfast', 'Coffee', 'Snacks']], ['Food & drink', ['Lunch', 'Dinner', 'Coffee']],
    ['Food & drink', ['Lunch', 'Dinner', 'Snacks']], ['Transport', ['Ride', 'Fuel', 'Train ticket']],
    ['Groceries', ['Groceries', 'Supermarket']], ['Entertainment', ['Movie', 'Games']], ['Shopping', ['Online order', 'Toiletries']],
  ];

  function demoState() {
    const now = new Date(), payday = addDays(now, -R(10, 22));
    const salary = roundTo(R(9000000, 24000000), 50000), savePct = 20;
    const afterSave = salary - Math.round(salary * savePct / 100);

    const rent = roundTo(R(1800000, 4200000), 10000);
    const daily = Math.min(roundTo(R(1200000, 2100000), 50000), roundTo((afterSave - rent) * 0.35, 50000));
    const date = Math.min(roundTo(R(300000, 800000), 50000), roundTo((afterSave - rent) * 0.1, 50000));
    const fixed = [{cat: 'Housing', name: 'Apartment rent', amount: rent}];
    shuffle(POOL).slice(0, R(4, 5)).forEach(([cat, name, lo, hi]) => {
      const amount = roundTo(R(lo, hi), 5000);
      if (sum(fixed.map(f => f.amount)) + amount + daily + date <= afterSave * 0.92) fixed.push({cat, name, amount});
    });
    const free = afterSave - sum(fixed.map(f => f.amount)) - daily - date;

    const env = newEnv(daily, date);
    const cap = Math.max(40000, roundTo(daily / 30, 5000));
    env.daily.cap = cap;

    // daily spending, day by day from payday until today, kept under the daily budget
    let spentDaily = 0;
    for (let d = new Date(payday); ymd(d) <= ymd(now); d = addDays(d, 1)) {
      const n = R(1, 3);
      for (let i = 0; i < n; i++) {
        const [cat, notes] = pick(DAILY);
        const amt = roundTo(R(12000, Math.max(15000, Math.round(cap / n * 0.85))), 1000);
        if (spentDaily + amt > daily * 0.92) continue;
        spentDaily += amt;
        env.daily.spends.push({date: ymd(d), cat, note: pick(notes), amt});
      }
    }
    const dayInCycle = () => ymd(addDays(payday, R(0, Math.round((now - payday) / 864e5))));
    let spentDate = 0;
    for (let i = R(0, 2); i > 0; i--) {
      const amt = roundTo(R(100000, Math.max(110000, Math.round(date * 0.5))), 5000);
      if (spentDate + amt > date) continue;
      spentDate += amt;
      env.date.spends.push({date: dayInCycle(), cat: 'Date', note: pick(['Dinner date', 'Movie night', 'Coffee date']), amt});
    }
    if (R(0, 1) && free > 600000) env.free.spends.push({date: dayInCycle(), cat: 'Shopping', note: 'Online shopping', amt: roundTo(R(80000, 300000), 5000)});

    // wealth: 3 stocks, one Stockbit top-up, one gold purchase from before tracking and one new one
    const transfers = [];
    const tickers = shuffle(['BBCA', 'BBRI', 'TLKM', 'ASII', 'UNVR', 'ICBP']).slice(0, 3);
    const holdings = tickers.map(t => {
      const price = quote(t + '.JK').price;
      const lots = Math.max(1, Math.round(R(3000000, 25000000) / (price * 100)));   // each holding is worth about IDR 3 to 25 million
      return {ticker: t, lots, invested: Math.round(lots * 100 * price * (0.82 + Math.random() * 0.35)), lastValue: Math.round(lots * 100 * price)};
    });
    const topUp = roundTo(R(300000, 1000000), 50000);
    transfers.push({id: 'demo-t1', date: dayInCycle(), type: 'stockbit', cat: 'Investment', amount: topUp, note: 'Monthly top-up'});
    const cash = roundTo(R(50000, 900000), 1000) + topUp;

    const gc = quote('GC=F').price, fx = quote('USDIDR=X').price;
    const perGram = Math.round(gc * fx / 31.1034768 * 0.998);
    const g1 = R(40, 180) / 100, g2 = R(20, 90) / 100;
    const paid2 = roundTo(g2 * perGram, 1000);
    const items = [
      {id: 'demo-g1', date: ymd(addDays(now, -R(60, 200))), grams: g1, paid: roundTo(g1 * perGram * (0.9 + Math.random() * 0.12), 1000), note: 'Bought before tracking'},
      {id: 'demo-g2', date: dayInCycle(), grams: g2, paid: paid2, note: ''},
    ];
    transfers.push({id: 'demo-t2', date: items[1].date, type: 'gold', cat: 'Investment', amount: paid2, note: '', goldId: 'demo-g2'});

    return {
      activeId: 'c1',
      basePrevSavings: roundTo(R(2000000, 15000000), 1000),
      cycles: [{
        id: 'c1', label: payday.toLocaleDateString('en-US', {month: 'long', year: 'numeric'}), payday: ymd(payday),
        salary, savePct, fixed, env,
      }],
      wealth: {stocks: {cash, holdings}, gold: {pricePerGram: 0, manual: false, lastAuto: perGram, seeded: true, items}, transfers},
    };
  }

  return {demoState, demoQuotes};
})();
