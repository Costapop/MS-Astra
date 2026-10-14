/** Catalogue of ideal, constant‑index materials (specification of the task). */
export const LAYER_MATERIALS = [
  { key: 'MgF2', label: 'MgF₂', n: 1.38 },
  { key: 'SiO2', label: 'SiO₂', n: 1.46 },
  { key: 'Al2O3', label: 'Al₂O₃', n: 1.63 },
  { key: 'HfO2', label: 'HfO₂', n: 1.95 },
  { key: 'Ta2O5', label: 'Ta₂O₅', n: 2.10 },
  { key: 'TiO2', label: 'TiO₂', n: 2.45 },
  { key: 'ZnS', label: 'ZnS', n: 2.35 },
  { key: 'a-Si', label: 'a‑Si', n: 3.95 },
  { key: 'K8', label: 'K8 glass', n: 1.52 },
  { key: 'Quartz', label: 'Fused quartz', n: 1.46 },
  { key: 'Sitall', label: 'Sitall', n: 1.54 },
];

export const SUBSTRATES = [
  { key: 'BK7', label: 'BK7', n: 1.52 },
];

export function materialByKey(key) {
  return LAYER_MATERIALS.find((m) => m.key === key) || SUBSTRATES.find((m) => m.key === key);
}

/** Target presets: bands as fractions of the spectral interval. */
export const PRESETS = {
  mirror: { name: 'Mirror 95 %', range: [450, 650], bands: [{ t: 1, R: 0.95 }], H: 'Ta2O5', L: 'SiO2', start: { material: 'Ta2O5', thickness: 100 }, maxLayers: 30, maxTOT: 5000, merit: 1e-4 },
  ar: { name: 'Anti‑reflection', range: [400, 700], bands: [{ t: 1, R: 0 }], H: 'TiO2', L: 'MgF2', start: { material: 'TiO2', thickness: 100 }, maxLayers: 12, maxTOT: 1500, merit: 1e-6 },
  edge: { name: 'Edge filter', range: [400, 800], bands: [{ t: 0.5, R: 0.02 }, { t: 1, R: 0.95 }], H: 'TiO2', L: 'MgF2', start: { material: 'TiO2', thickness: 150 }, maxLayers: 40, maxTOT: 6000, merit: 1e-4 },
  bandpass: { name: 'Band reflector', range: [400, 800], bands: [{ t: 0.3, R: 0.02 }, { t: 0.7, R: 0.95 }, { t: 1, R: 0.02 }], H: 'TiO2', L: 'SiO2', start: { material: 'TiO2', thickness: 150 }, maxLayers: 40, maxTOT: 6000, merit: 1e-4 },
  splitter: { name: 'Beam splitter 50 %', range: [450, 650], bands: [{ t: 1, R: 0.5 }], H: 'Ta2O5', L: 'SiO2', start: { material: 'Ta2O5', thickness: 100 }, maxLayers: 20, maxTOT: 3000, merit: 1e-5 },
};

export const DEFAULTS = {
  preset: 'mirror',
  points: 61,
  substrate: 'BK7',
  thinLayer: 1,
  needleWidth: 10,
  candidates: 3,
};

export function uniformGrid(min, max, count) {
  const g = new Float64Array(count);
  for (let i = 0; i < count; i++) g[i] = count === 1 ? min : min + (max - min) * i / (count - 1);
  return g;
}

/** Piecewise‑constant target: bands = [{from, to, R}] contiguous and sorted. */
export function targetOnGrid(bands, grid) {
  const t = new Float64Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    const w = grid[i];
    let b = bands.find((x) => w >= x.from - 1e-9 && w < x.to - 1e-9);
    if (!b) b = w >= bands[bands.length - 1].to - 1e-9 ? bands[bands.length - 1] : bands[0];
    t[i] = b.R;
  }
  return t;
}

export function bandsFromPreset(p) {
  const [a, b] = p.range;
  let from = a;
  return p.bands.map((x) => { const to = a + (b - a) * x.t; const band = { from, to, R: x.R }; from = to; return band; });
}

/** Validate the full configuration; returns { ok, errors: [] }. */
export function validateConfig(c) {
  const errors = [];
  if (!(c.lambdaMin > 0)) errors.push('Minimum wavelength must be positive.');
  if (!(c.lambdaMax > c.lambdaMin)) errors.push('Maximum wavelength must exceed the minimum.');
  if (!(Number.isInteger(c.points) && c.points >= 2 && c.points <= 2000)) errors.push('Spectral points must be an integer from 2 to 2000.');
  if (!c.H || !c.L) errors.push('Choose both layer materials.');
  else if (c.H.n === c.L.n) errors.push('Layer materials must have different refractive indices.');
  if (!(c.maxLayers >= 1 && c.maxLayers <= 400)) errors.push('Maximum layers must be from 1 to 400.');
  if (!(c.maxTOT > 0)) errors.push('Maximum optical thickness must be positive.');
  if (!(c.targetMerit > 0)) errors.push('Target merit must be positive.');
  if (!(c.startThickness >= 0)) errors.push('Starting thickness must be non‑negative.');
  if (c.startThickness * (c.startMaterial?.n || 1) > c.maxTOT) errors.push('Starting optical thickness exceeds the optical‑thickness limit.');
  if (!(c.thinLayer >= 0)) errors.push('Thin‑layer threshold must be non‑negative.');
  for (const b of c.bands || []) if (!(b.R >= 0 && b.R <= 1)) errors.push('Target reflectance must be between 0 and 1.');
  return { ok: errors.length === 0, errors };
}
