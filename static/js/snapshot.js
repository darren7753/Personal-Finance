// Pictures of the Dashboard diagram.
//  1. "Copy as image" button on the Dashboard: copies the diagram (as on screen: numbers hidden when the eye button is on) to the clipboard.
//  2. A snapshot of the newest cycle with real numbers is uploaded to the server (PUT /api/snapshot) so the Telegram bot can send it
//     with the time it was taken. Uploaded a few seconds after the page opens and after every real edit, and only when the numbers changed.
// The picture is drawn off-screen at the SAME width as the diagram card on screen (snapCardW), so it has exactly the same shape.
// Needs html-to-image (static/vendor) and the globals of app.js (calcAll, diagram, K, S, hideNums, maskIn, icon, notify), which are only used when a function runs.

let snapCardW = 0;   // width of the diagram card as drawn on screen; fitDiagram() in app.js updates it whenever the Dashboard is shown
let snapSig = null, snapBusy = false, snapTimer = null;

const latestK = () => calcAll().reduce((a, b) => (b.c.payday > a.c.payday ? b : a));
const snapHash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const isSafari = () => /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

// Draws the diagram card, off-screen, the same size as on screen, and turns it into a PNG. Returns {blob, sig}; sig changes when any text on it changes.
// The library copies the computed style of ordinary elements but not of the SVG arrows, so each arrow gets its dashes, line ends and shadow written onto it first.
async function diagramPng(k, {hide = false} = {}) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none';
  host.innerHTML = '<div class="snapbg"><div class="card funnelcard"></div></div>';
  document.body.appendChild(host);
  try {
    const node = host.firstElementChild, card = node.firstElementChild;
    const live = document.querySelector('#view .funnelcard');   // on the Dashboard: measure the real card right now (the remembered width can be a few pixels stale)
    if (live) snapCardW = live.getBoundingClientRect().width;
    card.style.width = (snapCardW || 1450) + 'px';
    const cs = getComputedStyle(card), padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    card.innerHTML = diagram(k, card.clientWidth - padX);   // the same room fitDiagram() gives the diagram on screen
    const need = card.querySelector('.diagram').offsetWidth + padX + (card.offsetWidth - card.clientWidth);
    if (need > card.offsetWidth) card.style.width = need + 'px';   // a narrow window scrolls sideways on screen; the picture shows the whole diagram
    card.querySelectorAll('.diagram svg path, .diagram svg polygon').forEach(e => {
      const c = getComputedStyle(e);
      e.setAttribute('style', `stroke-dasharray:${c.strokeDasharray};stroke-dashoffset:${c.strokeDashoffset};stroke-linecap:${c.strokeLinecap};filter:${c.filter}`);
    });
    if (hide) maskIn(host);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const sig = snapHash(node.textContent + '|' + Math.round(card.offsetWidth));   // text and width: a different window width gives a differently shaped picture
    // one try per quality: a very large PNG could be refused by the server (4 MB limit), so fall back to a smaller picture
    let blob = null;
    for (const ratio of [2, 1.5, 1]) {
      if (isSafari()) await htmlToImage.toBlob(node, {pixelRatio: ratio});   // Safari draws images only on the second try
      blob = await htmlToImage.toBlob(node, {pixelRatio: ratio});
      if (blob && blob.size < 3.5e6) break;
    }
    if (!blob) throw new Error('no picture');
    return {blob, sig};
  } finally { host.remove(); }
}

const downloadBlob = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

function snapFlash(btn, tip) {   // a check mark for a moment, then back to the normal icon
  btn.innerHTML = icon('check', 'filled', 24); btn.dataset.tip = tip; btn.classList.add('ok');
  setTimeout(() => { btn.innerHTML = icon('copy', 'regular', 24); btn.dataset.tip = 'Copy as image'; btn.classList.remove('ok'); }, 1800);
}

async function copyDiagramImage(btn) {
  if (btn.classList.contains('busy')) return;
  btn.classList.add('busy');
  const k = K(), name = `Where your salary goes - ${k.c.label}.png`;
  const made = diagramPng(k, {hide: hideNums}).then(r => r.blob);   // a promise: Safari wants the clipboard call made straight from the click
  try {
    if (!(navigator.clipboard && window.ClipboardItem)) throw new Error('no clipboard');
    await navigator.clipboard.write([new ClipboardItem({'image/png': made})]);
    snapFlash(btn, 'Copied');
  } catch (e) {
    try { downloadBlob(await made, name); snapFlash(btn, 'Saved as a file'); }   // clipboard not available or refused: save the picture instead
    catch (e2) { notify({title: 'Could not make the picture', text: 'Please try again.', ok: 'OK'}); }
  } finally { btn.classList.remove('busy'); }
}

// ---------- snapshot for the Telegram bot ----------
function snapSchedule(delay = 6000) {
  if (typeof GUEST !== 'undefined' && GUEST) return;   // the demo never uploads anything
  clearTimeout(snapTimer); snapTimer = setTimeout(snapUpload, delay);
}
async function snapUpload() {
  if (snapBusy) return;
  snapBusy = true;
  try {
    const k = latestK(); if (!k || untracked(k.c)) return;   // a cycle that is not tracked has no diagram
    if (snapSig === null) { const m = await fetch('/api/snapshot/meta'); snapSig = m.ok ? ((await m.json()).sig || '') : ''; }
    const {blob, sig} = await diagramPng(k);
    if (sig === snapSig) return;   // nothing changed since the picture on the server
    const r = await fetch(`/api/snapshot?rev=${S._rev || 0}&sig=${sig}&label=${encodeURIComponent(k.c.label)}`, {method: 'PUT', headers: {'Content-Type': 'image/png'}, body: blob});
    if (r.ok || r.status === 409) snapSig = sig;   // 409: the server already has a newer one from another tab or device
  } catch (e) { /* the picture is a bonus; never bother the user */ }
  finally { snapBusy = false; }
}
setInterval(() => { if (!document.hidden) snapSchedule(500); }, 10 * 60 * 1000);   // a page left open all day keeps the picture fresh (uploads only when numbers changed)
