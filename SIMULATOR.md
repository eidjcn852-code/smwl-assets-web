# Independent asset simulator

Entry: `/smwl-assets-web/simulator/`. The original `/smwl-assets-web/` entry is unchanged.

- Manual prices and editable accounts; charts, leverage, planned additions and deterministic health checks are retained.
- 00865B counts towards assets, net worth, concentration, collateral value and stress losses, but is omitted from current, planned and stress exposure numerators. Both account totals and health checks apply the simulator rule.
- Liabilities have one region-neutral section per account. Existing domestic and foreign pledge/general debt values merge on import and draft load without changing the total owed.
- No Google SDK, authentication, Sheets request or market-price request in the simulator entry.
- Draft, saved snapshot and baseline use separate `smwl-simulator-v1-*` localStorage keys. Browser storage is not encrypted and does not sync between devices.
- An explicit **複製本機正式版資料** action reads the existing browser backup only. It strips connection settings and does not write to the original backup or spreadsheet.
- Import/export JSON allows backup and transfer between browsers. Exported files contain financial numbers and should be kept private.
- No real user data is included in the deployed website. Start with blank accounts or copy your local original-app backup.

`SimulatorApp.tsx` is an intentionally separate UI copy to avoid changing the production app's authentication, state or quote workflow. Financial health and monthly leverage calculations are shared modules. Future UI fixes should consider both entries.

Validation: `pnpm test:pages` includes isolated storage, no-network, safe import, production-copy and shared financial regression tests. `pnpm build:pages` builds both entry points.
