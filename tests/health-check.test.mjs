import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDeterministicHealthCheck as check } from '../lib/health-check.ts';

// Synthetic amounts only. Do not place private account snapshots in this repo.
const account = overrides => ({name:'SM', cash:1000, realEstate:0, car:0,
  marginLoan:0, debt:0, mortgage:0, foreignDebt:0, foreignMarginLoan:0, ...overrides});
const position = overrides => ({account:'SM', market:'tw', name:'00631L', price:10,
  shares:100, plannedPrice:0, plannedShares:0, leverage:2, ...overrides});
const input = (overrides={}) => ({accounts:[account()], positions:[position()], history:[], ...overrides});
const domain = (result, name) => result.domains.find(d => d.label === name);
const diversified = (weights=[20,20,20,20,20]) => weights.map((weight,i) =>
  position({name:`ASSET${i}`, price:weight, shares:1, leverage:1, market:i%2?'foreign':'tw'}));

test('price-only draft does not mask current concentration; exact draft is disclosed', () => {
  const base = check(input());
  const actual = check(input({positions:[position({account:'WL',plannedPrice:1})]}));
  assert.equal(domain(actual,'集中度').status,'警戒');
  assert.equal(domain(actual,'集中度').value,domain(base,'集中度').value);
  assert.equal(actual.dataNotes.some(note=>/WL.*00631L.*加碼價位 1、加碼股數 0/.test(note)),true);
  assert.equal(actual.risks.some(r=>r.title==='部位資料不完整'),false);
  assert.deepEqual(actual.stressTests,base.stressTests);
});
test('empty placeholder is not incomplete; real missing holding price remains disclosed', () => {
  const blank = position({name:'',price:0,shares:0,leverage:1});
  const result = check(input({positions:[position(), blank]}));
  assert.equal(result.dataNotes.some(n=>n.includes('持倉資料不完整')),false);
  const incomplete = check(input({positions:[position(),position({name:'OTHER',price:0,shares:5})]}));
  assert.equal(domain(incomplete,'集中度').status,'警戒');
  assert.match(domain(incomplete,'集中度').findings.map(f=>f.evidence).join(),/OTHER/);
  assert.match(domain(incomplete,'集中度').explanation,/暫估/);
});
test('no securities is explicitly insufficient; planned-only position is not a current holding', () => {
  const result = check(input({positions:[position({price:0,shares:0,plannedPrice:10,plannedShares:1})]}));
  assert.equal(domain(result,'集中度').status,'資料不足');
  assert.equal(domain(result,'集中度').value,'無金融部位');
});
test('ticker aliases aggregate and use identical fixed scenario shocks', () => {
  const base = check(input());
  for (const name of [' tpe:00631l ', '00631L.TW', 'TWSE:00631L']) {
    assert.deepEqual(check(input({positions:[position({name})]})).stressTests,base.stressTests);
  }
  const merged=check(input({positions:[position(), position({account:'WL',name:'TPE:00631L'})]}));
  assert.match(domain(merged,'集中度').value,/100.0%/);
  assert.equal(merged.stressTests[0].estimatedLoss,1900);
});
test('stress tooltip receives scenario findings and interpretation, not an empty default', async () => {
  const source=await readFile(new URL('../pages-src/App.tsx',import.meta.url),'utf8');
  assert.match(source,/label=\{test.scenario\}[\s\S]{0,200}findings=\{test.findings\}/);
  assert.match(source,/interpretation=\{test.interpretation\}/);
  assert.match(source,/result.dataNotes.map/);
});
test('all five scenario amounts are unchanged for valid inputs and have matching warnings', () => {
  const result=check(input({accounts:[account({cash:100})]}));
  assert.deepEqual(result.stressTests.map(s=>s.estimatedLoss),[950,850,459,534,517]);
  for (const scenario of result.stressTests) {
    assert.ok(scenario.findings.some(f=>f.title.includes('回撤')));
    assert.equal(scenario.interpretation,scenario.findings[0].impact);
  }
});
test('scenario warnings use strict 30/50 boundaries before display rounding', () => {
  // 2000 loss = 950. Set net assets around the exact boundary.
  for (const [ratio,severity] of [[30,null],[30.001,'中'],[50,'中'],[50.001,'高']]) {
    const result=check(input({accounts:[account({cash:950/(ratio/100)-1000})]}));
    const warning=result.stressTests[0].findings.find(f=>f.title.includes('回撤'));
    assert.equal(warning?.severity ?? null,severity);
  }
});
test('maintenance and drawdown warnings both survive; boundary 180 is not triggered', () => {
  // Market value after the 2000 shock: 1000*(1-.662)=338.
  for (const [loan,expected] of [[338/1.8,false],[200,true]]) {
    const result=check(input({accounts:[account({cash:1000,marginLoan:loan})],positions:[position({name:'STOCK',leverage:1})]}));
    assert.equal(result.stressTests[0].findings.some(f=>f.title.includes('維持率')),expected);
  }
  const both=check(input({accounts:[account({cash:100,marginLoan:100})]})).stressTests[0];
  assert.ok(both.findings.some(f=>f.title.includes('維持率')));
  assert.ok(both.findings.some(f=>f.title.includes('回撤')));
});
test('zero or negative stressed equity returns null leverage, not fictional 99x', () => {
  const result=check(input({accounts:[account({cash:0,debt:100})]}));
  const stress=result.stressTests[0];
  assert.equal(stress.netAssetsAfter,-50);
  assert.equal(stress.exposureMultipleAfter,null);
  assert.equal(stress.findings[0].severity,'高');
  assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
  const negative=check(input({accounts:[account({cash:0,debt:1500})]}));
  assert.equal(negative.stressTests[0].drawdownPct,null);
  assert.match(domain(negative,'壓力承受能力').value,/不適用/);
});
test('zero and negative historical equity count towards real drawdown', () => {
  const result=check(input({history:[{month:'2026-01',netAssets:100},{month:'2026-02',netAssets:0},{month:'2026-03',netAssets:-10}]}));
  const history=result.metrics.find(m=>m.label==='歷史淨資產變動');
  assert.match(history.explanation,/110.0%/);
  assert.equal(history.value,'-110.0%');
  assert.equal(domain(result,'壓力承受能力').status,'警戒');
  const noBase=check(input({history:[{month:'2026-01',netAssets:0},{month:'2026-02',netAssets:100}]}));
  assert.equal(noBase.metrics.find(m=>m.label==='歷史淨資產變動').value,'資料不足');
});
test('top three badge and findings use same 75/90 thresholds', () => {
  for(const [weights,severity] of [[[25,25,25,25],null],[[26,26,26,22],'中'],[[31,31,31,7],'高']]){
    const result=check(input({positions:diversified(weights)}));
    const found=domain(result,'集中度').findings.find(f=>f.title.includes('前三大'));
    assert.equal(found?.severity??null,severity);
  }
});
test('illiquid assets, current ratio and cash coverage warnings are no longer missing', () => {
  const carHeavy=check(input({accounts:[account({cash:0,car:3000})]}));
  assert.ok(domain(carHeavy,'資產結構').findings.some(f=>f.title.includes('低流動性')));
  const illiquid=check(input({accounts:[account({cash:0,realEstate:5000,debt:1200})]}));
  assert.ok(domain(illiquid,'流動性與負債').findings.some(f=>f.title.includes('流動比率')&&f.severity==='高'));
  assert.ok(domain(illiquid,'流動性與負債').findings.some(f=>f.title.includes('現金')&&f.severity==='高'));
});
test('badge severity equals worst finding for many synthetic portfolios; no hidden warning truncation', () => {
  for (const cash of [0,100,1000,10000]) for (const debt of [0,500,5000]) {
    const result=check(input({accounts:[account({cash,debt,realEstate:2000})]}));
    for(const d of result.domains){
      const expected=d.findings.some(f=>f.severity==='高')?'警戒':d.findings.some(f=>f.severity==='中')?'留意':'良好';
      assert.equal(d.status,expected,JSON.stringify({cash,debt,label:d.label}));
    }
  }
});
test('analysis never mutates caller accounts, holdings or history', () => {
  const source=input(); const before=structuredClone(source);
  check(source); assert.deepEqual(source,before);
});
