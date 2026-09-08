// OAuth client IDs are public. Never put a client secret here.
export const GOOGLE_CLIENT_ID = '498889145173-n24ok1cte26phqc374pq8btgdfs7d28q.apps.googleusercontent.com';
export function bindingFromHash(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('bind')) return null;
  try {
    const value = JSON.parse(atob(params.get('bind') || ''));
    if (value.v !== 1 || typeof value.s !== 'string' || !/^[\w-]{20,}$/.test(value.s) ||
        typeof value.b !== 'number' || !Number.isFinite(value.b) || value.b <= 0) throw new Error();
    return { clientId: GOOGLE_CLIENT_ID, spreadsheetId: value.s, baseline: value.b };
  } catch { throw new Error('連線網址不完整，請重新開啟完整的專屬連線網址。'); }
}
