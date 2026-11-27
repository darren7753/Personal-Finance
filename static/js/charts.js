// ---------- Dashboard charts: spending by category (donut) and the daily trend ----------
// Built with Chart.js 4 (static/vendor/chart.umd.min.js, MIT licence, served from this site, no outside requests).
// One dropdown filters both charts. Only the 5 biggest categories get their own colour; everything else is grouped as "Others (n)",
// so the charts stay readable even though the app has 14 categories. A category keeps the same colour in both charts.
// Hovering a day in the trend chart shows only that day in the donut.
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
const SPEND_FILTERS = [['total', 'Total spending'], ['fixed', 'Fixed expenses'], ['daily', 'Daily budget'], ['date', 'Date budget'], ['free', 'Free to use']];
const TREND_TYPES = [['stacked', 'Stacked'], ['stacked100', 'Stacked 100%'], ['clustered', 'Clustered'], ['lines', 'Lines']];
let spendFilter = localStorage.getItem('dfSpendFilter'), trendType = 'stacked';   // the trend always opens as Stacked (the user's choice)
if (!SPEND_FILTERS.some(f => f[0] === spendFilter)) spendFilter = 'total';
let donutChart = null, trendChart = null, chartData = null, donutDay = null, donutHover = -1, viewGroups = [];
let donutCompact = false;   // too narrow for labels around the ring (phones, small windows): the labels become a list under the donut instead
const hv = {grow: [], fade: [], raf: 0};          // the donut hover animation: 0..1 per slice
const trendState = {d: null, t: 'stacked', dayTot: []};   // read by the trend chart's tooltip and axis at call time

function chartSection() {
  return `<div class="chartbar"><h2 style="margin:0">Spending breakdown <span class="s">From payday until today</span></h2>
    <div class="chartfilter"><select id="spendFilter" onchange="setSpendFilter(this.value)">${SPEND_FILTERS.map(([v, l]) => `<option value="${v}" ${v === spendFilter ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
  <div class="grid g2 charts">
    <div class="card chartcard"><div class="chead"><div class="t">By category</div><span class="s" id="donutScope"></span></div>
      <div class="dcanvas"><canvas id="donutC"></canvas><div class="dlabels" id="donutLabels"></div><div class="dcenter" id="donutCenter"></div></div><div id="donutLegend"></div></div>
    <div class="card chartcard"><div class="chead"><div class="t">Daily trend</div>
      <div class="seg" id="trendSeg">${TREND_TYPES.map(([v, l]) => `<button type="button" data-t="${v}" class="${v === trendType ? 'on' : ''}" onclick="setTrendType('${v}')">${l}</button>`).join('')}</div></div>
      <div class="tcanvas"><canvas id="trendC"></canvas></div></div>
  </div>`;
}

function setSpendFilter(v) { spendFilter = v; localStorage.setItem('dfSpendFilter', v); drawCharts(undefined, true); }
function setTrendType(v) {
  if (v === trendType) return;
  trendType = v;
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
const labelPct = v => hideNums ? '•••%' : (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + '%';
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
function spendData(c, filter) {
  const rows = [];
  if (filter === 'total' || filter === 'fixed') c.fixed.forEach(x => rows.push({date: c.payday, cat: x.cat || 'Other', amt: x.amount}));   // fixed expenses have no date: they count on payday
  ['daily', 'date', 'free'].forEach(key => { if (filter === 'total' || filter === key) c.env[key].spends.forEach(x => rows.push({date: x.date, cat: x.cat || 'Other', amt: x.amt})); });
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
    <div class="dc-a">${small ? compactIdr(v) : chartMoney(v)}</div>${g ? `<div class="dc-p">${chartPct(tot ? v / tot * 100 : 0)}</div>` : ''}`;
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
    t.elbow = x0 + t.side * Math.max(hug, 10); t.lx = t.elbow + t.side * 8;
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
    if (opts.mode === 'lines') return;
    const tops = {}, bases = {}, xs = {};
    chart.data.datasets.forEach((ds, j) => {
      if (ds.type !== 'bar' || !chart.isDatasetVisible(j)) return;
      chart.getDatasetMeta(j).data.forEach((el, i) => {
        if (!fin(el.x, el.y, el.base, el.width) || !(el.width > 0) || !(Math.abs(el.base - el.y) > .5)) return;   // a bar still being created has no position yet
        const key = opts.mode === 'clustered' ? i + ':' + j : i;
        tops[key] = Math.min(tops[key] ?? Infinity, el.y); bases[key] = Math.max(bases[key] ?? -Infinity, el.base); xs[key] = [el.x - el.width / 2, el.width];
      });
    });
    const c = chart.ctx;
    chart.$bars = Object.keys(xs).map(k => { const [x, w] = xs[k], h = bases[k] - tops[k]; return {x, y: tops[k], w, h, r: Math.min(opts.mode === 'clustered' ? 7 : 10, w / 2, h / 2)}; });
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
function trendDatasets(d, c, t) {
  const stacked = t === 'stacked' || t === 'stacked100', dayTot = d.days.map((_, i) => d.groups.reduce((a, g) => a + g.perDay[i], 0));
  const sets = d.groups.map(g => t === 'lines' ? {
    type: 'line', label: g.name, raw: g.perDay, data: g.perDay.map(v => v > 0 ? v : null),   // a day without spending is a gap, so a lone day is only a dot
    backgroundColor: g.color, borderColor: g.color, borderWidth: 3, tension: .4, spanGaps: false, fill: false, hidden: false,
    pointRadius: 5, pointHoverRadius: 8, pointBackgroundColor: '#fff', pointBorderColor: g.color, pointBorderWidth: 3, pointHoverBorderWidth: 3, pointHoverBackgroundColor: g.color,
  } : {
    type: 'bar', label: g.name, raw: g.perDay, data: t === 'stacked100' ? g.perDay.map((v, i) => dayTot[i] ? v / dayTot[i] * 100 : 0) : g.perDay,
    backgroundColor: g.color, hoverBackgroundColor: shade(g.color, -.06), borderColor: g.color, borderWidth: 0, borderRadius: 0, borderSkipped: false, hidden: false,
    barPercentage: stacked ? .55 : .82, categoryPercentage: .8, maxBarThickness: stacked ? 40 : 24,
  });
  if (t === 'lines') sets.push({   // invisible: keeps every day hoverable in the Lines view even where no line has a point
    type: 'line', label: '__ghost', raw: null, data: d.days.map(() => 0), showLine: false, pointRadius: 0, pointHoverRadius: 0, borderWidth: 0, hidden: false, backgroundColor: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,0)'});
  if (spendFilter === 'daily') sets.push({   // the daily cap (hidden in the 100% view, where it means nothing)
    type: 'line', label: 'Daily cap', raw: null, data: d.days.map(() => c.env.daily.cap || 60000), hidden: t === 'stacked100',
    borderColor: 'rgba(255,45,85,.7)', backgroundColor: 'rgba(255,45,85,.7)', borderWidth: 2, borderDash: [6, 6], pointRadius: 0, pointHoverRadius: 0, fill: false, order: -1, stack: 'cap',
  });
  trendState.d = d; trendState.t = t; trendState.dayTot = dayTot;
  return sets;
}
function trendScaleOptions(o, t) {
  const stacked = t === 'stacked' || t === 'stacked100';
  o.scales.x.stacked = stacked; o.scales.y.stacked = stacked; o.scales.y.max = t === 'stacked100' ? 100 : undefined;
  o.plugins.trendFx.mode = t === 'lines' ? 'lines' : t === 'clustered' ? 'clustered' : 'stacked';
}
function drawTrend(d, c, animate) {
  const tc = document.getElementById('trendC'), t = trendType, labels = d.days.map(dayLabel), sets = trendDatasets(d, c, t);
  if (trendChart && !trendChart.$dead && trendChart.canvas === tc && tc.isConnected) {
    // same chart: change it in place so Chart.js animates bars from where they are to where they go (no empty chart while switching)
    const cur = trendChart.data.datasets;
    sets.forEach((n, i) => { if (cur[i] && cur[i].label === n.label) { Object.keys(cur[i]).forEach(k => { if (!(k in n)) delete cur[i][k]; }); Object.assign(cur[i], n); } else cur[i] = n; });
    cur.length = sets.length; trendChart.data.labels = labels;
    trendScaleOptions(trendChart.options, t); trendChart.options.animation = anim(animate);
    // every switch plays the same animation (bars grow up from the axis), whatever the previous type was; the chart is never emptied
    if (animate) { trendChart.update('none'); trendChart.reset(); }
    trendChart.update(); return;
  }
  if (trendChart) { try { trendChart.destroy(); } catch (e) {} }
  const cv = freshCanvas('trendC');
  const compact = v => v >= 1e6 ? (v / 1e6).toLocaleString('en-US', {maximumFractionDigits: 1}) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : v;
  const options = {
    maintainAspectRatio: false, interaction: {mode: 'index', intersect: false}, layout: {padding: {top: 10, right: 4}}, animation: anim(animate),
    onHover: (e, els) => { try { setDonutDay(els.length ? els[0].index : null); } catch (err) { console.warn(err); } },   // hovering a day shows only that day in the donut
    scales: {
      x: {grid: {display: false}, border: {display: false}, ticks: {maxRotation: 0, autoSkip: true, maxTicksLimit: 14, font: {size: 11, weight: '800'}, color: '#8a91a6'}},
      y: {beginAtZero: true, grid: {color: 'rgba(30,40,100,.07)', drawTicks: false}, border: {display: false, dash: [4, 5]},
        ticks: {padding: 8, font: {size: 11, weight: '800'}, color: '#8a91a6', maxTicksLimit: 6, callback: v => hideNums ? '' : trendState.t === 'stacked100' ? v + '%' : compact(v)}},
    },
    plugins: {
      trendFx: {mode: 'stacked'},
      legend: {position: 'bottom', labels: {usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 16, font: {size: 12, weight: '800'}, color: '#4b5268',
        filter: (item, data) => { const ds = data.datasets[item.datasetIndex]; return ds.label !== '__ghost' && !(ds.label === 'Daily cap' && ds.hidden); }}},
      tooltip: {enabled: false, external: trendTip},   // our own HTML tooltip (a table); the canvas tooltip crashed on days without spending
    },
  };
  trendScaleOptions(options, t);
  trendChart = new Chart(cv, {type: 'bar', data: {labels, datasets: sets}, options, plugins: [trendFx, {id: 'trendDead', afterDestroy(ch) { ch.$dead = true; }}]});
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
  const c = K().c, d = part === 'trend' && chartData ? chartData : spendData(c, spendFilter), legend = document.getElementById('donutLegend');
  const none = !d.total;
  document.querySelectorAll('.tcanvas,.dcanvas').forEach(e => e.classList.toggle('hidden', none));
  legend.classList.toggle('dlist', false);
  legend.innerHTML = none ? '<div class="s cempty">No spending logged yet for this view. Add expenses on the Spending page and the charts will fill in.</div>' : '';
  if (none) {
    [donutChart, trendChart].forEach(ch => { if (ch) try { ch.destroy(); } catch (e) {} }); donutChart = trendChart = null; chartData = d; return;
  }
  try { if (part !== 'trend') drawDonut(d, animate); } catch (e) { console.error(e); }
  try { drawTrend(d, c, animate); } catch (e) { console.error(e); }
}
