import { buildDeterministicHealthCheck } from '../lib/health-check';

export const DRAFT_KEY = 'smwl-simulator-v1-draft';
export const SAVED_KEY = 'smwl-simulator-v1-saved';
export const BASELINE_KEY = 'smwl-simulator-v1-baseline';
export const backupKey = () => DRAFT_KEY;
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const numeric = (v: unknown) => {
  if ((typeof v !== 'string' && typeof v !== 'number') || !Number.isFinite(Number(v))) throw new Error('匯入資料含無效金額或數量。');
  return String(v);
};
export function validateSnapshot(value: unknown) {
  if (!record(value)) throw new Error('不是有效的模擬資料檔。');
  const account = (v: unknown) => {
    if (!record(v)) throw new Error('缺少 SM 或 WL 帳戶。');
    const positions = (rows: unknown) => {
      if (!Array.isArray(rows) || rows.length > 500) throw new Error('持倉格式不正確。');
      return rows.map((r, i) => {
        if (!record(r) || typeof r.name !== 'string') throw new Error('持倉名稱不正確。');
        return {id:`sim-${i}-${Math.random().toString(36).slice(2)}`,name:r.name.slice(0,100),
          price:numeric(r.price),shares:numeric(r.shares),addPrice:numeric(r.addPrice),addShares:numeric(r.addShares),leverage:numeric(r.leverage)};
      });
    };
    return {cash:numeric(v.cash),tw:positions(v.tw),foreign:positions(v.foreign),
      realEstate:numeric(v.realEstate),car:numeric(v.car),marginLoan:numeric(v.marginLoan),debt:numeric(v.debt),
      mortgage:numeric(v.mortgage),foreignDebt:numeric(v.foreignDebt),foreignMarginLoan:numeric(v.foreignMarginLoan)};
  };
  if (!Array.isArray(value.history) || value.history.length > 1200) throw new Error('月份資料格式不正確。');
  const months = new Set<string>();
  const history = value.history.map(r => {
    if (!record(r) || typeof r.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month) || months.has(r.month) || typeof r.netAssets !== 'number' || !Number.isFinite(r.netAssets)) throw new Error('月份重複或淨資產格式不正確。');
    months.add(r.month);
    const ratio = (v:unknown) => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    return {month:r.month,date:typeof r.date === 'string'?r.date:`${r.month}-01`,netAssets:r.netAssets,
      leverageWithProperty:ratio(r.leverageWithProperty),leverageWithoutProperty:ratio(r.leverageWithoutProperty)};
  });
  return {sm:account(value.sm),wl:account(value.wl),history};
}
export function readProductionCopy(storage: Pick<Storage,'getItem'>) {
  const settings = JSON.parse(storage.getItem('smwl-pages-google-settings') || 'null');
  if (!settings || typeof settings.spreadsheetId !== 'string') throw new Error('此瀏覽器沒有正式版的本機副本。可直接手動輸入，或在有副本的瀏覽器匯出模擬檔後匯入。');
  const raw=storage.getItem(`smwl-pages-assets-backup:${settings.spreadsheetId}`);
  if (!raw) throw new Error('尚無正式版資產副本，未連線 Google。請手動輸入模擬資料。');
  const baseline=Number(settings.baseline);
  if (!Number.isFinite(baseline) || baseline<=0) throw new Error('正式版基準值不完整。');
  return { ...validateSnapshot(JSON.parse(raw)), baseline };
}
export async function pagesFetch(input: string, options: RequestInit = {}): Promise<Response> {
  try {
    const url = new URL(input, 'https://simulator.invalid');
    if (url.pathname === '/api/health-check') return Response.json({analysis:buildDeterministicHealthCheck(JSON.parse(String(options.body)))});
    if (url.pathname !== '/api/cloud' || url.search) throw new Error('模擬版不連接雲端或更新報價。');
    if (options.method === 'POST') {
      const data=JSON.parse(String(options.body));
      if (!record(data.sm) || !record(data.wl)) throw new Error('模擬資料不完整。');
      localStorage.setItem(SAVED_KEY, JSON.stringify(data));
      return Response.json({status:'success'});
    }
    const raw=localStorage.getItem(SAVED_KEY);
    if (!raw) throw new Error('尚無儲存的模擬快照。');
    return Response.json({...JSON.parse(raw),status:'success'});
  } catch (e) {
    return Response.json({status:'error',message:e instanceof Error?e.message:'本機儲存失敗。'},{status:400});
  }
}
