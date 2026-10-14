/** Background multi‑start exploration (see synthesis.explore). */
import { explore } from './synthesis.js';

self.onmessage = (e) => {
  const cfg = e.data;
  try {
    for (const ev of explore(cfg)) self.postMessage(ev);
  } catch (err) {
    self.postMessage({ type: 'explore-error', message: String(err && err.message || err) });
  }
};
