import test from 'node:test';
import assert from 'node:assert/strict';
import { isExcludedExposure, mergeRegionalLiabilities } from '../lib/asset-rules.ts';

test('00865B exposure rule recognizes domestic and overseas entry formats', () => {
  for (const name of ['00865B', ' TPE:00865B ', 'TWSE:00865B', '00865B.TW', '00865B.TWO']) {
    assert.equal(isExcludedExposure(name), true, name);
  }
  for (const name of ['00865A', '00865B2', 'TEST']) {
    assert.equal(isExcludedExposure(name), false, name);
  }
});

test('legacy domestic and foreign loans merge once without changing liabilities', () => {
  const old = {
    marginLoan: '1,200', foreignMarginLoan: '300',
    debt: '400', foreignDebt: '600', mortgage: '500',
  };
  const merged = mergeRegionalLiabilities(old);
  assert.deepEqual([merged.marginLoan, merged.foreignMarginLoan, merged.debt, merged.foreignDebt, merged.mortgage],
    ['1500', '0', '1000', '0', '500']);
  assert.equal(Number(merged.marginLoan) + Number(merged.debt) + Number(merged.mortgage), 3000);
  assert.deepEqual(mergeRegionalLiabilities(merged), merged);
  assert.equal(old.foreignDebt, '600');
});
