# GitHub Pages 版本

主要介面：`pages-src/App.tsx`；Google 連接：`pages-src/google-sheets.ts`。
公開庫只包含網站程式與樣式，不含舊庫歷史或私人資產。

## 發布

儲存庫 Settings → Pages → Source 選擇 **GitHub Actions**。
推送 main 後，`.github/workflows/pages.yml` 測試、建置並發布 `dist-pages`。
網址： https://eidjcn852-code.github.io/smwl-assets-web/

## 一次性 Google 設定

沿用私人試算表與原 Apps Script 五分鐘報價快取；不需公開試算表。
在 Google Cloud 啟用 Google Sheets API，使用 Web application OAuth Client ID，
Authorized JavaScript origins 加入 `https://eidjcn852-code.github.io`。
OAuth 同意畫面若在 Testing 狀態，將實際使用帳號加入 test users。
Google 授權範圍為 spreadsheets，可存取帳號有權限的試算表；此程式只對使用者設定的 ID 發送請求。
網站設定輸入 Client ID、原有試算表 ID、年初淨資產基準值，再按「連接 Google」。
Client ID 不是密鑰。請勿輸入 Client secret、API_SECRET 或 Google 密碼到網站設定。

資料格式：`資產資料!A2:C3`，SM／WL、JSON、更新時間；
`報價暫存!A2:D`，股票代碼、公式、上次有效價格、快取時間。
日期序號按 Asia/Taipei 解讀；請維持原試算表的台灣時區。

## 可靠性與資料保護

- 網站不內建私人資產，資料留在 Google；存取權杖僅保存在記憶體。
- 本機保存試算表設定與分試算表的資產備份，請使用自己的裝置。
- 讀取遇網路或 Google 429／5xx 最多嘗試三次；寫入不盲目重試。
- 過期快取有警示；缺失價格保留原價，不假裝取得最新行情。
- 儲存前比對雲端版本，儲存後讀回確認。Sheets 並非交易型資料庫，請避免兩台裝置同時儲存。
- Google 授權過期時需按「重新連接 Google」，不會清除正在編輯的內容。
- 9月起儲存每月含房／不含房槓桿；1～8月不補造缺失資料。
- 本地測試不能代替實際 Google 授權、手機及電腦端驗證。

不需要 Cloudflare、ChatGPT 網址或付費網域；免費服務仍受供應商配額及可用性限制。

## 本機驗證

```sh
pnpm install --frozen-lockfile
pnpm test:pages
pnpm build:pages
```
