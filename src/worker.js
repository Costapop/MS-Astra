/**
 * Background multi‑start exploration. Every starting design is synthesized to
 * completion; the stages of the run are streamed to the interface (refinement
 * frames throttled to ~25 per second) so the exploration can be watched like
 * an ordinary synthesis, and the finished designs are ranked by
 * max(F, F_dense).
 */
import { synthesize, startDesigns } from './synthesis.js';

const STREAMED = new Set(['start', 'stage', 'cycle', 'scan', 'compare', 'needle', 'needle-rejected', 'growth', 'cleanup', 'refined', 'grid', 'dense', 'note', 'final-scan']);

self.onmessage = (e) => {
  const cfg = e.data;
  try {
    const lamMin = Math.min(...cfg.wavelengths), lamMax = Math.max(...cfg.wavelengths);
    const starts = cfg.starts || startDesigns(cfg, (lamMin + lamMax) / 2);
    const results = [];
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      self.postMessage({ type: 'explore-start', index: i, total: starts.length, name: s.name });
      let done = null, lastFrame = 0;
      for (const ev of synthesize({ ...cfg, start: { ...s.start, name: s.name } })) {
        if (ev.type === 'done') { done = ev; continue; }
        if (ev.type === 'refine') {
          const now = Date.now();
          if (now - lastFrame < 40) continue;
          lastFrame = now;
          self.postMessage({ type: 'explore-event', index: i, ev: { type: 'refine', layers: ev.layers, R: ev.R, F: ev.F } });
        } else if (STREAMED.has(ev.type)) {
          self.postMessage({ type: 'explore-event', index: i, ev });
        }
      }
      const score = done.dense ? Math.max(done.F, done.dense.F) : done.F;
      const r = { index: i, name: s.name, start: s.start, F: done.F, Fdense: done.dense ? done.dense.F : null, score, layers: done.layers, opticalThickness: done.opticalThickness, reason: done.reason, baseReason: done.stop.base, stopKind: done.stop.kind, summary: done.stop.summary, refinements: done.stop.refinements, elapsedMs: done.elapsedMs };
      results.push(r);
      self.postMessage({ type: 'explore-result', ...r });
    }
    const ranked = results.slice().sort((a, b) => a.score - b.score);
    self.postMessage({ type: 'explore-done', results: ranked, best: ranked[0] });
  } catch (err) {
    self.postMessage({ type: 'explore-error', message: String(err && err.message || err) });
  }
};
