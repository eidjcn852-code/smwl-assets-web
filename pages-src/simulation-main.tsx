import {useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import SimulatorApp from './SimulatorApp';
import {BASELINE_KEY,DRAFT_KEY,SAVED_KEY,validateSnapshot,readProductionCopy} from './simulation-store';
import '../app/globals.css';

function Main() {
  const [baseline,setBaseline]=useState(()=>{try {return localStorage.getItem(BASELINE_KEY)||'';} catch{return '';}});
  const [revision,setRevision]=useState(0);
  const [message,setMessage]=useState('');
  const file=useRef<HTMLInputElement>(null);
  const apply = (raw:unknown, nextBaseline:number) => {
    const snapshot=validateSnapshot(raw);
    if (!Number.isFinite(nextBaseline) || nextBaseline<=0) throw new Error('年初淨資產基準值須大於 0。');
    if (localStorage.getItem(DRAFT_KEY) && !window.confirm('要以匯入資料取代目前模擬草稿嗎？正式版與試算表不會更動。')) return;
    localStorage.setItem(DRAFT_KEY,JSON.stringify(snapshot));
    localStorage.setItem(BASELINE_KEY,String(nextBaseline));
    localStorage.removeItem(SAVED_KEY); // Do not allow a different scenario's old save to replace the import.
    setBaseline(String(nextBaseline)); setRevision(r=>r+1); setMessage('已載入獨立模擬副本；未連線 Google，也未更動正式資料。');
  };
  const exportFile=()=>{
    try {
      const snapshot=validateSnapshot(JSON.parse(localStorage.getItem(DRAFT_KEY)||'null'));
      if (!(Number(baseline)>0)) throw new Error('請先設定年初淨資產基準值。');
      const blob=new Blob([JSON.stringify({schema:'smwl-simulation-v1',baseline:Number(baseline),...snapshot},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;
      a.download=`smwl-simulation-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
      setMessage('已匯出模擬檔，檔案包含你的資產數字，請自行妥善保管。');
    } catch(e){setMessage(e instanceof Error?e.message:'匯出失敗');}
  };
  return <>
    <section className="mx-auto mt-4 max-w-[1400px] rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-slate-700">
      <p className="font-bold text-indigo-800">獨立模擬版｜手動報價・不需 Google 登入・不寫入正式資料</p>
      <p className="mt-1">草稿自動保留於此瀏覽器，清除瀏覽資料或換裝置不會同步，請匯出備份。首次可手動輸入，或複製同一瀏覽器已保存的正式版副本。</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label>年初淨資產基準值 <input aria-label="年初淨資產基準值" type="number" min="0" value={baseline} placeholder="自行設定" className="rounded border p-2" onChange={e=>{setBaseline(e.target.value);try{localStorage.setItem(BASELINE_KEY,e.target.value);}catch{setMessage('瀏覽器拒絕儲存，請匯出備份。');}}}/></label>
        <button className="action-button bg-white" onClick={()=>{try{const copy=readProductionCopy(localStorage); apply(copy,copy.baseline);}catch(e){setMessage(e instanceof Error?e.message:'無法複製');}}}>複製本機正式版資料</button>
        <button className="action-button bg-white" onClick={exportFile}>匯出模擬檔</button>
        <button className="action-button bg-white" onClick={()=>file.current?.click()}>匯入模擬檔</button>
        <input ref={file} type="file" accept=".json,application/json" className="hidden" aria-label="匯入模擬檔案" onChange={async e=>{const selected=e.target.files?.[0];e.target.value='';if(!selected)return;try{if(selected.size>2_000_000)throw new Error('檔案過大。');const raw=JSON.parse(await selected.text());apply(raw,Number(raw.baseline));}catch(err){setMessage(err instanceof Error?err.message:'匯入失敗');}}}/>
      </div>
      {message&&<p role="status" className="mt-2">{message}</p>}
    </section>
    <SimulatorApp key={revision} baseline={Number(baseline)>0?Number(baseline):0}/>
  </>;
}
createRoot(document.getElementById('root')!).render(<Main/>);
