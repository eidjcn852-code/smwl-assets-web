import test from 'node:test';
import assert from 'node:assert/strict';
import { bindingFromHash, GOOGLE_CLIENT_ID } from '../pages-src/binding.ts';
const link = value => '#bind=' + encodeURIComponent(btoa(JSON.stringify(value)));
test('private binding validates settings and fixes the OAuth client', () => {
  const data = {v:1,s:'synthetic_sheet_1234567890',b:100};
  assert.deepEqual(bindingFromHash(link({...data,clientId:'attacker'})), {clientId:GOOGLE_CLIENT_ID,spreadsheetId:data.s,baseline:100});
  assert.equal(bindingFromHash(''), null);
  assert.throws(()=>bindingFromHash('#bind=broken'));
  for(const b of [0,-1,'100',null]) assert.throws(()=>bindingFromHash(link({...data,b})));
  assert.throws(()=>bindingFromHash(link({...data,s:'bad/path'})));
});
