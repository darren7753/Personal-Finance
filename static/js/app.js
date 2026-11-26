// If the session expired, send the user to the login page instead of failing silently.
const _fetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const r = await _fetch(...args);
  if (r.status === 401) { location.href = '/login'; await new Promise(() => {}); }
  return r;
};
const inflow = v => v ? '+' + rp(v) : rp(v);
const outflow = v => v ? '−' + rp(v) : rp(v);
const rp = n => (n < 0 ? '−' : '') + 'IDR ' + Math.abs(Math.round(n)).toLocaleString('en-US');
const pc2 = v => Number(v).toFixed(2).replace(/\.00$/, '') + '%';
const fm = n => 'IDR ' + Math.round(n).toLocaleString('en-US');
const num = v => Number(String(v).replace(/\D/g, '')) || 0;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtDate = d => { const dt = new Date(d + 'T00:00'); return dt.toLocaleDateString('en-GB', {weekday: 'short'}) + ', ' + dt.toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}); };
const monthLabel = d => new Date(d + 'T00:00').toLocaleDateString('en-US', {month: 'long', year: 'numeric'});

const newEnv = (daily = 0, date = 0) => ({
  daily: {name: 'Daily budget', sub: 'Food & daily expenses', amount: daily, cap: 60000, wallet: 'gopay', icon: 'calday', spends: [], moved: 0},
  date:  {name: 'Date budget', sub: 'Flexible', amount: date, wallet: 'jago', icon: 'heart', spends: [], moved: 0},
  free:  {name: 'Free to use', sub: 'Left after everything', amount: 0, wallet: 'jago', icon: 'balloon', spends: [], moved: 0},
});
const DEFAULT = {
  activeId: 'c1',
  // Empty starting point for a brand-new database. Real numbers live only in the database.
  wealth: {stocks: {cash: 0, holdings: []}, gold: {pricePerGram: 0, items: []}, transfers: []},
  basePrevSavings: 0,                 // cash saving balance before the first cycle's percentage went in
  cycles: [{
    id: 'c1', label: monthLabel(new Date().toLocaleDateString('sv-SE')), payday: new Date().toLocaleDateString('sv-SE'), salary: 0, savePct: 20,
    fixed: [],
    env: newEnv(),
  }],
};

let S, tab = 'dash';
const spent = e => e.spends.reduce((a, x) => a + x.amt, 0);
const left = e => e.amount + (e.carry || 0) - spent(e) - e.moved;
const cur = () => S.cycles.find(c => c.id === S.activeId);

// per-cycle numbers; savings chain runs through cycles in order
// a transfer belongs to the latest cycle whose payday is on or before the transfer date
function cycleOfDate(date) {
  let found = S.cycles[0];
  S.cycles.forEach(c => { if (c.payday <= date) found = c; });
  return found;
}
function calcAll() {
  let prev = S.basePrevSavings, prevC = null;
  return S.cycles.map(c => {
    ['daily', 'date', 'free'].forEach(key => { c.env[key].carry = prevC ? Math.max(0, left(prevC.env[key])) : 0; });
    const save = Math.round(c.salary * c.savePct / 100);
    const fixedTotal = c.fixed.reduce((a, x) => a + x.amount, 0);
    const afterSave = c.salary - save, afterFixed = afterSave - fixedTotal;
    const dailyDate = c.env.daily.amount + c.env.date.amount;
    const free = afterFixed - dailyDate;
    c.env.free.amount = free;
    const moved = Object.values(c.env).reduce((a, e) => a + e.moved, 0);
    const transferred = ((S.wealth && S.wealth.transfers) || []).filter(t => cycleOfDate(t.date) === c).reduce((a, t) => a + t.amount, 0);
    const k = {c, prev, save, fixedTotal, afterSave, afterFixed, dailyDate, free, moved, transferred, total: prev + save + moved - transferred};
    prev = k.total; prevC = c;
    return k;
  });
}
const K = () => calcAll().find(k => k.c.id === S.activeId);

let saveChain = Promise.resolve();
function persist() {
  if (GUEST) return Promise.resolve();   // demo mode: nothing is ever saved
  saveChain = saveChain.then(async () => {
    const r = await fetch('/api/state', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(S)});
    if (r.status === 409) { alert('Your data was changed in another tab or window. The page will reload to show the latest data.'); location.reload(); return; }
    const res = await r.json(); S._rev = res.rev;
  }).catch(() => {});
  return saveChain;
}
const commit = () => { sel.clear(); persist(); render(); };

// ---------- render ----------
const TITLES = {dash: 'Salary', wealth: 'Wealth', spend: 'Spending', cycles: 'Pay cycles'};
let lastView = '', lastTab = '', justOpened = null;
function render() {
  const k = K(), c = k.c;
  $('#cycleSel').innerHTML = S.cycles.map(x => `<option value="${x.id}" ${x.id === S.activeId ? 'selected' : ''}>${x.label}</option>`).join('');
  csSyncAll();
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
  $('#title').textContent = TITLES[tab];
  $('#greet').textContent = `${c.label} cycle · Payday ${fmtDate(c.payday)}`;
  // animate only when the page / cycle / budget tab actually changes, not on every small edit
  const vk = tab + '|' + S.activeId, entering = vk !== lastView, tk = tab === 'spend' ? spendTab : tab === 'wealth' ? wealthTab : '', swapping = !entering && tk !== lastTab;
  lastView = vk; lastTab = tk;
  const v = $('#view'); v.className = entering ? 'enter' : '';
  v.innerHTML = {dash, wealth, spend, cycles}[tab](k);
  const top = document.querySelector('.top'); top.classList.remove('enter-top'); if (entering) { void top.offsetWidth; top.classList.add('enter-top'); }
  if (swapping) { const p = v.querySelector('.tabs + *'); if (p) p.classList.add('swap'); }
  decorate(entering);
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function decorate(entering) {
  enhanceSelects();   // before wrapTables: the custom dropdowns change cell widths, and wrapTables measures whether each table fits
  wrapTables();
  fitDiagram();
  decorateDiagram();
  if (entering && !reduceMotion && !hideNums) document.querySelectorAll('.big-num').forEach(countUp);
  applyHide();
  centerTab();
}

// ---------- responsive helpers ----------
// Every table goes inside a scroll box (a wide table scrolls inside its card instead of widening the page). The header row is
// marked and each cell gets its column name, so on phones the CSS can turn rows into stacked cards ("Date", "Amount", ...).
function wrapTables() {
  document.querySelectorAll('#view table').forEach(t => {
    if (!t.parentElement.classList.contains('tscroll')) { const w = document.createElement('div'); w.className = 'tscroll'; t.parentNode.insertBefore(w, t); w.appendChild(t); }
    const rows = [...t.rows], head = rows.find(r => r.cells.length && [...r.cells].every(c => c.tagName === 'TH'));   // the day tables have no header row
    const labels = head ? [...head.cells].map(c => c.textContent.trim()) : [], cols = labels.length || (rows[0] ? rows[0].cells.length : 0);
    t.style.setProperty('--cols', cols);
    const box = t.parentElement;
    box.classList.toggle('cards', innerWidth <= 700);                                   // phones: every table becomes stacked cards
    if (!box.classList.contains('cards') && box.scrollWidth > box.clientWidth + 1) box.classList.add('cards');   // any other screen: only a table that does not fit its card
    if (!head) return;
    head.classList.add('hr');
    rows.forEach(r => { if (r === head) return; let col = 0; [...r.cells].forEach(c => { if (c.colSpan === 1 && labels[col]) c.dataset.label = labels[col]; col += c.colSpan; }); });
  });
}
// the tab strip scrolls sideways on phones; keep the selected tab in view
function centerTab() {
  document.querySelectorAll('.tabs').forEach(bar => { const on = bar.querySelector('.tab.on'); if (on && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2; });
}

// ---------- hide / show all numbers (eye button, shared by every page, remembered between visits) ----------
let hideNums = localStorage.getItem('dfHide') === '1';
const maskText = t => t.replace(/IDR [\d,]+/g, 'IDR ••••••').replace(/\d+(?:\.\d+)?%/g, '•••%').replace(/[\d.,]+ (g|shares)\b/g, '•••• $1');
function applyHide() {
  document.body.classList.toggle('hide-nums', hideNums);
  const eye = $('#eye'); if (eye) { eye.innerHTML = icon(hideNums ? 'eyeoff' : 'eye', 'regular', 24); eye.setAttribute('aria-label', hideNums ? 'Show numbers' : 'Hide numbers'); }
  if (!hideNums) return;
  const w = document.createTreeWalker($('#view'), NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { const m = maskText(n.nodeValue); if (m !== n.nodeValue) n.nodeValue = m; }
  document.querySelectorAll('#view [data-tip]').forEach(e => { e.dataset.tip = maskText(e.dataset.tip); });
}
function toggleEye() { hideNums = !hideNums; localStorage.setItem('dfHide', hideNums ? '1' : '0'); render(); }

// ---------- custom glass dropdown (replaces the browser's own select menu; the real <select> stays hidden inside) ----------
let csMenu = null, csOpenBtn = null;
function csClose() { if (csMenu) { csMenu.remove(); csMenu = null; } if (csOpenBtn) { csOpenBtn.classList.remove('open'); csOpenBtn = null; } }
function csOptIcon(v) { return CATS.includes(v) ? `<span class="cs-ic">${icon(CAT_ICON[v], 'regular', 18)}</span>` : ''; }
function csSync(sel) {
  const btn = sel.parentElement && sel.parentElement.querySelector('.cs-btn'); if (!btn) return;
  const o = sel.options[sel.selectedIndex];
  btn.innerHTML = `${o ? csOptIcon(o.value) : ''}<span class="cs-label">${o ? esc(o.text) : ''}</span><span class="cs-chev">${icon('chevdown', 'regular', 16)}</span>`;
}
function csSyncAll() { document.querySelectorAll('select[data-cs]').forEach(csSync); }
function csOpen(sel, btn) {
  csClose(); csOpenBtn = btn; btn.classList.add('open');
  const m = document.createElement('div'); m.className = 'cs-menu'; m.setAttribute('role', 'listbox');
  m.innerHTML = [...sel.options].map((o, i) => `<div class="cs-opt ${i === sel.selectedIndex ? 'on' : ''}" role="option" tabindex="-1" data-i="${i}">${csOptIcon(o.value)}<span class="cs-label">${esc(o.text)}</span>${i === sel.selectedIndex ? `<span class="cs-check">${icon('check', 'filled', 16)}</span>` : ''}</div>`).join('');
  document.body.appendChild(m); csMenu = m;
  const r = btn.getBoundingClientRect(), mh = Math.min(m.scrollHeight + 16, 340), below = innerHeight - r.bottom - 14, above = r.top - 14, up = below < mh && above > below;
  m.style.minWidth = Math.max(r.width, 190) + 'px'; m.style.left = Math.max(8, Math.min(r.left, innerWidth - Math.max(r.width, 190) - 12)) + 'px';
  m.style.maxHeight = Math.max(140, Math.min(340, up ? above : below)) + 'px';
  if (up) { m.style.bottom = (innerHeight - r.top + 6) + 'px'; m.style.transformOrigin = 'bottom'; } else { m.style.top = (r.bottom + 6) + 'px'; }
  requestAnimationFrame(() => m.classList.add('show'));
  const pick = i => { sel.selectedIndex = i; sel.dispatchEvent(new Event('change', {bubbles: true})); csSync(sel); csClose(); btn.focus(); };
  m.addEventListener('click', e => { const o = e.target.closest('.cs-opt'); if (o) pick(Number(o.dataset.i)); });
  m.addEventListener('keydown', e => {
    const opts = [...m.querySelectorAll('.cs-opt')], at = opts.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); opts[Math.min(opts.length - 1, at + 1)].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); opts[Math.max(0, at - 1)].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (at >= 0) pick(at); }
    else if (e.key === 'Escape' || e.key === 'Tab') { csClose(); btn.focus(); }
  });
  (m.querySelector('.cs-opt.on') || m.querySelector('.cs-opt')).focus({preventScroll: true});
  (m.querySelector('.cs-opt.on') || {scrollIntoView() {}}).scrollIntoView({block: 'nearest'});
}
function enhanceSelects() {
  csClose();
  document.querySelectorAll('select:not([data-cs])').forEach(sel => {
    sel.dataset.cs = '1'; sel.classList.add('cs-native'); sel.tabIndex = -1;
    const wrap = document.createElement('div'), btn = document.createElement('button');
    wrap.className = 'cs'; btn.type = 'button'; btn.className = 'cs-btn'; btn.setAttribute('aria-haspopup', 'listbox');
    sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(btn); wrap.appendChild(sel);
    btn.addEventListener('click', e => { e.stopPropagation(); csOpenBtn === btn ? csClose() : csOpen(sel, btn); });
    btn.addEventListener('keydown', e => { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); csOpen(sel, btn); } });
    csSync(sel);
  });
  csSyncAll();
}
document.addEventListener('click', e => { if (csMenu && !csMenu.contains(e.target)) csClose(); });
let csW = innerWidth;   // phones fire `resize` when the keyboard or address bar moves; only a width change should close the menu
addEventListener('resize', () => { if (innerWidth !== csW) { csW = innerWidth; csClose(); } });
addEventListener('scroll', e => { if (csMenu && e.target instanceof Node && csMenu.contains(e.target)) return; csClose(); }, true);
function countUp(el) {
  const m = el.textContent.trim().match(/^(−?)IDR ([\d,]+)$/); if (!m) return;
  const target = Number(m[2].replace(/,/g, '')), sign = m[1], t0 = performance.now(), dur = 900;
  const step = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = sign + 'IDR ' + Math.round(target * e).toLocaleString('en-US'); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function logo(w) { return `<img class="logo" src="/static/logos/${w}.${w === 'treasury' ? 'png' : 'svg'}">`; }

const BANK = {bca: '#0060AF', jago: '#FFB020', gopay: '#00AED5', fixed: '#ff2d55'};

// The node width depends on the room inside the diagram card. The first render happens before the page's vertical
// scrollbar exists, so `fitDiagram()` re-measures the real card after layout and rebuilds only the diagram if needed.
// When the card is too narrow for five columns of nodes (small laptops, tablets, phones) the diagram is drawn as a stacked
// flow instead ("stack" mode, plain HTML that wraps by itself), so it never has to scroll sideways.
let diagAvail = 0, lastNW = 0;
const nwFor = avail => Math.max(200, Math.min(300, Math.floor((avail - 4 * 28) / 5)));   // 200 px is the narrowest node that still fits its longest line ("20% this cycle  +IDR 2,596,320")
const isStack = avail => avail < 5 * 200 + 4 * 28;
function decorateDiagram() {
  document.querySelectorAll('.diagram svg path').forEach(p => p.setAttribute('pathLength', '1'));
  document.querySelectorAll('.dnode').forEach((n, i) => { const t = parseFloat(n.style.top); n.style.setProperty('--d', (isNaN(t) ? 0.1 + i * 0.05 : 0.12 + t / 1000).toFixed(2) + 's'); });
}
function fitDiagram() {
  const card = document.querySelector('.funnelcard'); if (!card || tab !== 'dash') return;
  const cs = getComputedStyle(card), avail = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); if (avail <= 0) return;
  diagAvail = avail;
  if ((isStack(avail) ? 'stack' : nwFor(avail)) !== lastNW) { card.innerHTML = diagram(K()); decorateDiagram(); }
}
const RING = {'#ffe9ee': 'red', '#e8f7ec': 'green', '#e3effa': 'blue'};
function diagram(k) {
  const c = k.c, S = c.salary, env = c.env;
  const avail = diagAvail || (($('#view').clientWidth || 1100) - 60), stack = isStack(avail);
  const CG = 28, NH = 80, LV = 50, NW = nwFor(avail), G = '#0a9d58';
  lastNW = stack ? 'stack' : NW;
  const pct = v => pc2(v / S * 100) + ' of salary';
  const X = i => i * (NW + CG);                 // col 0 = saving, 1 = fixed, 2-4 = budgets
  const Wd = 5 * NW + 4 * CG;
  const Y = [0, 1, 2, 3, 4].map(i => i * (NH + LV));
  const nodes = [], paths = [];
  const add = n => { nodes.push(n); return n; };
  const arrowDown = (a, b, col) => {   // straight/curved arrow from bottom of a to top of b
    const x1 = a.cx, ya = a.y + (a.h || NH), x2 = b.cx, yb = b.y - 10, my = (ya + yb) / 2;
    paths.push(`<path d="M${x1},${ya} C${x1},${my} ${x2},${my} ${x2},${yb}" fill="none" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/>
      <polygon points="${x2},${b.y} ${x2 - 6.5},${b.y - 11} ${x2 + 6.5},${b.y - 11}" fill="${col}"/>`);
  };

  const remW = NW, remCx = (X(1) + X(4) + NW) / 2, cashCx = X(0) + NW / 2;
  const sal = add({id: 'sal', cx: (cashCx + remCx) / 2, y: Y[0], w: NW, title: 'Salary', sub: fmtDate(c.payday), amt: S, color: BANK.bca, bg: BANK.bca, fg: '#fff', logo: 'bca'});
  const cash = add({id: 'cash', cx: cashCx, y: Y[1], w: NW, title: `${pc2(c.savePct)} to cash saving`, sub: pct(k.save), amt: k.save, color: BANK.bca, bg: '#e3effa'});
  const rem = add({id: 'rem', cx: remCx, y: Y[1], w: remW, title: 'Remaining', sub: `${pc2(100 - c.savePct)} of salary`, amt: k.afterSave, color: BANK.bca, bg: '#e3effa'});
  const savH = 66 + 14 * (3 + (k.transferred ? 1 : 0)), busY = Y[4] + NH + 28;      // the orange bus line enters the node at its vertical middle
  const sav = add({id: 'sav', cx: cashCx, y: busY - savH / 2, w: NW, h: savH, title: 'Cash saving', color: BANK.jago, bg: BANK.jago, fg: '#1a1a1a', logo: 'jago', amt: k.total,
    lines: [['Previous', rp(k.prev)], [pc2(c.savePct) + ' this cycle', inflow(k.save)], ['Leftovers', inflow(k.moved)], ...(k.transferred ? [['Moved to investments', outflow(k.transferred)]] : [])]});
  arrowDown(sal, cash, BANK.bca); arrowDown(sal, rem, BANK.bca); arrowDown(cash, sav, BANK.jago);

  // fixed expenses: single node
  const fix = add({id: 'fix', cx: X(1) + NW / 2, y: Y[2], w: NW, title: 'Fixed expenses', sub: pct(k.fixedTotal), tip: `${c.fixed.length} ${c.fixed.length === 1 ? 'item' : 'items'}`, amt: k.fixedTotal, color: BANK.fixed, bg: '#ffe9ee', neg: 1});
  arrowDown(rem, fix, BANK.fixed);

  // budgets: budget → real expenses → remaining → my cash saving
  [['daily', 'gopay', 2], ['date', 'jago', 3], ['free', 'jago', 4]].forEach(([key, w, col]) => {
    const e = env[key], color = BANK[w], sp = spent(e), rest = e.amount + (e.carry || 0) - sp, cx = X(col) + NW / 2;
    const b = add({id: key + 'b', cx, y: Y[2], w: NW, title: e.name, sub: pct(e.amount), tip: e.carry ? `Includes ${rp(e.carry)} carried over` : '', amt: e.amount + (e.carry || 0), color, logo: w, bg: color, fg: w === 'gopay' ? '#fff' : '#1a1a1a'});
    const ex = add({id: key + 'x', cx, y: Y[3], w: NW, title: 'Real expenses', sub: pct(sp), tip: sp ? `${e.spends.length} logged. Click to open.` : 'Nothing logged yet. Click to add.', amt: sp, color: BANK.fixed, bg: '#ffe9ee', neg: sp > 0 ? 1 : 0, click: `goSpend('${key}')`});
    const rm = add({id: key + 'r', cx, y: Y[4], w: NW, title: 'Remaining', color: G, bg: '#e8f7ec', pos: 1, amt: rest,
      sub: e.moved ? 'Moved · ' + pct(rest) : pct(rest), tip: e.moved ? 'Moved to cash saving. Click to undo.' : rest > 0 ? 'Click to move to cash saving.' : 'Nothing left to move.',
      click: e.moved ? `undoMove('${key}')` : rest > 0 ? `moveLeft('${key}')` : ''});
    arrowDown(rem, b, color); arrowDown(b, ex, BANK.fixed); arrowDown(ex, rm, G);
    // remaining → my cash saving (bus under the row, entering the saving node from the right)
    const sx = X(0) + NW + 2;
    paths.push(`<path d="M${cx},${Y[4] + NH} V${busY - 22} Q${cx},${busY} ${cx - 22},${busY} H${sx + 12}" fill="none" stroke="${BANK.jago}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`);
  });
  paths.push(`<polygon points="${X(0) + NW + 2},${busY} ${X(0) + NW + 14},${busY - 6.5} ${X(0) + NW + 14},${busY + 6.5}" fill="${BANK.jago}"/>`);

  const nodeHtml = (n, abs) => {
    const h = n.h || NH, place = abs ? `left:${n.cx - n.w / 2}px;top:${n.y}px;width:${n.w}px;height:${h}px;` : '';   // stack mode: the CSS places the node
    return `<div class="dnode ${n.logo ? 'hl' : ''} ${n.click ? 'click' : ''}" ${RING[n.bg] ? `data-ring="${RING[n.bg]}"` : ''} ${n.click ? `onclick="${n.click}"` : ''} ${n.tip ? `data-tip="${esc(n.tip)}"` : ''} style="${place}background:${n.bg || '#fff'};color:${n.fg || 'inherit'}">
      ${n.logo ? `<img class="mini" src="/static/logos/${n.logo}.svg">` : ''}
      <div class="dt">${esc(n.title)}</div>
      <div class="da ${n.neg ? 'neg' : ''} ${n.pos ? 'pos' : ''}" style="${n.fg ? 'color:' + n.fg + ';' : ''}${n.big ? 'font-size:20px' : ''}">${rp(n.amt)}</div>
      ${n.lines ? n.lines.map(l => `<div class="ds" style="display:flex;justify-content:space-between;${n.fg ? 'color:' + n.fg + ';opacity:.85' : ''}"><span>${l[0]}</span><b style="color:inherit">${l[1]}</b></div>`).join('') : `<div class="ds" ${n.fg ? `style="color:${n.fg};opacity:.8"` : ''}>${esc(n.sub)}</div>`}</div>`;
  };

  if (stack) {   // Salary, then the 20% / remaining split, then one chain per budget, then Cash saving
    const N = id => nodeHtml(nodes.find(n => n.id === id), false), arrow = col => `<div class="flow-arrow" style="--c:${col}"></div>`;
    const chain = (ids, cols) => `<div class="flow-chain">${ids.map((id, i) => (i ? arrow(cols[i - 1]) : '') + N(id)).join('')}</div>`;
    return `<div class="flow">
      <div class="flow-one">${N('sal')}</div>${arrow(BANK.bca)}
      <div class="flow-pair">${N('cash')}${N('rem')}</div>${arrow(BANK.bca)}
      <div class="flow-cols">${chain(['fix'], [])}${['daily', 'date', 'free'].map(key => chain([key + 'b', key + 'x', key + 'r'], [BANK.fixed, G])).join('')}</div>
      ${arrow(BANK.jago)}
      <div class="flow-one">${N('sav')}</div></div>`;
  }
  const Ht = Math.max(...nodes.map(n => n.y + (n.h || NH)));
  return `<div class="diagram" style="width:${Wd}px;height:${Ht + 40}px;margin:0 auto"><svg width="${Wd}" height="${Ht + 40}">${paths.join('')}</svg>${nodes.map(n => nodeHtml(n, true)).join('')}</div>`;
}

function dash(k) {
  const c = k.c, S = c.salary, env = c.env;
  const spentTotal = ['daily', 'date', 'free'].reduce((t, key) => t + spent(env[key]), 0);
  const expense = k.fixedTotal + spentTotal;                                   // fixed + everything logged so far
  const remaining = ['daily', 'date', 'free'].reduce((t, key) => t + left(env[key]), 0);   // still available in the pockets
  const wealthTotal = k.total + stockCalc().equity + goldCalc().value;
  const tile = (name, tone) => `<div class="ico t-${tone}" style="width:86px;height:48px;border-radius:16px">${icon(name, 'filled', 24)}</div>`;
  return `
  <div class="grid g4">
    <div class="pocket bca"><div class="row">${logo('bca')}<div><div class="name">Salary</div></div></div><div class="big-num">${rp(S)}</div></div>
    <div class="pocket expense"><div class="row">${tile('receipt', 'red')}<div><div class="name">Total expenses</div><div class="sub">${pc2(expense / S * 100)} of salary</div></div></div><div class="big-num">${rp(expense)}</div></div>
    <div class="pocket remain"><div class="row">${tile('moneyhand', 'green')}<div><div class="name">Total remaining</div><div class="sub">${pc2(remaining / S * 100)} of salary</div></div></div><div class="big-num">${rp(remaining)}</div></div>
    <div class="pocket total"><div class="row">${tile('diamond', 'navy')}<div><div class="name">Total wealth</div></div></div><div class="big-num">${rp(wealthTotal)}</div></div>
  </div>
  <h2>Where your salary goes <span class="s">Log real expenses on the Spending page</span></h2>
  <div class="card funnelcard">${diagram(k)}</div>`;
}

function envCard(c, key) {
  const e = c.env[key], sp = spent(e), l = left(e), pc = Math.min(100, Math.max(0, (sp + e.moved) / Math.max(e.amount, 1) * 100));
  return `<div class="card" style="border-top:6px solid ${BANK[e.wallet]}">
    <div class="row" style="justify-content:space-between">${logo(e.wallet)}<div class="a" style="margin:0;font-size:20px">${rp(e.amount)}</div></div>
    <div class="t" style="font-size:17px;margin-top:14px;white-space:nowrap">${icon(e.icon, 'regular', 16)} ${e.name}</div>
    <div class="s">${e.sub} · ${WALLET[e.wallet]}</div>
    <div class="prog"><i class="${l < 0 ? 'over' : ''}" style="width:${pc}%"></i></div>
    <div class="s" style="display:flex;justify-content:space-between"><span>Spent ${rp(sp)}${e.moved ? ` · Moved ${rp(e.moved)}` : ''}</span><span>Left <b style="color:${l < 0 ? 'var(--red)' : 'var(--ink)'}">${rp(l)}</b></span></div>
  </div>`;
}

// ---------- wealth: savings + Stockbit (prices from Yahoo Finance) + gold ----------
let wealthTab = 'savings', quotes = {}, quotesAt = 0;

const flash = {};
function marketOpen() {            // IDX trades Mon-Fri, roughly 09:00-16:00 WIB (UTC+7)
  const w = new Date(Date.now() + 7 * 3600e3), d = w.getUTCDay(), h = w.getUTCHours() + w.getUTCMinutes() / 60;
  return d >= 1 && d <= 5 && h >= 9 && h < 16;
}
const TREASURY_FACTOR = 0.998;   // Treasury's sell price was 0.2% under the Yahoo-based spot estimate when checked on 26 Nov 2026
function livePrice() {
  const g = quotes['GC=F'], fx = quotes['USDIDR=X'];
  if (g && fx && g.price && fx.price) return Math.round(g.price * fx.price / 31.1034768 * TREASURY_FACTOR);
  return S.wealth.gold.lastAuto || 0;
}
async function loadQuotes(force) {
  if (typeof S === 'undefined' || !S || !S.wealth) return;
  const hs = S.wealth.stocks.holdings;
  try {
    const syms = hs.map(h => h.ticker + '.JK').concat(['GC=F', 'USDIDR=X']);
    const fresh = GUEST ? demoQuotes(syms) : await (await fetch('/api/quotes?symbols=' + syms.join(',') + (force ? '&refresh=1' : ''))).json();
    const before = {...quotes};
    let changed = false;
    Object.keys(fresh).forEach(s => {
      const o = before[s], n = fresh[s];
      if (o && n.price != null && o.price != null && n.price !== o.price) {
        flash[s] = n.price > o.price ? 'up' : 'down'; changed = true; setTimeout(() => { delete flash[s]; }, 1600);
      }
      if (!o || o.stale !== n.stale) changed = true;
    });
    quotes = fresh; quotesAt = Date.now();
    hs.forEach(h => { const q = quotes[h.ticker + '.JK']; if (q && q.price != null) h.lastValue = Math.round(h.lots * 100 * q.price); });
    const lp = livePrice(); if (lp && lp !== S.wealth.gold.lastAuto) { S.wealth.gold.lastAuto = lp; changed = true; }
    if (changed) persist();
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName);
    if (tab === 'wealth' && !typing && (changed || !before || !Object.keys(before).length)) render();
    else { const el = document.getElementById('quoteTime'); if (el) el.textContent = new Date().toLocaleTimeString('en-GB'); }
  } catch (e) { /* offline: keep last known values */ }
}
// poll often while the market is open, slowly when it is closed, and not at all while the tab is hidden
function schedulePoll() {
  setTimeout(async () => { if (!document.hidden) await loadQuotes(); schedulePoll(); }, marketOpen() ? 15000 : 120000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadQuotes(); });

function stockCalc() {
  const st = S.wealth.stocks;
  const rows = st.holdings.map((h, i) => {
    const q = quotes[h.ticker + '.JK'] || {}, shares = h.lots * 100, price = q.price != null ? q.price : null;
    const value = price != null ? shares * price : (h.lastValue || 0), pl = value - h.invested;
    return {h, i, q, shares, price, value, pl, ret: h.invested ? pl / h.invested * 100 : 0, avg: shares ? h.invested / shares : 0,
      day: q.prev ? (q.price - q.prev) / q.prev * 100 : null};
  });
  const invested = rows.reduce((a, r) => a + r.h.invested, 0), value = rows.reduce((a, r) => a + r.value, 0), pl = value - invested;
  return {rows, invested, value, pl, ret: invested ? pl / invested * 100 : 0, cash: st.cash, equity: value + st.cash};
}
const signed = v => v > 0 ? '+' + pc2(v) : v < 0 ? '−' + pc2(Math.abs(v)) : pc2(v);
const plClass = v => v < 0 ? 'neg' : v > 0 ? 'pos' : '';

function wealth(k) {
  const sc = stockCalc(), gc = goldCalc(), total = k.total + sc.equity + gc.value;
  const kpi = (cls, logoHtml, name, amt, sub = '') => `<div class="pocket ${cls}"><div class="row">${logoHtml}<div><div class="name">${name}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div><div class="big-num">${amt}</div></div>`;
  const tabs = [['savings', 'Cash saving', 'Bank Jago', k.total], ['stocks', 'Stockbit', 'Stocks', sc.equity], ['gold', 'Treasury', 'Gold', gc.value]];
  const panel = {savings: () => savingsPanel(k) + transferList(), stocks: () => stockPanel(k), gold: goldPanel}[wealthTab]();
  return `
  <div class="grid g4">
    ${kpi('total', `<div class="ico t-navy" style="width:86px;height:48px;border-radius:16px">${icon('diamond', 'filled', 24)}</div>`, 'Total wealth', rp(total))}
    ${kpi('jago', logo('jago'), 'Cash saving', rp(k.total))}
    ${kpi('stockbit', logo('stockbit'), 'Stockbit', rp(sc.equity), 'Total equity')}
    ${kpi('gold', logo('treasury'), 'Treasury', rp(gc.value), 'Total value')}
  </div>
  <div class="tabs" style="margin-top:24px">${tabs.map(([key, name, sub, v]) =>
    `<button class="tab ${key === wealthTab ? 'on' : ''}" style="--tc:${{savings: BANK.jago, stocks: '#2d2d2d', gold: '#e6c800'}[key]}" onclick="setWealthTab('${key}')">${name}<span>${rp(v)}</span></button>`).join('')}</div>
  <div class="wpanel">${panel}</div>`;
}
function setWealthTab(t) { wealthTab = t; render(); }

function stockPanel(k) {
  const sc = stockCalc(), stale = Object.values(quotes).some(q => q.stale), noPrices = !Object.keys(quotes).length;
  const upd = quotesAt ? new Date(quotesAt).toLocaleTimeString('en-GB') : '';
  const box = (label, val, cls = '', sub = '') => `<div class="stat"><div class="s">${label}</div><b class="${cls}">${val}</b>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  return `
  <div class="note"><span class="ni">ⓘ</span><div>${GUEST ? 'These values are made up for this demo. Prices are simulated and change a little on every refresh.' : 'These values are estimates. Prices come from Yahoo Finance and are delayed by about 10 minutes, so the numbers can differ slightly from your Stockbit app. Check the Stockbit app for your exact figures.'}</div></div>
  <div class="grid g3" style="margin-bottom:14px">
    <div class="stat"><div class="s">Trading balance</div><input class="money big" inputmode="numeric" autocomplete="off" value="${fm(sc.cash)}" onchange="setCash(this.value)"></div>
    ${box('Invested', rp(sc.invested))}
    ${box('Market value', rp(sc.value))}
    ${box('P&L', (sc.pl > 0 ? '+' : '') + rp(sc.pl), plClass(sc.pl))}
    ${box('Return', signed(sc.ret), plClass(sc.ret))}
    ${box('Total equity', rp(sc.equity))}
  </div>
  <div class="card" style="margin-bottom:14px">
    <div class="row" style="margin-bottom:6px"><div class="t" style="font-size:18px">Top up from cash saving</div><div class="s" style="margin-left:auto">Available in cash saving: <b>${rp(k.total)}</b></div></div>
    <div class="s" style="margin-bottom:10px">Moves money from your cash saving (Bank Jago) to your Stockbit trading balance. Your total wealth stays the same.</div>
    <form class="add" onsubmit="topUp(event)" style="margin-top:0">
      <input name="date" type="date" value="${today()}" required style="flex:0 0 160px"><input name="amt" class="money" inputmode="numeric" autocomplete="off" placeholder="Amount" required style="flex:0 0 200px;text-align:right"><input name="note" placeholder="Remarks"><button>Top up</button>
    </form>
  </div>
  <div class="card">
    <div class="row" style="margin-bottom:10px"><div class="t" style="font-size:18px">Holdings</div>
      <div class="s" style="margin-left:auto;display:flex;align-items:center;gap:10px"><span class="live ${marketOpen() ? 'on' : ''}"><i></i>${marketOpen() ? 'Live' : 'Market closed'}</span>${noPrices ? 'Loading prices…' : `${GUEST ? 'Simulated prices' : 'Yahoo Finance, delayed ~10 min'} · updated <span id="quoteTime">${upd}</span>${stale ? ' · <b class="neg">some prices are old</b>' : ''}`}<button class="link" onclick="loadQuotes(true).then(render)">Refresh</button></div></div>
    <form id="hadd" onsubmit="addHolding(event)"></form>
    <table class="crud">
      <tr><th style="width:150px">Stock</th><th class="r" style="width:110px">Lots</th><th class="r" style="width:190px">Invested</th><th class="r">Avg price</th><th class="r">Last price</th><th class="r">Today</th><th class="r">Market value</th><th class="r">P&L</th><th class="r">Return</th><th style="width:80px"></th></tr>
      <tr class="newrow">
        <td><input form="hadd" name="ticker" placeholder="e.g. BBCA" required style="text-transform:uppercase"></td>
        <td><input form="hadd" name="lots" type="number" min="1" placeholder="Lots" required style="text-align:right"></td>
        <td><input form="hadd" name="inv" class="money" inputmode="numeric" autocomplete="off" placeholder="Invested" required style="text-align:right"></td>
        <td colspan="6" class="s"><div class="row" style="gap:10px;align-items:center"><input form="hadd" type="checkbox" name="fund" id="fundchk" class="chk" checked>
          <div><label for="fundchk" style="cursor:pointer">Pay from trading balance (untick to record a holding you already own)</label><div>1 lot = 100 shares. Invested = the total buy cost shown in Stockbit.</div></div></div></td>
        <td class="r"><button form="hadd" class="cta inline" style="padding:9px 18px">+ Add</button></td></tr>
      ${sc.rows.map(r => `<tr>
        <td><b>${esc(r.h.ticker)}</b><div class="s">${Math.round(r.shares).toLocaleString('en-US')} shares</div></td>
        <td><input type="number" min="0" value="${r.h.lots}" onchange="editHolding(${r.i},'lots',this.value)" style="text-align:right"></td>
        <td><input class="money" inputmode="numeric" autocomplete="off" value="${fm(r.h.invested)}" onchange="editHolding(${r.i},'invested',this.value)" style="text-align:right"></td>
        <td class="r">${rp(r.avg)}</td>
        <td class="r ${flash[r.h.ticker + '.JK'] ? 'flash-' + flash[r.h.ticker + '.JK'] : ''}">${r.price != null ? rp(r.price) : '—'}</td>
        <td class="r ${plClass(r.day || 0)}">${r.day != null ? signed(r.day) : '—'}</td>
        <td class="r ${flash[r.h.ticker + '.JK'] ? 'flash-' + flash[r.h.ticker + '.JK'] : ''}"><b>${rp(r.value)}</b></td>
        <td class="r ${plClass(r.pl)}"><b>${(r.pl > 0 ? '+' : '') + rp(r.pl)}</b></td>
        <td class="r ${plClass(r.ret)}"><b>${signed(r.ret)}</b></td>
        <td class="r"><button class="link" onclick="delHolding(${r.i})">Delete</button></td></tr>`).join('')}
    </table>
  </div>`;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function goldCalc() {
  const g = S.wealth.gold, grams = g.items.reduce((a, x) => a + x.grams, 0), paid = g.items.reduce((a, x) => a + x.paid, 0), price = livePrice() || 0, manual = false;
  const value = price ? grams * price : paid;
  return {grams, paid, price, manual, value, pl: value - paid, ret: paid ? (value - paid) / paid * 100 : 0};
}
function goldPanel() {
  const gc = goldCalc(), items = [...S.wealth.gold.items].sort((a, b) => b.date.localeCompare(a.date));
  const box = (label, val, cls = '', sub = '') => `<div class="stat"><div class="s">${label}</div><b class="${cls}">${val}</b>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  return `
  <div class="note"><span class="ni">ⓘ</span><div>${GUEST ? 'These values are made up for this demo. The gold price is calculated from simulated gold futures and a simulated USD to IDR rate.' : "These values are estimates. The price is calculated from Yahoo Finance gold futures and the USD to IDR rate, so it can differ slightly from Treasury's own buy and sell prices. Check the Treasury app for your exact figures."}</div></div>
  <div class="grid g4" style="margin-bottom:14px">
    ${box('Total grams', gc.grams.toLocaleString('en-US', {maximumFractionDigits: 6}) + ' g')}
    ${box('Invested', rp(gc.paid))}
    ${box('Value now', rp(gc.value), '', gc.price ? 'Live estimate' : 'Loading price…')}
    ${box('P&L', (gc.pl > 0 ? '+' : '') + rp(gc.pl) + ' (' + signed(gc.ret) + ')', plClass(gc.pl))}
  </div>
  <div class="card">
    <div class="row" style="margin-bottom:10px"><div class="t" style="font-size:18px">Treasury purchases</div>
      <div class="row" style="margin-left:auto;gap:12px"><span class="s">Today's price per gram</span><b class="price-amt">${gc.price ? rp(gc.price) : 'Loading…'}</b><span class="live on"><i></i>Live</span></div></div>
    <div class="s" style="margin-bottom:10px">Each new purchase is taken from your cash saving. ${GUEST ? 'The price is simulated for this demo.' : "The live price is estimated from Yahoo Finance gold futures and the USD to IDR rate, matched to Treasury's sell price."}</div>
    <form id="gadd" onsubmit="addGold(event)"></form>
    <table class="crud">
      <tr><th style="width:150px">Date</th><th class="r" style="width:120px">Grams</th><th class="r">Paid</th><th class="r">Price per gram</th><th class="r">Value now</th><th class="r">P&L</th><th>Remarks</th><th style="width:130px"></th></tr>
      <tr class="newrow">
        <td><input form="gadd" type="date" name="date" value="${today()}" required></td>
        <td><input form="gadd" name="grams" type="number" step="0.000001" min="0.000001" placeholder="Grams" required style="text-align:right"></td>
        <td><input form="gadd" name="paid" class="money" inputmode="numeric" autocomplete="off" placeholder="Amount paid" required style="text-align:right"></td>
        <td colspan="3" class="s">Taken from cash saving</td>
        <td><input form="gadd" name="note" placeholder="Remarks"></td>
        <td class="r"><button form="gadd" class="cta inline" style="padding:9px 18px">+ Add</button></td></tr>
      ${items.map(x => { const val = gc.price ? x.grams * gc.price : x.paid; return `<tr>
        <td>${fmtDate(x.date)}</td><td class="r">${x.grams.toLocaleString('en-US', {maximumFractionDigits: 6})} g</td><td class="r">${rp(x.paid)}</td>
        <td class="r">${rp(x.paid / x.grams)}</td><td class="r"><b>${rp(val)}</b></td>
        <td class="r ${plClass(val - x.paid)}"><b>${(val - x.paid > 0 ? '+' : '') + rp(val - x.paid)}</b></td><td>${esc(x.note || '—')}</td>
        <td class="r"><button class="link" onclick="delGold('${x.id}')">Delete</button></td></tr>`; }).join('')}
      ${items.length ? '' : '<tr><td colspan="8" class="s" style="text-align:center;padding:22px">No Treasury purchases yet. Add your first purchase above.</td></tr>'}
    </table>
  </div>`;
}

function transferList() {
  const list = [...S.wealth.transfers].sort((a, b) => b.date.localeCompare(a.date));
  return `<h2>Moved from cash saving <span class="s">Investments and other spending, also shown on the Spending page</span></h2>
  <div class="card"><table>
    <tr><th>Date</th><th>To</th><th>Remarks</th><th class="r">Amount</th><th></th></tr>
    ${list.map(t => `<tr><td>${fmtDate(t.date)}</td><td><span class="cchip">${t.type === 'gold' ? '<img src="/static/logos/treasury-icon.png" style="height:14px;vertical-align:-2px"> Treasury' : t.type === 'expense' ? catLabel(t.cat || 'Other') : '<span class="ic">' + icon('trending', 'regular', 14) + '</span> Stockbit'}</span></td><td>${esc(t.note || '—')}</td><td class="r neg"><b>−${rp(t.amount)}</b></td>
      <td class="r"><button class="link" onclick="delTransfer('${t.id}')">Delete</button></td></tr>`).join('')}
    ${list.length ? '' : '<tr><td colspan="5" class="s" style="text-align:center;padding:22px">Nothing moved yet. Top up Stockbit or buy from Treasury and it will show here.</td></tr>'}
  </table></div>`;
}

function topUp(ev) {
  ev.preventDefault(); const f = ev.target, amt = num(f.amt.value); if (!amt) return;
  if (amt > K().total && !confirm('This is more than your current cash saving. Continue anyway?')) return;
  S.wealth.transfers.push({id: uid(), date: f.date.value, type: 'stockbit', cat: 'Investment', amount: amt, note: f.note.value.trim()});
  S.wealth.stocks.cash += amt; commit();
}
function delTransfer(id) {
  const t = S.wealth.transfers.find(x => x.id === id); if (!t || !confirm('Delete this transfer? The money goes back to your cash saving.')) return;
  S.wealth.transfers = S.wealth.transfers.filter(x => x.id !== id);
  if (t.type === 'stockbit') S.wealth.stocks.cash -= t.amount;
  if (t.type === 'gold') S.wealth.gold.items = S.wealth.gold.items.filter(x => x.id !== t.goldId);
  commit();
}
function addGold(ev) {
  ev.preventDefault(); const g = n => document.querySelector(`[form=gadd][name=${n}]`);
  const grams = Number(g('grams').value), paid = num(g('paid').value); if (!grams || !paid) return;
  if (paid > K().total && !confirm('This is more than your current cash saving. Continue anyway?')) return;
  const id = uid();
  S.wealth.gold.items.push({id, date: g('date').value, grams, paid, note: g('note').value.trim()});
  S.wealth.transfers.push({id: 't' + id, date: g('date').value, type: 'gold', cat: 'Investment', amount: paid, note: g('note').value.trim(), goldId: id}); commit();
}
function delGold(id) {
  const taken = S.wealth.transfers.some(x => x.goldId === id);
  if (!confirm(taken ? 'Delete this Treasury purchase? The money goes back to your cash saving.' : 'Delete this Treasury purchase?')) return;
  S.wealth.gold.items = S.wealth.gold.items.filter(x => x.id !== id);
  S.wealth.transfers = S.wealth.transfers.filter(x => x.goldId !== id); commit();
}

function addHolding(ev) {
  ev.preventDefault(); const g = n => document.querySelector(`[form=hadd][name=${n}]`);
  const t = g('ticker').value.trim().toUpperCase().replace(/\.JK$/, ''), lots = Number(g('lots').value), inv = num(g('inv').value);
  if (!t || !lots) return;
  if (g('fund').checked) {
    if (inv > S.wealth.stocks.cash) { alert('Your trading balance is lower than this purchase. Top up from cash saving first.'); return; }
    S.wealth.stocks.cash -= inv;
  }
  S.wealth.stocks.holdings.push({ticker: t, lots, invested: inv}); persist(); render(); loadQuotes();
}
function editHolding(i, f, v) { S.wealth.stocks.holdings[i][f] = f === 'lots' ? (Number(v) || 0) : num(v); commit(); }
function delHolding(i) { if (confirm('Delete this holding?')) { S.wealth.stocks.holdings.splice(i, 1); commit(); } }
function setCash(v) { S.wealth.stocks.cash = num(v); commit(); }

function savingsPanel(k) {
  const all = calcAll();
  return `
  <div class="grid g2">
    <div class="pocket jago"><div class="row">${logo('jago')}<div><div class="name">Cash saving</div></div></div>
      <div class="big-num">${rp(k.total)}</div>
      <div style="margin-top:16px;background:rgba(255,255,255,.4);border-radius:14px;padding:6px 16px">
        <div class="kv"><span>Previous savings</span><span>${rp(k.prev)}</span></div>
        <div class="kv"><span>${pc2(k.c.savePct)} of ${k.c.label} salary</span><span>${inflow(k.save)}</span></div>
        <div class="kv"><span>Leftovers</span><span>${inflow(k.moved)}</span></div>
        <div class="kv"><span>Moved to investments</span><span>${outflow(k.transferred)}</span></div>
        <div class="kv total"><span>Total</span><span>${rp(k.total)}</span></div>
      </div></div>
    <div class="card"><div class="t" style="font-size:18px;font-weight:900;margin-bottom:8px">Leftovers moved in this cycle</div>
      ${['daily', 'date', 'free'].map(x => { const e = k.c.env[x]; return `<div class="li"><div class="ico t-ink">${icon(e.icon, 'filled', 20)}</div><div class="t">${e.name}</div><div class="a ${e.moved ? 'pos' : ''}">${e.moved ? '+' : ''}${rp(e.moved)}</div></div>`; }).join('')}
      <div class="s" style="margin-top:12px">Move leftovers from the Spending page.</div></div>
  </div>
  <h2>History</h2>
  <div class="card"><table>
    <tr><th>Cycle</th><th class="r">Previous</th><th class="r">Saved from salary</th><th class="r">Leftovers</th><th class="r">Moved to investments</th><th class="r">Total</th></tr>
    ${all.map(x => `<tr class="${x.c.id === S.activeId ? 'cur' : ''}"><td><b>${x.c.label}</b></td><td class="r">${rp(x.prev)}</td><td class="r">${inflow(x.save)} <span class="s">(${pc2(x.c.savePct)})</span></td><td class="r">${inflow(x.moved)}</td><td class="r">${outflow(x.transferred)}</td><td class="r"><b>${rp(x.total)}</b></td></tr>`).join('')}
  </table></div>`;
}

const CATS = ['Food & drink', 'Groceries', 'Transport', 'Entertainment', 'Date', 'Shopping', 'Health', 'Housing', 'Installments', 'Subscriptions', 'Bills & utilities', 'Investment', 'Other'];
const CAT_ICON = {'Food & drink': 'food', 'Groceries': 'cart', 'Transport': 'car', 'Entertainment': 'movies', 'Date': 'heart', 'Shopping': 'bag', 'Health': 'heartpulse', 'Housing': 'home', 'Installments': 'card', 'Subscriptions': 'repeat', 'Bills & utilities': 'flash', 'Investment': 'trending', 'Other': 'box'};
const catLabel = n => `<span class="ic">${icon(CAT_ICON[n] || 'box', 'regular', 16)}</span> ${esc(n)}`;
const catOpts = sel => CATS.map(n => `<option value="${n}" ${n === sel ? 'selected' : ''}>${n}</option>`).join('');
const today = () => new Date().toLocaleDateString('sv-SE');
let spendTab = 'daily', editing = null;
const TAB_WALLET = {daily: 'gopay', date: 'jago', free: 'jago'};

const miniTile = (name, tone = 'ink') => `<div class="ico t-${tone}">${icon(name, 'filled', 20)}</div>`;
function mini(cls, tile, title, val, sub = '', raw = false, vcls = '') {
  return `<div class="pocket mini ${cls}"><div class="row">${tile}<div><div class="name">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>${raw ? val : `<div class="big-num ${vcls}">${val}</div>`}</div>`;
}

let fixedOpen = false, justOpenedFixed = false;
function toggleFixed() { fixedOpen = !fixedOpen; justOpenedFixed = fixedOpen; render(); justOpenedFixed = false; }

function spend(k) {
  const c = k.c, e = c.env[spendTab] || c.env.daily, l = left(e), sp = spent(e), w = TAB_WALLET[spendTab];
  const rows = e.spends.map((x, i) => ({x, i})).sort((a, b) => b.x.date.localeCompare(a.x.date) || b.i - a.i);
  const byCat = {}; e.spends.forEach(x => byCat[x.cat || 'Other'] = (byCat[x.cat || 'Other'] || 0) + x.amt);
  const opts = catOpts;
  return `
  <div class="card">
    <div class="row foldhead" onclick="toggleFixed()" style="${fixedOpen ? 'margin-bottom:8px' : ''}"><span class="chev">${icon(fixedOpen ? 'chevdown' : 'chevright', 'regular', 16)}</span><div class="t" style="font-size:18px;font-weight:900">Fixed expenses</div><div class="s">${c.fixed.length} ${c.fixed.length === 1 ? 'item' : 'items'}</div><div class="a neg" style="font-size:18px">${rp(k.fixedTotal)}</div></div>
    ${fixedOpen ? `<div class="foldbody ${justOpenedFixed ? 'opening' : ''}">
    <form id="fadd" onsubmit="addFixed(event)"></form>
    ${selBar('fixed', c.fixed.length)}
    <table class="crud">
      <tr><th style="width:36px"></th><th style="width:240px">Category</th><th>Remarks</th><th class="r" style="width:190px">Amount</th><th style="width:130px"></th></tr>
      <tr class="newrow"><td></td>
        <td><select form="fadd" name="cat">${catOpts('')}</select></td>
        <td><input form="fadd" name="note" placeholder="Remarks (e.g. Monthly rent)" required></td>
        <td><input form="fadd" name="amt" class="money" inputmode="numeric" autocomplete="off" placeholder="Amount" required style="text-align:right"></td>
        <td class="r"><button form="fadd" class="cta inline" style="padding:9px 18px">+ Add</button></td></tr>
      ${c.fixed.map((x, i) => `<tr>
        <td>${chk('fixed', i)}</td><td><select onchange="editFixedField(${i},'cat',this.value)">${catOpts(x.cat)}</select></td>
        <td><input value="${esc(x.name)}" onchange="editFixedField(${i},'name',this.value)"></td>
        <td><input class="money" inputmode="numeric" autocomplete="off" value="${fm(x.amount)}" onchange="editFixed(${i},this.value)" style="text-align:right;color:var(--red);font-weight:900"></td>
        <td class="r"><button class="link" onclick="delFixed(${i})">Delete</button></td></tr>`).join('')}
    </table>
    </div>` : ''}
  </div>

  <h2>Budget spending</h2>
  <div class="tabs">${['daily', 'date', 'free', 'cash'].map(key => {
    if (key === 'cash') return `<button class="tab ${spendTab === 'cash' ? 'on' : ''}" style="--tc:${BANK.jago}" onclick="setSpendTab('cash')"><span class="ic" style="color:var(--tc)">${icon('savings', 'filled', 16)}</span> Cash saving<span>${rp(k.total)} available</span></button>`;
    const b = c.env[key];
    return `<button class="tab ${key === spendTab ? 'on' : ''}" style="--tc:${BANK[TAB_WALLET[key]]}" onclick="setSpendTab('${key}')"><span class="ic" style="color:var(--tc)">${icon(b.icon, 'filled', 16)}</span> ${b.name}<span>${rp(left(b))} available</span></button>`; }).join('')}</div>

  ${spendTab === 'cash' ? cashPanel(k) : `<div class="card" style="border-top-left-radius:0">
    <div class="grid g4" style="margin-bottom:14px;gap:14px">
      ${mini(w === 'gopay' ? 'gopay' : 'jago', logo(w), e.name, rp(e.amount + (e.carry || 0)), e.carry ? 'Includes ' + rp(e.carry) + ' carried over' : '')}
      ${mini('plain', miniTile('receipt', 'red'), 'Spent', rp(sp), '', false, 'neg')}
      ${mini('plain', miniTile('moneyhand', 'green'), e.moved ? 'Left (moved to cash saving)' : 'Left', rp(l), '', false, l < 0 ? 'neg' : 'pos')}
      ${e.moved
        ? `<div class="stat" style="display:flex;align-items:center;justify-content:center"><div style="text-align:center"><span class="chip">Moved ${rp(e.moved)} to cash saving</span><br><button class="link" onclick="undoMove('${spendTab}')">Undo</button></div></div>`
        : `<button class="cta ghost move-btn" ${l <= 0 ? 'disabled' : ''} onclick="moveLeft('${spendTab}')">Move ${l > 0 ? rp(l) : 'leftover'} to cash saving</button>`}
    </div>
    ${spendTab === 'daily' ? dailyStats(e) : ''}
    ${Object.keys(byCat).length ? `<div class="catchips">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([n, v]) => `<span class="cchip">${catLabel(n)} <b>${rp(v)}</b></span>`).join('')}</div>` : ''}
    <form id="addf" onsubmit="addSpend(event)"></form><form id="ef" onsubmit="saveSpend(event)"></form>
    ${spendTab !== 'daily' ? selBar(spendTab, e.spends.length) : ''}
    <table class="crud">
      <tr><th style="width:36px"></th><th style="width:150px">Date</th><th style="width:190px">Category</th><th>Remarks</th><th class="r" style="width:150px">Amount</th><th style="width:140px"></th></tr>
      <tr class="newrow"><td></td>
        <td><input form="addf" type="date" name="date" value="${addDate}" required></td>
        <td><select form="addf" name="cat">${opts('')}</select></td>
        <td><input form="addf" name="note" placeholder="Remarks"></td>
        <td><input form="addf" name="amt" class="money" inputmode="numeric" autocomplete="off" placeholder="Amount" required style="text-align:right"></td>
        <td class="r"><button form="addf" class="cta inline" style="padding:9px 18px">+ Add</button></td></tr>
      ${(spendTab === 'daily' ? [] : rows).map(({x, i}) => editing && editing.key === spendTab && editing.i === i ? `
      <tr class="editing"><td></td>
        <td><input form="ef" type="date" name="date" value="${x.date}" required></td>
        <td><select form="ef" name="cat">${opts(x.cat)}</select></td>
        <td><input form="ef" name="note" value="${esc(x.note || '')}"></td>
        <td><input form="ef" name="amt" class="money" inputmode="numeric" autocomplete="off" value="${fm(x.amt)}" required style="text-align:right"></td>
        <td class="r"><button form="ef" class="link">Save</button> &nbsp; <button type="button" class="link" onclick="editing=null;render()">Cancel</button></td></tr>` : `
      <tr><td>${chk(spendTab, i)}</td><td>${fmtDate(x.date)}</td><td><span class="cchip">${catLabel(x.cat || 'Other')}</span></td><td>${esc(x.note || '—')}</td><td class="r neg"><b>−${rp(x.amt)}</b></td>
        <td class="r"><button class="link" onclick="editing={key:spendTab,i:${i}};render()">Edit</button> &nbsp; <button class="link" onclick="delSpend(spendTab,${i})">Delete</button></td></tr>`).join('')}
      ${rows.length || spendTab === 'daily' ? '' : '<tr><td colspan="6" class="s" style="text-align:center;padding:22px">No expenses yet. Add your first one above.</td></tr>'}
    </table>
    ${spendTab === 'daily' ? dayList(e) : ''}
  </div>`}`;
}

// money that leaves the cash saving: Stockbit top-ups, gold purchases and other spending
function cashPanel(k) {
  const c = k.c, all = S.wealth.transfers;
  const rows = all.map((t, i) => ({t, i})).filter(r => cycleOfDate(r.t.date) === c).sort((a, b) => b.t.date.localeCompare(a.t.date) || b.i - a.i);
  const sum = f => rows.filter(r => f(r.t)).reduce((a, r) => a + r.t.amount, 0);
  const invested = sum(t => t.type !== 'expense'), other = sum(t => t.type === 'expense');
  const catOf = t => t.type === 'expense' ? (t.cat || 'Other') : 'Investment';
  const stat = (label, val, cls = '', sub = '') => `<div class="stat"><div class="s">${label}</div><b class="${cls}">${val}</b>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  return `<div class="card" style="border-top-left-radius:0">
    <div class="grid g4" style="margin-bottom:14px;gap:14px">
      ${mini('jago', logo('jago'), 'Cash saving', rp(k.total))}
      ${mini('plain', miniTile('savings', 'green'), 'Added this cycle', rp(k.save + k.moved), pc2(k.c.savePct) + ' of salary + leftovers', false, 'pos')}
      ${mini('plain', miniTile('trending', 'navy'), 'Invested this cycle', rp(invested), 'Stockbit and Treasury', false, invested ? 'neg' : '')}
      ${mini('plain', miniTile('receipt', 'red'), 'Other spending', rp(other), '', false, other ? 'neg' : '')}
    </div>
    <div class="s" style="margin-bottom:10px">Everything here comes out of your cash saving. The Investment category is a Stockbit top-up, and it also shows on the Wealth page. Treasury purchases are added in the Treasury tab of the Wealth page and appear here too.</div>
    <form id="cadd" onsubmit="addCash(event)"></form><form id="cef" onsubmit="saveCash(event)"></form>
    <table class="crud">
      <tr><th style="width:150px">Date</th><th style="width:190px">Category</th><th>Remarks</th><th class="r" style="width:150px">Amount</th><th style="width:140px"></th></tr>
      <tr class="newrow">
        <td><input form="cadd" type="date" name="date" value="${today()}" required></td>
        <td><select form="cadd" name="cat">${catOpts('Investment')}</select></td>
        <td><input form="cadd" name="note" placeholder="Remarks"></td>
        <td><input form="cadd" name="amt" class="money" inputmode="numeric" autocomplete="off" placeholder="Amount" required style="text-align:right"></td>
        <td class="r"><button form="cadd" class="cta inline" style="padding:9px 18px">+ Add</button></td></tr>
      ${rows.map(({t}) => editing && editing.key === 'cash' && editing.id === t.id ? `
      <tr class="editing">
        <td><input form="cef" type="date" name="date" value="${t.date}" required></td>
        <td>${t.type === 'stockbit' ? `<span class="cchip">${catLabel('Investment')}</span>` : `<select form="cef" name="cat">${catOpts(catOf(t))}</select>`}</td>
        <td><input form="cef" name="note" value="${esc(t.note || '')}"></td>
        <td><input form="cef" name="amt" class="money" inputmode="numeric" autocomplete="off" value="${fm(t.amount)}" required style="text-align:right"></td>
        <td class="r"><button form="cef" class="link">Save</button> &nbsp; <button type="button" class="link" onclick="editing=null;render()">Cancel</button></td></tr>` : `
      <tr><td>${fmtDate(t.date)}</td><td><span class="cchip">${catLabel(catOf(t))}</span></td>
        <td>${t.note ? esc(t.note) + ' ' : t.type === 'expense' ? '—' : ''}${t.type === 'stockbit' ? '<span class="s">Stockbit top-up</span>' : t.type === 'gold' ? '<span class="s">Treasury purchase</span>' : ''}</td>
        <td class="r neg"><b>−${rp(t.amount)}</b></td>
        <td class="r">${t.type === 'gold' ? '' : `<button class="link" onclick="editing={key:'cash',id:'${t.id}'};render()">Edit</button> &nbsp; `}<button class="link" onclick="delTransfer('${t.id}')">Delete</button></td></tr>`).join('')}
      ${rows.length ? '' : '<tr><td colspan="5" class="s" style="text-align:center;padding:22px">Nothing has left your cash saving in this cycle.</td></tr>'}
    </table>
  </div>`;
}

function addCash(ev) {
  ev.preventDefault(); const g = n => document.querySelector(`[form=cadd][name=${n}]`);
  const amt = num(g('amt').value); if (!amt) return;
  if (amt > K().total && !confirm('This is more than your current cash saving. Continue anyway?')) return;
  const date = g('date').value, cat = g('cat').value, note = g('note').value.trim();
  if (cat === 'Investment') { S.wealth.transfers.push({id: uid(), date, type: 'stockbit', cat, amount: amt, note}); S.wealth.stocks.cash += amt; }
  else S.wealth.transfers.push({id: uid(), date, type: 'expense', cat, amount: amt, note});
  commit();
}
function saveCash(ev) {
  ev.preventDefault(); const g = n => document.querySelector(`[form=cef][name=${n}]`);
  const t = S.wealth.transfers.find(x => x.id === editing.id), amt = num(g('amt').value); if (!t || !amt) return;
  const cat = g('cat') ? g('cat').value : 'Investment';
  if (t.type === 'stockbit') S.wealth.stocks.cash += amt - t.amount;
  else if (cat === 'Investment') { t.type = 'stockbit'; S.wealth.stocks.cash += amt; }
  Object.assign(t, {date: g('date').value, note: g('note').value.trim(), amount: amt, cat});
  editing = null; commit();
}
const sel = new Set();
const chk = (scope, i) => `<input type="checkbox" class="chk" ${sel.has(scope + ':' + i) ? 'checked' : ''} onchange="toggleSel('${scope}',${i})">`;
const selCount = scope => [...sel].filter(k => k.startsWith(scope + ':')).length;
function selBar(scope, total) {
  if (!total) return '';
  const n = selCount(scope);
  return `<div class="selbar"><label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" class="chk" ${n === total ? 'checked' : ''} onchange="toggleAll('${scope}',this.checked)"> Select all</label>
    <span class="s">${n} selected</span><button class="danger" ${n ? '' : 'disabled'} onclick="delSelected('${scope}')">Delete selected${n ? ` (${n})` : ''}</button>${n ? '<button class="link" onclick="sel.clear();render()">Clear</button>' : ''}</div>`;
}
const listOf = scope => scope === 'fixed' ? cur().fixed : E(scope).spends;
function toggleSel(scope, i) { const k = scope + ':' + i; sel.has(k) ? sel.delete(k) : sel.add(k); render(); }
function toggleAll(scope, on) { [...sel].forEach(k => k.startsWith(scope + ':') && sel.delete(k)); if (on) listOf(scope).forEach((_, i) => sel.add(scope + ':' + i)); render(); }
function toggleDaySel(d) { const idx = E('daily').spends.map((x, i) => x.date === d ? i : -1).filter(i => i >= 0), all = idx.every(i => sel.has('daily:' + i));
  idx.forEach(i => all ? sel.delete('daily:' + i) : sel.add('daily:' + i)); render(); }
function delSelected(scope) {
  const idx = [...sel].filter(k => k.startsWith(scope + ':')).map(k => Number(k.split(':')[1])).sort((a, b) => b - a);
  if (!idx.length || !confirm(`Delete ${idx.length} ${idx.length === 1 ? 'item' : 'items'}? This cannot be undone.`)) return;
  idx.forEach(i => listOf(scope).splice(i, 1)); commit();
}
let addDate = today(), openDays = new Set([today()]);
const dayName = fmtDate;
const diffText = (spentV, capV) => spentV <= capV ? `${inflow(capV - spentV)} under` : `${outflow(spentV - capV)} over`;

function dailyStats(e) {
  const cap = e.cap || 60000, days = new Set(e.spends.map(x => x.date)).size, sofar = cap * days, sp = spent(e), ok = sp <= sofar;
  return `<div class="grid g4" style="margin-bottom:18px;gap:14px">
    ${mini('plain', miniTile('calday', 'cyan'), 'Daily cap', `<input class="money big" inputmode="numeric" autocomplete="off" value="${fm(cap)}" onchange="setCap(this.value)">`, 'Per day', true)}
    ${mini('plain', miniTile('calclock', 'cyan'), 'Days logged', days, `${rp(cap)} × ${days} ${days === 1 ? 'day' : 'days'}`)}
    ${mini('plain', miniTile('databar', 'cyan'), 'Budget so far', rp(sofar), 'Cap × days logged')}
    ${mini('plain ' + (days ? (ok ? 'good' : 'bad') : ''), miniTile('calculator', days ? (ok ? 'green' : 'red') : 'cyan'), 'Actual spend so far', rp(sp), days ? icon(ok ? 'check' : 'warning', 'filled', 13) + ' ' + diffText(sp, sofar) : 'Nothing logged yet', false, days ? (ok ? 'pos' : 'neg') : '')}
  </div>`;
}

function dayList(e) {
  const cap = e.cap || 60000, by = {};
  e.spends.forEach((x, i) => (by[x.date] = by[x.date] || []).push({x, i}));
  const days = Object.keys(by).sort().reverse();
  if (!days.length) return '<div class="s" style="text-align:center;padding:24px">No expenses yet. Add your first meal above. Entries are grouped by day automatically.</div>';
  return `<div class="daylist">${selBar('daily', e.spends.length)}<div class="s" style="margin:6px 0 10px">Grouped by day. Green means within the ${rp(cap)} cap, red means over.</div>` + days.map(d => {
    const list = by[d], tot = list.reduce((a, r) => a + r.x.amt, 0), ok = tot <= cap, open = openDays.has(d), pc = Math.min(100, tot / cap * 100);
    return `<div class="day ${ok ? 'good' : 'bad'}">
      <div class="dayhead" onclick="toggleDay('${d}')">
        <span class="chev">${icon(open ? 'chevdown' : 'chevright', 'regular', 16)}</span>
        <input type="checkbox" class="chk" onclick="event.stopPropagation()" onchange="toggleDaySel('${d}')" ${list.every(r => sel.has('daily:' + r.i)) ? 'checked' : ''}>
        <div><div class="t">${dayName(d)}</div><div class="s">${list.length} entr${list.length === 1 ? 'y' : 'ies'}</div></div>
        <div class="dbar"><i style="width:${pc}%"></i></div>
        <div style="text-align:right"><div class="${ok ? 'pos' : 'neg'}" style="font-weight:900;font-size:17px">${rp(tot)}</div><div class="s" style="font-weight:900;color:${ok ? '#0a9d58' : 'var(--red)'}">${diffText(tot, cap)}</div></div>
      </div>
      ${open ? `<div class="daybody ${justOpened === d ? 'opening' : ''}"><table class="crud">${list.map(({x, i}) => editing && editing.key === 'daily' && editing.i === i ? `
        <tr class="editing"><td style="width:36px"></td><td style="width:150px"><input form="ef" type="date" name="date" value="${x.date}" required></td>
          <td style="width:190px"><select form="ef" name="cat">${catOpts(x.cat)}</select></td>
          <td><input form="ef" name="note" value="${esc(x.note || '')}"></td>
          <td style="width:150px"><input form="ef" name="amt" class="money" inputmode="numeric" autocomplete="off" value="${fm(x.amt)}" required style="text-align:right"></td>
          <td class="r" style="width:140px"><button form="ef" class="link">Save</button> &nbsp; <button type="button" class="link" onclick="editing=null;render()">Cancel</button></td></tr>` : `
        <tr><td style="width:36px">${chk('daily', i)}</td><td style="width:150px"><span class="cchip">${catLabel(x.cat || 'Other')}</span></td><td>${esc(x.note || '—')}</td><td class="r neg" style="width:150px"><b>−${rp(x.amt)}</b></td>
          <td class="r" style="width:140px"><button class="link" onclick="editing={key:'daily',i:${i}};render()">Edit</button> &nbsp; <button class="link" onclick="delSpend('daily',${i})">Delete</button></td></tr>`).join('')}</table>
        <button class="link" style="margin:8px 0 4px" onclick="addToDay('${d}')">+ Add another entry to this day</button></div>` : ''}
    </div>`;
  }).join('') + '</div>';
}
function toggleDay(d) { const opening = !openDays.has(d); opening ? openDays.add(d) : openDays.delete(d); justOpened = opening ? d : null; render(); justOpened = null; }
function addToDay(d) { addDate = d; render(); const el = document.querySelector('[form=addf][name=amt]'); el.focus(); el.scrollIntoView({block: 'center', behavior: 'smooth'}); }
function setCap(v) { E('daily').cap = num(v) || 60000; commit(); }
function setSpendTab(k) { spendTab = k; editing = null; sel.clear(); render(); }
function goSpend(k) { spendTab = k; tab = 'spend'; editing = null; render(); scrollTo(0, 0); }

function envCardInner(c, key) { return envCard(c, key).replace(/^<div class="card">/, '<div>').replace(/<\/div>\s*$/, '</div>'); }

function newPreviewHtml(salary, dailyAmt, dateAmt, pctV) {
  const all = calcAll(), lk = all[all.length - 1], last = lk.c; if (pctV == null || isNaN(pctV)) pctV = last.savePct;
  if (!salary) return '<div class="s">Enter the salary to preview how it will be distributed.</div>';
  const save = Math.round(salary * pctV / 100), fixed = lk.fixedTotal, free = salary - save - fixed - dailyAmt - dateAmt;
  const carry = key => Math.max(0, left(last.env[key]));
  const row = (label, val, cls = '', sub = '') => `<div class="kv" style="padding:6px 0"><span>${label}${sub ? `<div class="s">${sub}</div>` : ''}</span><b class="${cls}">${val}</b></div>`;
  return `<div class="t" style="font-size:15px;margin:4px 0 6px">Automatic distribution</div>
    ${row('Salary (BCA)', rp(salary))}
    ${row(`${pc2(pctV)} to cash saving`, '−' + rp(save), 'neg', `Cash saving: ${rp(lk.total)} → ${rp(lk.total + save)}`)}
    ${row(`Fixed expenses (${last.fixed.length} copied)`, '−' + rp(fixed), 'neg')}
    ${row('Daily budget (GoPay)', rp(dailyAmt), '', carry('daily') ? `+ ${rp(carry('daily'))} carried over = ${rp(dailyAmt + carry('daily'))}` : '')}
    ${row('Date budget (Bank Jago)', rp(dateAmt), '', carry('date') ? `+ ${rp(carry('date'))} carried over = ${rp(dateAmt + carry('date'))}` : '')}
    ${row('Free to use (Bank Jago)', rp(free), free < 0 ? 'neg' : 'pos', carry('free') ? `+ ${rp(carry('free'))} carried over = ${rp(free + carry('free'))}` : (free < 0 ? 'Over-allocated. Lower a budget or a fixed expense.' : ''))}`;
}
function previewNew(f) {
  const sal = num(f.salary.value), d = num(f.dailyAmt.value), dt = num(f.dateAmt.value), pv = Number(f.pct.value);
  document.getElementById('newprev').innerHTML = newPreviewHtml(sal, d, dt, pv);
  const lk = calcAll().slice(-1)[0];
  f.free.value = sal ? fm(sal - Math.round(sal * pv / 100) - lk.fixedTotal - d - dt) : '';
}

function cycles(k) {
  const all = calcAll(), c = k.c, last = S.cycles[S.cycles.length - 1];
  const d = new Date(last.payday + 'T00:00'); d.setMonth(d.getMonth() + 1);
  const next = new Date(d.getFullYear(), d.getMonth(), 25).toLocaleDateString('sv-SE');
  const inp = (label, name, val, extra = '') => `<label class="s">${label}<input name="${name}" class="money" inputmode="numeric" autocomplete="off" value="${val}" required ${extra} style="width:100%;display:block;margin-top:4px"></label>`;
  const pctIn = (val) => `<label class="s">Cash saving %<input name="pct" type="number" step="0.01" min="0" max="100" value="${val}" required style="width:100%;display:block;margin-top:4px"></label>`;
  const freeIn = (val, id = '') => `<label class="s">Free to use (automatic)<input name="free" value="${val}" disabled placeholder="Calculated from salary" style="width:100%;display:block;margin-top:4px;font-weight:900"></label>`;
  return `
  <div class="grid g2" style="align-items:stretch">
    <div class="card cyc"><div class="t" style="font-size:18px;font-weight:900;margin-bottom:6px">Start a new cycle</div>
      <div class="s intro">Your payday moves around the last week of the month, so enter the real date and salary. Everything else is distributed automatically: fixed expenses are copied from <b>${last.label}</b>, and money you haven't moved to cash saving stays in its pocket and is added to the new cycle.</div>
      <form onsubmit="newCycle(event)" oninput="previewNew(this)" class="cycform">
        <div class="fgrid">
          <label class="s">Payday<input name="payday" type="date" value="${next}" required style="width:100%;display:block;margin-top:4px"></label>
          ${inp('Salary (BCA)', 'salary', '', 'placeholder="e.g. IDR 10,000,000"')}
          ${inp('Daily budget (GoPay)', 'dailyAmt', fm(last.env.daily.amount))}${inp('Daily cap (per day)', 'dailyCap', fm(last.env.daily.cap || 60000))}
          ${inp('Date budget (Bank Jago)', 'dateAmt', fm(last.env.date.amount))}${pctIn(last.savePct)}
          ${freeIn('')}
        </div>
        <div id="newprev" class="stat">${newPreviewHtml(0, last.env.daily.amount, last.env.date.amount, last.savePct)}</div>
        <button class="cta" style="margin-top:auto">Create cycle</button>
      </form>
    </div>
    <div class="card cyc"><div class="t" style="font-size:18px;font-weight:900;margin-bottom:6px">Edit ${c.label}</div>
      <div class="s intro">Adjust this cycle's numbers. Free to use is recalculated automatically, and fixed expenses are edited on the Spending page.</div>
      <form onsubmit="editCycle(event)" class="cycform">
        <div class="fgrid">
          <label class="s">Payday<input name="payday" type="date" value="${c.payday}" required style="width:100%;display:block;margin-top:4px"></label>
          ${inp('Salary (BCA)', 'salary', fm(c.salary))}
          ${inp('Daily budget (GoPay)', 'dailyAmt', fm(c.env.daily.amount))}${inp('Daily cap (per day)', 'dailyCap', fm(c.env.daily.cap || 60000))}
          ${inp('Date budget (Bank Jago)', 'dateAmt', fm(c.env.date.amount))}${pctIn(c.savePct)}
          ${freeIn(fm(k.free))}
        </div>
        <div class="stat"><div class="t" style="font-size:15px;margin:4px 0 6px">Carried over from the previous cycle</div>
          ${['daily', 'date', 'free'].map(key => `<div class="kv" style="padding:6px 0"><span>${E(key).name}</span><b>${rp(c.env[key].carry || 0)}</b></div>`).join('')}</div>
        <button class="cta" style="margin-top:auto">Save changes</button>
      </form>
    </div>
  </div>
  <h2>All cycles</h2>
  <div class="card"><table>
    <tr><th>Cycle</th><th>Payday</th><th class="r">Salary</th><th class="r">Fixed</th><th class="r">Daily</th><th class="r">Date</th><th class="r">Free to use</th><th class="r">Cash saving after</th><th></th></tr>
    ${all.map(x => `<tr class="${x.c.id === S.activeId ? 'cur' : ''}"><td><b>${x.c.label}</b></td><td>${fmtDate(x.c.payday)}</td><td class="r">${rp(x.c.salary)}</td><td class="r">${rp(x.fixedTotal)}</td><td class="r">${rp(x.c.env.daily.amount)}</td><td class="r">${rp(x.c.env.date.amount)}</td><td class="r">${rp(x.free)}</td><td class="r"><b>${rp(x.total)}</b></td>
      <td class="r"><button class="link" onclick="selectCycle('${x.c.id}')">Open</button></td></tr>`).join('')}
  </table></div>`;
}

// ---------- actions ----------
const WALLET = {gopay: 'GoPay', bca: 'BCA', jago: 'Bank Jago'};
const E = key => cur().env[key];
function addSpend(ev) { ev.preventDefault(); const f = ev.target.id === 'addf' ? ev.target : document.getElementById('addf'); const g = n => document.querySelector(`[form=addf][name=${n}]`);
  const amt = num(g('amt').value); if (!amt) return;
  addDate = g('date').value; openDays.add(addDate);
  E(spendTab).spends.push({date: g('date').value, cat: g('cat').value, note: g('note').value.trim(), amt}); commit(); }
function saveSpend(ev) { ev.preventDefault(); const g = n => document.querySelector(`[form=ef][name=${n}]`);
  Object.assign(E(editing.key).spends[editing.i], {date: g('date').value, cat: g('cat').value, note: g('note').value.trim(), amt: num(g('amt').value)}); editing = null; commit(); }
function delSpend(key, i) { if (confirm('Delete this expense?')) { E(key).spends.splice(i, 1); commit(); } }
function moveLeft(key) { const e = E(key), l = left(e); if (l > 0) { e.moved += l; commit(); } }
function undoMove(key) { E(key).moved = 0; commit(); }
function editFixed(i, v) { cur().fixed[i].amount = num(v); commit(); }
function editFixedField(i, f, v) { cur().fixed[i][f] = v.trim(); commit(); }
function delFixed(i) { cur().fixed.splice(i, 1); commit(); }
function addFixed(ev) { ev.preventDefault(); const g = n => document.querySelector(`[form=fadd][name=${n}]`);
  const amt = num(g('amt').value); if (!amt) return; cur().fixed.push({cat: g('cat').value, name: g('note').value.trim(), amount: amt}); commit(); }
function selectCycle(id) { S.activeId = id; tab = 'dash'; commit(); }
function newCycle(ev) {
  ev.preventDefault(); const f = ev.target, last = S.cycles[S.cycles.length - 1], payday = f.payday.value;
  const label = monthLabel(payday);
  if (S.cycles.some(x => x.label === label) && !confirm(`A ${label} cycle already exists. Add another?`)) return;
  const c = {id: 'c' + Date.now(), label, payday, salary: num(f.salary.value), savePct: last.savePct,
    fixed: last.fixed.map(x => ({...x})), env: newEnv(num(f.dailyAmt.value), num(f.dateAmt.value))};
  c.env.daily.cap = num(f.dailyCap.value) || 60000; c.savePct = Number(f.pct.value);
  S.cycles.push(c); S.activeId = c.id; tab = 'dash'; commit();
}
function editCycle(ev) { ev.preventDefault(); const f = ev.target, c = cur();
  c.payday = f.payday.value; c.salary = num(f.salary.value); c.savePct = Number(f.pct.value); c.label = monthLabel(c.payday);
  c.env.daily.amount = num(f.dailyAmt.value); c.env.daily.cap = num(f.dailyCap.value) || 60000; c.env.date.amount = num(f.dateAmt.value); commit(); }
function resetAll() { if (confirm('Reset all data to the empty starting numbers?')) { S = structuredClone(DEFAULT); commit(); } }

document.addEventListener('input', ev => {
  const el = ev.target; if (!el.classList || !el.classList.contains('money')) return;
  const before = el.value.slice(0, el.selectionStart).replace(/\D/g, '').length, d = el.value.replace(/\D/g, '');
  el.value = d ? 'IDR ' + Number(d).toLocaleString('en-US') : '';
  let n = 0, i = 0; for (; i < el.value.length && n < before; i++) if (/\d/.test(el.value[i])) n++;
  el.setSelectionRange(i, i);
});
// Re-render only when the WIDTH changes (rotation, window resize). On phones the on-screen keyboard and the collapsing address bar
// change only the height, and a re-render then would rebuild the page under the field the user is typing in.
let rz, rzW = innerWidth; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (innerWidth !== rzW) { rzW = innerWidth; S && render(); } }, 150); });
const NAV_ICON = {dash: 'moneyhand', wealth: 'diamond', spend: 'receipt', cycles: 'calclock'};   // shown only in the phone / tablet bottom bar
document.querySelectorAll('.nav').forEach(b => { b.insertAdjacentHTML('afterbegin', `<span class="navic">${icon(NAV_ICON[b.dataset.t], 'filled', 22)}</span>`); b.onclick = () => { tab = b.dataset.t; render(); scrollTo(0, 0); }; });
document.querySelectorAll('.logout').forEach(b => b.insertAdjacentHTML('afterbegin', `<span class="logic">${icon('signout', 'regular', 20)}</span>`));
$('#cycleSel').onchange = e => { S.activeId = e.target.value; commit(); };

(async () => {
  let saved = GUEST ? demoState() : await (await fetch('/api/state')).json();
  if (saved && saved.cycle) {   // migrate v1 data
    const o = saved, c = o.cycle;
    saved = {activeId: 'c1', basePrevSavings: c.savingsAfterSplit - Math.round(c.salary * c.savePct / 100),
      cycles: [{id: 'c1', label: c.label, payday: c.payday, salary: c.salary, savePct: c.savePct, fixed: o.fixed, env: o.env}]};
  }
  S = saved || structuredClone(DEFAULT);
  if (!S.wealth) S.wealth = structuredClone(DEFAULT.wealth);
  if (!S.wealth.transfers) S.wealth.transfers = [];
  if (!S.wealth.gold) S.wealth.gold = {pricePerGram: 0, items: []};
  S.cycles.forEach(c => Object.values(c.env).forEach(e => e.spends.forEach(x => { if (!x.cat) x.cat = 'Other'; })));
  S.cycles.forEach(c => c.fixed.forEach(x => { if (!x.cat) x.cat = 'Other'; delete x.icon; }));
  S.cycles.forEach(c => { if (!c.env.daily.cap) c.env.daily.cap = 60000; });
  S.cycles.forEach(c => { c.env.daily.icon = 'calday'; c.env.date.icon = 'heart'; c.env.free.icon = 'balloon'; });
  S.cycles.forEach(c => { c.env.date.wallet = 'jago'; c.env.free.wallet = 'jago'; });
  persist(); render();
  loadQuotes(); schedulePoll();
})();


// ---------- custom tooltip (native title tooltips do not show reliably in every browser) ----------
(() => {
  const tip = document.createElement('div'); tip.id = 'tip'; document.body.appendChild(tip);
  let timer = null, current = null;
  const place = ev => { const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 12), y = ev.clientY + 18 + tip.offsetHeight > innerHeight ? ev.clientY - tip.offsetHeight - 12 : ev.clientY + 18; tip.style.left = Math.max(8, x) + 'px'; tip.style.top = y + 'px'; };
  document.addEventListener('mouseover', ev => {
    const el = ev.target.closest && ev.target.closest('[data-tip]'); if (el === current) return;
    current = el; clearTimeout(timer); tip.classList.remove('show');
    if (el) timer = setTimeout(() => { tip.textContent = el.dataset.tip; place(ev); tip.classList.add('show'); }, 120);
  });
  document.addEventListener('mousemove', ev => { if (current && tip.classList.contains('show')) place(ev); });
  document.addEventListener('mouseleave', () => { current = null; clearTimeout(timer); tip.classList.remove('show'); });
  document.addEventListener('click', () => { clearTimeout(timer); tip.classList.remove('show'); });
})();
