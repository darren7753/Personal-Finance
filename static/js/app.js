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
// A cycle with tracked:false only records the salary (the months before tracking started). It has no budgets, no spending and no
// effect on cash saving, and every page except the dashboard and Pay cycles just says "No tracking yet".
const untracked = c => c.tracked === false;
let SLIPS = new Set();   // months (yyyymm) that have a salary slip PDF on the server; empty in demo mode and on the live site
const slipKey = c => c.payday.slice(0, 7).replace('-', '');

// per-cycle numbers; savings chain runs through cycles in order
// a transfer belongs to the latest cycle whose payday is on or before the transfer date
function cycleOfDate(date) {
  const tracked = S.cycles.filter(c => !untracked(c));
  let found = tracked[0];
  tracked.forEach(c => { if (c.payday <= date) found = c; });
  return found;
}
function calcAll() {
  let prev = S.basePrevSavings, prevC = null;
  return S.cycles.map(c => {
    if (untracked(c)) return {c, prev, save: 0, fixedTotal: 0, afterSave: 0, afterFixed: 0, dailyDate: 0, free: 0, moved: 0, transferred: 0, returned: 0, other: 0, toStock: 0, toGold: 0, fromStock: 0, fromGold: 0, total: prev, untracked: true};
    ['daily', 'date', 'free'].forEach(key => { c.env[key].carry = prevC ? Math.max(0, left(prevC.env[key])) : 0; });
    const save = Math.round(c.salary * c.savePct / 100);
    const fixedTotal = c.fixed.reduce((a, x) => a + x.amount, 0);
    const afterSave = c.salary - save, afterFixed = afterSave - fixedTotal;
    const dailyDate = c.env.daily.amount + c.env.date.amount;
    const free = afterFixed - dailyDate;
    c.env.free.amount = free;
    const moved = Object.values(c.env).reduce((a, e) => a + e.moved, 0);
    // a transfer is money leaving cash saving (investments, other spending) unless `back` is set: then it is a sale coming back in
    const trs = ((S.wealth && S.wealth.transfers) || []).filter(t => cycleOfDate(t.date) === c);
    const sum = f => trs.filter(f).reduce((a, t) => a + t.amount, 0);
    const toStock = sum(t => !t.back && t.type === 'stockbit'), toGold = sum(t => !t.back && t.type === 'gold');
    const fromStock = sum(t => t.back && t.type === 'stockbit'), fromGold = sum(t => t.back && t.type === 'gold');
    const other = sum(t => !t.back && t.type === 'expense'), transferred = toStock + toGold, returned = fromStock + fromGold;
    const k = {c, prev, save, fixedTotal, afterSave, afterFixed, dailyDate, free, moved, transferred, returned, other, toStock, toGold, fromStock, fromGold,
      total: prev + save + moved - transferred - other + returned};
    prev = k.total; prevC = c;
    return k;
  });
}
const K = () => calcAll().find(k => k.c.id === S.activeId);

// ---------- our own confirm / message dialogs (never the browser's pop-ups) ----------
// ask({title, text, ok, danger, icon}) resolves true/false; notify() is the same with a single button.
let mdlOpen = null;
function ask(o) {
  return new Promise(res => {
    if (mdlOpen) mdlOpen(false);
    const back = document.createElement('div'); back.className = 'mdl-back';
    const tone = o.danger ? 'danger' : 'cta', ic = o.icon || (o.danger ? 'trash' : 'warning');
    back.innerHTML = `<div class="mdl" role="alertdialog" aria-modal="true" aria-labelledby="mdlT">
      <div class="mdl-ic ${o.danger ? 'red' : ''}">${icon(ic, 'regular', 26)}</div>
      <div class="mdl-t" id="mdlT">${esc(o.title)}</div>${o.text ? `<div class="mdl-x">${esc(o.text)}</div>` : ''}
      <div class="mdl-btns">${o.single ? '' : '<button type="button" class="mdl-cancel">Cancel</button>'}<button type="button" class="mdl-ok ${tone}">${esc(o.ok || 'OK')}</button></div></div>`;
    document.body.appendChild(back);
    const okB = back.querySelector('.mdl-ok'), cancelB = back.querySelector('.mdl-cancel');
    const done = v => { document.removeEventListener('keydown', key, true); mdlOpen = null; back.classList.remove('show'); setTimeout(() => back.remove(), 160); res(v); };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(!!o.single); }
      else if (e.key === 'Tab') { const b = [...back.querySelectorAll('button')], at = b.indexOf(document.activeElement); e.preventDefault(); b[(at + (e.shiftKey ? b.length - 1 : 1)) % b.length].focus(); }
    };
    mdlOpen = done; document.addEventListener('keydown', key, true);
    okB.onclick = () => done(true); if (cancelB) cancelB.onclick = () => done(false);
    back.addEventListener('mousedown', e => { if (e.target === back) done(!!o.single); });
    requestAnimationFrame(() => back.classList.add('show'));
    (o.danger && cancelB ? cancelB : okB).focus();   // a delete never has its confirm button focused by default
  });
}
const notify = o => ask({...o, single: true, icon: o.icon || 'warning'});

let saveChain = Promise.resolve();
function persist() {
  if (GUEST) return Promise.resolve();   // demo mode: nothing is ever saved
  saveChain = saveChain.then(async () => {
    const r = await fetch('/api/state', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(S)});
    if (r.status === 409) { await notify({title: 'Your data changed elsewhere', text: 'Your data was changed in another tab or window. The page will reload to show the latest data.', ok: 'Reload'}); location.reload(); return; }
    const res = await r.json(); S._rev = res.rev;
  }).catch(() => {});
  return saveChain;
}
const commit = () => { sel.clear(); persist(); render(); };

// ---------- render ----------
const TITLES = {dash: 'Dashboard', wealth: 'Wealth', spend: 'Spending', cycles: 'Pay cycles'};
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
  v.innerHTML = untracked(c) && (tab === 'wealth' || tab === 'spend') ? noTracking(c) : {dash, wealth, spend, cycles}[tab](k);
  const top = document.querySelector('.top'); top.classList.remove('enter-top'); if (entering) { void top.offsetWidth; top.classList.add('enter-top'); }
  if (swapping) { const p = v.querySelector('.tabs + *'); if (p) p.classList.add('swap'); }
  decorate(entering);
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function decorate(entering) {
  enhanceDates();
  enhanceSelects();   // before wrapTables: the custom dropdowns change cell widths, and wrapTables measures whether each table fits
  wrapTables();
  fitDiagram();
  decorateDiagram();
  drawCharts(undefined, entering);   // dashboard charts (static/js/charts.js); before applyHide so the legend numbers get masked too
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
  const eye = $('#eye'); if (eye) { eye.innerHTML = icon(hideNums ? 'eyeclosed' : 'eye', 'regular', 24); eye.setAttribute('aria-label', hideNums ? 'Show numbers' : 'Hide numbers'); }
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
  // category menus: the chosen category first, Other last, the rest A to Z (each option keeps its real index in data-i)
  const isCat = [...sel.options].length && [...sel.options].every(o => CATS.includes(o.value));
  const order = [...sel.options].map((o, i) => i);
  if (isCat) order.sort((a, b) => (b === sel.selectedIndex) - (a === sel.selectedIndex) || (sel.options[a].value === 'Other') - (sel.options[b].value === 'Other') || sel.options[a].text.localeCompare(sel.options[b].text));
  m.innerHTML = order.map(i => [sel.options[i], i]).map(([o, i]) => `<div class="cs-opt ${i === sel.selectedIndex ? 'on' : ''}" role="option" tabindex="-1" data-i="${i}">${csOptIcon(o.value)}<span class="cs-label">${esc(o.text)}</span>${i === sel.selectedIndex ? `<span class="cs-check">${icon('check', 'filled', 16)}</span>` : ''}</div>`).join('');
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
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (at >= 0) pick(Number(opts[at].dataset.i)); }
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
// ---------- custom glass date picker (replaces the browser's own calendar; the real <input type="date"> stays hidden inside, so forms still work) ----------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = n => String(n).padStart(2, '0'), isoOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
function dpSync(inp) {
  const btn = inp.parentElement && inp.parentElement.querySelector('.cs-btn'); if (!btn) return;
  btn.innerHTML = `<span class="cs-ic dp-ic">${icon('calendar', 'regular', 18)}</span><span class="cs-label">${inp.value ? esc(fmtDate(inp.value)) : 'Select date'}</span><span class="cs-chev">${icon('chevdown', 'regular', 16)}</span>`;
}
function dpOpen(inp, btn) {
  csClose(); csOpenBtn = btn; btn.classList.add('open');
  const sel0 = inp.value || today(), sy = Number(sel0.slice(0, 4)), sm = Number(sel0.slice(5, 7));
  let vy = sy, vm = sm - 1;
  const m = document.createElement('div'); m.className = 'cs-menu dp-menu'; csMenu = m; document.body.appendChild(m);
  const draw = () => {
    const first = new Date(vy, vm, 1), lead = (first.getDay() + 6) % 7, t = today(), cur = inp.value;
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const dt = new Date(vy, vm, 1 - lead + i), iso = isoOf(dt.getFullYear(), dt.getMonth(), dt.getDate()), out = dt.getMonth() !== vm;
      cells += `<button type="button" class="dp-day ${out ? 'out' : ''} ${iso === t ? 'today' : ''} ${iso === cur ? 'on' : ''}" data-d="${iso}">${dt.getDate()}</button>`;
    }
    m.innerHTML = `<div class="dp-head"><button type="button" class="ib edit" data-nav="-1" aria-label="Previous month">${icon('chevleft', 'regular', 18)}</button><div class="dp-title">${MONTHS[vm]} ${vy}</div><button type="button" class="ib edit" data-nav="1" aria-label="Next month">${icon('chevright', 'regular', 18)}</button></div>
      <div class="dp-grid dp-wd">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(x => `<span>${x}</span>`).join('')}</div><div class="dp-grid">${cells}</div>
      <div class="dp-foot"><button type="button" class="link" data-d="${t}">Today</button></div>`;
  };
  draw();
  m.addEventListener('click', e => {
    e.stopPropagation();   // the month buttons are replaced while drawing, so the page-level "click outside" handler must not see them
    const nav = e.target.closest('[data-nav]'), day = e.target.closest('[data-d]');
    if (nav) { vm += Number(nav.dataset.nav); if (vm < 0) { vm = 11; vy--; } if (vm > 11) { vm = 0; vy++; } draw(); }
    else if (day) { inp.value = day.dataset.d; inp.dispatchEvent(new Event('input', {bubbles: true})); inp.dispatchEvent(new Event('change', {bubbles: true})); dpSync(inp); csClose(); btn.focus(); }
  });
  m.addEventListener('keydown', e => { if (e.key === 'Escape') { csClose(); btn.focus(); } });
  const r = btn.getBoundingClientRect(), W = 300, mh = m.scrollHeight, below = innerHeight - r.bottom - 14, above = r.top - 14, up = below < mh && above > below;
  m.style.width = W + 'px'; m.style.left = Math.max(8, Math.min(r.left, innerWidth - W - 12)) + 'px';
  m.style.maxHeight = Math.max(240, up ? above : below) + 'px';
  if (up) { m.style.bottom = (innerHeight - r.top + 6) + 'px'; m.style.transformOrigin = 'bottom'; } else { m.style.top = (r.bottom + 6) + 'px'; }
  requestAnimationFrame(() => m.classList.add('show'));
  (m.querySelector('.dp-day.on') || m.querySelector('.dp-day.today') || m.querySelector('.dp-day')).focus({preventScroll: true});
}
function enhanceDates() {
  document.querySelectorAll('input[type=date]:not([data-dp])').forEach(inp => {
    inp.dataset.dp = '1'; inp.classList.add('cs-native'); inp.tabIndex = -1;
    const wrap = document.createElement('div'), btn = document.createElement('button');
    wrap.className = 'cs dp'; wrap.style.cssText = inp.getAttribute('style') || ''; inp.removeAttribute('style');   // the field's own sizing (flex, width, margin) moves to the wrapper
    btn.type = 'button'; btn.className = 'cs-btn'; btn.setAttribute('aria-haspopup', 'dialog');
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(btn); wrap.appendChild(inp);
    btn.addEventListener('click', e => { e.stopPropagation(); csOpenBtn === btn ? csClose() : dpOpen(inp, btn); });
    btn.addEventListener('keydown', e => { if (['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); dpOpen(inp, btn); } });
    dpSync(inp);
  });
}
document.addEventListener('click', e => { if (csMenu && !csMenu.contains(e.target)) csClose(); });
let csW = innerWidth;   // phones fire `resize` when the keyboard or address bar moves; only a width change should close the menu
addEventListener('resize', () => { if (innerWidth !== csW) { csW = innerWidth; csClose(); } });
addEventListener('scroll', e => { if (csMenu && e.target instanceof Node && (csMenu.contains(e.target) || e.target.id === 'trendScroll')) return; csClose(); }, true);
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
// The branched diagram is always drawn the same way (the user rejected a stacked version without branches). When the card is
// too narrow for five columns of nodes (nodes never go below 200 px) the card scrolls sideways.
let diagAvail = 0, lastNW = 0;
const DPAD = 22;   // room at the left of the diagram for the purple Total wealth frame
const nwFor = avail => Math.max(200, Math.min(300, Math.floor((avail - DPAD - 4 * 28) / 5)));   // 200 px is the narrowest node that still fits its longest line ("20% this cycle  +IDR 2,596,320")
function decorateDiagram() {
  document.querySelectorAll('.diagram svg path:not(.dash)').forEach(p => p.setAttribute('pathLength', '1'));   // dashed arrows are not drawn in, they fade in
  document.querySelectorAll('.dnode').forEach((n, i) => { const t = parseFloat(n.style.top); n.style.setProperty('--d', (isNaN(t) ? 0.1 + i * 0.05 : 0.12 + t / 1000).toFixed(2) + 's'); });
}
function fitDiagram() {
  const card = document.querySelector('.funnelcard'); if (!card || tab !== 'dash') return;
  const cs = getComputedStyle(card), avail = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); if (avail <= 0) return;
  diagAvail = avail;
  if (nwFor(avail) !== lastNW) { card.innerHTML = diagram(K()); decorateDiagram(); }
}
const ARROW = '#7d87a8';   // one neutral colour for every connector arrow
const RING = {'#ffe9ee': 'red', '#e8f7ec': 'green', '#e3effa': 'blue'};
function diagram(k) {
  const c = k.c, S = c.salary, env = c.env, sc = stockCalc(), gc = goldCalc();
  const avail = diagAvail || (($('#view').clientWidth || 1100) - 60);
  const CG = 28, NH = 80, LV = 50, NW = nwFor(avail), G = '#0a9d58', PAD = DPAD;
  lastNW = NW;
  const pct = v => pc2(v / S * 100) + ' of salary';
  const X = i => PAD + i * (NW + CG);           // col 0-1 = saving + investments, 1 = fixed, 2-4 = budgets
  const Wd = PAD + 5 * NW + 4 * CG;
  const Y = [0, 1, 2, 3, 4].map(i => i * (NH + LV));
  const nodes = [], paths = [];
  const add = n => { nodes.push(n); return n; };
  // every connector is DASHED while it is only a possibility and becomes a full line once the money really moved
  const stroke = real => real ? `stroke="${ARROW}" stroke-linecap="round"` : `class="dash" stroke="${ARROW}"`;
  const head = (x, y, up) => `<polygon points="${x},${y} ${x - 6.5},${y + (up ? 11 : -11)} ${x + 6.5},${y + (up ? 11 : -11)}" fill="${ARROW}"/>`;
  const arrowDown = (a, b, real = true) => {   // curved arrow from the bottom centre of a to the top centre of b
    const x1 = a.cx, ya = a.y + (a.h || NH), x2 = b.cx, yb = b.y - 10, my = (ya + yb) / 2;
    paths.push(`<path d="M${x1},${ya} C${x1},${my} ${x2},${my} ${x2},${yb}" fill="none" ${stroke(real)} stroke-width="3.5"/>${head(x2, b.y, false)}`);
  };
  const vArrow = (x, y1, y2, real) => {          // straight vertical arrow, head at y2 (up or down)
    const up = y2 < y1, ye = y2 + (up ? 10 : -10);
    paths.push(`<path d="M${x},${y1} V${ye}" fill="none" ${stroke(real)} stroke-width="3.5"/>${head(x, y2, up)}`);
  };

  const remW = NW, remCx = (X(1) + X(4) + NW) / 2, cashCx = X(0) + NW / 2;
  const sal = add({id: 'sal', cx: (cashCx + remCx) / 2, y: Y[0], w: NW, title: 'Salary', sub: fmtDate(c.payday), amt: S, color: BANK.bca, bg: BANK.bca, fg: '#fff', logo: 'bca'});
  const cash = add({id: 'cash', cx: cashCx, y: Y[1], w: NW, title: `${pc2(c.savePct)} to cash saving`, sub: pct(k.save), amt: k.save, color: BANK.bca, bg: '#e3effa'});
  const rem = add({id: 'rem', cx: remCx, y: Y[1], w: remW, title: 'Remaining', sub: `${pc2(100 - c.savePct)} of salary`, amt: k.afterSave, color: BANK.bca, bg: '#e3effa'});
  // Cash saving is as wide as Stocks and Gold together, so the arrows to them run straight down from it
  const GAP2 = 12, savW = 2 * NW + GAP2, savH = 66 + 14 * 6 + 16, busY = Y[4] + NH + 56;      // Stocks and Gold sit close together; the lines from the budgets all end at the middle of the node's right edge
  const sav = add({id: 'sav', cx: X(0) + savW / 2, y: busY - savH / 2, w: savW, h: savH, title: 'Cash saving', color: BANK.jago, bg: BANK.jago, fg: '#1a1a1a', logo: 'jago', amt: k.total,
    lines: [['Previous savings', rp(k.prev)], [`${pc2(c.savePct)} of ${c.label} salary`, inflow(k.save)], ['Leftovers moved in', inflow(k.moved)],
      ['Moved to investments', outflow(k.transferred)], ['Moved from investments', inflow(k.returned)], ['Other spending', outflow(k.other)]]});
  arrowDown(sal, cash); arrowDown(sal, rem); arrowDown(cash, sav);

  // stocks and gold sit under cash saving; two arrows each way (down = invested, up = sold and moved back)
  const ay = sav.y + savH + 58, cb = sav.y + savH;
  const stk = add({id: 'stk', cx: X(0) + NW / 2, y: ay, w: NW, title: 'Stocks', sub: 'Total equity', amt: sc.equity, bg: '#26262b', fg: '#fff', logo: 'stockbit'});
  const gld = add({id: 'gld', cx: X(0) + NW + GAP2 + NW / 2, y: ay, w: NW, title: 'Gold', sub: 'Total value', amt: gc.value, bg: '#ffd60a', fg: '#3a2e00', logo: 'treasury'});
  vArrow(stk.cx - 16, cb, ay, k.toStock > 0); vArrow(stk.cx + 16, ay, cb, k.fromStock > 0);
  vArrow(gld.cx - 16, cb, ay, k.toGold > 0);  vArrow(gld.cx + 16, ay, cb, k.fromGold > 0);
  const wrapTop = sav.y - 60, wrapBottom = ay + NH + 22;

  // fixed expenses: single node
  const fix = add({id: 'fix', cx: X(1) + NW / 2, y: Y[2], w: NW, title: 'Fixed expenses', sub: pct(k.fixedTotal), tip: `${c.fixed.length} ${c.fixed.length === 1 ? 'item' : 'items'}`, amt: k.fixedTotal, color: BANK.fixed, bg: '#ffe9ee', neg: 1});
  arrowDown(rem, fix);

  // budgets: budget → real expenses → remaining → cash saving (dashed until the leftover is really moved)
  const busDash = [], busSolid = [];
  [['daily', 'gopay', 2], ['date', 'jago', 3], ['free', 'jago', 4]].forEach(([key, w, col]) => {
    const e = env[key], color = BANK[w], sp = spent(e), rest = e.amount + (e.carry || 0) - sp, cx = X(col) + NW / 2;
    const b = add({id: key + 'b', cx, y: Y[2], w: NW, title: e.name, sub: pct(e.amount), tip: e.carry ? `Includes ${rp(e.carry)} carried over` : '', amt: e.amount + (e.carry || 0), color, logo: w, bg: color, fg: w === 'gopay' ? '#fff' : '#1a1a1a'});
    const ex = add({id: key + 'x', cx, y: Y[3], w: NW, title: 'Real expenses', sub: pct(sp), tip: sp ? `${e.spends.length} logged. Click to open.` : 'Nothing logged yet. Click to add.', amt: sp, color: BANK.fixed, bg: '#ffe9ee', neg: sp > 0 ? 1 : 0, click: `goSpend('${key}')`});
    const rm = add({id: key + 'r', cx, y: Y[4], w: NW, title: 'Remaining', color: G, bg: '#e8f7ec', pos: 1, amt: rest,
      sub: e.moved ? 'Moved · ' + pct(rest) : pct(rest), tip: e.moved ? 'Moved to cash saving. Click to undo.' : rest > 0 ? 'Click to move to cash saving.' : 'Nothing left to move.',
      click: e.moved ? `undoMove('${key}')` : rest > 0 ? `moveLeft('${key}')` : ''});
    arrowDown(rem, b); arrowDown(b, ex); arrowDown(ex, rm);
    const sx = X(0) + savW + 2;
    // each line leaves its own node, then they bend like branches and meet at the same end point on the right edge of Cash saving
    const ex0 = sx + 12;
    (e.moved ? busSolid : busDash).push(`<path d="M${cx},${Y[4] + NH} C${cx},${busY} ${ex0 + (cx - ex0) * 0.45},${busY} ${ex0},${busY}" fill="none" ${stroke(!!e.moved)} stroke-width="3.5"/>`);
  });
  paths.push(...busDash, ...busSolid);   // full lines are drawn last so they stay on top where the three buses overlap
  paths.push(`<polygon points="${X(0) + savW + 2},${busY} ${X(0) + savW + 14},${busY - 6.5} ${X(0) + savW + 14},${busY + 6.5}" fill="${ARROW}"/>`);

  const nodeHtml = (n, abs) => {
    const h = n.h || NH, place = abs ? `left:${n.cx - n.w / 2}px;top:${n.y}px;width:${n.w}px;height:${h}px;` : '';
    return `<div class="dnode ${n.logo ? 'hl' : ''} ${n.click ? 'click' : ''}" ${RING[n.bg] ? `data-ring="${RING[n.bg]}"` : ''} ${n.click ? `onclick="${n.click}"` : ''} ${n.tip ? `data-tip="${esc(n.tip)}"` : ''} style="${place}background:${n.bg || '#fff'};color:${n.fg || 'inherit'}">
      ${n.logo ? `<img class="mini" src="/static/logos/${n.logo}.${n.logo === 'treasury' ? 'png' : 'svg'}">` : ''}
      <div class="dt">${esc(n.title)}</div>
      <div class="da ${n.neg ? 'neg' : ''} ${n.pos ? 'pos' : ''}" style="${n.fg ? 'color:' + n.fg + ';' : ''}${n.big ? 'font-size:20px' : ''}">${rp(n.amt)}</div>
      ${n.lines ? `<div class="dlines">${n.lines.map(l => `<div class="ds" style="display:flex;justify-content:space-between;${n.fg ? 'color:' + n.fg + ';opacity:.85' : ''}"><span>${l[0]}</span><b style="color:inherit">${l[1]}</b></div>`).join('')}</div>` : `<div class="ds" ${n.fg ? `style="color:${n.fg};opacity:.8"` : ''}>${esc(n.sub)}</div>`}</div>`;
  };

  const Ht = Math.max(wrapBottom, ...nodes.map(n => n.y + (n.h || NH)));
  const frame = `<div class="dwrap" style="left:0;top:${wrapTop}px;width:${savW + 2 * PAD}px;height:${wrapBottom - wrapTop}px;padding-left:${PAD + 16}px"><span>Total wealth</span><b>${rp(k.total + sc.equity + gc.value)}</b><i class="wico" style="right:${PAD + 12}px">${icon('diamond', 'filled', 14)}</i></div>`;
  return `<div class="diagram" style="width:${Wd}px;height:${Ht}px;margin:0 auto">${frame}<svg width="${Wd}" height="${Ht}">${paths.join('')}</svg>${nodes.map(n => nodeHtml(n, true)).join('')}</div>`;
}

function noTracking(c) {
  return `<div class="note"><span class="ni">ⓘ</span><div>No tracking yet. Spending and wealth are tracked from November 2026, so ${c.label} only has the salary.</div></div>`;
}
const slipBtn = c => (GUEST || SLIPS.has(slipKey(c)))
  ? `<button type="button" class="slipb" data-tip="Open salary slip" aria-label="Open salary slip" onclick="openSlip('${slipKey(c)}')">${icon('pdf', 'regular', 24)}</button>` : '';   // no slip for that month = no button, the card works the same
// the slip opens in a pop-up on this page (the browser's own PDF viewer inside an iframe), not in a new tab
function openSlip(ym) {
  if (mdlOpen) mdlOpen(false);
  const c = S.cycles.find(x => slipKey(x) === ym), back = document.createElement('div'); back.className = 'mdl-back';
  back.innerHTML = `<div class="mdl slipv" role="dialog" aria-modal="true" aria-label="Salary slip"><div class="slipv-h"><div class="mdl-t">Salary slip${c ? ' · ' + esc(c.label) : ''}</div><button type="button" class="ib del" data-tip="Close" aria-label="Close">${icon('dismiss', 'regular', 20)}</button></div><iframe src="${GUEST ? '/static/demo-salary-slip.pdf' : '/api/slip/' + ym}#view=FitH" title="Salary slip"></iframe></div>`;
  document.body.appendChild(back);
  const done = () => { document.removeEventListener('keydown', key, true); mdlOpen = null; back.classList.remove('show'); setTimeout(() => back.remove(), 160); };
  const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } };
  mdlOpen = done; document.addEventListener('keydown', key, true);
  back.querySelector('button').onclick = done; back.addEventListener('mousedown', e => { if (e.target === back) done(); });
  requestAnimationFrame(() => back.classList.add('show'));
}
function dash(k) {
  const c = k.c, S = c.salary, env = c.env;
  if (untracked(c)) return `<div class="grid g4"><div class="pocket bca"><div class="row">${logo('bca')}<div><div class="name">Salary</div></div>${slipBtn(c)}</div><div class="big-num">${rp(S)}</div></div></div>${noTracking(c)}`;
  const spentTotal = ['daily', 'date', 'free'].reduce((t, key) => t + spent(env[key]), 0);
  const expense = k.fixedTotal + spentTotal;                                   // fixed + everything logged so far
  const remaining = ['daily', 'date', 'free'].reduce((t, key) => t + left(env[key]), 0);   // still available in the pockets
  const wealthTotal = k.total + stockCalc().equity + goldCalc().value;
  const tile = (name, tone) => `<div class="ico t-${tone}" style="width:86px;height:48px;border-radius:16px">${icon(name, 'filled', 24)}</div>`;
  return `
  <div class="grid g4">
    <div class="pocket bca"><div class="row">${logo('bca')}<div><div class="name">Salary</div></div>${slipBtn(c)}</div><div class="big-num">${rp(S)}</div></div>
    <div class="pocket expense"><div class="row">${tile('receipt', 'red')}<div><div class="name">Total expenses</div><div class="sub">${pc2(expense / S * 100)} of salary</div></div></div><div class="big-num">${rp(expense)}</div></div>
    <div class="pocket remain"><div class="row">${tile('moneyhand', 'green')}<div><div class="name">Total remaining</div><div class="sub">${pc2(remaining / S * 100)} of salary</div></div></div><div class="big-num">${rp(remaining)}</div></div>
    <div class="pocket total"><div class="row">${tile('diamond', 'navy')}<div><div class="name">Total wealth</div></div></div><div class="big-num">${rp(wealthTotal)}</div></div>
  </div>
  <h2>Where your salary goes <span class="s">Log real expenses on the Spending page</span></h2>
  <div class="card funnelcard">${diagram(k)}</div>
  ${chartSection()}`;
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
const TREASURY_FACTOR = 0.998;   // fallback only: Treasury's sell price was 0.2% under the Yahoo-based spot estimate when checked on 26 Nov 2026
const JAGO_SELL = 0.99701;       // the Bank Jago gold pocket sells at 0.99701 x Treasury's website sell price (measured on 27 Nov 2026, constant over 7 readings)
// Where the gold price comes from right now: 'treasury' (Treasury website, fresh), 'yahoo' (Treasury failed, so a Yahoo estimate), or 'saved' (nothing loaded, last saved price)
function goldSource() {
  const t = quotes['TREASURY_SELL'], g = quotes['GC=F'], fx = quotes['USDIDR=X'];
  if (t && t.price && !t.stale) return 'treasury';
  if (g && fx && g.price && fx.price) return 'yahoo';
  return 'saved';
}
function livePrice() {
  const src = goldSource();
  if (src === 'treasury') return Math.round(quotes['TREASURY_SELL'].price * JAGO_SELL);   // Treasury's own sell price per gram, adjusted to the Jago pocket
  if (src === 'yahoo') return Math.round(quotes['GC=F'].price * quotes['USDIDR=X'].price / 31.1034768 * TREASURY_FACTOR * JAGO_SELL);
  return S.wealth.gold.lastAuto || 0;
}
const JAGO_BUY = 0.996993;       // the Jago pocket buys at 0.996993 x Treasury's website buy price (same measurement)
function goldBuyPrice() {         // only known when Treasury's own buy price loaded; the Yahoo estimate has no buy side
  const b = quotes['TREASURY_BUY'];
  return goldSource() === 'treasury' && b && b.price ? Math.round(b.price * JAGO_BUY) : null;
}
const GOLD_INFO = {   // the note and the source label for each of the three cases
  treasury: {src: 'Source: Treasury website, adjusted to Bank Jago', note: 'These values are estimates. The gold price comes directly from the Treasury website and is adjusted to match the Bank Jago gold pocket, so it can differ slightly from your Jago app. Check the Jago app for your exact figures.'},
  yahoo: {src: 'Source: Yahoo Finance gold futures (Treasury is unavailable)', note: "These values are estimates. Treasury's price could not be loaded, so the gold price is estimated from Yahoo Finance gold futures and the USD to IDR rate. It can be off by about 1% from your Jago app. Check the Jago app for your exact figures."},
  saved: {src: 'Source: last saved price (no live price available)', note: 'These values are estimates. No live gold price could be loaded, so the last saved price is shown. Check the Jago app for your exact figures.'},
};
async function loadQuotes(force) {
  if (typeof S === 'undefined' || !S || !S.wealth) return;
  const hs = S.wealth.stocks.holdings;
  try {
    const syms = hs.map(h => h.ticker + '.JK').concat(['GC=F', 'USDIDR=X'], GUEST ? [] : ['TREASURY_BUY', 'TREASURY_SELL']);
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
    // prices are NOT saved: they are re-fetched on every load, and saving them made two open devices fight over the data (409 "changed elsewhere")
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
  // Like Stockbit, the overall return is measured on invested + trading balance (each row's return stays on its own invested amount)
  return {rows, invested, value, pl, ret: invested + st.cash ? pl / (invested + st.cash) * 100 : 0, cash: st.cash, equity: value + st.cash};
}
const avgPrice = n => 'IDR ' + (Math.floor(n * 100 + 1e-6) / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});   // 2 decimals, cut off (not rounded) like Stockbit
const signed = v => v > 0 ? '+' + pc2(v) : v < 0 ? '−' + pc2(Math.abs(v)) : pc2(v);
const plClass = v => v < 0 ? 'neg' : v > 0 ? 'pos' : '';

function wealth(k) {
  const sc = stockCalc(), gc = goldCalc(), total = k.total + sc.equity + gc.value;
  const kpi = (cls, logoHtml, name, amt, sub = '') => `<div class="pocket ${cls}"><div class="row">${logoHtml}<div><div class="name">${name}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div><div class="big-num">${amt}</div></div>`;
  const tabs = [['savings', 'Cash saving', 'Bank Jago', k.total], ['stocks', 'Stocks', 'Stockbit', sc.equity], ['gold', 'Gold', 'Treasury', gc.value]];
  const panel = {savings: () => savingsPanel(k) + transferList(), stocks: () => stockPanel(k), gold: goldPanel}[wealthTab]();
  return `
  <div class="grid g4">
    ${kpi('total', `<div class="ico t-navy" style="width:86px;height:48px;border-radius:16px">${icon('diamond', 'filled', 24)}</div>`, 'Total wealth', rp(total))}
    ${kpi('jago', logo('jago'), 'Cash saving', rp(k.total))}
    ${kpi('stockbit', logo('stockbit'), 'Stocks', rp(sc.equity), 'Total equity')}
    ${kpi('gold', logo('treasury'), 'Gold', rp(gc.value), 'Total value')}
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
    ${box('Return', signed(sc.ret), plClass(sc.ret), 'On invested + trading balance')}
    ${box('Total equity', rp(sc.equity))}
  </div>
  <div class="grid g3 actions" style="margin-bottom:14px">
    <div class="card">
      <div class="t" style="font-size:18px">Top up from cash saving</div>
      <div class="s act-d">Moves money from your cash saving (Bank Jago) to your Stockbit trading balance. Your total wealth stays the same.</div>
      <div class="s act-a">Available in cash saving: <b>${rp(k.total)}</b></div>
      <form class="add stack" onsubmit="topUp(event)">
        <input name="date" type="date" value="${today()}" required><input name="amt" class="money" inputmode="numeric" autocomplete="off" placeholder="Amount" required style="text-align:right"><input name="note" placeholder="Remarks"><button>Top up</button>
      </form>
    </div>
    <div class="card">
      <div class="t" style="font-size:18px">Sell stocks</div>
      <div class="s act-d">Sells lots of a holding. The money goes to your trading balance. The amount is filled in from the live price, so change it to match the real number in Stockbit.</div>
      <div class="s act-a">Trading balance: <b>${rp(sc.cash)}</b></div>
      ${sc.rows.length ? `<form class="add stack" data-kind="stock" onsubmit="sellStock(event)" oninput="sellEst(this,event)" onchange="sellEst(this,event)">
        <div class="pair"><input name="date" type="date" value="${today()}" required><select name="pick">${sc.rows.map(r => `<option value="${r.i}">${esc(r.h.ticker)} · ${r.h.lots} ${r.h.lots === 1 ? 'lot' : 'lots'}</option>`).join('')}</select></div>
        <input name="lots" type="number" min="1" placeholder="Lots" required style="text-align:right"><input name="amt" class="money" inputmode="numeric" autocomplete="off" placeholder="Amount received" required style="text-align:right"><button>Sell</button>
      </form>` : '<div class="s">You have no holdings to sell.</div>'}
    </div>
    <div class="card">
      <div class="t" style="font-size:18px">Withdraw to cash saving</div>
      <div class="s act-d">Moves money from your Stockbit trading balance back to your cash saving. Your total wealth stays the same.</div>
      <div class="s act-a">Available in trading balance: <b>${rp(sc.cash)}</b></div>
      <form class="add stack" onsubmit="withdrawStock(event)">
        <input name="date" type="date" value="${today()}" required><input name="amt" class="money" inputmode="numeric" autocomplete="off" placeholder="Amount" required style="text-align:right"><input name="note" placeholder="Remarks"><button>Withdraw</button>
      </form>
    </div>
  </div>
  <div class="card">
    <div class="row" style="margin-bottom:10px"><div class="t" style="font-size:18px">Holdings</div>
      <div class="s" style="margin-left:auto;display:flex;align-items:center;gap:10px"><span class="live ${marketOpen() ? 'on' : ''}"><i></i>${marketOpen() ? 'Live' : 'Market closed'}</span>${noPrices ? 'Loading prices…' : `${GUEST ? 'Simulated prices' : 'Yahoo Finance, delayed ~10 min'} · updated <span id="quoteTime">${upd}</span>${stale ? ' · <b class="neg">some prices are old</b>' : ''}`}<button class="ib edit sm" data-tip="Refresh prices" aria-label="Refresh prices" onclick="loadQuotes(true).then(render)">${icon('refresh', 'regular', 16)}</button></div></div>
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
        <td class="r">${avgPrice(r.avg)}</td>
        <td class="r ${flash[r.h.ticker + '.JK'] ? 'flash-' + flash[r.h.ticker + '.JK'] : ''}">${r.price != null ? rp(r.price) : '—'}</td>
        <td class="r ${plClass(r.day || 0)}">${r.day != null ? signed(r.day) : '—'}</td>
        <td class="r ${flash[r.h.ticker + '.JK'] ? 'flash-' + flash[r.h.ticker + '.JK'] : ''}"><b>${rp(r.value)}</b></td>
        <td class="r ${plClass(r.pl)}"><b>${(r.pl > 0 ? '+' : '') + rp(r.pl)}</b></td>
        <td class="r ${plClass(r.ret)}"><b>${signed(r.ret)}</b></td>
        <td class="r"><button class="ib del" data-tip="Delete" aria-label="Delete" onclick="delHolding(${r.i})">${icon('trash', 'regular', 18)}</button></td></tr>`).join('')}
    </table>
  </div>
  ${(() => {
    const sales = [...(S.wealth.stocks.sales || [])].sort((a, b) => b.date.localeCompare(a.date)), realized = sales.reduce((a, x) => a + x.proceeds - x.cost, 0);
    return `<div class="card" style="margin-top:14px">
    <div class="row" style="margin-bottom:10px"><div class="t" style="font-size:18px">Sales</div><div class="s" style="margin-left:auto">Realized profit: <b class="${plClass(realized)}">${(realized > 0 ? '+' : '') + rp(realized)}</b></div></div>
    <table>
      <tr><th>Date</th><th>Stock</th><th class="r">Lots</th><th class="r">Received</th><th class="r">Cost</th><th class="r">Profit</th><th></th></tr>
      ${sales.map(x => `<tr><td>${fmtDate(x.date)}</td><td><b>${esc(x.ticker)}</b></td><td class="r">${x.lots}</td><td class="r">${rp(x.proceeds)}</td><td class="r">${rp(x.cost)}</td><td class="r ${plClass(x.proceeds - x.cost)}"><b>${(x.proceeds - x.cost > 0 ? '+' : '') + rp(x.proceeds - x.cost)}</b></td>
        <td class="r"><button class="ib del" data-tip="Delete" aria-label="Delete" onclick="delStockSale('${x.id}')">${icon('trash', 'regular', 18)}</button></td></tr>`).join('')}
      ${sales.length ? '' : '<tr><td colspan="7" class="s" style="text-align:center;padding:22px">No sales yet. Sell a holding above and it will show here.</td></tr>'}
    </table></div>`;
  })()}`;
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
  <div class="note"><span class="ni">ⓘ</span><div>${GUEST ? 'These values are made up for this demo. The gold price is calculated from simulated gold futures and a simulated USD to IDR rate.' : GOLD_INFO[goldSource()].note}</div></div>
  <div class="grid g4" style="margin-bottom:14px">
    ${box('Total grams', gc.grams.toLocaleString('en-US', {maximumFractionDigits: 6}) + ' g')}
    ${box('Invested', rp(gc.paid))}
    ${box('Value now', rp(gc.value), '', gc.price ? (GUEST ? 'Simulated price' : goldSource() === 'treasury' ? 'Treasury, adjusted to Bank Jago' : goldSource() === 'yahoo' ? 'Yahoo Finance estimate' : 'Last saved price') : 'Loading price…')}
    ${box('P&L', (gc.pl > 0 ? '+' : '') + rp(gc.pl) + ' (' + signed(gc.ret) + ')', plClass(gc.pl))}
  </div>
  <div class="card" style="margin-bottom:14px">
    <div class="row" style="margin-bottom:6px"><div class="t" style="font-size:18px">Sell gold</div><div class="s" style="margin-left:auto">You hold <b>${gc.grams.toLocaleString('en-US', {maximumFractionDigits: 6})} g</b></div></div>
    <div class="s" style="margin-bottom:10px">The money goes to your cash saving. The amount is filled in from the live price, so change it to match the real number in Treasury. The oldest purchases are sold first.</div>
    <form class="add" data-kind="gold" onsubmit="sellGold(event)" oninput="sellEst(this,event)" onchange="sellEst(this,event)" style="margin-top:0">
      <input name="date" type="date" value="${today()}" required style="flex:0 0 160px"><input name="grams" type="number" step="any" min="0" placeholder="Grams" required style="flex:0 0 120px;text-align:right"><input name="amt" class="money" inputmode="numeric" autocomplete="off" placeholder="Amount received" required style="flex:0 0 200px;text-align:right"><input name="note" placeholder="Remarks"><button>Sell</button>
    </form>
  </div>
  <div class="card">
    <div class="row" style="margin-bottom:10px"><div class="t" style="font-size:18px">Gold purchases</div>
      <div class="row" style="margin-left:auto;gap:12px">${goldBuyPrice() ? `<span class="s">Buy price per gram</span><b class="price-amt">${rp(goldBuyPrice())}</b>` : ''}<span class="s">Sell price per gram</span><b class="price-amt">${gc.price ? rp(gc.price) : 'Loading…'}</b><span class="live on"><i></i>Live</span></div></div>
    <div class="s" style="margin-bottom:10px">Each new purchase is taken from your cash saving. ${GUEST ? 'The price is simulated for this demo.' : GOLD_INFO[goldSource()].src + '.'}</div>
    <form id="gadd" onsubmit="addGold(event)"></form>
    <table class="crud">
      <tr><th style="width:150px">Date</th><th class="r" style="width:120px">Grams</th><th class="r">Paid</th><th class="r" style="width:180px">Price per gram</th><th class="r">Value now</th><th class="r">P&L</th><th>Remarks</th><th style="width:130px"></th></tr>
      <tr class="newrow">
        <td><input form="gadd" type="date" name="date" value="${today()}" required></td>
        <td class="r s">Calculated</td>
        <td><input form="gadd" name="paid" class="money" inputmode="numeric" autocomplete="off" placeholder="Amount paid" required style="text-align:right"></td>
        <td><input form="gadd" name="price" class="money" inputmode="numeric" autocomplete="off" placeholder="Buy price" required style="text-align:right"></td>
        <td colspan="2" class="s">Grams = amount ÷ price. Taken from cash saving</td>
        <td><input form="gadd" name="note" placeholder="Remarks"></td>
        <td class="r"><button form="gadd" class="cta inline" style="padding:9px 18px">+ Add</button></td></tr>
      ${items.map(x => { const val = gc.price ? x.grams * gc.price : x.paid; return `<tr>
        <td>${fmtDate(x.date)}</td><td class="r">${x.grams.toLocaleString('en-US', {maximumFractionDigits: 6})} g</td><td class="r">${rp(x.paid)}</td>
        <td><input class="money" inputmode="numeric" autocomplete="off" value="${fm(x.price || x.paid / x.grams)}" onchange="editGoldPrice('${x.id}',this.value)" style="text-align:right"></td><td class="r"><b>${rp(val)}</b></td>
        <td class="r ${plClass(val - x.paid)}"><b>${(val - x.paid > 0 ? '+' : '') + rp(val - x.paid)}</b></td><td>${esc(x.note || '—')}</td>
        <td class="r"><button class="ib del" data-tip="Delete" aria-label="Delete" onclick="delGold('${x.id}')">${icon('trash', 'regular', 18)}</button></td></tr>`; }).join('')}
      ${items.length ? '' : '<tr><td colspan="8" class="s" style="text-align:center;padding:22px">No gold purchases yet. Add your first purchase above.</td></tr>'}
    </table>
  </div>
  ${(() => {
    const sales = S.wealth.transfers.filter(t => t.type === 'gold' && t.back).map(t => ({t, cost: (t.cut || []).reduce((a, c) => a + c.paid, 0)})).sort((a, b) => b.t.date.localeCompare(a.t.date)), realized = sales.reduce((a, x) => a + x.t.amount - x.cost, 0);
    return `<div class="card" style="margin-top:14px">
    <div class="row" style="margin-bottom:10px"><div class="t" style="font-size:18px">Gold sales</div><div class="s" style="margin-left:auto">Realized profit: <b class="${plClass(realized)}">${(realized > 0 ? '+' : '') + rp(realized)}</b></div></div>
    <table>
      <tr><th>Date</th><th class="r">Grams</th><th class="r">Received</th><th class="r">Cost</th><th class="r">Profit</th><th>Remarks</th><th></th></tr>
      ${sales.map(({t, cost}) => `<tr><td>${fmtDate(t.date)}</td><td class="r">${(t.grams || 0).toLocaleString('en-US', {maximumFractionDigits: 6})} g</td><td class="r">${rp(t.amount)}</td><td class="r">${rp(cost)}</td><td class="r ${plClass(t.amount - cost)}"><b>${(t.amount - cost > 0 ? '+' : '') + rp(t.amount - cost)}</b></td><td>${esc(t.note || '—')}</td>
        <td class="r"><button class="ib del" data-tip="Delete" aria-label="Delete" onclick="delTransfer('${t.id}')">${icon('trash', 'regular', 18)}</button></td></tr>`).join('')}
      ${sales.length ? '' : '<tr><td colspan="7" class="s" style="text-align:center;padding:22px">No gold sales yet. Sell gold above and it will show here.</td></tr>'}
    </table></div>`;
  })()}`;
}

function transferList() {
  const list = [...S.wealth.transfers].sort((a, b) => b.date.localeCompare(a.date));
  return `<h2>Moved to and from cash saving <span class="s">Investments, sales and other spending, also shown on the Spending page</span></h2>
  <div class="card"><table>
    <tr><th>Date</th><th>Account</th><th>Remarks</th><th class="r">Amount</th><th></th></tr>
    ${list.map(t => `<tr><td>${fmtDate(t.date)}</td><td><span class="cchip ${t.type === 'expense' ? '' : 'logochip'}">${t.type === 'gold' ? '<img src="/static/logos/treasury.png" alt="Treasury">' : t.type === 'expense' ? catLabel(t.cat || 'Other') : '<img src="/static/logos/stockbit.svg" alt="Stockbit">'}</span></td><td>${esc(t.note || '—')}</td><td class="r ${t.back ? 'pos' : 'neg'}"><b>${t.back ? '+' : '−'}${rp(t.amount)}</b></td>
      <td class="r"><button class="ib del" data-tip="Delete" aria-label="Delete" onclick="delTransfer('${t.id}')">${icon('trash', 'regular', 18)}</button></td></tr>`).join('')}
    ${list.length ? '' : '<tr><td colspan="5" class="s" style="text-align:center;padding:22px">Nothing moved yet. Top up your stocks, buy or sell gold, and it will show here.</td></tr>'}
  </table></div>`;
}

async function topUp(ev) {
  ev.preventDefault(); const f = ev.target, amt = num(f.amt.value); if (!amt) return;
  const date = f.date.value, note = f.note.value.trim();
  if (amt > K().total && !(await ask({title: 'More than your cash saving', text: 'This is more than your current cash saving. Continue anyway?', ok: 'Continue'}))) return;
  S.wealth.transfers.push({id: uid(), date, type: 'stockbit', cat: 'Investment', amount: amt, note});
  S.wealth.stocks.cash += amt; commit();
}
async function delTransfer(id) {
  const t = S.wealth.transfers.find(x => x.id === id); if (!t || !(await ask({title: 'Delete this transfer?', text: t.back ? 'The money leaves your cash saving again' + (t.type === 'gold' ? ' and the gold comes back.' : ' and goes back to your trading balance.') : 'The money goes back to your cash saving.', ok: 'Delete', danger: true}))) return;
  S.wealth.transfers = S.wealth.transfers.filter(x => x.id !== id);
  if (t.type === 'stockbit') S.wealth.stocks.cash += t.back ? t.amount : -t.amount;
  if (t.type === 'gold' && !t.back) S.wealth.gold.items = S.wealth.gold.items.filter(x => x.id !== t.goldId);
  if (t.type === 'gold' && t.back) (t.cut || []).forEach(c => {   // undo a gold sale: put the grams and their cost back
    const it = S.wealth.gold.items.find(x => x.id === c.id);
    if (it) { it.grams += c.grams; it.paid += c.paid; } else S.wealth.gold.items.push({id: c.id, date: c.date, grams: c.grams, paid: c.paid, price: c.price, note: c.note || ''});
  });
  commit();
}
// grams = amount paid / buy price per gram, with the digits after 6 decimals cut off (this reproduces the grams the Jago app shows)
const gramsFor = (paid, price) => Math.floor(paid / price * 1e6 + 1e-9) / 1e6;
function editGoldPrice(id, v) {
  const it = S.wealth.gold.items.find(x => x.id === id), price = num(v);
  if (!it || !(price > 0)) { render(); return; }
  it.price = price; it.grams = gramsFor(it.paid, price); commit();
}
async function addGold(ev) {
  ev.preventDefault(); const g = n => document.querySelector(`[form=gadd][name=${n}]`);
  const price = num(g('price').value), paid = num(g('paid').value); if (!(price > 0) || !paid) return;
  const grams = gramsFor(paid, price); if (!grams) return;
  const date = g('date').value, note = g('note').value.trim();   // read before the dialog opens: the page may redraw underneath it
  if (paid > K().total && !(await ask({title: 'More than your cash saving', text: 'This is more than your current cash saving. Continue anyway?', ok: 'Continue'}))) return;
  const id = uid();
  S.wealth.gold.items.push({id, date, grams, paid, price, note});
  S.wealth.transfers.push({id: 't' + id, date, type: 'gold', cat: 'Investment', amount: paid, note, goldId: id}); commit();
}
async function delGold(id) {
  const taken = S.wealth.transfers.some(x => x.goldId === id);
  if (!(await ask({title: 'Delete this gold purchase?', text: taken ? 'The money goes back to your cash saving.' : '', ok: 'Delete', danger: true}))) return;
  S.wealth.gold.items = S.wealth.gold.items.filter(x => x.id !== id);
  S.wealth.transfers = S.wealth.transfers.filter(x => x.goldId !== id); commit();
}

async function addHolding(ev) {
  ev.preventDefault(); const g = n => document.querySelector(`[form=hadd][name=${n}]`);
  const t = g('ticker').value.trim().toUpperCase().replace(/\.JK$/, ''), lots = Number(g('lots').value), inv = num(g('inv').value);
  if (!t || !lots) return;
  if (g('fund').checked) {
    if (inv > S.wealth.stocks.cash) { await notify({title: 'Trading balance too low', text: 'Your trading balance is lower than this purchase. Top up from cash saving first.'}); return; }
    S.wealth.stocks.cash -= inv;
  }
  S.wealth.stocks.holdings.push({ticker: t, lots, invested: inv}); persist(); render(); loadQuotes();
}
// the "Amount received" box follows the estimate until the user types their own number
function sellEst(f, e) {
  if (e.target.name === 'amt') { if (e.type === 'input') f.amt.dataset.touched = '1'; return; }
  if (f.amt.dataset.touched === '1') return;
  let est = 0;
  if (f.dataset.kind === 'gold') est = Math.round((Number(f.grams.value) || 0) * (goldCalc().price || 0));
  else { const r = stockCalc().rows[Number(f.pick.value)]; est = r && r.price != null ? Math.round((Number(f.lots.value) || 0) * 100 * r.price) : 0; }
  f.amt.value = est ? fm(est) : '';
}
async function sellStock(ev) {
  ev.preventDefault(); const f = ev.target, i = Number(f.pick.value), lots = Number(f.lots.value), amt = num(f.amt.value), date = f.date.value, h = S.wealth.stocks.holdings[i];
  if (!h || !lots || !amt) return;
  if (lots > h.lots) { await notify({title: 'Not enough lots', text: `You hold ${h.lots} ${h.lots === 1 ? 'lot' : 'lots'} of ${h.ticker}.`, ok: 'OK'}); return; }
  if (!(await ask({title: `Sell ${lots} ${lots === 1 ? 'lot' : 'lots'} of ${h.ticker}?`, text: `${rp(amt)} goes to your trading balance.`, ok: 'Sell'}))) return;
  const cost = lots === h.lots ? h.invested : Math.round(h.invested * lots / h.lots);   // the sold lots take their share of the invested amount
  const ticker = h.ticker;
  h.invested -= cost; h.lots -= lots;
  if (h.lots <= 0) S.wealth.stocks.holdings.splice(i, 1);
  S.wealth.stocks.cash += amt;
  (S.wealth.stocks.sales = S.wealth.stocks.sales || []).push({id: uid(), date, ticker, lots, proceeds: amt, cost}); commit();
}
async function delStockSale(id) {
  const st = S.wealth.stocks, x = (st.sales || []).find(v => v.id === id); if (!x) return;
  if (x.proceeds > st.cash) { await notify({title: 'Trading balance too low', text: 'Part of this money has already left your trading balance. Delete the withdrawal first.', ok: 'OK'}); return; }
  if (!(await ask({title: 'Delete this sale?', text: `${x.lots} ${x.lots === 1 ? 'lot' : 'lots'} of ${x.ticker} come back to your holdings and ${rp(x.proceeds)} leaves your trading balance.`, ok: 'Delete', danger: true}))) return;
  const h = st.holdings.find(v => v.ticker === x.ticker);
  if (h) { h.lots += x.lots; h.invested += x.cost; } else st.holdings.push({ticker: x.ticker, lots: x.lots, invested: x.cost});
  st.cash -= x.proceeds; st.sales = st.sales.filter(v => v.id !== id); commit(); loadQuotes();
}
async function withdrawStock(ev) {
  ev.preventDefault(); const f = ev.target, amt = num(f.amt.value), date = f.date.value, note = f.note.value.trim(); if (!amt) return;
  if (amt > S.wealth.stocks.cash) { await notify({title: 'Trading balance too low', text: 'Your trading balance is lower than this amount.', ok: 'OK'}); return; }
  S.wealth.stocks.cash -= amt;
  S.wealth.transfers.push({id: uid(), date, type: 'stockbit', back: true, cat: 'Investment', amount: amt, note}); commit();
}
async function sellGold(ev) {
  ev.preventDefault(); const f = ev.target, grams = Number(f.grams.value), amt = num(f.amt.value), date = f.date.value, note = f.note.value.trim(); if (!grams || !amt) return;
  const items = S.wealth.gold.items, have = items.reduce((a, x) => a + x.grams, 0);
  if (grams > have + 1e-9) { await notify({title: 'Not enough gold', text: `You hold ${have.toLocaleString('en-US', {maximumFractionDigits: 6})} g.`, ok: 'OK'}); return; }
  if (!(await ask({title: `Sell ${grams.toLocaleString('en-US', {maximumFractionDigits: 6})} g of gold?`, text: `${rp(amt)} goes to your cash saving.`, ok: 'Sell'}))) return;
  let left = grams; const cut = [];
  [...items].sort((a, b) => a.date.localeCompare(b.date)).forEach(it => {   // oldest purchase first; each sold part takes its share of what was paid
    if (left <= 1e-9) return;
    const take = Math.min(it.grams, left), paid = take >= it.grams ? it.paid : Math.round(it.paid * take / it.grams);
    cut.push({id: it.id, date: it.date, note: it.note, price: it.price, grams: take, paid}); it.grams -= take; it.paid -= paid; left -= take;
  });
  S.wealth.gold.items = items.filter(x => x.grams > 1e-9);
  S.wealth.transfers.push({id: uid(), date, type: 'gold', back: true, cat: 'Investment', amount: amt, note, grams, cut}); commit();
}
function editHolding(i, f, v) { S.wealth.stocks.holdings[i][f] = f === 'lots' ? (Number(v) || 0) : num(v); commit(); }
async function delHolding(i) { if (await ask({title: 'Delete this holding?', ok: 'Delete', danger: true})) { S.wealth.stocks.holdings.splice(i, 1); commit(); } }
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
        <div class="kv"><span>Leftovers moved in</span><span>${inflow(k.moved)}</span></div>
        <div class="kv"><span>Moved to investments</span><span>${outflow(k.transferred)}</span></div>
        <div class="kv"><span>Moved from investments</span><span>${inflow(k.returned)}</span></div>
        <div class="kv"><span>Other spending</span><span>${outflow(k.other)}</span></div>
        <div class="kv total"><span>Total</span><span>${rp(k.total)}</span></div>
      </div></div>
    <div class="card"><div class="t" style="font-size:18px;font-weight:900;margin-bottom:8px">Leftovers moved in this cycle</div>
      ${['daily', 'date', 'free'].map(x => { const e = k.c.env[x]; return `<div class="li"><div class="ico t-ink">${icon(e.icon, 'filled', 20)}</div><div class="t">${e.name}</div><div class="a ${e.moved ? 'pos' : ''}">${e.moved ? '+' : ''}${rp(e.moved)}</div></div>`; }).join('')}
      <div class="s" style="margin-top:12px">Move leftovers from the Spending page.</div></div>
  </div>
  <h2>History</h2>
  <div class="card"><table>
    <tr><th>Cycle</th><th class="r">Previous</th><th class="r">Saved from salary</th><th class="r">Leftovers moved in</th><th class="r">Moved to investments</th><th class="r">Moved from investments</th><th class="r">Other spending</th><th class="r">Total</th></tr>
    ${all.filter(x => !x.untracked).map(x => `<tr class="${x.c.id === S.activeId ? 'cur' : ''}"><td><b>${x.c.label}</b></td><td class="r">${rp(x.prev)}</td><td class="r">${inflow(x.save)} <span class="s">(${pc2(x.c.savePct)})</span></td><td class="r">${inflow(x.moved)}</td><td class="r">${outflow(x.transferred)}</td><td class="r">${inflow(x.returned)}</td><td class="r">${outflow(x.other)}</td><td class="r"><b>${rp(x.total)}</b></td></tr>`).join('')}
  </table></div>`;
}

// The category list lives in static/categories.json, shared with the Telegram bot so the two can never drift apart. It is filled in at start-up, before the first render.
let CATS = [], CAT_ICON = {};
const catLabel = n => `<span class="ic">${icon(CAT_ICON[n] || 'box', 'regular', 16)}</span> ${esc(n)}`;
// alphabetical, "Other" always last, but the category already chosen stays at the top of the list
const catOpts = sel => [...CATS].sort((a, b) => (b === sel) - (a === sel) || (a === 'Other') - (b === 'Other') || a.localeCompare(b)).map(n => `<option value="${n}" ${n === sel ? 'selected' : ''}>${n}</option>`).join('');
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
        <td class="r"><button class="ib del" data-tip="Delete" aria-label="Delete" onclick="delFixed(${i})">${icon('trash', 'regular', 18)}</button></td></tr>`).join('')}
    </table>
    </div>` : ''}
  </div>

  <h2>Budget spending</h2>
  <div class="tabs">${['daily', 'date', 'free', 'cash'].map(key => {
    if (key === 'cash') return `<button class="tab ${spendTab === 'cash' ? 'on' : ''}" style="--tc:${BANK.jago}" onclick="setSpendTab('cash')"><span class="ic" style="color:var(--tc)">${icon('savings', 'filled', 16)}</span> Cash saving<span>${rp(k.total)} available</span></button>`;
    const b = c.env[key];
    return `<button class="tab ${key === spendTab ? 'on' : ''}" style="--tc:${BANK[TAB_WALLET[key]]}" onclick="setSpendTab('${key}')"><span class="ic" style="color:var(--tc)">${icon(b.icon, 'filled', 16)}</span> ${b.name}<span>${rp(left(b))} available</span></button>`; }).join('')}</div>

  ${spendTab === 'cash' ? cashPanel(k) : `<div class="card">
    <div class="grid g4" style="margin-bottom:14px;gap:14px">
      ${mini(w === 'gopay' ? 'gopay' : 'jago', logo(w), e.name, rp(e.amount + (e.carry || 0)), e.carry ? 'Includes ' + rp(e.carry) + ' carried over' : '')}
      ${mini('plain', miniTile('receipt', 'red'), 'Spent', rp(sp), '', false, 'neg')}
      ${mini('plain', miniTile('moneyhand', 'green'), e.moved ? 'Left (moved to cash saving)' : 'Left', rp(l), '', false, l < 0 ? 'neg' : 'pos')}
      ${e.moved
        ? `<div class="stat" style="display:flex;align-items:center;justify-content:center"><div style="text-align:center"><span class="chip">Moved ${rp(e.moved)} to cash saving</span><br><button class="ib edit" data-tip="Undo" aria-label="Undo" onclick="undoMove('${spendTab}')">${icon('undo', 'regular', 18)}</button></div></div>`
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
        <td class="r"><button form="ef" class="ib edit" data-tip="Save" aria-label="Save">${icon('save', 'regular', 18)}</button><button type="button" class="ib del" data-tip="Cancel" aria-label="Cancel" onclick="editing=null;render()">${icon('dismiss', 'regular', 18)}</button></td></tr>` : `
      <tr><td>${chk(spendTab, i)}</td><td>${fmtDate(x.date)}</td><td><span class="cchip">${catLabel(x.cat || 'Other')}</span></td><td>${esc(x.note || '—')}</td><td class="r neg"><b>−${rp(x.amt)}</b></td>
        <td class="r"><button class="ib edit" data-tip="Edit" aria-label="Edit" onclick="editing={key:spendTab,i:${i}};render()">${icon('edit', 'regular', 18)}</button><button class="ib del" data-tip="Delete" aria-label="Delete" onclick="delSpend(spendTab,${i})">${icon('trash', 'regular', 18)}</button></td></tr>`).join('')}
      ${rows.length || spendTab === 'daily' ? '' : '<tr><td colspan="6" class="s" style="text-align:center;padding:22px">No expenses yet. Add your first one above.</td></tr>'}
    </table>
    ${spendTab === 'daily' ? dayList(e) : ''}
  </div>`}`;
}

// money that moves in or out of the cash saving: stock top-ups, gold purchases, sales that come back, and other spending
function cashPanel(k) {
  const c = k.c, all = S.wealth.transfers;
  const rows = all.map((t, i) => ({t, i})).filter(r => cycleOfDate(r.t.date) === c).sort((a, b) => b.t.date.localeCompare(a.t.date) || b.i - a.i);
  const sum = f => rows.filter(r => f(r.t)).reduce((a, r) => a + r.t.amount, 0);
  const invested = sum(t => !t.back && t.type !== 'expense'), other = sum(t => !t.back && t.type === 'expense'), returned = sum(t => t.back);
  const catOf = t => t.type === 'expense' ? (t.cat || 'Other') : 'Investment';
  const stat = (label, val, cls = '', sub = '') => `<div class="stat"><div class="s">${label}</div><b class="${cls}">${val}</b>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  return `<div class="card">
    <div class="grid g4" style="margin-bottom:14px;gap:14px">
      ${mini('jago', logo('jago'), 'Cash saving', rp(k.total))}
      ${mini('plain', miniTile('savings', 'green'), 'Added this cycle', rp(k.save + k.moved), pc2(k.c.savePct) + ' of salary + leftovers', false, 'pos')}
      ${mini('plain', miniTile('trending', 'navy'), 'Invested this cycle', rp(invested), returned ? `${rp(returned)} moved back from sales` : 'Stocks and gold', false, invested ? 'neg' : '')}
      ${mini('plain', miniTile('receipt', 'red'), 'Other spending', rp(other), '', false, other ? 'neg' : '')}
    </div>
    <div class="s" style="margin-bottom:10px">Everything here moves in or out of your cash saving. The Investment category is a stock top-up, and it also shows on the Wealth page. Gold purchases, gold sales and stock withdrawals are added in the Wealth page and appear here too.</div>
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
        <td class="r"><button form="cef" class="ib edit" data-tip="Save" aria-label="Save">${icon('save', 'regular', 18)}</button><button type="button" class="ib del" data-tip="Cancel" aria-label="Cancel" onclick="editing=null;render()">${icon('dismiss', 'regular', 18)}</button></td></tr>` : `
      <tr><td>${fmtDate(t.date)}</td><td><span class="cchip">${catLabel(catOf(t))}</span></td>
        <td>${t.note ? esc(t.note) + ' ' : t.type === 'expense' ? '—' : ''}${t.type === 'stockbit' ? `<span class="s">${t.back ? 'Stock withdrawal' : 'Stock top-up'}</span>` : t.type === 'gold' ? `<span class="s">${t.back ? 'Gold sale' : 'Gold purchase'}</span>` : ''}</td>
        <td class="r ${t.back ? 'pos' : 'neg'}"><b>${t.back ? '+' : '−'}${rp(t.amount)}</b></td>
        <td class="r">${t.type === 'gold' || t.back ? '' : `<button class="ib edit" data-tip="Edit" aria-label="Edit" onclick="editing={key:'cash',id:'${t.id}'};render()">${icon('edit', 'regular', 18)}</button>`}<button class="ib del" data-tip="Delete" aria-label="Delete" onclick="delTransfer('${t.id}')">${icon('trash', 'regular', 18)}</button></td></tr>`).join('')}
      ${rows.length ? '' : '<tr><td colspan="5" class="s" style="text-align:center;padding:22px">Nothing has moved in or out of your cash saving in this cycle.</td></tr>'}
    </table>
  </div>`;
}

async function addCash(ev) {
  ev.preventDefault(); const g = n => document.querySelector(`[form=cadd][name=${n}]`);
  const amt = num(g('amt').value); if (!amt) return;
  const date = g('date').value, cat = g('cat').value, note = g('note').value.trim();   // read before the dialog opens: the page may redraw underneath it
  if (amt > K().total && !(await ask({title: 'More than your cash saving', text: 'This is more than your current cash saving. Continue anyway?', ok: 'Continue'}))) return;
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
    <span class="s">${n} selected</span><button class="danger" ${n ? '' : 'disabled'} onclick="delSelected('${scope}')">${icon('trash', 'regular', 18)}<span>Delete selected${n ? ` (${n})` : ''}</span></button>${n ? `<button class="ib edit" data-tip="Clear selection" aria-label="Clear selection" onclick="sel.clear();render()">${icon('eraser', 'regular', 18)}</button>` : ''}</div>`;
}
const listOf = scope => scope === 'fixed' ? cur().fixed : E(scope).spends;
function toggleSel(scope, i) { const k = scope + ':' + i; sel.has(k) ? sel.delete(k) : sel.add(k); render(); }
function toggleAll(scope, on) { [...sel].forEach(k => k.startsWith(scope + ':') && sel.delete(k)); if (on) listOf(scope).forEach((_, i) => sel.add(scope + ':' + i)); render(); }
function toggleDaySel(d) { const idx = E('daily').spends.map((x, i) => x.date === d ? i : -1).filter(i => i >= 0), all = idx.every(i => sel.has('daily:' + i));
  idx.forEach(i => all ? sel.delete('daily:' + i) : sel.add('daily:' + i)); render(); }
async function delSelected(scope) {
  const idx = [...sel].filter(k => k.startsWith(scope + ':')).map(k => Number(k.split(':')[1])).sort((a, b) => b - a);
  if (!idx.length || !(await ask({title: `Delete ${idx.length} ${idx.length === 1 ? 'item' : 'items'}?`, text: 'This cannot be undone.', ok: 'Delete', danger: true}))) return;
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

const WARN_AT = 0.9;   // a day turns yellow from this share of the daily cap (red only when over the cap)
function dayList(e) {
  const cap = e.cap || 60000, by = {};
  e.spends.forEach((x, i) => (by[x.date] = by[x.date] || []).push({x, i}));
  const days = Object.keys(by).sort().reverse();
  if (!days.length) return '<div class="s" style="text-align:center;padding:24px">No expenses yet. Add your first meal above. Entries are grouped by day automatically.</div>';
  return `<div class="daylist">${selBar('daily', e.spends.length)}<div class="s" style="margin:6px 0 10px">Grouped by day. Yellow starts at ${WARN_AT * 100}% of the ${rp(cap)} cap, and red only when a day goes over it.</div>` + days.map(d => {
    const list = by[d], tot = list.reduce((a, r) => a + r.x.amt, 0), lvl = tot > cap ? 'bad' : tot >= cap * WARN_AT ? 'warn' : 'good', open = openDays.has(d), pc = Math.min(100, tot / cap * 100);
    return `<div class="day ${lvl}">
      <div class="dayhead" onclick="toggleDay('${d}')">
        <span class="chev">${icon(open ? 'chevdown' : 'chevright', 'regular', 16)}</span>
        <input type="checkbox" class="chk" onclick="event.stopPropagation()" onchange="toggleDaySel('${d}')" ${list.every(r => sel.has('daily:' + r.i)) ? 'checked' : ''}>
        <div><div class="t">${dayName(d)}</div><div class="s">${list.length} entr${list.length === 1 ? 'y' : 'ies'}</div></div>
        <div class="dbar"><i style="width:${pc}%"></i></div>
        <div style="text-align:right"><div class="${lvl === 'good' ? 'pos' : lvl === 'bad' ? 'neg' : 'amber'}" style="font-weight:900;font-size:17px">${rp(tot)}</div><div class="s" style="font-weight:900;color:${lvl === 'good' ? '#0a9d58' : lvl === 'bad' ? 'var(--red)' : '#b87700'}">${diffText(tot, cap)}</div></div>
      </div>
      ${open ? `<div class="daybody ${justOpened === d ? 'opening' : ''}"><table class="crud">${list.map(({x, i}) => editing && editing.key === 'daily' && editing.i === i ? `
        <tr class="editing"><td style="width:36px"></td><td style="width:150px"><input form="ef" type="date" name="date" value="${x.date}" required></td>
          <td style="width:190px"><select form="ef" name="cat">${catOpts(x.cat)}</select></td>
          <td><input form="ef" name="note" value="${esc(x.note || '')}"></td>
          <td style="width:150px"><input form="ef" name="amt" class="money" inputmode="numeric" autocomplete="off" value="${fm(x.amt)}" required style="text-align:right"></td>
          <td class="r" style="width:140px"><button form="ef" class="ib edit" data-tip="Save" aria-label="Save">${icon('save', 'regular', 18)}</button><button type="button" class="ib del" data-tip="Cancel" aria-label="Cancel" onclick="editing=null;render()">${icon('dismiss', 'regular', 18)}</button></td></tr>` : `
        <tr><td style="width:36px">${chk('daily', i)}</td><td style="width:150px"><span class="cchip">${catLabel(x.cat || 'Other')}</span></td><td>${esc(x.note || '—')}</td><td class="r neg" style="width:150px"><b>−${rp(x.amt)}</b></td>
          <td class="r" style="width:140px"><button class="ib edit" data-tip="Edit" aria-label="Edit" onclick="editing={key:'daily',i:${i}};render()">${icon('edit', 'regular', 18)}</button><button class="ib del" data-tip="Delete" aria-label="Delete" onclick="delSpend('daily',${i})">${icon('trash', 'regular', 18)}</button></td></tr>`).join('')}</table>
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
    ${untracked(c) ? `<div class="card cyc"><div class="t" style="font-size:18px;font-weight:900;margin-bottom:6px">Edit ${c.label}</div>
      <div class="s intro">This cycle has no tracking yet, so only the payday and the salary can be changed.</div>
      <form onsubmit="editCycle(event)" class="cycform">
        <div class="fgrid">
          <label class="s">Payday<input name="payday" type="date" value="${c.payday}" required style="width:100%;display:block;margin-top:4px"></label>
          ${inp('Salary (BCA)', 'salary', fm(c.salary))}
        </div>
        <button class="cta" style="margin-top:auto">Save changes</button>
      </form></div>` : `<div class="card cyc"><div class="t" style="font-size:18px;font-weight:900;margin-bottom:6px">Edit ${c.label}</div>
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
    </div>`}
  </div>
  <h2>All cycles</h2>
  <div class="card"><table>
    <tr><th>Cycle</th><th>Payday</th><th class="r">Salary</th><th class="r">Fixed</th><th class="r">Daily</th><th class="r">Date</th><th class="r">Free to use</th><th class="r">Cash saving after</th><th></th></tr>
    ${all.map(x => x.untracked ? `<tr class="${x.c.id === S.activeId ? 'cur' : ''}"><td><b>${x.c.label}</b></td><td>${fmtDate(x.c.payday)}</td><td class="r">${rp(x.c.salary)}</td><td colspan="5" class="s">No tracking yet</td>
      <td class="r"><button class="ib edit" data-tip="Open" aria-label="Open" onclick="selectCycle('${x.c.id}')">${icon('open', 'regular', 18)}</button></td></tr>` : `<tr class="${x.c.id === S.activeId ? 'cur' : ''}"><td><b>${x.c.label}</b></td><td>${fmtDate(x.c.payday)}</td><td class="r">${rp(x.c.salary)}</td><td class="r">${rp(x.fixedTotal)}</td><td class="r">${rp(x.c.env.daily.amount)}</td><td class="r">${rp(x.c.env.date.amount)}</td><td class="r">${rp(x.free)}</td><td class="r"><b>${rp(x.total)}</b></td>
      <td class="r"><button class="ib edit" data-tip="Open" aria-label="Open" onclick="selectCycle('${x.c.id}')">${icon('open', 'regular', 18)}</button></td></tr>`).join('')}
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
async function delSpend(key, i) { if (await ask({title: 'Delete this expense?', text: 'This cannot be undone.', ok: 'Delete', danger: true})) { E(key).spends.splice(i, 1); commit(); } }
function moveLeft(key) { const e = E(key), l = left(e); if (l > 0) { e.moved += l; commit(); } }
function undoMove(key) { E(key).moved = 0; commit(); }
function editFixed(i, v) { cur().fixed[i].amount = num(v); commit(); }
function editFixedField(i, f, v) { cur().fixed[i][f] = v.trim(); commit(); }
function delFixed(i) { cur().fixed.splice(i, 1); commit(); }
function addFixed(ev) { ev.preventDefault(); const g = n => document.querySelector(`[form=fadd][name=${n}]`);
  const amt = num(g('amt').value); if (!amt) return; cur().fixed.push({cat: g('cat').value, name: g('note').value.trim(), amount: amt}); commit(); }
function selectCycle(id) { S.activeId = id; tab = 'dash'; commit(); }
async function newCycle(ev) {
  ev.preventDefault(); const f = ev.target, last = S.cycles[S.cycles.length - 1], payday = f.payday.value;
  const label = monthLabel(payday);
  if (S.cycles.some(x => x.label === label) && !(await ask({title: `A ${label} cycle already exists`, text: 'Add another one?', ok: 'Add another'}))) return;
  const c = {id: 'c' + Date.now(), label, payday, salary: num(f.salary.value), savePct: last.savePct,
    fixed: last.fixed.map(x => ({...x})), env: newEnv(num(f.dailyAmt.value), num(f.dateAmt.value))};
  c.env.daily.cap = num(f.dailyCap.value) || 60000; c.savePct = Number(f.pct.value);
  S.cycles.push(c); S.activeId = c.id; tab = 'dash'; commit();
}
function editCycle(ev) { ev.preventDefault(); const f = ev.target, c = cur();
  c.payday = f.payday.value; c.salary = num(f.salary.value); c.label = monthLabel(c.payday);
  if (untracked(c)) { commit(); return; }
  c.savePct = Number(f.pct.value);
  c.env.daily.amount = num(f.dailyAmt.value); c.env.daily.cap = num(f.dailyCap.value) || 60000; c.env.date.amount = num(f.dateAmt.value); commit(); }
async function resetAll() { if (await ask({title: 'Reset all data?', text: 'Everything goes back to the empty starting numbers.', ok: 'Reset', danger: true, icon: 'warning'})) { S = structuredClone(DEFAULT); commit(); } }

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
document.querySelectorAll('.side-foot').forEach(f => f.addEventListener('submit', async e => {
  e.preventDefault();
  const yes = await ask(GUEST ? {title: 'Exit the demo?', text: 'The random demo data will be gone.', ok: 'Exit demo', danger: true, icon: 'signout'}
                              : {title: 'Log out?', text: 'You will need to sign in again.', ok: 'Log out', danger: true, icon: 'signout'});
  if (yes) { CHART_KEYS.forEach(k => localStorage.removeItem(k)); f.submit(); }   // the remembered chart choices end with the session; submit() does not fire this handler again
}));
document.querySelectorAll('.logout').forEach(b => b.insertAdjacentHTML('afterbegin', `<span class="logic">${icon('signout', 'regular', 20)}</span>`));
$('#cycleSel').onchange = e => { S.activeId = e.target.value; commit(); };

(async () => {
  const catData = await (await fetch('/static/categories.json')).json(); CATS = catData.cats; CAT_ICON = catData.icons;
  let saved = GUEST ? demoState() : await (await fetch('/api/state')).json();
  const raw = JSON.stringify(saved);   // to see later whether opening the page changed anything that needs saving
  if (saved && saved.cycle) {   // migrate v1 data
    const o = saved, c = o.cycle;
    saved = {activeId: 'c1', basePrevSavings: c.savingsAfterSplit - Math.round(c.salary * c.savePct / 100),
      cycles: [{id: 'c1', label: c.label, payday: c.payday, salary: c.salary, savePct: c.savePct, fixed: o.fixed, env: o.env}]};
  }
  S = saved || structuredClone(DEFAULT);
  if (!GUEST) { try { SLIPS = new Set(await (await fetch('/api/slips')).json()); } catch (e) {} }   // salary slip PDFs exist only on this computer's server, never in the demo
  if (!S.wealth) S.wealth = structuredClone(DEFAULT.wealth);
  if (!S.wealth.transfers) S.wealth.transfers = [];
  if (!S.wealth.gold) S.wealth.gold = {pricePerGram: 0, items: []};
  S.cycles.forEach(c => Object.values(c.env).forEach(e => e.spends.forEach(x => { if (!x.cat) x.cat = 'Other'; })));
  S.cycles.forEach(c => c.fixed.forEach(x => { if (!x.cat) x.cat = 'Other'; delete x.icon; }));
  S.cycles.forEach(c => { if (!c.env.daily.cap) c.env.daily.cap = 60000; });
  S.cycles.forEach(c => { c.env.daily.icon = 'calday'; c.env.date.icon = 'heart'; c.env.free.icon = 'balloon'; });
  S.cycles.forEach(c => { c.env.date.wallet = 'jago'; c.env.free.wallet = 'jago'; });
  const dirty = JSON.stringify(S) !== raw;   // true only for a first-ever load or a data upgrade; a normal open never writes
  // keep the page hidden (only the spinner shows) until the data AND the prices are in, so nothing pops in or jumps afterwards;
  // prices get at most 4 seconds, then the page opens with the last known values
  await Promise.race([loadQuotes(), new Promise(r => setTimeout(r, 4000))]);
  if (dirty) persist();
  render();
  document.documentElement.classList.remove('booting'); const bl = document.getElementById('boot'); if (bl) bl.remove();
  schedulePoll();
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
