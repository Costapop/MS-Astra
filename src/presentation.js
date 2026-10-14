/** Presentation pacing only: numerical snapshots are never interpolated in the solver. */
export function frameDuration(stage, pace) {
  if (!(Number(pace) > 0)) return 0;
  const cinematic = Number(pace) >= 500;
  if (stage === 'needle-insertion') return cinematic ? 3200 : 1900;
  if (stage === 'needle-scan') return cinematic ? 1500 : 900;
  if (stage === 'growth') return cinematic ? 1800 : 1100;
  if (stage === 'refinement' || stage === 'final') return cinematic ? 520 : 280;
  if (stage === 'done') return 0;
  return cinematic ? 850 : 450;
}

/** Find the new material, not the newly named remnant of the split host. */
export function insertedLayerId(previous, current) {
  if (current.stage !== 'needle-insertion' || !current.needle?.best) return null;
  const oldIds = new Set((previous?.layers || []).map(layer => String(layer.id)));
  const material = current.needle.best.material;
  return current.layers.find(layer => layer.material === material && !oldIds.has(String(layer.id)))?.id ?? null;
}

/** A physically scaled, clipped neighborhood; the full stack keeps its true scale. */
export function insertionDetail(layers, selectedId) {
  const selected = layers.findIndex(layer => String(layer.id) === String(selectedId));
  if (selected < 0) return null;
  const total = layers.reduce((sum, layer) => sum + layer.d, 0);
  const start = layers.slice(0, selected).reduce((sum, layer) => sum + layer.d, 0);
  const layer = layers[selected], center = start + layer.d / 2;
  const width = Math.min(total, Math.max(layer.d * 7, 1e-5));
  const left = Math.max(0, Math.min(total - width, center - width / 2));
  const right = left + width;
  let position = 0;
  const segments = layers.flatMap(item => {
    const from = Math.max(left, position), to = Math.min(right, position + item.d);
    position += item.d;
    return to > from ? [{ ...item, fraction: (to - from) / width, selected: String(item.id) === String(selectedId) }] : [];
  });
  return { layer, index: selected, left, right, center, segments, magnification: total / width };
}
