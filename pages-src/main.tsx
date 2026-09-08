import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import Home from "./App";
import { connectGoogle, configureGoogle, readSettings, loadAccounts, onGoogleError } from "./google-sheets";
import "../app/globals.css";

function Main() {
  const [settings, setSettings] = useState(readSettings);
  const [ready, setReady] = useState(false);
  const [activeBaseline, setActiveBaseline] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { onGoogleError(setMessage); }, []);
  const [message, setMessage] = useState("請連接 Google；私人資產不會放在 GitHub 網頁內。");
  const [expanded, setExpanded] = useState(!settings.clientId || !settings.spreadsheetId || !settings.baseline);
  async function connect() {
    setBusy(true);
    try {
      configureGoogle(settings);
      await connectGoogle();
      if (!ready) await loadAccounts();
      setReady(true);
      setActiveBaseline(settings.baseline);
      setExpanded(false);
      setMessage("Google 已連接。此網站只操作你設定的試算表；報價使用背景快取。");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Google 連接失敗"); }
    finally { setBusy(false); }
  }
  return <>
    <section className="m-3 rounded-xl border border-slate-200 bg-white p-4 text-sm sm:mx-6">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={connect} disabled={busy} className="rounded-lg bg-slate-800 px-4 py-2 text-white">{busy ? "連接中…" : ready ? "重新連接 Google" : "連接 Google"}</button>
        <button disabled={ready} onClick={() => setExpanded(!expanded)} className="text-slate-600 disabled:hidden">連線設定</button>
        <span role="status">{message}</span>
      </div>
      {expanded && <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label>Google OAuth Client ID<input className="mt-1 w-full rounded border p-2" value={settings.clientId} onChange={e=>setSettings({...settings,clientId:e.target.value})} placeholder="…apps.googleusercontent.com" /></label>
        <label>私人試算表 ID 或網址<input className="mt-1 w-full rounded border p-2" value={settings.spreadsheetId} onChange={e=>setSettings({...settings,spreadsheetId:e.target.value})} /></label>
        <label>年初淨資產基準值<input type="number" min="1" className="mt-1 w-full rounded border p-2" value={settings.baseline || ""} onChange={e=>setSettings({...settings,baseline:Number(e.target.value)})} /></label>
      </div>}
    </section>
    {ready && <Home baseline={activeBaseline} />}
  </>;
}
createRoot(document.getElementById("root")!).render(<Main />);
