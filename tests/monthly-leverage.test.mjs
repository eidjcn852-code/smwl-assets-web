import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyLeverage, leverageText } from '../lib/monthly-leverage.ts';

test('September ratios use the same net assets and only remove property exposure', () => {
  const value = monthlyLeverage('2026-09', 100000, 156000, 20000);
  assert.equal(leverageText(value.leverageWithProperty), '1.56倍');
  assert.equal(leverageText(value.leverageWithoutProperty), '1.36倍');
  assert.equal(value.leverageWithoutProperty, 1.36);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
});
test('no retrospective invention or division by zero', () => {
  assert.deepEqual(monthlyLeverage('2026-08', 10, 20, 5), {});
  assert.equal(leverageText(monthlyLeverage('2026-09', 0, 20, 5).leverageWithProperty), '—');
  assert.equal(leverageText(undefined), '—');
  assert.equal(leverageText(monthlyLeverage('2027-01', 100, 200, 50).leverageWithoutProperty), '1.50倍');
});
