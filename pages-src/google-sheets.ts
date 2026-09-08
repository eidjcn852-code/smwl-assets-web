import { buildDeterministicHealthCheck } from '../lib/health-check';

type Settings = { clientId: string; spreadsheetId: string; baseline: number };
const SETTINGS_KEY = 'smwl-pages-google-settings';
let settings: Settings = { clientId: '', spreadsheetId: '', baseline: 0 };
let token = '';
let expiresAt = 0;
let loadedRevision: string | null = null;
let errorListener: ((message: string) => void) | undefined;
export const onGoogleError = (listener: (message: string) => void) => { errorListener = listener; };
export function readSettings(): Settings {
  try { return { ...settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...settings }; }
}
export function configureGoogle(input: Settings) {
  const id = input.spreadsheetId.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] || input.spreadsheetId.trim();
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(input.clientId.trim())) throw new Error('請填入有效的 Google OAuth Client ID（不是 API 密鑰）。');
  if (!/^[\w-]{20,}$/.test(id)) throw new Error('請填入有效的試算表網址或 ID。');
  if (!Number.isFinite(input.baseline) || input.baseline <= 0) throw new Error('請填入原有年初淨資產基準值，才能正確計算 YTD。');
  if (settings.spreadsheetId !== id || settings.clientId !== input.clientId.trim()) { token = ''; expiresAt = 0; loadedRevision = null; }
  settings = { ...input, clientId: input.clientId.trim(), spreadsheetId: id };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
export function backupKey() { return `smwl-pages-assets-backup:${settings.spreadsheetId}`; }
export function connectGoogle(): Promise<void> {
  const google = (window as unknown as { google?: { accounts: { oauth2: { initTokenClient: (options: Record<string, unknown>) => { requestAccessToken: (options: Record<string, unknown>) => void } } } } }).google;
  if (!google) return Promise.reject(new Error('Google 登入服務尚未載入，請稍後再按連接。'));
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: settings.clientId,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      callback: (response: { access_token?: string; expires_in?: number; error?: string }) => {
        if (response.error || !response.access_token) { reject(new Error('Google 授權未完成。')); return; }
        token = response.access_token;
        expiresAt = Date.now() + Math.max(0, Number(response.expires_in || 3600) - 60) * 1000;
        resolve();
      },
      error_callback: () => reject(new Error('Google 登入視窗未完成，請再按「連接 Google」。')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function sheets(path: string, options: RequestInit = {}, signal?: AbortSignal) {
  if (!token || Date.now() >= expiresAt) throw new Error('Google 授權已到期，請按上方「重新連接 Google」；目前資料不會被清除。');
  let response!: Response;
  const attempts = !options.method || options.method === 'GET' ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const timeout = AbortSignal.timeout(15000);
      response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(settings.spreadsheetId)}/${path}`, {
        ...options, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { ...options.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      if (signal?.aborted || attempt === attempts - 1) throw error;
    }
    if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
  }
  if (response.status === 401) { token = ''; throw new Error('Google 授權已到期，請重新連接 Google。'); }
  if (response.status === 403) throw new Error('目前 Google 帳號沒有試算表權限，或尚未啟用 Google Sheets API。');
  if (response.status === 429) throw new Error('Google 暫時限制讀取頻率，請稍後重試；原資料已保留。');
  if (!response.ok) throw new Error(`Google 試算表操作失敗（${response.status}）；原資料已保留。`);
  return response.json();
}
const rangePath = (range: string) => `values/${encodeURIComponent(range)}`;
export function parseAccounts(rows: unknown[][]) {
  if (rows?.[0]?.[0] !== 'SM' || rows?.[1]?.[0] !== 'WL') throw new Error('試算表帳戶列不是 SM／WL，已停止操作以免寫錯資料。');
  const parse = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('試算表資產資料為空，不會用零值覆蓋。');
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.keys(parsed).length) throw new Error('試算表資料不完整。');
    return parsed as Record<string, unknown>;
  };
  return { status: 'success', sm: parse(rows[0][1]), wl: parse(rows[1][1]), revision: JSON.stringify(rows) };
}
export async function loadAccounts(signal?: AbortSignal) {
  const result = await sheets(rangePath("'資產資料'!A2:C3"), {}, signal);
  const data = parseAccounts(result.values);
  loadedRevision = data.revision;
  return data;
}
export function quoteTimestamp(value: unknown): string | null {
  const ms = typeof value === 'number' ? Date.UTC(1899, 11, 30) + value * 86400000 - 8 * 3600000 : Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
export function parseQuotes(rows: unknown[][], tickers: string[], now = Date.now()) {
  return tickers.map(ticker => {
    const row = rows.find(row => row[0] === ticker);
    const price = row?.[2];
    const quotedAt = quoteTimestamp(row?.[3]);
    return typeof price === 'number' && Number.isFinite(price) && price > 0
      ? { ticker, status: 'success', price, quotedAt, stale: !quotedAt || now - Date.parse(quotedAt) > 20 * 60000 }
      : { ticker, status: 'error', message: '背景報價尚無有效價格，保留原價。' };
  });
}
async function readQuotes(tickers: string[], signal?: AbortSignal) {
  const data = await sheets(rangePath("'報價暫存'!A2:D1000") + '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER', {}, signal);
  const results = parseQuotes(data.values || [], tickers);
  const times = results.flatMap(item => item.quotedAt ? [item.quotedAt] : []).sort();
  return { status: 'success', results, quotedAt: times[0] || null };
}
async function saveAccounts(payload: { sm: Record<string, unknown>; wl: Record<string, unknown>; updatedAt?: string }, signal?: AbortSignal) {
  if (loadedRevision === null) throw new Error('請先成功讀取雲端資料，再儲存。');
  const current = await sheets(rangePath("'資產資料'!A2:C3"), {}, signal);
  if (parseAccounts(current.values).revision !== loadedRevision) throw new Error('雲端資料已被其他裝置更新，尚未覆蓋；請先重新讀取並確認。');
  if (!payload.sm || !payload.wl) throw new Error('缺少帳戶資料。');
  const updatedAt = payload.updatedAt || new Date().toISOString();
  const values = [['SM', JSON.stringify(payload.sm), updatedAt], ['WL', JSON.stringify(payload.wl), updatedAt]];
  if (values.some(row => row[1].length > 49000)) throw new Error('資料超過試算表儲存格容量，已停止寫入。');
  await sheets(rangePath("'資產資料'!A2:C3") + '?valueInputOption=RAW', { method: 'PUT', body: JSON.stringify({ range: "'資產資料'!A2:C3", majorDimension: 'ROWS', values }) }, signal);
  const confirmation = await sheets(rangePath("'資產資料'!A2:C3"), {}, signal);
  if (JSON.stringify(confirmation.values) !== JSON.stringify(values)) throw new Error('儲存結果尚未確認，請重新讀取核對，避免重複覆寫。');
  loadedRevision = JSON.stringify(values);
  return { status: 'success', updatedAt };
}
export async function pagesFetch(input: string, options: RequestInit = {}): Promise<Response> {
  try {
    const url = new URL(input, 'https://local.invalid');
    if (url.pathname === '/api/health-check') {
      return Response.json({ mode: 'deterministic', analysis: buildDeterministicHealthCheck(JSON.parse(String(options.body))) });
    }
    if (url.pathname !== '/api/cloud') throw new Error('不支援的資料路徑。');
    const signal = options.signal || undefined;
    if (options.method === 'POST') return Response.json(await saveAccounts(JSON.parse(String(options.body)), signal));
    if (url.searchParams.get('action') === 'quotes') return Response.json(await readQuotes(JSON.parse(url.searchParams.get('tickers') || '[]'), signal));
    if (url.searchParams.get('action') === 'quote') return Response.json((await readQuotes([url.searchParams.get('ticker') || ''], signal)).results[0]);
    return Response.json(await loadAccounts(signal));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google 連線失敗，已保留原資料。';
    errorListener?.(message);
    return Response.json({ status: 'error', message }, { status: 503 });
  }
}
