const MIN_LOG = Math.log10(Number.MIN_VALUE);
const MAX_LOG = Math.log10(Number.MAX_VALUE);

/** Physical reflectance range, with a readable optional fit to current + target R. */
export function createReflectanceRange(values, { fit = false } = {}) {
  const physical = Array.from(values, value => {
    if (!Number.isFinite(value) || value < -1e-12 || value > 1 + 1e-12) throw new RangeError('Reflectance must be finite and between 0 and 1.');
    return Math.max(0, Math.min(1, value));
  });
  if (!fit || !physical.length) return { min: 0, max: 1 };
  let least = 1, greatest = 0;
  for (const value of physical) { least = Math.min(least, value); greatest = Math.max(greatest, value); }
  const span = Math.min(1, Math.max(0.04, (greatest - least) * 1.3));
  const center = (least + greatest) / 2;
  const min = Math.max(0, Math.min(1 - span, center - span / 2));
  return { min, max: Math.min(1, min + span) };
}

function checkedMerit(value) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Merit must be a finite, nonnegative MSE.');
  return value;
}

function fromLog(exponent) {
  if (exponent <= MIN_LOG) return Number.MIN_VALUE;
  if (exponent >= MAX_LOG) return Number.MAX_VALUE;
  return 10 ** exponent;
}

/** Format the physical MSE value, never its logarithm. */
export function formatMeritTick(value) {
  checkedMerit(value);
  if (value === 0) return '0';
  if (value >= 0.001 && value < 10000) return String(Number(value.toPrecision(3)));
  const rounded = value.toExponential(2);
  const text = Number.isFinite(Number(rounded)) ? rounded : value.toExponential();
  return text.replace(/\.0+(?=e)/, '').replace(/(\.\d*[1-9])0+(?=e)/, '$1').replace('e-', 'e−').replace('e+', 'e');
}

/**
 * Logarithmic MSE scale with normalized positions (0 = bottom, 1 = top).
 * The optional target participates in the domain, so its guide stays visible.
 * Exact zeros occupy a separate floor below the positive logarithmic range;
 * they are never changed to a fabricated positive objective value.
 */
export function createMeritScale(values, { target, maxTicks = 4 } = {}) {
  const observed = Array.from(values, checkedMerit);
  const supplied = target === undefined || target === null ? observed : [...observed, checkedMerit(target)];
  const positives = supplied.filter(value => value > 0);
  const hasZero = supplied.some(value => value === 0);
  const tickLimit = Number.isFinite(maxTicks) ? Math.max(3, Math.min(12, Math.floor(maxTicks))) : 4;

  // A zero-only series has no logarithmic extent. Show its exact value only.
  if (hasZero && positives.length === 0) {
    return {
      mode: 'zero', scaleLabel: 'MSE', hasZero, zeroNote: null,
      minimum: 0, maximum: 0, empty: observed.length === 0,
      ticks: [{ value: 0, label: '0', position: 0, isZero: true }],
      position(value) { checkedMerit(value); return value === 0 ? 0 : 1; },
    };
  }

  let minimumLog = -6, maximumLog = 0;
  if (positives.length) {
    let least = Infinity, greatest = -Infinity;
    for (const value of positives) {
      const exponent = Math.log10(value);
      least = Math.min(least, exponent); greatest = Math.max(greatest, exponent);
    }
    minimumLog = Math.max(MIN_LOG, Math.floor(least));
    maximumLog = Math.min(MAX_LOG, Math.ceil(greatest));
    if (maximumLog - minimumLog < 1) {
      minimumLog = Math.max(MIN_LOG, Math.floor(least) - 1);
      maximumLog = Math.min(MAX_LOG, Math.ceil(greatest) + 1);
    }
  }
  const zeroGap = hasZero ? 0.14 : 0;
  const position = value => {
    checkedMerit(value);
    if (value === 0) return 0;
    const fraction = (Math.log10(value) - minimumLog) / (maximumLog - minimumLog);
    return zeroGap + Math.max(0, Math.min(1, fraction)) * (1 - zeroGap);
  };
  const positiveTickLimit = tickLimit - Number(hasZero);
  const exponentStep = Math.max(1, Math.ceil((maximumLog - minimumLog) / (positiveTickLimit - 1)));
  const exponents = [minimumLog];
  for (let exponent = minimumLog + exponentStep; exponent < maximumLog; exponent += exponentStep) exponents.push(exponent);
  exponents.push(maximumLog);
  const ticks = exponents.map(exponent => {
    const value = fromLog(exponent);
    return { value, label: formatMeritTick(value), position: position(value), isZero: false };
  });
  if (hasZero) ticks.unshift({ value: 0, label: '0', position: 0, isZero: true });

  return {
    mode: 'log', scaleLabel: 'MSE · logarithmic scale', hasZero,
    zeroNote: hasZero ? 'Exact zero is shown below the logarithmic range.' : null,
    minimum: fromLog(minimumLog), maximum: fromLog(maximumLog),
    empty: observed.length === 0, ticks, position,
  };
}
