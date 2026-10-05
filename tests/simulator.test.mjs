import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const read = p => readFile(new URL(p,import.meta.url),'utf8');
const url = s => 'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
const health=url(await read('../lib/health-check.ts'));
const source=await read('../pages-src/simulation-store.ts');
const api=await import(url(source.replace("'../lib/health-check'",JSON.stringify(health))));
const account=()=>({cash:'1000',tw:[{id:'test',name:'TEST',price:'10',shares:'20',addPrice:'0',addShares:'0',leverage:'1'}],foreign:[],realEstate:'0',car:'0',marginLoan:'0',debt:'0',mortgage:'0',foreignDebt:'0',foreignMarginLoan:'0'});
const snapshot=()=>({sm:account(),wl:account(),history:[{month:'2026-09',netAssets:2400}]});

test('simulation imports validate amounts/months and discard unrelated settings',()=>{
  const raw={...snapshot(),access_token:'not-real',clientId:'not-real'};
  const clean=api.validateSnapshot(raw);
  assert.equal(clean.sm.cash,'1000');
  assert.equal('access_token' in clean,false);
  assert.equal('clientId' in clean,false);
  assert.throws(()=>api.validateSnapshot({...raw,history:[...raw.history,...raw.history]}));
  assert.throws(()=>api.validateSnapshot({...raw,sm:{...raw.sm,cash:'NaN'}}));
});
test('older regional debt fields merge without changing total liabilities',()=>{
  const raw=snapshot();
  raw.sm={...raw.sm,marginLoan:'120',foreignMarginLoan:'30',debt:'40',foreignDebt:'60',mortgage:'500'};
  const clean=api.validateSnapshot(raw);
  assert.deepEqual([clean.sm.marginLoan,clean.sm.debt,clean.sm.mortgage,clean.sm.foreignMarginLoan,clean.sm.foreignDebt],
    ['150','100','500','0','0']);
  assert.equal(Number(clean.sm.marginLoan)+Number(clean.sm.debt)+Number(clean.sm.mortgage),750);
});
test('explicit production copy is read-only and strips connection details',()=>{
  const values=new Map([['smwl-pages-google-settings',JSON.stringify({spreadsheetId:'synthetic',baseline:1000,clientId:'not-real'})],['smwl-pages-assets-backup:synthetic',JSON.stringify(snapshot())]]);
  const before=JSON.stringify([...values]);
  const result=api.readProductionCopy({getItem:k=>values.get(k)});
  assert.equal(result.baseline,1000);
  assert.equal(result.sm.tw[0].shares,'20');
  assert.equal('spreadsheetId' in result,false);
  assert.equal(JSON.stringify([...values]),before);
});
test('local save/load and health check never use network or formal storage',async()=>{
  const data=new Map([['formal-protected','untouched']]);
  globalThis.localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
  globalThis.fetch=()=>{throw new Error('Network must not be called');};
  assert.equal((await api.pagesFetch('/api/cloud')).status,400);
  const body={sm:{cash:1000},wl:{cash:1000}};
  assert.equal((await api.pagesFetch('/api/cloud',{method:'POST',body:JSON.stringify(body)})).status,200);
  assert.equal((await (await api.pagesFetch('/api/cloud')).json()).sm.cash,1000);
  assert.equal((await api.pagesFetch('/api/cloud?symbol=TEST')).status,400);
  assert.equal((await api.pagesFetch('/api/quote')).status,400);
  assert.equal((await api.pagesFetch('/api/health-check',{method:'POST',body:JSON.stringify({accounts:[],positions:[],history:[]})})).status,200);
  assert.equal(data.get('formal-protected'),'untouched');
  assert.deepEqual([...data.keys()].sort(),['formal-protected',api.SAVED_KEY].sort());
});
test('simulator entry has no authentication or quote wiring',async()=>{
  const html=await read('../pages-src/simulator/index.html');
  const app=await read('../pages-src/SimulatorApp.tsx');
  assert.doesNotMatch(html,/accounts\.google|gsi\/client/);
  assert.doesNotMatch(app,/google-sheets|updateAllQuotes|updateOneQuote|reconnectGoogle|requestAccessToken/);
  assert.match(app,/資產風險健檢/);
  assert.match(app,/TrendChart/);
  assert.match(app,/monthlyLeverage/);
  assert.match(app,/simulation-store/);
});

test('simulator health route applies its own 00865B exposure rule',async()=>{
  const payload={accounts:[{name:'SM',cash:1000,realEstate:0,car:0,marginLoan:0,debt:0,mortgage:0,foreignDebt:0,foreignMarginLoan:0}],
    positions:[{account:'SM',market:'tw',name:'00865B',price:10,shares:10,plannedPrice:0,plannedShares:0,leverage:1}],history:[]};
  const result=await (await api.pagesFetch('/api/health-check',{method:'POST',body:JSON.stringify(payload)})).json();
  assert.equal(result.analysis.domains.find(d=>d.label==='槓桿與質押').value,'0.00 倍');
  assert.equal(result.analysis.metrics.find(m=>m.label==='目前總資產').value,'$1,100');
});
