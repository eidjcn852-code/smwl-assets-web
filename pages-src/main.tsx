import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import Home from "./App";
import { connectGoogle, configureGoogle, readSettings, loadAccounts, onGoogleError, restoreGoogleSession } from "./google-sheets";
import { bindingFromHash, GOOGLE_CLIENT_ID } from "./binding";
import "../app/globals.css";

function initialConnection() {
  try {
    const incoming = bindingFromHash(window.location.hash);
    return { settings: incoming || { ...readSettings(), clientId: GOOGLE_CLIENT_ID }, incoming: Boolean(incoming), error: "" };
  } catch (e) {
    return { settings: { ...readSettings(), clientId: GOOGLE_CLIENT_ID }, incoming: false, error: e instanceof Error ? e.message : "連線網址無效。" };
  }
}
function Main() {
  const [connection] = useState(initialConnection);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(connection.error);
  const settings = connection.settings;
  const configured = Boolean(settings.spreadsheetId && settings.baseline > 0 && !connection.error);
  useEffect(() => {
    onGoogleError(setMessage);
    if (window.location.hash.startsWith("#bind=")) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!configured) return;
    let cancelled = false;
    try {
      configureGoogle(settings);
      if (restoreGoogleSession()) {
        setBusy(true);
        setMessage("正在恢復 Google 連線…");
        loadAccounts().then(() => {
          if (!cancelled) { setReady(true); setMessage(""); }
        }).catch(e => {
          if (!cancelled) setMessage(e instanceof Error ? e.message : "請重新連接 Google。");
        }).finally(() => { if (!cancelled) setBusy(false); });
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : "連線設定無效。"); }
    return () => { cancelled = true; };
  }, []);
  async function connect() {
    setBusy(true);
    setMessage("");
    try {
      configureGoogle(settings);
      await connectGoogle();
      if (!ready) await loadAccounts();
      setReady(true);
      setMessage("");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Google 連接失敗，請重試。"); }
    finally { setBusy(false); }
  }
  return <>
    {!ready && <section className="mx-auto mt-12 w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:mt-20 sm:p-8">
      {!ready && <>
        <h1 className="text-2xl font-bold text-slate-800">SM 與 WL 資產總覽</h1>
        <p className="mt-3 mb-5 text-base leading-7 text-slate-600">{configured ? "登入有權限的 Google 帳號，即可查看資產、更新報價與儲存。" : "此瀏覽器尚未綁定。首次請開啟提供給你的專屬連線網址，不需要填寫技術設定。"}</p>
      </>}
      <div className="flex flex-wrap items-center gap-3">
        {configured && <button onClick={connect} disabled={busy} className="rounded-xl bg-slate-800 px-5 py-3 text-base font-medium text-white disabled:opacity-60">{busy ? "Google 連接中…" : ready ? "重新連接 Google" : connection.incoming ? "綁定並使用 Google 登入" : "使用 Google 登入"}</button>}
        {message && <span role="status" className="text-sm leading-6">{message}</span>}
      </div>
      {!ready && <p className="mt-5 text-sm leading-6 text-slate-500">資產保留在私人 Google 試算表，不會公開在 GitHub。專屬網址含私人設定，請勿轉傳；綁定後此瀏覽器會記住設定。</p>}
    </section>}
    {ready && <Home baseline={settings.baseline} reconnectGoogle={connect} googleBusy={busy} googleMessage={message} />}
  </>;
}
createRoot(document.getElementById("root")!).render(<Main />);
