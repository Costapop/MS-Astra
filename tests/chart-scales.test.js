import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeritScale, formatMeritTick, createReflectanceRange } from '../src/chart-scales.js';
import { merit } from '../src/optics.js';

const close = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const labelNumber = label => Number(label.replace('−', '-'));

test('merit is a nonnegative mean square, while logarithms may be negative', () => {
  const value = merit([0.8, 0.7, 0.9], [0.9, 0.9, 0.9]);
  close(value, (0.01 + 0.04) / 3);
  assert.ok(value > 0 && Math.log10(value) < 0);
  assert.equal(merit([0, 0.5, 1], [0, 0.5, 1]), 0);
  const scale = createMeritScale([value]);
  assert.ok(scale.ticks.every(tick => tick.value > 0 && labelNumber(tick.label) > 0));
});

test('logarithmic plot has equal spacing for equal ratios but labels actual MSE', () => {
  const scale = createMeritScale([1, 0.1, 0.01, 0.001], { maxTicks: 4 });
  assert.deepEqual(scale.ticks.map(tick => tick.label), ['0.001', '0.01', '0.1', '1']);
  close(scale.position(0.001), 0);
  close(scale.position(1), 1);
  close(scale.position(0.01) - scale.position(0.001), scale.position(1) - scale.position(0.1));
  close(scale.position(Math.sqrt(0.01 * 0.1)), (scale.position(0.01) + scale.position(0.1)) / 2);
});

test('requested threshold remains inside the axis domain without changing samples', () => {
  const data = [0.7, 0.2, 0.03];
  const scale = createMeritScale(data, { target: 1e-8, maxTicks: 4 });
  assert.ok(scale.minimum <= 1e-8 && scale.maximum >= 0.7);
  assert.ok(scale.position(1e-8) < scale.position(0.03));
  assert.ok(scale.ticks.length <= 4);
  assert.deepEqual(data, [0.7, 0.2, 0.03]);
  assert.equal(formatMeritTick(1e-8), '1e−8');
});

test('zero has a distinct floor and is never silently clamped to a positive MSE', () => {
  const scale = createMeritScale([0.1, 1e-20, 0], { target: 1e-4 });
  assert.equal(scale.ticks[0].value, 0);
  assert.equal(scale.ticks[0].label, '0');
  assert.equal(scale.ticks[0].isZero, true);
  assert.equal(scale.position(0), 0);
  assert.ok(scale.position(1e-20) > scale.position(0));
  assert.match(scale.zeroNote, /Exact zero/);
  assert.ok(scale.ticks.length <= 4);
  const zero = createMeritScale([0, 0, 0], { target: 0 });
  assert.equal(zero.mode, 'zero');
  assert.deepEqual(zero.ticks.map(tick => tick.value), [0]);
  assert.equal(zero.position(0), 0);
});

test('very small positive MSE values retain distinctions below the former 1e-14 floor', () => {
  const scale = createMeritScale([1e-16, 1e-24, 1e-32]);
  assert.ok(scale.position(1e-32) < scale.position(1e-24));
  assert.ok(scale.position(1e-24) < scale.position(1e-16));
  close(scale.position(1e-24), 0.5);
  assert.equal(scale.hasZero, false);
  assert.ok(scale.ticks.every(tick => tick.value > 0));
});

test('empty and identical series produce finite, bounded axes', () => {
  for (const values of [[], [0.1], [0.03, 0.03], [1, 1], [0, 0]]) {
    const scale = createMeritScale(values);
    assert.equal(scale.empty, values.length === 0);
    for (const tick of scale.ticks) {
      assert.ok(Number.isFinite(tick.value) && tick.value >= 0);
      assert.ok(Number.isFinite(tick.position) && tick.position >= 0 && tick.position <= 1);
    }
    for (const value of values) assert.ok(Number.isFinite(scale.position(value)));
  }
});

test('subnormal and maximum finite data remain monotonic with finite tick labels', () => {
  const values = [Number.MIN_VALUE, 1e-320, 1e-300, 1e-100, 1e-4, 1, 1e100, Number.MAX_VALUE];
  const scale = createMeritScale(values, { maxTicks: 5 });
  for (let index = 1; index < values.length; index++) assert.ok(scale.position(values[index]) > scale.position(values[index - 1]));
  assert.ok(scale.ticks.length <= 5);
  assert.ok(scale.ticks.every(tick => Number.isFinite(tick.value) && tick.value > 0 && Number.isFinite(labelNumber(tick.label))));
  for (const value of [Number.MIN_VALUE, Number.MAX_VALUE]) {
    const single = createMeritScale([value]);
    assert.ok(Number.isFinite(single.position(value)));
    assert.ok(single.ticks.every(tick => tick.value > 0 && Number.isFinite(tick.value)));
  }
});

test('invalid or negative merit is rejected rather than disguised by plotting', () => {
  for (const bad of [-0.1, NaN, Infinity, -Infinity]) {
    assert.throws(() => createMeritScale([0.1, bad]), /finite, nonnegative/);
    assert.throws(() => createMeritScale([0.1], { target: bad }), /finite, nonnegative/);
    assert.throws(() => createMeritScale([0.1]).position(bad), /finite, nonnegative/);
    assert.throws(() => formatMeritTick(bad), /finite, nonnegative/);
  }
});

test('reflectance defaults to the full physical range and fitted curves gain 15% padding per side', () => {
  const values = [0.2, 0.5, 0.6];
  assert.deepEqual(createReflectanceRange(values), { min: 0, max: 1 });
  assert.deepEqual(createReflectanceRange([], { fit: true }), { min: 0, max: 1 });
  const fitted = createReflectanceRange(values, { fit: true });
  close(fitted.min, 0.14);
  close(fitted.max, 0.66);
  assert.deepEqual(values, [0.2, 0.5, 0.6]);
});

test('reflectance fitting preserves at least four percentage points at both physical limits', () => {
  for (const values of [[0], [1], [0.5, 0.5], [0.001, 0.002], [0.999, 1]]) {
    const range = createReflectanceRange(values, { fit: true });
    assert.ok(range.min >= 0 && range.max <= 1);
    assert.ok(range.max - range.min >= 0.04 - 1e-14);
    for (const value of values) assert.ok(range.min <= value && range.max >= value);
  }
  assert.deepEqual(createReflectanceRange([0, 1], { fit: true }), { min: 0, max: 1 });
});

test('reflectance fitting accepts roundoff only and rejects unphysical inputs even in full-range mode', () => {
  assert.deepEqual(createReflectanceRange([-5e-13, 1 + 5e-13], { fit: true }), { min: 0, max: 1 });
  for (const value of [-2e-12, 1 + 2e-12, NaN, Infinity, -Infinity]) {
    assert.throws(() => createReflectanceRange([value], { fit: true }), /finite and between 0 and 1/);
    assert.throws(() => createReflectanceRange([value]), /finite and between 0 and 1/);
  }
});
