// ---------- Dashboard charts: spending by category (donut) and the daily trend ----------
// Built with Chart.js 4 (static/vendor/chart.umd.min.js, MIT licence, served from this site, no outside requests).
// One multi-select dropdown (a checkbox per part of the spending, plus Select all) filters both charts. Only the 5 biggest categories get their own colour; everything else is grouped as "Others (n)",
// so the charts stay readable even though the app has 14 categories. A category keeps the same colour in both charts.
// Hovering a day in the trend chart shows only that day in the donut. The trend is Stacked (with the day's total above each bar) or
// Stacked 100%; every day is SLOT px wide and more days than fit scroll sideways, opening at the newest day, while the y axis stays put.
//
// Rules learned the hard way (see handoff.md):
// - slice and bar colours stay plain colours; the glass / 3D look is painted ON TOP by plugins (Chart.js cannot animate gradients
//   and crashed inside destroy(), which left blank charts);
// - a type or filter switch updates the existing chart in place, so Chart.js morphs the bars instead of showing an empty chart;
// - the donut hover (slice grows, the others turn grey) is our own small animation, not Chart.js's hover, so it is always smooth;
// - labels are placed by layoutPills(), which works without a chart redraw.

const CAT_COLOR = {
  'Food & drink': '#ff9f1c', 'Groceries': '#34c38f', 'Transport': '#4c8dff', 'Entertainment': '#a06cff', 'Date': '#ff5c8a', 'Shopping': '#ff7b54',
  'Health': '#1fc8c0', 'Housing': '#5b6ee1', 'Installments': '#f25f5c', 'Subscriptions': '#00a6d6', 'Bills & utilities': '#f4c430',
  'Laundry': '#9adf6a', 'Investment': '#2d3a8c', 'Other': '#9aa3bd',
};
const OTHERS_COLOR = '#b4bbd2', TOP_N = 5;
const SPEND_PARTS = [['fixed', 'Fixed expenses'], ['daily', 'Daily budget'], ['date', 'Date budget'], ['free', 'Free to use']];
const TREND_TYPES = [['stacked', 'Stacked'], ['stacked100', 'Stacked 100%']];
// both choices are remembered in this browser until the user logs out or exits the demo (see the logout handler in app.js)
const CHART_KEYS = ['dfSpendParts', 'dfTrendType'];
let spendParts = (() => { try { const v = JSON.parse(localStorage.getItem('dfSpendParts')); if (Array.isArray(v)) return new Set(v.filter(p => SPEND_PARTS.some(s => s[0] === p))); } catch (e) {} return new Set(SPEND_PARTS.map(s => s[0])); })();
let trendType = TREND_TYPES.some(t => t[0] === localStorage.getItem('dfTrendType')) ? localStorage.getItem('dfTrendType') : 'stacked';
const AXW = 44, SLOT = 92;   // y-axis width; the width of one day (a 40 px bar); more days than fit scroll sideways
let donutChart = null, trendChart = null, chartData = null, donutDay = null, donutHover = -1, viewGroups = [];
let donutCompact = false;   // too narrow for labels around the ring (phones, small windows): the labels become a list under the donut instead
const hv = {grow: [], fade: [], raf: 0};          // the donut hover animation: 0..1 per slice
const trendState = {d: null, t: 'stacked', dayTot: []};   // read by the trend chart's tooltip and axis at call time

function chartSection() {
  return `<div class="chartbar"><h2 style="margin:0">Spending breakdown <span class="s">From payday until today</span></h2>
    <div class="chartfilter"><div class="cs"><button type="button" class="cs-btn" id="spendBtn" aria-haspopup="listbox" onclick="event.stopPropagation();spendMenu(this)" onkeydown="if(['ArrowDown','Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();spendMenu(this)}">${spendBtnHtml()}</button></div></div></div>
  <div class="grid g2 charts">
    <div class="card chartcard"><div class="chead"><div class="t">By category</div><span class="s" id="donutScope"></span></div>
      <div class="dcanvas"><canvas id="donutC"></canvas><div class="dlabels" id="donutLabels"></div><div class="dcenter" id="donutCenter"></div></div><div id="donutLegend"></div></div>
    <div class="card chartcard"><div class="chead"><div class="t">Daily trend</div>
      <div class="seg" id="trendSeg">${TREND_TYPES.map(([v, l]) => `<button type="button" data-t="${v}" class="${v === trendType ? 'on' : ''}" onclick="setTrendType('${v}')">${l}</button>`).join('')}</div></div>
      <div class="tcanvas"><div class="tchaxis"><canvas id="trendY"></canvas></div><div class="tchscroll" id="trendScroll"><div class="tchinner"><canvas id="trendC"></canvas></div></div></div>
      <div class="tlegend" id="trendLegend"></div></div>
  </div>`;
}

// ---- the filter: a dropdown with a checkbox per part of the spending, and "Select all" ----
function spendBtnHtml() {
  const n = spendParts.size, label = n === SPEND_PARTS.length ? 'All spending' : n ? SPEND_PARTS.filter(s => spendParts.has(s[0])).map(s => s[1]).join(', ') : 'Nothing selected';
  return `<span class="cs-label">${label}</span><span class="cs-chev">${icon('chevdown', 'regular', 16)}</span>`;
}
function spendMenu(btn) {
  if (csOpenBtn === btn) { csClose(); return; }
  csClose(); csOpenBtn = btn; btn.classList.add('open');
  const m = document.createElement('div'); m.className = 'cs-menu ms'; m.setAttribute('role', 'listbox'); m.setAttribute('aria-multiselectable', 'true');
  const row = (v, l, on, mixed) => `<div class="cs-opt ms-opt" role="option" aria-selected="${on}" tabindex="-1" data-v="${v}"><span class="ms-box ${on ? 'on' : mixed ? 'mixed' : ''}">${on ? icon('check', 'filled', 14) : '<i></i>'}</span><span class="cs-label">${l}</span></div>`;
  const paint = () => {
    const all = spendParts.size === SPEND_PARTS.length;
    m.innerHTML = row('all', 'Select all', all, !all && spendParts.size > 0) + '<div class="ms-sep"></div>' + SPEND_PARTS.map(([v, l]) => row(v, l, spendParts.has(v))).join('');
  };
  const toggle = v => {
    if (v === 'all') spendParts = spendParts.size === SPEND_PARTS.length ? new Set() : new Set(SPEND_PARTS.map(s => s[0]));
    else spendParts.has(v) ? spendParts.delete(v) : spendParts.add(v);
    localStorage.setItem('dfSpendParts', JSON.stringify([...spendParts]));
    paint(); btn.innerHTML = spendBtnHtml(); m.querySelector(`[data-v="${v}"]`).focus({preventScroll: true});
    drawCharts(undefined, true);
  };
  paint(); document.body.appendChild(m); csMenu = m;
  const r = btn.getBoundingClientRect(), w = Math.max(r.width, 220);
  m.style.minWidth = w + 'px'; m.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 12)) + 'px'; m.style.top = (r.bottom + 6) + 'px';
  requestAnimationFrame(() => m.classList.add('show'));
  m.addEventListener('click', e => { e.stopPropagation(); const o = e.target.closest('.ms-opt'); if (o) toggle(o.dataset.v); });   // stays open: tick as many as you like
  m.addEventListener('keydown', e => {
    const opts = [...m.querySelectorAll('.ms-opt')], at = opts.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); opts[Math.min(opts.length - 1, at + 1)].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); opts[Math.max(0, at - 1)].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (at >= 0) toggle(opts[at].dataset.v); }
    else if (e.key === 'Escape' || e.key === 'Tab') { csClose(); btn.focus(); }
  });
  m.querySelector('.ms-opt').focus({preventScroll: true});
}
function setTrendType(v) {
  if (v === trendType) return;
  trendType = v; localStorage.setItem('dfTrendType', v);
  document.querySelectorAll('#trendSeg button').forEach(b => b.classList.toggle('on', b.dataset.t === v));
  drawCharts('trend', true);
}

const shiftDay = (iso, n) => { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); return isoOf(d.getFullYear(), d.getMonth(), d.getDate()); };
function daysBetween(a, b) {
  const out = [], d = new Date(a + 'T00:00'), e = new Date(b + 'T00:00');
  for (; d <= e && out.length < 92; d.setDate(d.getDate() + 1)) out.push(isoOf(d.getFullYear(), d.getMonth(), d.getDate()));
  return out;
}
const dayLabel = iso => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1].slice(0, 3)}`;
const chartMoney = v => hideNums ? 'IDR ••••••' : rp(v);
const chartPct = v => hideNums ? '•••%' : pc2(v);
const labelPct = v => hideNums ? '•••%' : v.toFixed(2).replace(/\.00$/, '') + '%';   // 2 decimals, but a whole number drops the .00 (50.00% shows as 50%)
const compactIdr = v => hideNums ? 'IDR ••••' : 'IDR ' + (v >= 1e6 ? (Math.round(v / 1e4) / 100).toLocaleString('en-US') + 'M' : v >= 1e3 ? Math.round(v / 1e3).toLocaleString('en-US') + 'K' : v);
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const shade = (h, p) => { const f = p >= 0 ? v => Math.round(v + (255 - v) * p) : v => Math.round(v * (1 + p)); const [r, g, b] = hexRgb(h); return `rgb(${f(r)},${f(g)},${f(b)})`; };
const toGrey = (h, k) => { const [r, g, b] = hexRgb(h), G = [214, 218, 228]; return `rgb(${[r, g, b].map((v, i) => Math.round(v + (G[i] - v) * k)).join(',')})`; };

// the 5 biggest categories of these expenses, the rest grouped as "Others (n)"
function groupRows(rows) {
  const tot = {}; rows.forEach(r => { tot[r.cat] = (tot[r.cat] || 0) + r.amt; });
  const ranked = Object.entries(tot).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]);
  const groups = ranked.slice(0, TOP_N).map(([name, total]) => ({name, color: CAT_COLOR[name] || OTHERS_COLOR, total, members: [name]}));
  const rest = ranked.slice(TOP_N);
  if (rest.length) groups.push({name: `Others (${rest.length})`, color: OTHERS_COLOR, total: rest.reduce((a, e) => a + e[1], 0), members: rest.map(e => e[0]), detail: rest});
  return groups;
}
// every expense of the cycle that matches the filter, grouped into the top categories (+ "Others")
function spendData(c, parts) {
  const rows = [];
  if (parts.has('fixed')) c.fixed.forEach(x => rows.push({date: c.payday, cat: x.cat || 'Other', amt: x.amount}));   // fixed expenses have no date: they count on payday
  ['daily', 'date', 'free'].forEach(key => { if (parts.has(key)) c.env[key].spends.forEach(x => rows.push({date: x.date, cat: x.cat || 'Other', amt: x.amt})); });
  const groups = groupRows(rows);
  const groupOf = {}; groups.forEach(g => g.members.forEach(m => { groupOf[m] = g; }));
  // days from payday until today (an older cycle ends the day before the next payday); entries outside that range stretch it
  const nxt = S.cycles[S.cycles.indexOf(c) + 1];
  let start = c.payday, end = nxt ? shiftDay(nxt.payday, -1) : today();
  rows.forEach(r => { if (r.date < start) start = r.date; if (r.date > end) end = r.date; });
  if (end < start) end = start;
  const days = daysBetween(start, end), idx = Object.fromEntries(days.map((d, i) => [d, i]));
  groups.forEach(g => { g.perDay = days.map(() => 0); });
  rows.forEach(r => { const g = groupOf[r.cat]; if (g && r.date in idx) g.perDay[idx[r.date]] += r.amt; });
  return {rows, groups, days, total: groups.reduce((a, g) => a + g.total, 0)};
}

function chartDefaults() {
  Chart.defaults.font.family = "'Nunito', system-ui, sans-serif";
  Chart.defaults.font.weight = '800';
  Chart.defaults.color = '#6b7388';
}
const anim = on => ({duration: on && !reduceMotion ? 500 : 0, easing: 'easeOutCubic'});
const tipStyle = () => ({
  backgroundColor: 'rgba(27,32,51,.92)', titleColor: '#fff', bodyColor: '#fff', footerColor: 'rgba(255,255,255,.75)', padding: 12, cornerRadius: 14, boxPadding: 6,
  titleFont: {weight: '900', size: 12}, bodyFont: {weight: '800', size: 12}, footerFont: {weight: '900', size: 12}, usePointStyle: true, caretSize: 0,
});

// Chart.js runs ONE animation loop for all charts: an error thrown while drawing (for example a gradient built from a bar that is
// still being created and has no position yet) stops that loop, and every chart freezes on a half-drawn frame. So every drawing
// hook below runs inside safe(), and every number used for drawing is checked first.
const fin = (...v) => v.every(Number.isFinite);
const safe = plugin => { Object.keys(plugin).forEach(k => { const f = plugin[k]; if (typeof f === 'function') plugin[k] = function (...a) { try { return f.apply(this, a); } catch (e) { console.warn('chart drawing skipped:', e.message); } }; }); return plugin; };

// ================= DONUT =================
const donutGroups = () => donutDay == null ? chartData.groups : groupRows(chartData.rows.filter(r => r.date === chartData.days[donutDay]));
const donutValues = () => viewGroups.map(g => g.total);
function donutText() {   // the centre text and the small note next to the card title
  const center = document.getElementById('donutCenter'), scope = document.getElementById('donutScope'); if (!center || !chartData) return;
  const vals = donutValues(), tot = vals.reduce((a, v) => a + v, 0), g = donutHover >= 0 ? viewGroups[donutHover] : null;
  scope.textContent = donutDay == null ? '' : 'Showing ' + fmtDate(chartData.days[donutDay]);
  const r = donutChart ? donutChart.getDatasetMeta(0).controller.innerRadius || 80 : 80, v = g ? vals[donutHover] : tot, small = r < 64;
  center.style.fontSize = Math.max(9, Math.min(18, r * .24)) + 'px';   // the text always fits inside the hole
  center.innerHTML = `<div class="dc-t" style="${g ? 'color:' + g.color : ''}">${esc(g ? g.name : donutDay == null ? 'Total spent' : dayLabel(chartData.days[donutDay]))}</div>
    <div class="dc-a">${small ? compactIdr(v) : chartMoney(v)}</div>${g ? `<div class="dc-p">${labelPct(tot ? v / tot * 100 : 0)}</div>` : ''}`;
}
function donutPills() {   // one label per category; hovering a label works exactly like hovering its slice
  const around = document.getElementById('donutLabels'), list = document.getElementById('donutLegend'); if (!around || !list) return;
  const box = donutCompact ? list : around; (donutCompact ? around : list).innerHTML = ''; list.classList.toggle('dlist', donutCompact);
  const vals = donutValues(), tot = vals.reduce((a, v) => a + v, 0);
  box.innerHTML = viewGroups.map((g, i) => `<div class="dpill" data-i="${i}" ${g.detail ? `data-tip="${esc(g.detail.map(([n, v]) => n + ' ' + chartMoney(v)).join(' · '))}"` : ''}
      onmouseenter="donutHoverSet(${i})" onmouseleave="donutHoverSet(-1)">
      <i style="background:${g.color}"></i><div><b>${esc(g.name)}</b><span>${compactIdr(vals[i])} · ${labelPct(tot ? vals[i] / tot * 100 : 0)}</span></div></div>`).join('');
}
// hover: the slice grows outward, every other slice and label turns grey, all eased over ~300 ms
const approach = (v, t) => { const n = v + (t - v) * (reduceMotion ? 1 : .22); return Math.abs(t - n) < .004 ? t : n; };
function donutHoverSet(i) {
  if (donutHover === i) return;
  donutHover = i;
  document.querySelectorAll('#donutLabels .dpill').forEach(p => { const k = Number(p.dataset.i); p.classList.toggle('on', k === i); p.classList.toggle('dim', i >= 0 && k !== i); });
  donutText();
  if (hv.raf) return;
  const step = () => {
    hv.raf = 0; if (!donutChart || donutChart.$dead) return;
    let moving = false;
    viewGroups.forEach((g, k) => {
      const tg = donutHover === k ? 1 : 0, tf = donutHover >= 0 && donutHover !== k ? 1 : 0;
      hv.grow[k] = approach(hv.grow[k] || 0, tg); hv.fade[k] = approach(hv.fade[k] || 0, tf);
      if (hv.grow[k] !== tg || hv.fade[k] !== tf) moving = true;
    });
    try { donutChart.draw(); } catch (e) { console.warn(e); }
    if (moving) hv.raf = requestAnimationFrame(step);
  };
  hv.raf = requestAnimationFrame(step);
}
function resetHover() { hv.grow = []; hv.fade = []; donutHover = -1; }
function setDonutDay(i) {   // called while hovering the trend chart
  if (!donutChart || donutChart.$dead || !chartData || donutDay === i) return;
  donutDay = i; resetHover(); viewGroups = donutGroups();
  fillDonut(true);
}
function fillDonut(animate) {   // put the current view into the existing donut and animate to it
  const ds = donutChart.data.datasets[0], cols = viewGroups.map(g => g.color);
  donutChart.data.labels = viewGroups.map(g => g.name); ds.data = donutValues(); ds.backgroundColor = cols; ds.hoverBackgroundColor = cols;
  donutPills();
  donutChart.options.animation = anim(animate);
  donutChart.update();
  layoutPills(donutChart); donutText();
}
// Labels like Power BI: each label sits just outside the ring at about the height of its slice, hugging the circle, so labels go around the
// donut (the ones for small slices at the top go above it). Labels that would touch are moved apart as a group, centred on where they want
// to be. A leader line runs from the slice to an elbow on the circle at the label's height, then a short flat piece into the label.
function layoutPills(chart) {
  const box = document.getElementById('donutLabels'); if (!box || !chart || chart.$dead || !chartData || donutCompact) return [];
  const meta = chart.getDatasetMeta(0), arcs = meta.data, R = meta.controller.outerRadius; if (!arcs.length || !(R > 0)) return [];
  const x0 = arcs[0].x, y0 = arcs[0].y, H = chart.height, gap = 4, rr = R + 22; if (!isFinite(x0)) return [];
  const pills = [...box.children], vals = chart.data.datasets[0].data, items = [];
  arcs.forEach((a, i) => {
    const pill = pills[i]; if (!pill) return;
    const show = vals[i] > 0; pill.style.display = show ? '' : 'none'; if (!show) return;
    const mid = (a.startAngle + a.endAngle) / 2; if (!Number.isFinite(mid)) return;
    items.push({i, pill, mid, side: Math.cos(mid) >= 0 ? 1 : -1, h: pill.offsetHeight || 32, want: y0 + Math.sin(mid) * rr});
  });
  // Balance the two sides: slices close to the top or bottom of the ring can have their label on either side, so when one side is
  // clearly fuller than the other, those slices (the ones nearest the vertical axis first) move to the emptier side. A moved slice
  // that is further from the axis gets a label further out, so its leader line never crosses its neighbour's.
  const load = side => items.filter(t => t.side === side).reduce((a, t) => a + t.h + gap, 0);
  for (let n = 0; n < items.length; n++) {
    const heavy = load(1) >= load(-1) ? 1 : -1, diff = Math.abs(load(1) - load(-1));
    const cand = items.filter(t => t.side === heavy && Math.abs(Math.cos(t.mid)) < .6).sort((a, b) => Math.abs(Math.cos(a.mid)) - Math.abs(Math.cos(b.mid)))[0];
    if (!cand || cand.h + gap >= diff) break;
    cand.side = -heavy; cand.moved = true;
    cand.want = y0 + Math.sin(cand.mid) * rr + Math.sign(Math.sin(cand.mid)) * Math.abs(Math.cos(cand.mid)) * rr * .9;
  }
  [1, -1].forEach(side => {
    const col = items.filter(t => t.side === side).sort((a, b) => a.want - b.want); if (!col.length) return;
    let blocks = col.map(t => ({ts: [t], h: t.h, want: t.want}));
    const place = b => { b.top = Math.min(Math.max(b.want - b.h / 2, 2), H - b.h - 2); };
    blocks.forEach(place);
    for (let merged = true; merged;) {   // merge touching neighbours into one block centred on their average wish
      merged = false;
      for (let k = 1; k < blocks.length; k++) {
        const a = blocks[k - 1], b = blocks[k];
        if (b.top < a.top + a.h + gap) {
          const ts = a.ts.concat(b.ts), h = a.h + gap + b.h;
          blocks.splice(k - 1, 2, {ts, h, want: ts.reduce((s, t) => s + t.want, 0) / ts.length}); place(blocks[k - 1]); merged = true; break;
        }
      }
    }
    blocks.forEach(b => { let y = b.top; b.ts.forEach(t => { t.y = y + t.h / 2; y += t.h + gap; }); });
  });
  items.forEach(t => {
    const dy = t.y - y0, hug = Math.abs(dy) < rr ? Math.sqrt(rr * rr - dy * dy) : 0;
    t.elbow = x0 + t.side * Math.max(hug, 10);
    // when the label was pushed up or down by its neighbours, the line still runs straight out from the slice until it reaches the
    // label's height (the point on the slice's own ray), then goes flat into the label, instead of bending around the circle
    const sn = Math.sin(t.mid), cs = Math.cos(t.mid), rn = Math.abs(sn) > .15 ? dy / sn : 0;
    if (!t.moved && rn >= R + 2 && rn <= R + 80) t.elbow = x0 + cs * rn;
    t.lx = t.elbow + t.side * 8;
    t.ex = x0 + Math.cos(t.mid) * (R + 2); t.ey = y0 + Math.sin(t.mid) * (R + 2);
    // plain left/top (no CSS translate), so nothing slides when a label first appears; transform is only used for the hover scale
    t.pill.dataset.side = t.side > 0 ? 'r' : 'l';
    t.pill.style.left = (t.side > 0 ? t.lx : t.lx - t.pill.offsetWidth) + 'px'; t.pill.style.top = (t.y - t.h / 2) + 'px'; t.pill.classList.add('placed');
  });
  return items;
}
const donutFx = safe({   // applies the hover animation (grow / grey) right before the slices are drawn
  id: 'donutFx',
  beforeDatasetDraw(chart) {
    const meta = chart.getDatasetMeta(0), R = meta.controller.outerRadius; if (!(R > 0)) return;
    meta.data.forEach((a, i) => { const g = viewGroups[i]; if (!g) return; const gr = hv.grow[i] || 0, fd = hv.fade[i] || 0;
      a.outerRadius = R + 10 * gr; a.options.backgroundColor = fd ? toGrey(g.color, .82 * fd) : g.color; });
    const c = chart.ctx; c.save(); c.shadowColor = 'rgba(40,50,130,.20)'; c.shadowBlur = 18; c.shadowOffsetY = 9;   // the ring floats a little, like the cards
  },
  afterDatasetDraw(chart) {
    const c = chart.ctx; c.restore();
    // glass on top of every slice, like the site's cards and diagram nodes: a white sheen on the upper part of the ring, a soft
    // inner shade along the hole and a darker outer rim, so the ring reads as a rounded, liquid tube
    const meta = chart.getDatasetMeta(0), r = meta.controller.innerRadius; if (!(r > 0)) return;
    meta.data.forEach((a, i) => {
      if (!fin(a.x, a.y, a.outerRadius, a.startAngle, a.endAngle) || !(a.endAngle - a.startAngle > .01) || !(a.outerRadius > r + 4)) return;
      const R = a.outerRadius, pad = 2.2 / R, s = a.startAngle + pad, e = a.endAngle - pad, x = a.x, y = a.y; if (e <= s) return;
      c.save(); try {   // save/restore always stay paired, even if something below fails
      c.beginPath(); c.arc(x, y, R - 1.5, s, e); c.arc(x, y, r + 1.5, e, s, true); c.closePath(); c.clip();
      const tube = c.createRadialGradient(x, y, r, x, y, R);
      tube.addColorStop(0, 'rgba(20,25,70,.16)'); tube.addColorStop(.28, 'rgba(255,255,255,0)'); tube.addColorStop(.5, 'rgba(255,255,255,.22)');
      tube.addColorStop(.72, 'rgba(255,255,255,0)'); tube.addColorStop(1, 'rgba(20,25,70,.12)');
      c.fillStyle = tube; c.fillRect(x - R, y - R, 2 * R, 2 * R);
      const sheen = c.createLinearGradient(0, y - R, 0, y + R * .2);
      sheen.addColorStop(0, `rgba(255,255,255,${.38 * (1 - (hv.fade[i] || 0) * .6)})`); sheen.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = sheen; c.fillRect(x - R, y - R, 2 * R, 2 * R);
      } finally { c.restore(); }
    });
  },
});
const donutLines = safe({   // the leader lines
  id: 'donutLines',
  afterDestroy(chart) { chart.$dead = true; },
  afterDatasetsDraw(chart) {
    const items = layoutPills(chart); if (!items.length) return;
    const c = chart.ctx; c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    items.forEach(t => {
      const g = viewGroups[t.i]; if (!g || !fin(t.ex, t.ey, t.elbow, t.y, t.lx)) return;
      const fd = hv.fade[t.i] || 0, gr = hv.grow[t.i] || 0;
      c.globalAlpha = 1 - .75 * fd; c.strokeStyle = gr > .5 ? g.color : 'rgba(120,128,155,.6)'; c.lineWidth = 1.3 + gr;
      c.beginPath(); c.moveTo(t.ex + Math.cos(t.mid) * 10 * gr, t.ey + Math.sin(t.mid) * 10 * gr); c.lineTo(t.elbow, t.y); c.lineTo(t.lx - t.side * 3, t.y); c.stroke();
    });
    c.restore();
  },
});
function drawDonut(d, animate) {
  const dc = document.getElementById('donutC');
  chartData = d; donutDay = null; resetHover(); viewGroups = d.groups;
  donutCompact = false; donutPills();   // measure the labels as they would sit around the ring
  const widest = Math.max(0, ...[...document.querySelectorAll('#donutLabels .dpill')].map(p => p.offsetWidth));
  const fits = w => widest + 34 <= Math.round(w * .34);
  const padding = w => fits(w) ? {left: widest + 34, right: widest + 34, top: 46, bottom: 46} : {left: 10, right: 10, top: 12, bottom: 12};
  donutCompact = !fits(dc.parentElement.clientWidth || 460); if (donutCompact) donutPills();
  if (donutChart && !donutChart.$dead && donutChart.canvas === dc && dc.isConnected) {   // same chart: morph to the new numbers
    donutChart.options.layout.padding = padding(donutChart.width);
    fillDonut(animate); return;
  }
  if (donutChart) { try { donutChart.destroy(); } catch (e) {} }
  const cv = freshCanvas('donutC'), cols = viewGroups.map(g => g.color);
  donutChart = new Chart(cv, {
    type: 'doughnut',
    data: {labels: viewGroups.map(g => g.name), datasets: [{data: donutValues(), backgroundColor: cols, hoverBackgroundColor: cols,
      borderColor: '#fff', hoverBorderColor: '#fff', borderWidth: 3, borderRadius: 6, hoverOffset: 0}]},
    options: {
      cutout: '62%', maintainAspectRatio: false, layout: {padding: padding(cv.parentElement.clientWidth || 460)}, animation: anim(animate),
      onHover: (e, els) => { try { donutHoverSet(els.length ? els[0].index : -1); } catch (err) { console.warn(err); } },
      onResize: (ch, size) => {
        const p = padding(size.width), compact = !fits(size.width);
        if (compact !== donutCompact) { donutCompact = compact; donutPills(); }
        if (ch.options.layout.padding.left !== p.left) { ch.options.layout.padding = p; ch.update('none'); }
      },
      plugins: {legend: {display: false}, tooltip: {enabled: false}},
    },
    plugins: [donutFx, donutLines],
  });
  cv.addEventListener('mouseleave', () => donutHoverSet(-1));
  layoutPills(donutChart);   // (in the list mode there is nothing to place) setTimeout(() => layoutPills(donutChart), 600);
  donutText();
}

// ================= DAILY TREND =================
// glass on the bars too (white sheen on top, soft shade at the bottom, a soft shadow), and a whole stacked day is one rounded bar
const trendFx = safe({
  id: 'trendFx',
  beforeDatasetsDraw(chart, args, opts) {
    chart.$bars = [];
    chart.$clipped = false;
    const tops = {}, bases = {}, xs = {};
    chart.data.datasets.forEach((ds, j) => {
      if (ds.type !== 'bar' || !chart.isDatasetVisible(j)) return;
      chart.getDatasetMeta(j).data.forEach((el, i) => {
        if (!fin(el.x, el.y, el.base, el.width) || !(el.width > 0) || !(Math.abs(el.base - el.y) > .5)) return;   // a bar still being created has no position yet
        tops[i] = Math.min(tops[i] ?? Infinity, el.y); bases[i] = Math.max(bases[i] ?? -Infinity, el.base); xs[i] = [el.x - el.width / 2, el.width];
      });
    });
    const c = chart.ctx;
    chart.$bars = Object.keys(xs).map(k => { const [x, w] = xs[k], h = bases[k] - tops[k]; return {i: Number(k), x, y: tops[k], w, h, r: Math.min(10, w / 2, h / 2)}; });
    // soft shadow under each bar: a blurred dark shape, never a white fill (a white fill showed as white bars while bars were moving)
    c.save(); try { c.filter = 'blur(7px)'; c.fillStyle = 'rgba(40,50,130,.16)';
      chart.$bars.forEach(b => { if (!fin(b.x, b.y, b.w, b.h, b.r) || b.r < 0) return; c.beginPath(); c.roundRect(b.x + 2, b.y + 7, b.w - 4, b.h, b.r); c.fill(); });
    } finally { c.restore(); }
    c.save(); chart.$clipped = true; c.beginPath(); chart.$bars.forEach(b => { if (fin(b.x, b.y, b.w, b.h, b.r) && b.r >= 0) c.roundRect(b.x, b.y, b.w, b.h, b.r); }); c.clip();   // every bar / stack rounded top and bottom
  },
  afterDatasetsDraw(chart, args, opts) {
    if (!chart.$clipped) return;
    const c = chart.ctx; chart.$clipped = false;
    c.globalCompositeOperation = 'source-atop';   // the sheen only lands on pixels a bar has painted, never on empty space while bars move
    try { (chart.$bars || []).forEach(b => {
      const g = c.createLinearGradient(0, b.y, 0, b.y + b.h);
      g.addColorStop(0, 'rgba(255,255,255,.42)'); g.addColorStop(Math.min(.45, 22 / Math.max(b.h, 1)), 'rgba(255,255,255,0)');
      g.addColorStop(Math.max(.55, 1 - 16 / Math.max(b.h, 1)), 'rgba(20,25,70,0)'); g.addColorStop(1, 'rgba(20,25,70,.14)');
      c.fillStyle = g; c.fillRect(b.x, b.y, b.w, b.h);
      const side = c.createLinearGradient(b.x, 0, b.x + b.w, 0);   // a little roundness across the bar
      side.addColorStop(0, 'rgba(255,255,255,.18)'); side.addColorStop(.35, 'rgba(255,255,255,0)'); side.addColorStop(1, 'rgba(20,25,70,.08)');
      c.fillStyle = side; c.fillRect(b.x, b.y, b.w, b.h);
    }); } finally { c.restore(); }
  },
});
// the total above every stacked day, written like the donut centre (IDR 6.83M); not in the 100% view
const trendTotals = safe({
  id: 'trendTotals',
  afterDatasetsDraw(chart) {
    if (trendState.t !== 'stacked') return;
    const c = chart.ctx; c.save();
    try {
      c.font = "900 11px 'Nunito', system-ui, sans-serif"; c.fillStyle = '#4b5268'; c.textAlign = 'center'; c.textBaseline = 'bottom';
      (chart.$bars || []).forEach(b => { const v = trendState.dayTot[b.i]; if (v > 0 && fin(b.x, b.y, b.w)) c.fillText(compactIdr(v), b.x + b.w / 2, b.y - 6); });
    } finally { c.restore(); }
  },
});
// the y axis stays put while the days scroll: after every frame its strip of the chart is copied into a small canvas on the left
const trendAxis = safe({
  id: 'trendAxis',
  afterDraw(chart) {
    const y = document.getElementById('trendY'), src = chart.canvas; if (!y || !src.width) return;
    const w = Math.round(AXW * chart.currentDevicePixelRatio), h = src.height;
    if (y.width !== w || y.height !== h) { y.width = w; y.height = h; y.style.width = AXW + 'px'; y.style.height = chart.height + 'px'; }
    const c = y.getContext('2d'); c.clearRect(0, 0, w, h); c.drawImage(src, 0, 0, w, h, 0, 0, w, h);
  },
});
function trendDatasets(d, c, t) {
  const dayTot = d.days.map((_, i) => d.groups.reduce((a, g) => a + g.perDay[i], 0));
  const sets = d.groups.map(g => ({
    type: 'bar', label: g.name, raw: g.perDay, data: t === 'stacked100' ? g.perDay.map((v, i) => dayTot[i] ? v / dayTot[i] * 100 : 0) : g.perDay,
    backgroundColor: g.color, hoverBackgroundColor: shade(g.color, -.06), borderColor: g.color, borderWidth: 0, borderRadius: 0, borderSkipped: false, hidden: false,
    barPercentage: .55, categoryPercentage: .8, maxBarThickness: 40,
  }));
  if (dailyOnly()) sets.push({   // the daily cap (hidden in the 100% view, where it means nothing)
    type: 'line', label: 'Daily cap', raw: null, data: d.days.map(() => c.env.daily.cap || 60000), hidden: t === 'stacked100',
    borderColor: 'rgba(255,45,85,.7)', backgroundColor: 'rgba(255,45,85,.7)', borderWidth: 2, borderDash: [6, 6], pointRadius: 0, pointHoverRadius: 0, fill: false, order: -1, stack: 'cap',
  });
  trendState.d = d; trendState.t = t; trendState.dayTot = dayTot;
  return sets;
}
const dailyOnly = () => spendParts.size === 1 && spendParts.has('daily');
function trendScaleOptions(o, t) {
  o.scales.y.max = t === 'stacked100' ? 100 : undefined;
  o.scales.y.grace = t === 'stacked' ? '14%' : 0;   // room for the totals above the bars
}
function trendLegend(d) {
  const el = document.getElementById('trendLegend'); if (!el) return;
  el.innerHTML = d.groups.map(g => `<span ${g.detail ? `data-tip="${esc(g.detail.map(([n, v]) => n + ' ' + chartMoney(v)).join(' · '))}"` : ''}><i style="background:${g.color}"></i>${esc(g.name)}</span>`).join('')
    + (dailyOnly() && trendType !== 'stacked100' ? '<span class="cap"><i></i>Daily cap</span>' : '');
}
// every day keeps the same width (SLOT); when the days don't fit, the chart gets wider than its box and scrolls, starting at the newest day
function sizeTrend(n) {
  const sc = document.getElementById('trendScroll'); if (!sc) return;
  const inner = sc.firstElementChild, w = AXW + Math.max(sc.clientWidth, n * SLOT + 8);
  if (inner.style.width !== w + 'px') inner.style.width = w + 'px';
}
const trendToEnd = () => { const sc = document.getElementById('trendScroll'); if (sc) sc.scrollLeft = sc.scrollWidth; };
function drawTrend(d, c, animate) {
  const tc = document.getElementById('trendC'), t = trendType, labels = d.days.map(dayLabel), sets = trendDatasets(d, c, t);
  sizeTrend(d.days.length); trendLegend(d);
  if (trendChart && !trendChart.$dead && trendChart.canvas === tc && tc.isConnected) {
    // same chart: change it in place so Chart.js animates bars from where they are to where they go (no empty chart while switching)
    const cur = trendChart.data.datasets;
    sets.forEach((n, i) => { if (cur[i] && cur[i].label === n.label) { Object.keys(cur[i]).forEach(k => { if (!(k in n)) delete cur[i][k]; }); Object.assign(cur[i], n); } else cur[i] = n; });
    cur.length = sets.length; trendChart.data.labels = labels;
    trendScaleOptions(trendChart.options, t); trendChart.options.animation = anim(animate);
    trendChart.resize();
    // every switch plays the same animation (bars grow up from the axis), whatever the previous type was; the chart is never emptied
    if (animate) { trendChart.update('none'); trendChart.reset(); }
    trendChart.update(); trendToEnd(); return;
  }
  if (trendChart) { try { trendChart.destroy(); } catch (e) {} }
  const cv = freshCanvas('trendC');
  const compact = v => v >= 1e6 ? (v / 1e6).toLocaleString('en-US', {maximumFractionDigits: 1}) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : v;
  const options = {
    maintainAspectRatio: false, interaction: {mode: 'index', intersect: false}, layout: {padding: {top: 10, right: 4}}, animation: anim(animate),
    onHover: (e, els) => { try { setDonutDay(els.length ? els[0].index : null); } catch (err) { console.warn(err); } },   // hovering a day shows only that day in the donut
    scales: {
      x: {stacked: true, grid: {display: false}, border: {display: false}, ticks: {maxRotation: 0, autoSkip: true, font: {size: 11, weight: '800'}, color: '#8a91a6'}},
      y: {stacked: true, beginAtZero: true, grid: {color: 'rgba(30,40,100,.07)', drawTicks: false}, border: {display: false, dash: [4, 5]}, afterFit: s => { s.width = AXW; },
        ticks: {padding: 8, font: {size: 11, weight: '800'}, color: '#8a91a6', maxTicksLimit: 6, callback: v => hideNums ? '' : trendState.t === 'stacked100' ? v + '%' : compact(v)}},
    },
    plugins: {
      legend: {display: false},   // the legend is HTML under the chart, so it stays in view when the days scroll
      tooltip: {enabled: false, external: trendTip},   // our own HTML tooltip (a table); the canvas tooltip crashed on days without spending
    },
  };
  trendScaleOptions(options, t);
  trendChart = new Chart(cv, {type: 'bar', data: {labels, datasets: sets}, options, plugins: [trendFx, trendTotals, trendAxis, {id: 'trendDead', afterDestroy(ch) { ch.$dead = true; }}]});
  trendToEnd();
  cv.addEventListener('mouseleave', () => { setDonutDay(null); const tip = document.getElementById('chartTip'); if (tip) tip.classList.remove('show'); });
}

// The trend tooltip: an HTML table (category, amount, share of the day) in the site's dark glass style, the same in every chart type.
// Built from our own numbers, so a day without spending simply says so (the canvas tooltip crashed there and froze every chart).
function trendTip(ctx) {
  try {
    const {chart, tooltip} = ctx; let el = document.getElementById('chartTip');
    if (!el) { el = document.createElement('div'); el.id = 'chartTip'; document.body.appendChild(el); }
    const i = tooltip.dataPoints && tooltip.dataPoints.length ? tooltip.dataPoints[0].dataIndex : -1, d = trendState.d;
    if (tooltip.opacity === 0 || i < 0 || !d || !d.days[i]) { el.classList.remove('show'); return; }
    const tot = trendState.dayTot[i] || 0, rows = d.groups.map(g => ({g, v: g.perDay[i]})).filter(r => r.v > 0).sort((a, b) => b.v - a.v);
    const capDs = chart.data.datasets.find(ds => ds.label === 'Daily cap' && !ds.hidden);
    el.innerHTML = `<div class="ct-h">${esc(fmtDate(d.days[i]))}</div>${rows.length ? `<table>${rows.map(r => `<tr><td><i style="background:${r.g.color}"></i>${esc(r.g.name)}</td><td class="r">${chartMoney(r.v)}</td><td class="r p">${chartPct(r.v / tot * 100)}</td></tr>`).join('')}
      <tr class="tot"><td><i style="visibility:hidden"></i>Total</td><td class="r">${chartMoney(tot)}</td><td class="r p">${chartPct(100)}</td></tr>
      ${capDs ? `<tr class="cap"><td><i style="visibility:hidden"></i>Daily cap</td><td class="r">${chartMoney(capDs.data[i])}</td><td class="r p">${chartPct(capDs.data[i] ? tot / capDs.data[i] * 100 : 0)}</td></tr>` : ''}</table>` : '<div class="ct-none">No spending on this day</div>'}`;
    const box = chart.canvas.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    let x = box.left + tooltip.caretX + 16, y = box.top + tooltip.caretY - h / 2;
    if (x + w > innerWidth - 8) x = box.left + tooltip.caretX - w - 16;
    y = Math.max(8, Math.min(innerHeight - h - 8, y));
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.classList.add('show');
  } catch (e) { console.warn(e); }
}
document.addEventListener('scroll', () => { const el = document.getElementById('chartTip'); if (el) el.classList.remove('show'); }, true);

// freshly made canvases: Chart.js can leave a canvas half reset after destroy(), and a new chart on it may come out empty
function freshCanvas(id) {
  const old = document.getElementById(id); if (!old) return null;
  const cv = document.createElement('canvas'); cv.id = id; old.replaceWith(cv); return cv;
}

function drawCharts(part, animate) {
  if (!document.getElementById('donutC') || !document.getElementById('trendC') || typeof Chart === 'undefined') return;
  chartDefaults();
  const c = K().c, d = part === 'trend' && chartData ? chartData : spendData(c, spendParts), legend = document.getElementById('donutLegend');
  const none = !d.total;
  document.querySelectorAll('.tcanvas,.dcanvas,.tlegend').forEach(e => e.classList.toggle('hidden', none));
  legend.classList.toggle('dlist', false);
  legend.innerHTML = none ? `<div class="s cempty">${spendParts.size ? 'No spending logged yet for this view. Add expenses on the Spending page and the charts will fill in.' : 'Nothing is selected. Tick at least one part of your spending in the dropdown above.'}</div>` : '';
  if (none) {
    [donutChart, trendChart].forEach(ch => { if (ch) try { ch.destroy(); } catch (e) {} }); donutChart = trendChart = null; chartData = d; return;
  }
  try { if (part !== 'trend') drawDonut(d, animate); } catch (e) { console.error(e); }
  try { drawTrend(d, c, animate); } catch (e) { console.error(e); }
}
