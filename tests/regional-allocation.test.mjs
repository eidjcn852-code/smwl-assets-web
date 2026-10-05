import test from 'node:test';
import assert from 'node:assert/strict';
import {regionalAllocation} from '../lib/regional-allocation.ts';

test('property and car join domestic securities while overseas securities stay separate', () => {
  const sm=regionalAllocation(100,100,200,100);
  const wl=regionalAllocation(50,50,0,0);
  assert.deepEqual([sm.domestic,sm.foreign,sm.twRatio,sm.foreignRatio],[400,100,'80.0','20.0']);
  const combined=regionalAllocation(sm.domestic+wl.domestic,sm.foreign+wl.foreign,0,0);
  assert.deepEqual([combined.twRatio,combined.foreignRatio],['75.0','25.0']);
});

test('property or car alone is domestic; empty allocation is zero', () => {
  assert.equal(regionalAllocation(0,0,200,100).twRatio,'100.0');
  assert.equal(regionalAllocation(0,0,200,100).foreignRatio,'0.0');
  assert.deepEqual([regionalAllocation(0,0,0,0).twRatio,regionalAllocation(0,0,0,0).foreignRatio],['0.0','0.0']);
});
