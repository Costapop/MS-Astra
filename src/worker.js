/**
 * Background multi‑start exploration. Every starting design is synthesized to
 * completion; the stages of the run are streamed to the interface (refinement
 * frames throttled to ~25 per second) so the exploration can be watched like
 * an ordinary synthesis, and the finished designs are ranked by
 * max(F, F_dense).
 */
import { synthesize, startDesigns, exploreResult } from './synthesis.js';

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
      let done = null, finalScan = null, lastFrame = 0;
      for (const ev of synthesize({ ...cfg, start: { ...s.start, name: s.name } })) {
        if (ev.type === 'done') { done = ev; continue; }
        if (ev.type === 'final-scan') finalScan = ev;
        if (ev.type === 'refine') {
          const now = Date.now();
          if (now - lastFrame < 40) continue;
          lastFrame = now;
          self.postMessage({ type: 'explore-event', index: i, ev: { type: 'refine', layers: ev.layers, R: ev.R, F: ev.F } });
        } else if (STREAMED.has(ev.type)) {
          self.postMessage({ type: 'explore-event', index: i, ev });
        }
      }
      // the complete result of the start (its `done` event and final needle scan) travels with the ranking
      // fields, so the interface can show any explored result on the dashboard and export it
      const r = exploreResult(i, s, done, finalScan);
      results.push(r);
      self.postMessage({ type: 'explore-result', ...r });
    }
    const ranked = results.slice().sort((a, b) => a.score - b.score);
    self.postMessage({ type: 'explore-done', results: ranked, best: ranked[0] });
  } catch (err) {
    self.postMessage({ type: 'explore-error', message: String(err && err.message || err) });
  }
};
