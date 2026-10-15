/**
 * Canvas charts for the MS Astra dashboard: spectrum (with interactive
 * piecewise‑constant target editor), needle derivative, coating structure and
 * merit history. All charts read their colours from CSS custom properties so
 * light and dark themes are consistent with the page.
 */

const themeCache = { dirty: true, values: {} };
const THEME_KEYS = ['--ink', '--ink-2', '--ink-3', '--grid', '--line', '--card', '--accent', '--series-current', '--series-current-fill',
  '--series-target', '--mat-h', '--mat-h-fill', '--mat-l', '--mat-l-fill', '--needle', '--needle-fill', '--substrate', '--good', '--bad', '--control'];
export function theme() {
  if (themeCache.dirty) {
    const cs = getComputedStyle(document.documentElement);
    for (const k of THEME_KEYS) themeCache.values[k.slice(2)] = cs.getPropertyValue(k).trim();
    themeCache.values.font = cs.getPropertyValue('--font').trim() || 'system-ui, sans-serif';
    themeCache.dirty = false;
  }
  return themeCache.values;
}
export function invalidateTheme() { themeCache.dirty = true; }
if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', invalidateTheme);

export function niceTicks(min, max, count = 6) {
  if (!(max > min)) return [min];
  const span = max - min;
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}
const fmtNum = (v, digits = 0) => v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const fmt = {
  nm: (v) => `${fmtNum(v, 1)} nm`,
  pct: (v, d = 2) => `${(100 * v).toFixed(d)} %`,
  sci: (v) => (v === 0 ? '0' : v.toExponential(3).replace('e-', '×10⁻').replace('e+', '×10').replace(/×10(\d+)/, (m, p) => `×10${sup(p)}`).replace(/×10⁻(\d+)/, (m, p) => `×10⁻${sup(p)}`)),
};
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function sup(s) { return String(s).split('').map((c) => SUP[c] ?? c).join(''); }

class Plot {
  constructor(canvas, margin) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.margin = margin; this.w = 0; this.h = 0; this.dpr = 1;
    this.ro = new ResizeObserver(() => { this.resize(); this.requestDraw(); });
    this.ro.observe(canvas.parentElement);
    this.resize();
    this._raf = 0;
  }
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.w = Math.max(10, Math.floor(r.width)); this.h = Math.max(10, Math.floor(r.height));
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
  }
  requestDraw() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); }); }
  frame() { const m = this.margin; return { x0: m.l, x1: this.w - m.r, y0: m.t, y1: this.h - m.b }; }
  begin() {
    const ctx = this.ctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.w, this.h);
    ctx.font = `11px ${theme().font}`; ctx.textBaseline = 'middle';
    return ctx;
  }
  axes(ctx, fr, xt, yt, xfmt, yfmt, xlabel, ylabel) {
    const T = theme();
    ctx.strokeStyle = T.grid; ctx.lineWidth = 1; ctx.fillStyle = T['ink-3'];
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const t of xt.ticks) { const x = Math.round(xt.scale(t)) + 0.5; ctx.beginPath(); ctx.moveTo(x, fr.y0); ctx.lineTo(x, fr.y1); ctx.stroke(); ctx.fillText(xfmt(t), x, fr.y1 + 6); }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const t of yt.ticks) { const y = Math.round(yt.scale(t)) + 0.5; ctx.beginPath(); ctx.moveTo(fr.x0, y); ctx.lineTo(fr.x1, y); ctx.stroke(); ctx.fillText(yfmt(t), fr.x0 - 8, y); }
    if (xlabel) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(xlabel, fr.x1, this.h - 2); }
    if (ylabel) { ctx.save(); ctx.translate(13, fr.y0); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(ylabel, 0, 0); ctx.restore(); }
  }
  destroy() { this.ro.disconnect(); }
}
const SUB_W = 44; // width of the substrate block left of z = 0 in the z-charts
const lin = (d0, d1, r0, r1) => { const k = (r1 - r0) / ((d1 - d0) || 1); const f = (v) => r0 + (v - d0) * k; f.invert = (p) => d0 + (p - r0) / k; return f; };

/* ===================================================================== */
/*  Spectrum chart with target editor                                     */
/* ===================================================================== */
export class SpectrumChart extends Plot {
  constructor(canvas, tooltip) {
    super(canvas, { l: 66, r: 18, t: 26, b: 34 });
    this.tooltip = tooltip;
    this.state = { lambdaMin: 400, lambdaMax: 700, bands: [], grid: null, target: null, R: null, weights: null, added: null, curve: null, curveDashed: false, transition: 0, yMode: 'full', editable: true, ghosts: [], ghostHighlight: null, showPols: false, showRs: true, showRp: true, charLabel: 'R' };
    this.onChange = null;      // (patch) => void
    this.hover = null; this.drag = null;
    const c = canvas;
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerleave', () => { this.hover = null; this.tooltip.hidden = true; this.requestDraw(); });
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('dblclick', (e) => this.onDouble(e));
  }
  set(patch) { Object.assign(this.state, patch); this.requestDraw(); }
  scales() {
    const s = this.state, fr = this.frame();
    const span = s.lambdaMax - s.lambdaMin;
    const pad = Math.max(span * 0.06, 2);
    const xs = lin(s.lambdaMin - pad, s.lambdaMax + pad, fr.x0, fr.x1);
    let y0 = 0, y1 = 1;
    if (s.yMode === 'fit') {
      let lo = Infinity, hi = -Infinity;
      const scan = (arr) => { if (arr) for (let i = 0; i < arr.length; i++) { lo = Math.min(lo, arr[i]); hi = Math.max(hi, arr[i]); } };
      scan(s.target); scan(s.R); if (s.curve) scan(s.curve.R);
      for (const gh of s.ghosts || []) scan(gh.R);
      if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
      const p = Math.max((hi - lo) * 0.15, 0.005);
      y0 = Math.max(0, lo - p); y1 = Math.min(1, hi + p);
      if (y1 - y0 < 0.01) { y0 = Math.max(0, y0 - 0.005); y1 = Math.min(1, y1 + 0.005); }
    }
    const ys = lin(y0, y1, fr.y1, fr.y0);
    return { xs, ys, fr, y0, y1 };
  }
  handles() {
    const { xs, ys, fr } = this.scales();
    const s = this.state, out = [];
    s.bands.forEach((b, i) => {
      out.push({ type: 'level', index: i, x: xs((b.from + b.to) / 2), y: ys(b.R) });
      if (i < s.bands.length - 1) out.push({ type: 'boundary', index: i, x: xs(b.to), y: fr.y0 + 8 });
    });
    out.push({ type: 'range-min', x: xs(s.lambdaMin), y: fr.y0 + 8 });
    out.push({ type: 'range-max', x: xs(s.lambdaMax), y: fr.y0 + 8 });
    return out;
  }
  pick(px, py) {
    let best = null, bd = 12;
    for (const h of this.handles()) { const d = Math.hypot(h.x - px, h.y - py); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  pos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  onMove(e) {
    const p = this.pos(e);
    if (this.drag) { this.applyDrag(p); return; }
    const h = this.state.editable ? this.pick(p.x, p.y) : null;
    this.hover = { ...p, handle: h };
    this.canvas.style.cursor = h ? (h.type === 'level' ? 'ns-resize' : 'ew-resize') : 'crosshair';
    this.showTooltip(p);
    this.requestDraw();
  }
  showTooltip(p) {
    const s = this.state, { xs, ys, fr } = this.scales();
    if (p.x < fr.x0 || p.x > fr.x1 || p.y < fr.y0 || p.y > fr.y1 || !s.grid) { this.tooltip.hidden = true; return; }
    const lam = xs.invert(p.x);
    let i = 0, bd = Infinity;
    for (let k = 0; k < s.grid.length; k++) { const d = Math.abs(s.grid[k] - lam); if (d < bd) { bd = d; i = k; } }
    const t = s.target ? s.target[i] : null, r = s.R ? s.R[i] : null;
    let html = `<b>λ = ${s.grid[i].toFixed(1)} nm</b>`;
    if (t != null) html += `<br>Target ${fmt.pct(t)}`;
    if (r != null) html += `<br>Current ${s.showPols ? s.charLabel + ' ' : ''}${fmt.pct(r, 3)}`;
    if (t != null && r != null) html += `<br>Error ${(100 * (r - t)).toFixed(3)} p.p.`;
    if (s.showPols && s.curve && s.curve.Rs && s.curve.Rp) {
      // s and p polarizations from the dense display curve, nearest point
      let ci = 0, cd = Infinity;
      for (let k = 0; k < s.curve.wl.length; k++) { const d = Math.abs(s.curve.wl[k] - s.grid[i]); if (d < cd) { cd = d; ci = k; } }
      html += `<br>Rs ${fmt.pct(s.curve.Rs[ci], 3)} · Rp ${fmt.pct(s.curve.Rp[ci], 3)}`;
    }
    this.tooltip.innerHTML = html; this.tooltip.hidden = false;
    const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
    let x = p.x + 14, y = p.y - th - 8;
    if (x + tw > this.w - 4) x = p.x - tw - 14;
    if (y < 4) y = p.y + 14;
    this.tooltip.style.left = `${x}px`; this.tooltip.style.top = `${y}px`;
    this.hoverIndex = i;
  }
  onDown(e) {
    if (!this.state.editable) return;
    const p = this.pos(e);
    const h = this.pick(p.x, p.y);
    if (!h) return;
    this.drag = h; this.dragScales = this.scales(); // freeze the axes for the duration of the drag
    this.canvas.setPointerCapture(e.pointerId); e.preventDefault();
  }
  onUp(e) { if (this.drag) { this.drag = null; this.dragScales = null; try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } this.onChange?.({ bands: this.state.bands, lambdaMin: this.state.lambdaMin, lambdaMax: this.state.lambdaMax, commit: true }); } }
  applyDrag(p) {
    const s = this.state, { xs, ys } = this.dragScales || this.scales();
    const h = this.drag;
    const bands = s.bands.map((b) => ({ ...b }));
    let lambdaMin = s.lambdaMin, lambdaMax = s.lambdaMax;
    const minW = Math.max(1, Math.round((s.lambdaMax - s.lambdaMin) * 0.02));
    if (h.type === 'level') {
      bands[h.index].R = Math.min(1, Math.max(0, Math.round(ys.invert(p.y) * 1000) / 1000));
    } else if (h.type === 'boundary') {
      const lo = bands[h.index].from + minW, hi = bands[h.index + 1].to - minW;
      const v = Math.min(hi, Math.max(lo, Math.round(xs.invert(p.x))));
      bands[h.index].to = v; bands[h.index + 1].from = v;
    } else if (h.type === 'range-min') {
      const v = Math.max(100, Math.min(bands[0].to - minW, Math.round(xs.invert(p.x))));
      lambdaMin = v; bands[0].from = v;
    } else if (h.type === 'range-max') {
      const v = Math.min(20000, Math.max(bands[bands.length - 1].from + minW, Math.round(xs.invert(p.x))));
      lambdaMax = v; bands[bands.length - 1].to = v;
    }
    this.onChange?.({ bands, lambdaMin, lambdaMax, commit: false });
  }
  onDouble(e) {
    if (!this.state.editable) return;
    const p = this.pos(e); const s = this.state; const { xs, fr } = this.scales();
    const h = this.pick(p.x, p.y);
    const bands = s.bands.map((b) => ({ ...b }));
    if (h && h.type === 'boundary') {
      // merge bands h.index and h.index+1
      bands[h.index].to = bands[h.index + 1].to; bands.splice(h.index + 1, 1);
      this.onChange?.({ bands, lambdaMin: s.lambdaMin, lambdaMax: s.lambdaMax, commit: true });
      return;
    }
    if (p.x < fr.x0 || p.x > fr.x1) return;
    const lam = Math.round(xs.invert(p.x));
    const i = bands.findIndex((b) => lam > b.from && lam < b.to);
    if (i < 0) return;
    const minW = Math.max(1, (s.lambdaMax - s.lambdaMin) * 0.02);
    if (lam - bands[i].from < minW || bands[i].to - lam < minW) return;
    const b = bands[i];
    bands.splice(i, 1, { from: b.from, to: lam, R: b.R }, { from: lam, to: b.to, R: b.R });
    this.onChange?.({ bands, lambdaMin: s.lambdaMin, lambdaMax: s.lambdaMax, commit: true });
  }
  draw() {
    const ctx = this.begin(), T = theme(), s = this.state;
    const { xs, ys, fr, y0, y1 } = this.scales();
    // out-of-range shading
    ctx.fillStyle = T.control;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(fr.x0, fr.y0, xs(s.lambdaMin) - fr.x0, fr.y1 - fr.y0);
    ctx.fillRect(xs(s.lambdaMax), fr.y0, fr.x1 - xs(s.lambdaMax), fr.y1 - fr.y0);
    ctx.globalAlpha = 1;
    const xt = { ticks: niceTicks(xs.invert(fr.x0), xs.invert(fr.x1), Math.max(3, Math.floor((fr.x1 - fr.x0) / 90))), scale: xs };
    const yt = { ticks: niceTicks(y0, y1, Math.max(3, Math.floor((fr.y1 - fr.y0) / 44))), scale: ys };
    this.axes(ctx, fr, xt, yt, (v) => fmtNum(v), (v) => `${fmtNum(100 * v, y1 - y0 < 0.1 ? 2 : 0)} %`, 'wavelength, nm', 'reflectance R');
    ctx.save(); ctx.beginPath(); ctx.rect(fr.x0, fr.y0 - 1, fr.x1 - fr.x0, fr.y1 - fr.y0 + 2); ctx.clip();
    // transition zones around target jumps (zero weight)
    if (s.transition > 0 && s.bands.length > 1) {
      ctx.save(); ctx.strokeStyle = T['ink-3']; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
      for (let i = 0; i < s.bands.length - 1; i++) {
        const xa = xs(s.bands[i].to - s.transition / 2), xb = xs(s.bands[i].to + s.transition / 2);
        ctx.save(); ctx.beginPath(); ctx.rect(xa, fr.y0, xb - xa, fr.y1 - fr.y0); ctx.clip();
        for (let x = xa - (fr.y1 - fr.y0); x < xb; x += 6) { ctx.beginPath(); ctx.moveTo(x, fr.y1); ctx.lineTo(x + (fr.y1 - fr.y0), fr.y0); ctx.stroke(); }
        ctx.restore();
      }
      ctx.restore();
    }
    // ghost spectra of explored starting designs
    if (s.ghosts && s.ghosts.length) {
      const order = s.ghosts.map((g, i) => i).sort((a, b) => (s.ghosts[a].best ? 1 : 0) - (s.ghosts[b].best ? 1 : 0) || (a === s.ghostHighlight ? 1 : 0) - (b === s.ghostHighlight ? 1 : 0));
      for (const i of order) {
        const gh = s.ghosts[i]; if (!gh.R) continue;
        const hl = i === s.ghostHighlight;
        ctx.beginPath();
        for (let k = 0; k < gh.wl.length; k++) { const x = xs(gh.wl[k]), y = ys(gh.R[k]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        // multi-start lines share the line width of the synthesis curve (2.25 px); only colour and dash differ
        if (hl) { ctx.strokeStyle = T.needle; ctx.lineWidth = 2.5; ctx.globalAlpha = 1; ctx.setLineDash([]); }
        else if (gh.best) { ctx.strokeStyle = T.good; ctx.lineWidth = 2.25; ctx.globalAlpha = 0.9; ctx.setLineDash([7, 5]); }
        else { ctx.strokeStyle = T['ink-3']; ctx.lineWidth = 2.25; ctx.globalAlpha = 0.4; ctx.setLineDash([7, 5]); }
        ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]);
      }
      const hl = s.ghostHighlight != null ? s.ghosts[s.ghostHighlight] : null;
      if (hl) {
        let mean = 0; if (s.target && s.target.length) { for (let k = 0; k < s.target.length; k++) mean += s.target[k]; mean /= s.target.length; }
        const top = mean <= 0.5;
        ctx.fillStyle = T.ink; ctx.font = `600 11px ${T.font}`; ctx.textAlign = 'left'; ctx.textBaseline = top ? 'top' : 'bottom';
        ctx.fillText(`${hl.name} · F = ${fmt.sci(hl.F)} · ${hl.layers} layers`, fr.x0 + 8, top ? fr.y0 + 4 : fr.y1 - 4); ctx.font = `11px ${T.font}`;
      }
    }
    // s and p polarizations at oblique incidence: thin solid (s) and dashed (p) lines under the characteristic
    if (s.showPols && s.curve && s.curve.Rs && s.curve.Rp && !s.curveDashed) {
      for (const [arr, dash, on] of [[s.curve.Rs, [], s.showRs], [s.curve.Rp, [5, 4], s.showRp]]) {
        if (!on) continue;
        ctx.beginPath();
        for (let i = 0; i < s.curve.wl.length; i++) { const x = xs(s.curve.wl[i]), y = ys(arr[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.strokeStyle = T['series-current']; ctx.lineWidth = 1.25; ctx.globalAlpha = 0.7; ctx.setLineDash(dash); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // current R: dense display curve (or grid values) as area + line
    const cw = s.curve ? s.curve.wl : s.grid, cR = s.curve ? s.curve.R : s.R;
    if (cw && cR) {
      ctx.beginPath();
      for (let i = 0; i < cw.length; i++) { const x = xs(cw[i]), y = ys(cR[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = T['series-current']; ctx.lineWidth = 2.25; ctx.lineJoin = 'round';
      if (s.curveDashed) { ctx.setLineDash([7, 5]); ctx.stroke(); ctx.setLineDash([]); }
      else {
        ctx.stroke();
        ctx.lineTo(xs(cw[cw.length - 1]), ys(y0)); ctx.lineTo(xs(cw[0]), ys(y0)); ctx.closePath();
        ctx.fillStyle = T['series-current-fill']; ctx.fill();
      }
    }
    // target: thick step line
    ctx.strokeStyle = T['series-target']; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.setLineDash([]);
    for (const b of s.bands) { ctx.beginPath(); ctx.moveTo(xs(b.from), ys(b.R)); ctx.lineTo(xs(b.to), ys(b.R)); ctx.stroke(); }
    ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.strokeStyle = T['ink-3'];
    for (let i = 0; i < s.bands.length - 1; i++) { const x = Math.round(xs(s.bands[i].to)) + 0.5; ctx.beginPath(); ctx.moveTo(x, fr.y0); ctx.lineTo(x, fr.y1); ctx.stroke(); }
    ctx.setLineDash([]);
    // grid points as small dots on the target line (hollow = zero weight, ring = added by enrichment)
    if (s.grid && s.target && s.grid.length <= 600) {
      for (let i = 0; i < s.grid.length; i++) {
        const x = xs(s.grid[i]), y = ys(s.target[i]);
        const zero = s.weights && s.weights[i] <= 0;
        const added = s.added && s.added.has(s.grid[i]);
        ctx.beginPath(); ctx.arc(x, y, added ? 3.2 : 2, 0, Math.PI * 2);
        if (zero) { ctx.strokeStyle = T['ink-3']; ctx.lineWidth = 1; ctx.stroke(); }
        else if (added) { ctx.fillStyle = T.card; ctx.fill(); ctx.strokeStyle = T.good; ctx.lineWidth = 1.5; ctx.stroke(); }
        else { ctx.fillStyle = T['ink-3']; ctx.fill(); }
      }
    }
    // hover crosshair
    if (this.hover && !this.drag && s.grid && this.hoverIndex != null && !this.tooltip.hidden) {
      const i = this.hoverIndex, x = Math.round(xs(s.grid[i])) + 0.5;
      ctx.strokeStyle = T['ink-3']; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, fr.y0); ctx.lineTo(x, fr.y1); ctx.stroke(); ctx.setLineDash([]);
      if (s.R) { ctx.fillStyle = T['series-current']; ctx.beginPath(); ctx.arc(xs(s.grid[i]), ys(s.R[i]), 4, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = T.card; ctx.lineWidth = 2; ctx.stroke(); }
    }
    ctx.restore();
    // handles
    if (s.editable) {
      const hov = this.hover?.handle, drag = this.drag;
      for (const h of this.handles()) {
        const active = (drag && drag.type === h.type && drag.index === h.index) || (!drag && hov && hov.type === h.type && hov.index === h.index);
        const r = active ? 7 : 5.5;
        ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
        ctx.fillStyle = h.type === 'level' ? T.card : T.accent; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = h.type === 'level' ? T['series-target'] : T.card; ctx.stroke();
        if (h.type !== 'level') {
          ctx.strokeStyle = T.accent; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(Math.round(h.x) + 0.5, h.y + r); ctx.lineTo(Math.round(h.x) + 0.5, fr.y1); ctx.stroke(); ctx.setLineDash([]);
        }
        if (active) {
          ctx.fillStyle = T.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.font = `600 11px ${T.font}`;
          const label = h.type === 'level' ? fmt.pct(s.bands[h.index].R, 1) : h.type === 'boundary' ? `${s.bands[h.index].to} nm` : h.type === 'range-min' ? `${s.lambdaMin} nm` : `${s.lambdaMax} nm`;
          ctx.fillText(label, h.x, h.y - 10);
          ctx.font = `11px ${T.font}`;
        }
      }
    }
  }
}

/* ===================================================================== */
/*  Needle derivative chart                                               */
/* ===================================================================== */
export class NeedleChart extends Plot {
  constructor(canvas, tooltip) {
    super(canvas, { l: 66, r: 18, t: 16, b: 34 });
    this.tooltip = tooltip;
    this.state = { xmax: 1, layers: [], scan: null, candidate: null, insertion: null, stale: false, Hkey: 'H', Lkey: 'L', annotations: null, banner: null };
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerleave', () => { this.tooltip.hidden = true; });
  }
  set(patch) { Object.assign(this.state, patch); this.requestDraw(); }
  scales() {
    const s = this.state, fr = this.frame();
    const xs = lin(0, Math.max(1, s.xmax), fr.x0 + SUB_W, fr.x1);
    let gmax = 0;
    if (s.scan) for (let i = 0; i < s.scan.g.length; i++) gmax = Math.max(gmax, Math.abs(s.scan.g[i]));
    if (!(gmax > 0)) gmax = 1e-5;
    const exp = Math.floor(Math.log10(gmax));
    const unit = Math.pow(10, exp);
    const ymax = gmax * 1.12 / unit;
    const ys = lin(-ymax, ymax, fr.y1, fr.y0);
    return { xs, ys, fr, unit, exp, ymax };
  }
  onMove(e) {
    const r = this.canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
    const s = this.state; const { xs, fr, unit } = this.scales();
    if (!s.scan || px < fr.x0 + SUB_W || px > fr.x1 || py < fr.y0 || py > fr.y1) { this.tooltip.hidden = true; return; }
    const z = xs.invert(px);
    let i = 0, bd = Infinity;
    for (let k = 0; k < s.scan.z.length; k++) { const d = Math.abs(s.scan.z[k] - z); if (d < bd) { bd = d; i = k; } }
    const j = s.scan.layer[i]; const lay = s.layers[j];
    this.tooltip.innerHTML = `<b>z = ${s.scan.z[i].toFixed(1)} nm</b><br>Layer ${j + 1} (${lay ? lay.m : '—'})<br>g = ${(s.scan.g[i] / unit).toFixed(3)} ×10${sup(Math.log10(unit))} nm⁻¹`;
    this.tooltip.hidden = false;
    const tw = this.tooltip.offsetWidth; let x = px + 14; if (x + tw > this.w - 4) x = px - tw - 14;
    this.tooltip.style.left = `${x}px`; this.tooltip.style.top = `${Math.max(4, py - 54)}px`;
  }
  draw() {
    const ctx = this.begin(), T = theme(), s = this.state;
    const { xs, ys, fr, unit, exp, ymax } = this.scales();
    // substrate band and layer background bands
    ctx.fillStyle = T.substrate; ctx.globalAlpha = 0.35; ctx.fillRect(fr.x0, fr.y0, SUB_W, fr.y1 - fr.y0); ctx.globalAlpha = 1;
    let z = 0;
    for (const L of s.layers) {
      const x0 = xs(z), x1 = xs(z + L.d);
      ctx.fillStyle = L.isH ? T['mat-h'] : T['mat-l']; ctx.globalAlpha = 0.07;
      ctx.fillRect(x0, fr.y0, x1 - x0, fr.y1 - fr.y0);
      ctx.globalAlpha = 1;
      z += L.d;
    }
    ctx.strokeStyle = T.line; ctx.lineWidth = 1; z = 0;
    for (let j = 0; j < s.layers.length - 1; j++) { z += s.layers[j].d; const x = Math.round(xs(z)) + 0.5; ctx.beginPath(); ctx.moveTo(x, fr.y0); ctx.lineTo(x, fr.y1); ctx.stroke(); }
    const xt = { ticks: niceTicks(0, s.xmax, Math.max(3, Math.floor((fr.x1 - fr.x0) / 90))), scale: xs };
    const yt = { ticks: niceTicks(-ymax, ymax, 5), scale: ys };
    this.axes(ctx, fr, xt, yt, (v) => fmtNum(v), (v) => fmtNum(v, 1), 'position from substrate z, nm', `g(z), 10${sup(exp)} nm⁻¹`);
    // zero line
    ctx.strokeStyle = T['ink-3']; ctx.lineWidth = 1; const yz = Math.round(ys(0)) + 0.5; ctx.beginPath(); ctx.moveTo(fr.x0, yz); ctx.lineTo(fr.x1, yz); ctx.stroke();
    if (!s.scan) {
      ctx.fillStyle = T['ink-3']; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('The needle derivative appears after the first refinement.', (fr.x0 + fr.x1) / 2, (fr.y0 + fr.y1) / 2);
      return;
    }
    ctx.save(); ctx.beginPath(); ctx.rect(fr.x0, fr.y0, fr.x1 - fr.x0, fr.y1 - fr.y0); ctx.clip();
    ctx.globalAlpha = s.stale ? 0.45 : 1;
    // negative fill + curve coloured by inserted material
    const sc = s.scan;
    let start = 0;
    while (start < sc.z.length) {
      const j = sc.layer[start]; let end = start;
      while (end + 1 < sc.z.length && sc.layer[end + 1] === j) end++;
      const host = s.layers[j];
      const color = host && host.isH ? T['mat-l'] : T['mat-h'];
      // fill where g < 0
      ctx.beginPath(); ctx.moveTo(xs(sc.z[start]), ys(0));
      for (let i = start; i <= end; i++) ctx.lineTo(xs(sc.z[i]), ys(Math.min(0, sc.g[i]) / unit));
      ctx.lineTo(xs(sc.z[end]), ys(0)); ctx.closePath();
      ctx.fillStyle = color; ctx.globalAlpha = (s.stale ? 0.45 : 1) * 0.16; ctx.fill(); ctx.globalAlpha = s.stale ? 0.45 : 1;
      ctx.beginPath();
      for (let i = start; i <= end; i++) { const x = xs(sc.z[i]), y = ys(sc.g[i] / unit); i === start ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      start = end + 1;
    }
    ctx.globalAlpha = 1;
    // insertion animation band
    if (s.insertion) {
      const ins = s.insertion;
      const x0 = xs(ins.z - ins.width / 2), x1 = xs(ins.z + ins.width / 2);
      ctx.fillStyle = T['needle-fill']; ctx.fillRect(x0, fr.y0, Math.max(2, x1 - x0), fr.y1 - fr.y0);
      ctx.strokeStyle = T.needle; ctx.lineWidth = 1; ctx.strokeRect(Math.round(x0) + 0.5, fr.y0 + 0.5, Math.max(2, x1 - x0), fr.y1 - fr.y0 - 1);
    }
    // final-state annotations: tested insertions with their refined ΔF
    if (s.annotations && s.annotations.length) {
      s.annotations.forEach((a, ai) => {
        const x = xs(a.z), y = ys(a.g / unit);
        const below = ai % 2 === 1;
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = T.card; ctx.fill();
        ctx.strokeStyle = a.gain ? T.good : T.bad; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = T.ink; ctx.font = `600 10px ${T.font}`; ctx.textBaseline = below ? 'top' : 'bottom';
        const tw = ctx.measureText(a.label).width; let lx = x; ctx.textAlign = 'center';
        if (lx - tw / 2 < fr.x0 + SUB_W) { lx = fr.x0 + SUB_W + tw / 2 + 2; } if (lx + tw / 2 > fr.x1) { lx = fr.x1 - tw / 2 - 2; }
        ctx.fillText(a.label, lx, below ? y + 9 : y - 9);
        ctx.font = `11px ${T.font}`;
      });
    }
    if (s.banner) {
      ctx.font = `600 11px ${T.font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(s.banner).width;
      let allPos = true; if (s.scan) for (let i = 0; i < s.scan.g.length; i++) if (s.scan.g[i] < 0) { allPos = false; break; }
      const bx = fr.x0 + SUB_W + 6, bh = 20, by = allPos ? fr.y1 - bh - 4 : fr.y0 + 4, bw = Math.min(tw + 16, fr.x1 - bx - 4);
      ctx.fillStyle = s.bannerKind === 'possible' ? T.needle : T.good; ctx.globalAlpha = 0.14; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = s.bannerKind === 'possible' ? T.needle : T.good;
      ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip(); ctx.fillText(s.banner, bx + 8, by + bh / 2); ctx.restore();
      ctx.font = `11px ${T.font}`;
    }
    // candidate marker
    if (s.candidate) {
      const c = s.candidate, x = xs(c.z), y = ys(c.g / unit);
      ctx.strokeStyle = T.needle; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, fr.y0); ctx.lineTo(Math.round(x) + 0.5, fr.y1); ctx.stroke(); ctx.setLineDash([]);
      const pr = 6 + 3 * (c.pulse ?? 0);
      ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2); ctx.fillStyle = T.needle; ctx.fill(); ctx.strokeStyle = T.card; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = T.ink; ctx.font = `600 11px ${T.font}`; ctx.textBaseline = 'top';
      const label = c.label || '';
      const tw = ctx.measureText(label).width;
      let lx = x + 10; ctx.textAlign = 'left';
      if (lx + tw > fr.x1) { lx = x - 10; ctx.textAlign = 'right'; }
      ctx.fillText(label, lx, fr.y0 + 4);
      ctx.font = `11px ${T.font}`;
    }
    ctx.restore();
  }
}

/* ===================================================================== */
/*  Coating structure chart                                               */
/* ===================================================================== */
export class StructureChart extends Plot {
  constructor(canvas, tooltip) {
    super(canvas, { l: 66, r: 18, t: 16, b: 34 });
    this.tooltip = tooltip;
    this.state = { xmax: 1, layers: [], nmax: 2.5, highlight: null, substrate: 'BK7', ns: 1.52, ambient: 'air', na: 1 };
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerleave', () => { this.tooltip.hidden = true; });
  }
  set(patch) { Object.assign(this.state, patch); this.requestDraw(); }
  scales() {
    const s = this.state, fr = this.frame();
    const xs = lin(0, Math.max(1, s.xmax), fr.x0 + SUB_W, fr.x1);
    const ys = lin(1, s.nmax + 0.25, fr.y1, fr.y0);
    return { xs, ys, fr };
  }
  onMove(e) {
    const r = this.canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
    const s = this.state; const { xs, fr } = this.scales();
    if (px < fr.x0 + SUB_W || px > fr.x1 || py < fr.y0 || py > fr.y1) { this.tooltip.hidden = true; return; }
    const z = xs.invert(px);
    let acc = 0, found = -1;
    for (let j = 0; j < s.layers.length; j++) { if (z >= acc && z <= acc + s.layers[j].d) { found = j; break; } acc += s.layers[j].d; }
    if (found < 0) { this.tooltip.hidden = true; return; }
    const L = s.layers[found];
    this.tooltip.innerHTML = `<b>Layer ${found + 1} · ${L.m}</b><br>n = ${L.n.toFixed(2)}<br>d = ${L.d.toFixed(2)} nm<br>nd = ${(L.n * L.d).toFixed(1)} nm`;
    this.tooltip.hidden = false;
    const tw = this.tooltip.offsetWidth; let x = px + 14; if (x + tw > this.w - 4) x = px - tw - 14;
    this.tooltip.style.left = `${x}px`; this.tooltip.style.top = `${Math.max(4, py - 64)}px`;
  }
  draw() {
    const ctx = this.begin(), T = theme(), s = this.state;
    const { xs, ys, fr } = this.scales();
    const xt = { ticks: niceTicks(0, s.xmax, Math.max(3, Math.floor((fr.x1 - fr.x0) / 90))), scale: xs };
    const yt = { ticks: niceTicks(1, s.nmax + 0.25, 4), scale: ys };
    this.axes(ctx, fr, xt, yt, (v) => fmtNum(v), (v) => fmtNum(v, 1), 'position from substrate z, nm', 'refractive index n');
    // substrate block (left of z = 0) and ambient hint
    ctx.fillStyle = T.substrate; ctx.globalAlpha = 0.6;
    ctx.fillRect(fr.x0, ys(s.ns), SUB_W - 1, fr.y1 - ys(s.ns)); ctx.globalAlpha = 1;
    ctx.fillStyle = T['ink-2']; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `600 10px ${T.font}`;
    ctx.fillText(s.substrate, fr.x0 + SUB_W / 2, (ys(s.ns) + fr.y1) / 2);
    ctx.font = `11px ${T.font}`;
    const y1 = fr.y1;
    let z = 0;
    const hl = s.highlight;
    for (let j = 0; j < s.layers.length; j++) {
      const L = s.layers[j];
      const x0 = xs(z), x1 = xs(z + L.d);
      const w = Math.max(x1 - x0, L.d > 0 ? 1.5 : 0);
      const top = ys(L.n);
      ctx.fillStyle = L.isH ? T['mat-h-fill'] : T['mat-l-fill'];
      const isHL = hl && hl.index === j;
      if (isHL) ctx.fillStyle = T.needle;
      ctx.beginPath();
      const rr = Math.min(4, w / 2);
      ctx.roundRect(x0, top, w, y1 - top, [rr, rr, 0, 0]);
      ctx.fill();
      ctx.strokeStyle = T.card; ctx.lineWidth = 1; ctx.stroke();
      if (isHL) { ctx.shadowColor = T.needle; ctx.shadowBlur = 14 + 8 * (hl.pulse ?? 0); ctx.strokeStyle = T.needle; ctx.lineWidth = 2; ctx.stroke(); ctx.shadowBlur = 0; }
      if (w >= 30 && y1 - top > 16) {
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `600 10px ${T.font}`;
        const label = L.d >= 100 ? L.d.toFixed(0) : L.d.toFixed(1);
        ctx.fillText(label, x0 + w / 2, Math.min(y1 - 9, top + 10));
        ctx.font = `11px ${T.font}`;
      }
      z += L.d;
    }
    // ambient medium: label, and its index level when it is not air
    if (s.na > 1) {
      const ya = ys(s.na);
      ctx.fillStyle = T.substrate; ctx.globalAlpha = 0.35; ctx.fillRect(xs(z), ya, Math.max(0, fr.x1 - xs(z)), fr.y1 - ya); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = T['ink-3']; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (xs(z) + 36 < fr.x1) ctx.fillText(s.ambient || 'air', xs(z) + 8, (fr.y0 + fr.y1) / 2);
    ctx.fillStyle = T['ink-3']; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(`${s.layers.length} layer${s.layers.length === 1 ? '' : 's'} · ${fmtNum(z, 0)} nm`, fr.x1, fr.y0 + 2);
  }
}

/* ===================================================================== */
/*  Merit history                                                         */
/* ===================================================================== */
export class MeritChart extends Plot {
  constructor(canvas) {
    super(canvas, { l: 60, r: 14, t: 14, b: 30 });
    this.state = { history: [], targetF: 1e-4 };
  }
  set(patch) { Object.assign(this.state, patch); this.requestDraw(); }
  draw() {
    const ctx = this.begin(), T = theme(), s = this.state, fr = this.frame();
    const h = s.history;
    const n = Math.max(2, h.length);
    const xs = lin(0, n - 1, fr.x0, fr.x1);
    let lo = s.targetF, hi = s.targetF * 10;
    for (const p of h) { if (p.F > 0) { lo = Math.min(lo, p.F); hi = Math.max(hi, p.F); } }
    lo = Math.pow(10, Math.floor(Math.log10(lo)) - 0.2); hi = Math.pow(10, Math.ceil(Math.log10(hi)) + 0.1);
    const ys = lin(Math.log10(lo), Math.log10(hi), fr.y1, fr.y0);
    const ticks = []; for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++) ticks.push(e);
    const stepT = Math.max(1, Math.ceil(ticks.length / 5));
    const yt = { ticks: ticks.filter((_, i) => i % stepT === 0), scale: ys };
    const xt = { ticks: niceTicks(0, n - 1, Math.max(2, Math.floor((fr.x1 - fr.x0) / 70))).filter(Number.isInteger), scale: xs };
    this.axes(ctx, fr, xt, yt, (v) => fmtNum(v), (e) => `10${sup(e)}`, 'event', 'F');
    // target line
    const yT = Math.round(ys(Math.log10(s.targetF))) + 0.5;
    ctx.strokeStyle = T.good; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(fr.x0, yT); ctx.lineTo(fr.x1, yT); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = T.good; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('target', fr.x1 - 2, yT - 2);
    if (!h.length) return;
    ctx.save(); ctx.beginPath(); ctx.rect(fr.x0, fr.y0, fr.x1 - fr.x0, fr.y1 - fr.y0); ctx.clip();
    ctx.beginPath();
    h.forEach((p, i) => { const x = xs(i), y = ys(Math.log10(Math.max(p.F, lo))); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = T['series-current']; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    h.forEach((p, i) => {
      if (!p.mark) return;
      const x = xs(i), y = ys(Math.log10(Math.max(p.F, lo)));
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = p.mark === 'needle' ? T.needle : p.mark === 'growth' ? T['series-current'] : p.mark === 'cleanup' ? T['ink-3'] : T.good;
      ctx.fill(); ctx.strokeStyle = T.card; ctx.lineWidth = 1.5; ctx.stroke();
    });
    ctx.restore();
  }
}
