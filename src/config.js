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

/** Incident (ambient) media the light comes from; the angle of incidence is measured in this medium. */
export const AMBIENTS = [
  { key: 'Air', label: 'Air', n: 1.0 },
  { key: 'BK7', label: 'BK7', n: 1.52 },
];

export function materialByKey(key) {
  return LAYER_MATERIALS.find((m) => m.key === key) || SUBSTRATES.find((m) => m.key === key);
}
export function ambientByKey(key) {
  return AMBIENTS.find((m) => m.key === key) || AMBIENTS[0];
}

/**
 * Target presets: bands as fractions of the spectral interval. `angle` (degrees),
 * `pol` (s | p | both | avg) and `ambient` (Air | BK7) default to normal
 * incidence of unpolarized light from air.
 */
export const PRESETS = {
  mirror: { name: 'Mirror 95 %', range: [450, 650], bands: [{ t: 1, R: 0.95 }], H: 'Ta2O5', L: 'SiO2', start: { material: 'Ta2O5', thickness: 100 }, maxLayers: 30, maxTOT: 5000, merit: 1e-4 },
  ar: { name: 'Anti‑reflection', range: [400, 700], bands: [{ t: 1, R: 0 }], H: 'TiO2', L: 'MgF2', start: { material: 'TiO2', thickness: 100 }, maxLayers: 12, maxTOT: 1500, merit: 1e-6 },
  edge: { name: 'Edge filter', range: [400, 800], bands: [{ t: 0.5, R: 0.02 }, { t: 1, R: 0.95 }], H: 'TiO2', L: 'MgF2', start: { material: 'TiO2', thickness: 150 }, maxLayers: 40, maxTOT: 6000, merit: 1e-4 },
  bandpass: { name: 'Band reflector', range: [400, 800], bands: [{ t: 0.3, R: 0.02 }, { t: 0.7, R: 0.95 }, { t: 1, R: 0.02 }], H: 'TiO2', L: 'SiO2', start: { material: 'TiO2', thickness: 150 }, maxLayers: 40, maxTOT: 6000, merit: 1e-4 },
  splitter: { name: 'Beam splitter 50 %', range: [450, 650], bands: [{ t: 1, R: 0.5 }], H: 'Ta2O5', L: 'SiO2', start: { material: 'Ta2O5', thickness: 100 }, maxLayers: 20, maxTOT: 3000, merit: 1e-5 },
  cube: { name: 'Cube splitter 45°', range: [450, 650], bands: [{ t: 1, R: 0.5 }], H: 'Ta2O5', L: 'SiO2', start: { material: 'Ta2O5', thickness: 100 }, maxLayers: 24, maxTOT: 4000, merit: 1e-4, angle: 45, pol: 'avg', ambient: 'BK7' },
  ar45: { name: 'AR at 45°', range: [450, 650], bands: [{ t: 1, R: 0 }], H: 'TiO2', L: 'MgF2', start: { material: 'TiO2', thickness: 100 }, maxLayers: 14, maxTOT: 1800, merit: 3e-5, angle: 45, pol: 'both', ambient: 'Air' },
};

export const DEFAULTS = {
  preset: 'mirror',
  points: 61,
  substrate: 'BK7',
  ambient: 'Air',
  angle: 0,
  pol: 'avg',
  thinLayer: 1,
  needleWidth: 10,
  candidates: 3,
  transition: 0,
  denseCheck: true,
  enrichGrid: true,
  multiStart: false,
  exploreBudget: 20,
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

/**
 * Sample the piecewise-constant target on an arbitrary wavelength list and
 * build the merit weights: ν_l = 1/L' over the points outside the transition
 * zones (|λ − λ_jump| < transition/2 around every interior band boundary get
 * weight 0; Furman–Tikhonravov §2.1: small or zero weights where the target
 * changes abruptly). Returns { target, weights, excluded }.
 */
export function sampleTarget(bands, grid, transition = 0) {
  const target = targetOnGrid(bands, grid);
  const weights = new Float64Array(grid.length);
  const jumps = bands.slice(0, -1).map((b) => b.to);
  let excluded = 0, kept = 0;
  for (let i = 0; i < grid.length; i++) {
    const inZone = transition > 0 && jumps.some((j) => Math.abs(grid[i] - j) < transition / 2 - 1e-9);
    if (inZone) { weights[i] = 0; excluded++; } else { weights[i] = 1; kept++; }
  }
  const norm = kept > 0 ? 1 / kept : 1 / grid.length;
  for (let i = 0; i < grid.length; i++) weights[i] = kept > 0 ? weights[i] * norm : norm;
  return { target, weights, excluded };
}

/**
 * Independent dense verification grid: uniform with at least `points`
 * (default max(2001, 8·L)) samples plus both sides of every target jump.
 */
export function denseGrid(bands, lambdaMin, lambdaMax, transition = 0, points) {
  const count = points ?? 2001;
  const span = lambdaMax - lambdaMin;
  const list = Array.from(uniformGrid(lambdaMin, lambdaMax, count));
  for (const b of bands.slice(0, -1)) { const eps = Math.max(1e-6 * span, 1e-6); list.push(b.to - eps, b.to + eps); }
  list.sort((a, b) => a - b);
  const wl = Float64Array.from(list);
  const s = sampleTarget(bands, wl, transition);
  return { wavelengths: wl, target: s.target, weights: s.weights };
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
  if (!((c.transition ?? 0) >= 0)) errors.push('Transition‑zone width must be non‑negative.');
  if ((c.transition ?? 0) > 0 && (c.bands || []).length > 1) {
    const span = c.lambdaMax - c.lambdaMin;
    if (c.transition >= span / 2) errors.push('Transition zone is too wide for the spectral range.');
  }
  for (const b of c.bands || []) if (!(b.R >= 0 && b.R <= 1)) errors.push('Target reflectance must be between 0 and 1.');
  const angle = c.angle ?? 0;
  if (!(angle >= 0 && angle <= 89.9)) errors.push('Angle of incidence must be from 0 to 89.9 degrees.');
  if (c.pol != null && !['s', 'p', 'both', 'avg'].includes(c.pol)) errors.push('Choose the target characteristic: Rs, Rp, Rs & Rp or (Rs + Rp)/2.');
  const na = c.ambient?.n ?? 1, ns = c.substrate?.n;
  if (ns && angle >= 0 && angle <= 89.9 && na * Math.sin(angle * Math.PI / 180) >= ns) errors.push(`Total internal reflection at the substrate (n_a sin θ ≥ n_s): the reflectance is 1 for every design. Reduce the angle below ${(Math.asin(Math.min(1, ns / na)) * 180 / Math.PI).toFixed(1)}°.`);
  return { ok: errors.length === 0, errors };
}
