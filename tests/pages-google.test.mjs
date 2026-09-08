import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const health = dataUrl(transpile(await readFile(new URL('../lib/health-check.ts', import.meta.url), 'utf8')));
const source = (await readFile(new URL('../pages-src/google-sheets.ts', import.meta.url), 'utf8')).replace("'../lib/health-check'", JSON.stringify(health));
const api = await import(dataUrl(transpile(source)));

test('reload restores only an unexpired session for the same database; rejected tokens are removed', async () => {
  const storage = new Map();
  globalThis.sessionStorage = { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.window = { google: { accounts: { oauth2: { initTokenClient: options => ({ requestAccessToken: () => options.callback({access_token:'session-test-token',expires_in:3600}) }) } } } };
  api.configureGoogle({clientId:'test.apps.googleusercontent.com',spreadsheetId:'session_sheet_1234567890',baseline:100});
  await api.connectGoogle();
  assert.equal(api.restoreGoogleSession(), true);
  const key = 'smwl-pages-google-session';
  const saved = JSON.parse(storage.get(key));
  storage.set(key,JSON.stringify({...saved,expiresAt:Date.now()-1}));
  assert.equal(api.restoreGoogleSession(),false);
  assert.equal(storage.has(key),false);
  storage.set(key,JSON.stringify({...saved,spreadsheetId:'another_sheet_1234567890'}));
  assert.equal(api.restoreGoogleSession(),false);
  storage.set(key,JSON.stringify(saved));
  assert.equal(api.restoreGoogleSession(),true);
  globalThis.fetch=async()=>new Response('',{status:401});
  assert.equal((await api.pagesFetch('/api/cloud')).status,503);
  assert.equal(storage.has(key),false);
});

test('invalid cache never supplies zero or fabricated prices', () => {
  const rows = [['TPE:2330', 'formula', 100, '2026-09-08T01:00:00Z'], ['TPE:0056', '', '#N/A', '']];
  const quotes = api.parseQuotes(rows, ['TPE:2330', 'TPE:0056', 'MISSING'], Date.parse('2026-09-08T01:05:00Z'));
  assert.equal(quotes[0].price, 100);
  assert.equal(quotes[0].stale, false);
  assert.equal(quotes[1].status, 'error');
  assert.equal(quotes[2].price, undefined);
  assert.equal(api.parseQuotes(rows, ['TPE:2330'], Date.parse('2026-09-09T00:00:00Z'))[0].stale, true);
});
test('account parsing rejects empty and swapped rows', () => {
  assert.throws(() => api.parseAccounts([['WL', '{}'], ['SM', '{}']]));
  assert.throws(() => api.parseAccounts([['SM', '{}'], ['WL', '{}']]));
});
test('read retries transient failures; conflicting save does not write; token stays in memory', async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) };
  globalThis.window = { google: { accounts: { oauth2: { initTokenClient: options => ({ requestAccessToken: () => options.callback({ access_token: 'test-token', expires_in: 3600 }) }) } } } };
  api.configureGoogle({ clientId: 'test.apps.googleusercontent.com', spreadsheetId: 'synthetic_sheet_1234567890', baseline: 100 });
  await api.connectGoogle();
  assert.ok(!JSON.stringify([...storage]).includes('test-token'));
  const rows = [['SM', '{"cash":"1"}', 'v1'], ['WL', '{"cash":"2"}', 'v1']];
  let reads = 0;
  globalThis.fetch = async () => ++reads === 1 ? new Response('', { status: 503 }) : Response.json({ values: rows });
  assert.equal((await api.loadAccounts()).sm.cash, '1');
  assert.equal(reads, 2);
  let writes = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'PUT') writes++;
    return Response.json({ values: [['SM', '{"cash":"3"}', 'v2'], rows[1]] });
  };
  const result = await api.pagesFetch('/api/cloud', { method: 'POST', body: JSON.stringify({ sm: { cash: '4' }, wl: { cash: '2' } }) });
  assert.equal(result.status, 503);
  assert.equal(writes, 0);
});
