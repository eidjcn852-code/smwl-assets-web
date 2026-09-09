import { pagesFetch, backupKey } from "./google-sheets";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  CircleGauge,
  Download,
  Globe,
  Info,
  LineChart,
  LoaderCircle,
  PieChart,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import {
  type HealthCheckInput,
  type HealthCheckResult,
} from "../lib/health-check";

let BASE_ASSET_2025 = 1;
import { monthlyLeverage, leverageText, type MonthlyLeverage } from "../lib/monthly-leverage";

type Position = {
  id: string;
  name: string;
  price: string;
  shares: string;
  addPrice: string;
  addShares: string;
  leverage: string;
};

type Account = {
  cash: string;
  tw: Position[];
  foreign: Position[];
  realEstate: string;
  car: string;
  marginLoan: string;
  debt: string;
  mortgage: string;
  foreignDebt: string;
  foreignMarginLoan: string;
};

type HistoryPoint = { month: string; date: string; netAssets: number } & MonthlyLeverage;
type SyncState = "idle" | "loading" | "saving" | "success" | "error";
type QuoteStatus = { type: "success" | "warning" | "error"; message: string } | null;

type Metrics = {
  totalAssets: number;
  liabilities: number;
  netAssets: number;
  exposure: number;
  leverage: string;
  twRatio: string;
  foreignRatio: string;
  marginCurrent: string;
  marginAfter: string;
  twHolding: number;
  foreignHolding: number;
  position: Record<
    string,
    { holding: number; add: number; holdingPct: string; addPct: string }
  >;
};

const emptyPosition = (): Position => ({
  id: `${Date.now()}-${Math.random()}`,
  name: "",
  price: "0",
  shares: "0",
  addPrice: "0",
  addShares: "0",
  leverage: "1",
});

const blankAccount = (): Account => ({
 cash: "0", tw: [], foreign: [], realEstate: "0", car: "0",
 marginLoan: "0", debt: "0", mortgage: "0", foreignDebt: "0", foreignMarginLoan: "0",
});
const fallbackSm = blankAccount();
const fallbackWl = blankAccount();
const fallbackHistory: HistoryPoint[] = [];

const money = (value: number) =>
  new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(value);

type ExplanationGuide = {
  description: string;
  formula: string;
  criteria: string;
};

const domainGuides: Record<string, ExplanationGuide> = {
  資產結構: {
    description:
      "衡量房地產與汽車等不易立即變現的資產，占家庭目前總資產的程度；預計加碼不計入。",
    formula:
      "低流動性資產占比＝（SM＋WL 房地產＋汽車）÷（現金＋證券市值＋房地產＋汽車）×100%。",
    criteria:
      "同時檢查房地產占比（>40% 留意、>60% 警戒）及低流動性資產占比（>50% 留意、>70% 警戒），採較嚴重結果。",
  },
  集中度: {
    description:
      "相同代號會跨 SM／WL 合併，再同時檢查單一標的、前三大標的與台灣／海外市場集中程度。",
    formula:
      "單一標的占比＝最大標的市值÷全部證券市值；前三大占比＝前三大標的市值合計÷全部證券市值；地域集中度＝較大的台灣或海外證券市值÷全部證券市值。",
    criteria:
      "單一標的 >30% 留意、>50% 警戒；前三大 >75% 留意、>90% 警戒；地域 >65% 留意、>80% 警戒，採較嚴重結果。",
  },
  槓桿與質押: {
    description:
      "把商品本身的槓桿、槓桿商品占比及質押借款安全空間合併判讀，不等同券商正式維持率。",
    formula:
      "總曝險倍數＝［Σ（證券市值×有效槓桿倍數）＋房地產］÷淨資產；估算維持率＝全部證券市值÷質押借款×100%。",
    criteria:
      "曝險 >1.5 倍留意、>2 倍警戒；槓桿商品占證券 >10% 留意、>25% 警戒；估算維持率 <250% 留意、<180% 警戒。",
  },
  流動性與負債: {
    description:
      "同時衡量總負債相對全部資產的壓力，以及可快速變現資產覆蓋估算流動負債的能力。",
    formula:
      "負債比＝總負債÷總資產×100%；估算流動比率＝（現金＋目前證券市值）÷（質押借款＋一般負債＋海外負債＋海外質押借款）×100%。房貸因缺少一年內到期金額，暫不列入流動負債。",
    criteria:
      "負債比 >30% 為留意、>50% 為警戒；估算流動比率 <150% 為留意、<100% 為警戒。若沒有估算流動負債，顯示「無流動負債」。",
  },
  壓力承受能力: {
    description:
      "比較五組歷史情境，使用估計損失最大的一組檢查市場與房地產同步下跌後，淨資產還能保留多少。",
    formula:
      "重壓回撤＝五組歷史情境中的最大估計損失÷目前淨資產×100%；00631L 優先使用各次事件的實際峰谷跌幅，汽車不列入壓力損失。",
    criteria:
      "回撤 >30% 為留意；回撤 >50% 或壓力後淨資產≤0 為警戒。",
  },
};

const stressScenarioGuides: Record<string, ExplanationGuide> = {
  "2000 網路泡沫": {
    description:
      "依 2000 年網路泡沫校準：一般台灣證券 -66.2%、海外證券 -47.41%、房地產 -10%。00631L 不以兩倍指數跌幅推算，依指定歷史壓力損失固定為 -95%。",
    formula:
      "估計損失＝00631L 市值×95%＋Σ［其他證券市值×min（所屬市場跌幅×有效槓桿倍數，100%）］＋房地產×10%。",
    criteria:
      "房地產 -10% 是景氣衰退與急售流動性折價的模型假設，不是台灣官方實際跌幅。模型校準：2026-07-31。",
  },
  "2008 全球金融海嘯": {
    description:
      "依 2008 年全球金融海嘯校準：一般台灣證券 -58.3%、海外證券 -55.25%、房地產 -20%。00631L 依指定歷史壓力損失固定為 -85%。",
    formula:
      "估計損失＝00631L 市值×85%＋Σ［其他證券市值×min（所屬市場跌幅×有效槓桿倍數，100%）］＋房地產×20%。",
    criteria:
      "房地產 -20% 是信用緊縮、成交萎縮與急售折價的嚴重模型假設，不是台灣官方實際跌幅。模型校準：2026-07-31。",
  },
  "2020 COVID 急跌": {
    description:
      "依 2020 年 COVID 急跌校準：一般台灣證券 -28.7%、海外證券 -33.8%、房地產 -5%。00631L 依證交所實際盤中高低價 55.35 元至 25.79 元，固定採 -53.41%。",
    formula:
      "估計損失＝00631L 市值×53.41%＋Σ［其他證券市值×min（所屬市場跌幅×有效槓桿倍數，100%）］＋房地產×5%。",
    criteria:
      "00631L 實際期間：2020-01-03 至 2020-03-19；房地產 -5% 代表短期交易凍結與急售折價的模型假設。模型校準：2026-07-31。",
  },
  "2022 通膨升息熊市": {
    description:
      "依 2022 年通膨升息熊市校準：一般台灣證券 -31.6%、海外證券 -25.4%、房地產 -10%。00631L 依證交所實際盤中高低價 152.45 元至 73.65 元，固定採 -51.69%。",
    formula:
      "估計損失＝00631L 市值×51.69%＋Σ［其他證券市值×min（所屬市場跌幅×有效槓桿倍數，100%）］＋房地產×10%。",
    criteria:
      "00631L 實際期間：2022-01-18 至 2022-10-25；房地產 -10% 是升息與估值折價的模型假設。模型校準：2026-07-31。",
  },
  "2015 中國股災與全球市場震盪": {
    description:
      "依 2015 年中國股災與全球市場震盪校準：一般台灣證券 -28.1%、海外證券 -12%、房地產 -5%。00631L 依證交所實際盤中高低價 24.90 元至 13.47 元，固定採 -45.90%。",
    formula:
      "估計損失＝00631L 市值×45.90%＋Σ［其他證券市值×min（所屬市場跌幅×有效槓桿倍數，100%）］＋房地產×5%。",
    criteria:
      "00631L 實際期間：2015-04-27 至 2015-08-24；房地產 -5% 是交易流動性與急售折價的模型假設。模型校準：2026-07-31。",
  },
};

function ExplanationTooltip({
  guide,
  label,
  findings = [],
}: {
  guide: ExplanationGuide;
  label: string;
  findings?: HealthCheckResult["domains"][number]["findings"];
}) {
  return (
    <>
      <button
        type="button"
        aria-label={`查看${label}的詳細解釋與公式`}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/10 text-slate-400 transition hover:border-indigo-300/40 hover:text-indigo-200 focus:border-indigo-300/50 focus:text-indigo-100 focus:outline-none"
      >
        <Info size={14} />
      </button>
      <div
        role="tooltip"
        className="pointer-events-auto invisible absolute inset-x-0 top-[calc(100%+0.5rem)] z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-indigo-300/25 bg-slate-950/95 p-4 text-left opacity-0 shadow-2xl backdrop-blur transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <div className="text-xs font-black text-indigo-200">{label}</div>
        <p className="mt-2 text-[11px] leading-5 text-slate-300">
          {guide.description}
        </p>
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.05] p-3">
          <div className="text-[10px] font-black tracking-wide text-slate-300">
            本次判讀
          </div>
          {findings.length ? (
            <div className="mt-2 space-y-2">
              {findings.map((finding) => (
                <div key={`${finding.severity}-${finding.title}`}>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-black ${
                        finding.severity === "高"
                          ? "bg-red-400/15 text-red-200"
                          : finding.severity === "中"
                            ? "bg-amber-400/15 text-amber-200"
                            : "bg-sky-400/15 text-sky-200"
                      }`}
                    >
                      {finding.severity}
                    </span>
                    <span className="text-[10px] font-bold text-white">
                      {finding.title}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-slate-300">
                    {finding.evidence}
                  </p>
                  <p className="text-[10px] leading-4 text-slate-400">
                    {finding.impact}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[10px] leading-4 text-emerald-200">
              目前沒有觸發此指標的主要風險門檻。
            </p>
          )}
        </div>
        <div className="mt-3 rounded-lg bg-indigo-400/10 p-3">
          <div className="text-[10px] font-black tracking-wide text-indigo-300">
            計算公式
          </div>
          <p className="mt-1 text-[11px] leading-5 text-indigo-50">
            {guide.formula}
          </p>
        </div>
        <p className="mt-2 text-[10px] leading-5 text-slate-400">
          <strong className="text-slate-300">判讀方式：</strong>
          {guide.criteria}
        </p>
      </div>
    </>
  );
}

const numberOf = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatTicker = (value: string, isTw: boolean) => {
  let ticker = value.replace(/^'+/, "").trim().toUpperCase();
  if (ticker === "APPL") ticker = "AAPL";
  if (/^\d+$/.test(ticker) && ticker.length <= 3) {
    ticker = ticker.padStart(5, "0");
  } else if (
    isTw &&
    /^\d{2,4}[A-Z]$/.test(ticker) &&
    ticker.length < 6
  ) {
    ticker = ticker.padStart(6, "0");
  }
  return ticker;
};

const metricsFor = (account: Account): Metrics => {
  const position: Metrics["position"] = {};
  const summarize = (rows: Position[], prefix: string) => {
    let holding = 0;
    let added = 0;
    let exposure = 0;
    let addedExposure = 0;
    for (const row of rows) {
      const holdingValue = numberOf(row.price) * numberOf(row.shares);
      const addValue = numberOf(row.addPrice) * numberOf(row.addShares);
      const ratio = numberOf(row.leverage) || 1;
      holding += holdingValue;
      added += addValue;
      exposure += holdingValue * ratio;
      addedExposure += addValue * ratio;
      position[`${prefix}-${row.id}`] = {
        holding: holdingValue,
        add: addValue,
        holdingPct: "0.0",
        addPct: "0.0",
      };
    }
    return { holding, added, exposure, addedExposure };
  };

  const tw = summarize(account.tw, "tw");
  const foreign = summarize(account.foreign, "foreign");
  const realEstate = numberOf(account.realEstate);
  const car = numberOf(account.car);
  const totalAssets =
    numberOf(account.cash) +
    tw.holding +
    foreign.holding +
    realEstate +
    car;
  const liabilities =
    numberOf(account.marginLoan) +
    numberOf(account.debt) +
    numberOf(account.mortgage) +
    numberOf(account.foreignDebt) +
    numberOf(account.foreignMarginLoan);
  const netAssets = totalAssets - liabilities;
  const exposure = tw.exposure + foreign.exposure + realEstate;
  const exposureAfter =
    exposure + tw.addedExposure + foreign.addedExposure;

  for (const row of account.tw) {
    const item = position[`tw-${row.id}`];
    const ratio = numberOf(row.leverage) || 1;
    item.holdingPct = exposure
      ? ((item.holding * ratio * 100) / exposure).toFixed(1)
      : "0.0";
    item.addPct = exposureAfter
      ? ((item.add * ratio * 100) / exposureAfter).toFixed(1)
      : "0.0";
  }
  for (const row of account.foreign) {
    const item = position[`foreign-${row.id}`];
    const ratio = numberOf(row.leverage) || 1;
    item.holdingPct = exposure
      ? ((item.holding * ratio * 100) / exposure).toFixed(1)
      : "0.0";
    item.addPct = exposureAfter
      ? ((item.add * ratio * 100) / exposureAfter).toFixed(1)
      : "0.0";
  }

  const twHolding = tw.holding;
  const foreignHolding = foreign.holding;
  const allocated = twHolding + foreignHolding;
  const totalMargin =
    numberOf(account.marginLoan) + numberOf(account.foreignMarginLoan);
  const collateralCurrent = tw.holding + foreign.holding;
  const collateralAfter = collateralCurrent + tw.added + foreign.added;

  return {
    totalAssets,
    liabilities,
    netAssets,
    exposure,
    leverage: netAssets > 0 ? (exposure / netAssets).toFixed(2) : "資產為負值",
    twRatio: allocated ? ((twHolding * 100) / allocated).toFixed(1) : "0.0",
    foreignRatio: allocated
      ? ((foreignHolding * 100) / allocated).toFixed(1)
      : "0.0",
    marginCurrent: totalMargin
      ? ((collateralCurrent * 100) / totalMargin).toFixed(1)
      : "∞",
    marginAfter: totalMargin
      ? ((collateralAfter * 100) / totalMargin).toFixed(1)
      : "∞",
    twHolding,
    foreignHolding,
    position,
  };
};

const fromLegacy = (raw: Record<string, unknown>, seed: Account): Account => {
  if (!raw || typeof raw !== "object") return seed;
  const build = (prefix: "tw" | "fn") => {
    const count = Math.max(1, Number(raw[`${prefix}Count`]) || 1);
    const seedRows = prefix === "tw" ? seed.tw : seed.foreign;
    return Array.from({ length: count }, (_, index) => {
      const i = index + 1;
      const rowPrefix = `${prefix}${i}_`;
      const hasCloudRow = Object.keys(raw).some((key) => key.startsWith(rowPrefix));
      const seedRow = seedRows[index];
      if (!hasCloudRow && seedRow) {
        return { ...seedRow, id: `${prefix}-${i}-${Date.now()}` };
      }
      return {
        id: `${prefix}-${i}-${Date.now()}`,
        name: formatTicker(String(raw[`${prefix}${i}_name`] ?? ""), prefix === "tw"),
        price: String(raw[`${prefix}${i}_price`] ?? "0"),
        shares: String(raw[`${prefix}${i}_lots`] ?? "0"),
        addPrice: String(raw[`${prefix}${i}_addPrice`] ?? "0"),
        addShares: String(raw[`${prefix}${i}_addLots`] ?? "0"),
        leverage: String(raw[`${prefix}${i}_expRatio`] ?? "1"),
      };
    });
  };
  return {
    cash: String(raw.cash ?? seed.cash),
    tw: build("tw"),
    foreign: build("fn"),
    realEstate: String(raw.tw_realEstate ?? "0"),
    car: String(raw.tw_car ?? "0"),
    marginLoan: String(raw.tw_marginLoan ?? "0"),
    debt: String(raw.tw_debt ?? "0"),
    mortgage: String(raw.tw_mortgage ?? "0"),
    foreignDebt: String(raw.fn_debt ?? "0"),
    foreignMarginLoan: String(raw.fn_marginLoan ?? "0"),
  };
};

const toLegacy = (account: Account, history?: HistoryPoint[]) => {
  const output: Record<string, unknown> = {
    cash: account.cash,
    twCount: account.tw.length,
    fnCount: account.foreign.length,
    tw_realEstate: account.realEstate,
    tw_car: account.car,
    tw_marginLoan: account.marginLoan,
    tw_debt: account.debt,
    tw_mortgage: account.mortgage,
    fn_debt: account.foreignDebt,
    fn_marginLoan: account.foreignMarginLoan,
  };
  const write = (rows: Position[], prefix: "tw" | "fn") =>
    rows.forEach((row, index) => {
      const i = index + 1;
      output[`${prefix}${i}_name`] = `'${row.name.replace(/^'+/, "")}`;
      output[`${prefix}${i}_price`] = row.price;
      output[`${prefix}${i}_lots`] = row.shares;
      output[`${prefix}${i}_addPrice`] = row.addPrice;
      output[`${prefix}${i}_addLots`] = row.addShares;
      output[`${prefix}${i}_expRatio`] = row.leverage;
    });
  write(account.tw, "tw");
  write(account.foreign, "fn");
  if (history) output.historyData = JSON.stringify(history);
  return output;
};

const fetchWithTimeout = async (
  url: string,
  options?: RequestInit,
  timeoutMs = 8000,
) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await pagesFetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
};

function RatioBadge({ value }: { value: string }) {
  if (value === "∞") {
    return (
      <span className="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">
        ∞ (無借款)
      </span>
    );
  }
  const level =
    Number(value) < 130
      ? "bg-red-100 text-red-700"
      : Number(value) < 166
        ? "bg-orange-100 text-orange-700"
        : "bg-emerald-100 text-emerald-700";
  return (
    <span className={`rounded px-2 py-0.5 font-bold ${level}`}>{value}%</span>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-bold text-slate-500">
      {label}
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0"
        className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}

function PortfolioTable({
  rows,
  kind,
  metrics,
  onChange,
  onAdd,
  onRemove,
  onQuote,
}: {
  rows: Position[];
  kind: "tw" | "foreign";
  metrics: Metrics;
  onChange: (rows: Position[]) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onQuote: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const setValue = (id: string, field: keyof Position, value: string) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[520px] table-fixed border-collapse text-left">
          <thead>
            <tr className="bg-slate-200 text-[11px] uppercase tracking-wider text-slate-600">
              <th className="w-[18%] px-2 py-2">名稱</th>
              <th className="w-[14%] px-2 py-2 text-right">價位</th>
              <th className="w-[15%] px-2 py-2 text-right">股數</th>
              <th className="w-[21%] px-2 py-2 text-right">總金額</th>
              <th className="w-[12%] px-2 py-2 text-center text-purple-700">曝險</th>
              <th className="w-[12%] px-2 py-2 text-right">佔比</th>
              <th className="w-[8%] px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const item = metrics.position[`${kind}-${row.id}`];
              const isExpanded = expanded[row.id];
              return (
                <FragmentRow
                  key={row.id}
                  row={row}
                  item={item}
                  canDelete={rows.length > 1}
                  expanded={isExpanded}
                  setValue={setValue}
                  onQuote={onQuote}
                  onRemove={onRemove}
                  onToggle={() =>
                    setExpanded((current) => ({
                      ...current,
                      [row.id]: !current[row.id],
                    }))
                  }
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="flex w-full items-center justify-center gap-1 border-t border-slate-200 bg-slate-50 py-2.5 text-sm font-bold text-slate-500 transition-colors hover:bg-slate-100"
      >
        <Plus size={16} /> 新增一筆股票
      </button>
    </div>
  );
}

function FragmentRow({
  row,
  item,
  canDelete,
  expanded,
  setValue,
  onQuote,
  onRemove,
  onToggle,
}: {
  row: Position;
  item: Metrics["position"][string];
  canDelete: boolean;
  expanded: boolean;
  setValue: (id: string, field: keyof Position, value: string) => void;
  onQuote: (id: string) => void;
  onRemove: (id: string) => void;
  onToggle: () => void;
}) {
  const inputClass =
    "w-full min-w-0 rounded-md border border-slate-200 px-1.5 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";
  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50">
        <td className="p-1.5">
          <input
            value={row.name}
            placeholder="代碼+Enter"
            aria-label="輸入代碼後按下 Enter 即可自動抓取價位"
            onChange={(event) => setValue(row.id, "name", event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onQuote(row.id);
            }}
            className={`${inputClass} text-left uppercase`}
          />
        </td>
        <td className="p-1.5">
          <input
            value={row.price}
            aria-label="價位"
            onChange={(event) => setValue(row.id, "price", event.target.value)}
            className={`${inputClass} text-right`}
          />
        </td>
        <td className="p-1.5">
          <input
            value={row.shares}
            aria-label="股數"
            onChange={(event) => setValue(row.id, "shares", event.target.value)}
            className={`${inputClass} text-right`}
          />
        </td>
        <td className="p-1.5 text-right text-xs font-black text-slate-800">
          ${money(item?.holding ?? 0)}
        </td>
        <td className="p-1.5">
          <div className="flex items-center justify-center">
            <input
              value={row.leverage}
              aria-label="曝險倍數"
              onChange={(event) => setValue(row.id, "leverage", event.target.value)}
              className="w-10 rounded-md border border-slate-300 px-1 py-1.5 text-center text-xs font-black text-purple-700 outline-none focus:ring-2 focus:ring-purple-200"
            />
            <span className="ml-1 text-[10px] font-bold text-purple-500">x</span>
          </div>
        </td>
        <td className="p-1.5 text-right text-xs font-black text-purple-600">
          {item?.holdingPct ?? "0.0"}%
        </td>
        <td className="p-1.5">
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              onClick={onToggle}
              title={expanded ? "收合加碼" : "展開加碼"}
              className="rounded p-1 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={() => onRemove(row.id)}
                title="刪除"
                className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-indigo-100 bg-indigo-50/60">
          <td className="px-2 py-2 text-[11px] font-bold text-indigo-600">
            預計加碼
          </td>
          <td className="p-1.5">
            <input
              value={row.addPrice}
              aria-label="加碼價位"
              onChange={(event) => setValue(row.id, "addPrice", event.target.value)}
              className={`${inputClass} text-right`}
            />
          </td>
          <td className="p-1.5">
            <input
              value={row.addShares}
              aria-label="加碼股數"
              onChange={(event) => setValue(row.id, "addShares", event.target.value)}
              className={`${inputClass} text-right`}
            />
          </td>
          <td className="p-1.5 text-right text-xs font-black text-indigo-700">
            ${money(item?.add ?? 0)}
          </td>
          <td />
          <td className="p-1.5 text-right text-xs font-black text-indigo-600">
            {item?.addPct ?? "0.0"}%
          </td>
          <td />
        </tr>
      )}
    </>
  );
}

function AccountPanel({
  name,
  account,
  setAccount,
  metrics,
  onQuote,
}: {
  name: "SM" | "WL";
  account: Account;
  setAccount: (account: Account) => void;
  metrics: Metrics;
  onQuote: (name: "SM" | "WL", kind: "tw" | "foreign", id: string) => void;
}) {
  const patch = (value: Partial<Account>) => setAccount({ ...account, ...value });
  const section = (
    kind: "tw" | "foreign",
    title: string,
    tone: "indigo" | "emerald",
  ) => {
    const rows = account[kind];
    return (
      <section
        className={`rounded-xl border p-4 ${
          tone === "indigo"
            ? "border-indigo-100 bg-indigo-50/30"
            : "border-emerald-100 bg-emerald-50/30"
        }`}
      >
        <h3
          className={`mb-3 flex items-center gap-2 text-sm font-bold ${
            tone === "indigo" ? "text-indigo-800" : "text-emerald-800"
          }`}
        >
          {kind === "tw" ? <LineChart size={18} /> : <Globe size={18} />} {title}
        </h3>
        <PortfolioTable
          rows={rows}
          kind={kind}
          metrics={metrics}
          onChange={(next) => patch({ [kind]: next })}
          onAdd={() => patch({ [kind]: [...rows, emptyPosition()] })}
          onRemove={(id) => patch({ [kind]: rows.filter((row) => row.id !== id) })}
          onQuote={(id) => onQuote(name, kind, id)}
        />
        <div
          className={`mt-3 grid grid-cols-2 gap-3 rounded-lg border bg-white p-3 ${
            tone === "indigo" ? "border-indigo-100" : "border-emerald-100"
          }`}
        >
          {kind === "tw" ? (
            <>
              <Field label="房地產金額" value={account.realEstate} onChange={(realEstate) => patch({ realEstate })} />
              <Field label="汽車金額" value={account.car} onChange={(car) => patch({ car })} />
              <Field label="質押借款" value={account.marginLoan} onChange={(marginLoan) => patch({ marginLoan })} />
              <Field label="一般負債" value={account.debt} onChange={(debt) => patch({ debt })} />
              <Field label="房貸負債" value={account.mortgage} onChange={(mortgage) => patch({ mortgage })} />
            </>
          ) : (
            <>
              <Field label="一般負債" value={account.foreignDebt} onChange={(foreignDebt) => patch({ foreignDebt })} />
              <Field label="質押借款" value={account.foreignMarginLoan} onChange={(foreignMarginLoan) => patch({ foreignMarginLoan })} />
            </>
          )}
        </div>
      </section>
    );
  };

  const summaryRows: [string, React.ReactNode][] = [
    [
      "1. 台/外真實資產比例",
      <span key="ratio">
        <b className="text-indigo-400">TW {metrics.twRatio}%</b>
        <span className="mx-2 text-slate-500">/</span>
        <b className="text-emerald-400">US {metrics.foreignRatio}%</b>
      </span>,
    ],
    ["2. 總資產 (實際市值)", `$ ${money(metrics.totalAssets)}`],
    ["3. 總負債", `$ ${money(metrics.liabilities)}`],
    ["4. 淨資產", <b key="net" className="text-blue-400">$ {money(metrics.netAssets)}</b>],
    ["5. 曝險總額 (含槓桿倍數)", <b key="exp" className="text-purple-400">$ {money(metrics.exposure)}</b>],
    ["6. 實際槓桿比率", <b key="lev" className="text-orange-400">{metrics.leverage} 倍</b>],
  ];

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header
        className={`flex items-center gap-2 px-5 py-3 text-lg font-bold text-white ${
          name === "SM" ? "bg-indigo-600" : "bg-emerald-600"
        }`}
      >
        <Wallet size={20} /> {name} 帳戶 面板
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-inner">
          <Field label="帳戶閒置現金 (不投入市場)" value={account.cash} onChange={(cash) => patch({ cash })} />
        </div>
        {section("tw", "國內部位 (含房地產)", "indigo")}
        {section("foreign", "國外部位", "emerald")}
      </div>
      <footer className="mt-auto bg-slate-800 p-5 text-sm font-medium text-slate-100">
        <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
          <Activity size={15} /> 帳戶結算摘要
        </h4>
        <div className="space-y-3">
          {summaryRows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 border-b border-slate-700 pb-2">
              <span className="text-slate-300">{label}</span>
              <span className="shrink-0 text-right">{value}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 pt-1">
            <span className="text-slate-300">7. 質押維持率 (現有)</span>
            <RatioBadge value={metrics.marginCurrent} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-300">7. 質押維持率 (加碼後)</span>
            <RatioBadge value={metrics.marginAfter} />
          </div>
        </div>
      </footer>
    </article>
  );
}

function TightLeverageExplanation({ text, centerX, bottomY, chartWidth }: {
  text: string;
  centerX: number;
  bottomY: number;
  chartWidth: number;
}) {
  const textRef = useRef<SVGTextElement>(null);
  const [bounds, setBounds] = useState({ x: 0, y: -12, width: 520, height: 14 });
  useLayoutEffect(() => {
    let active = true;
    const measure = () => {
      if (!active || !textRef.current) return;
      const { x, y, width, height } = textRef.current.getBBox();
      setBounds({ x, y, width, height });
    };
    measure();
    void document.fonts.ready.then(measure);
    return () => { active = false; };
  }, [text]);
  const padding = 2;
  const boxWidth = bounds.width + padding * 2;
  const boxHeight = bounds.height + padding * 2;
  const x = Math.max(2, Math.min(chartWidth - boxWidth - 2, centerX - boxWidth / 2));
  const y = Math.max(2, bottomY - boxHeight);
  return (
    <g transform={`translate(${x - bounds.x + padding}, ${y - bounds.y + padding})`} pointerEvents="none" role="status" aria-live="polite">
      <rect x={bounds.x - padding} y={bounds.y - padding} width={boxWidth} height={boxHeight} rx="4" fill="white" stroke="#cbd5e1" strokeWidth="1.2" />
      <text ref={textRef} x="0" y="0" fontSize="12" fontWeight="500" fill="#0f172a">{text}</text>
    </g>
  );
}

function TrendChart({ data }: { data: HistoryPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [leverageInfo, setLeverageInfo] = useState<{
    index: number;
    kind: "withProperty" | "withoutProperty";
  } | null>(null);
  const sorted = [...data].sort((a, b) => a.month.localeCompare(b.month));
  const latest = sorted.at(-1)?.netAssets ?? 0;
  const previous = sorted.at(-2)?.netAssets ?? BASE_ASSET_2025;
  const mom = previous ? ((latest - previous) * 100) / previous : 0;
  const ytd = ((latest - BASE_ASSET_2025) * 100) / BASE_ASSET_2025;
  const width = 1400;
  const height = 400;
  const left = 60;
  const top = 112;
  const chartW = 1260;
  const chartH = 248;
  const points = sorted.map((point, index) => {
    const month = Number(point.month.split("-")[1]);
    const previousAsset =
      index === 0 ? BASE_ASSET_2025 : sorted[index - 1].netAssets;
    return {
      ...point,
      x: left + ((month - 1) / 11) * chartW,
      y: top + chartH - (Math.min(point.netAssets, 100_000_000) / 100_000_000) * chartH,
      monthNumber: month,
      momRate: previousAsset
        ? ((point.netAssets - previousAsset) * 100) / previousAsset
        : 0,
      ytdRate:
        ((point.netAssets - BASE_ASSET_2025) * 100) / BASE_ASSET_2025,
    };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = points.length
    ? `${points[0].x},${top + chartH} ${line} ${points.at(-1)!.x},${top + chartH}`
    : "";
  const hoveredPoint =
    hoveredIndex === null ? null : points[hoveredIndex] ?? null;
  const labelLayout = (point: (typeof points)[number]) => {
    const showLeverage = point.month >= "2026-09";
    const labelWidth = showLeverage ? 118 : 96;
    const labelHeight = showLeverage ? 84 : 63;
    const labelX = Math.max(
      2,
      Math.min(width - labelWidth - 2, point.x - labelWidth / 2),
    );
    return {
      showLeverage,
      labelWidth,
      labelHeight,
      labelX,
      labelY: Math.max(8, point.y - labelHeight - 21),
    };
  };
  const toggleLeverageInfo = (
    index: number,
    kind: "withProperty" | "withoutProperty",
  ) => {
    setLeverageInfo((current) =>
      current?.index === index && current.kind === kind ? null : { index, kind },
    );
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col justify-between gap-3 sm:flex-row">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <TrendingUp size={16} /> 淨資產成長趨勢
          </h3>
          <p className="mt-1 text-[10px] font-medium text-slate-400">
            *YTD = 今年以來報酬率（基準值 ${money(BASE_ASSET_2025)}）
          </p>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-2xl font-black tracking-tight text-slate-800">${money(latest)}</div>
          <div className="mt-1 flex gap-2 sm:justify-end">
            <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${mom >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
              月 {mom >= 0 ? "▲" : "▼"} {Math.abs(mom).toFixed(1)}%
            </span>
            <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${ytd >= 0 ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
              YTD {ytd >= 0 ? "▲" : "▼"} {Math.abs(ytd).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-[900px]"
          role="img"
          aria-label="淨資產成長趨勢圖；移到月份可查看十字軸"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <defs>
            <linearGradient id="assetArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {Array.from({ length: 11 }, (_, index) => index * 10_000_000).map((value) => {
            const y = top + chartH - (value / 100_000_000) * chartH;
            return (
              <g key={value}>
                <line x1={left} x2={left + chartW} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                <text x={left + chartW + 12} y={y + 4} fontSize="11" fontWeight="700" fill="#64748b">
                  {value === 100_000_000 ? "1億" : value ? `${value / 10_000}萬` : "0"}
                </text>
              </g>
            );
          })}
          {Array.from({ length: 12 }, (_, index) => (
            <text key={index} x={left + (index / 11) * chartW} y={top + chartH + 28} textAnchor="middle" fontSize="13" fontWeight="700" fill="#64748b">
              {index + 1}月
            </text>
          ))}
          {hoveredPoint && (
            <g aria-hidden="true">
              <line
                x1={hoveredPoint.x}
                x2={hoveredPoint.x}
                y1={top}
                y2={top + chartH}
                stroke="#3b82f6"
                strokeDasharray="6 5"
                strokeWidth="1.5"
                opacity="0.8"
              />
              <line
                x1={left}
                x2={left + chartW}
                y1={hoveredPoint.y}
                y2={hoveredPoint.y}
                stroke="#3b82f6"
                strokeDasharray="6 5"
                strokeWidth="1.5"
                opacity="0.8"
              />
            </g>
          )}
          {area && <polygon points={area} fill="url(#assetArea)" />}
          {line && <polyline points={line} fill="none" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
          {points.map((point, index) => {
            const { showLeverage, labelWidth, labelHeight, labelX, labelY } =
              labelLayout(point);
            // Keep the card visually connected to its point without touching the line.
            const isHovered = hoveredIndex === index;
            return (
              <g key={point.month}>
                <rect
                  x={labelX}
                  y={labelY}
                  width={labelWidth}
                  height={labelHeight}
                  rx="7"
                  fill="white"
                  stroke={isHovered ? "#3b82f6" : "#dbe4f0"}
                  strokeWidth={isHovered ? "2" : "1.3"}
                />
                <text
                  x={labelX + labelWidth / 2}
                  y={labelY + 19}
                  textAnchor="middle"
                  fontSize="12.5"
                  fontWeight="700"
                  fill="#0f172a"
                >
                  ${money(point.netAssets)}
                </text>
                <text
                  x={labelX + labelWidth / 2}
                  y={labelY + 38}
                  textAnchor="middle"
                  fontSize="11.5"
                  fontWeight="800"
                  fill={point.momRate >= 0 ? "#059669" : "#dc2626"}
                >
                  月 {point.momRate >= 0 ? "▲" : "▼"} {Math.abs(point.momRate).toFixed(1)}%
                </text>
                <text
                  x={labelX + labelWidth / 2}
                  y={labelY + 55}
                  textAnchor="middle"
                  fontSize="11.5"
                  fontWeight="800"
                  fill={point.ytdRate >= 0 ? "#2563eb" : "#dc2626"}
                >
                  YTD {point.ytdRate >= 0 ? "▲" : "▼"} {Math.abs(point.ytdRate).toFixed(1)}%
                </text>
                {showLeverage && (
                  <g>
                    <line x1={labelX + 3} x2={labelX + labelWidth - 3} y1={labelY + 62} y2={labelY + 62} stroke="#e2e8f0" />
                  </g>
                )}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={isHovered ? "6.5" : "5"}
                  fill="white"
                  stroke="#2563eb"
                  strokeWidth="3"
                />
                <title>
                  {point.month}：${money(point.netAssets)}；月報酬 {point.momRate.toFixed(1)}%；YTD {point.ytdRate.toFixed(1)}%
                  {showLeverage ? `；含房 ${leverageText(point.leverageWithProperty)}＝（金融部位曝險＋房地產）÷淨資產；不含房 ${leverageText(point.leverageWithoutProperty)}＝金融部位曝險÷淨資產；房貸與淨資產不變。` : ""}
                </title>
              </g>
            );
          })}
          {points.map((point, index) => (
            <g
              key={`hit-${point.month}`}
              // The focused value card already indicates selection; do not outline the full-height hit area.
              style={{ outline: "none" }}
              tabIndex={0}
              role="button"
              aria-label={`${point.monthNumber}月，淨資產 ${money(point.netAssets)} 元`}
              onMouseEnter={() => setHoveredIndex(index)}
              onFocus={() => setHoveredIndex(index)}
              onBlur={() => setHoveredIndex(null)}
            >
              <rect
                data-month-index={index}
                x={point.x - chartW / 24}
                y={8}
                width={chartW / 12}
                height={top + chartH - 8}
                fill="rgba(0,0,0,0.001)"
                pointerEvents="all"
                className="cursor-crosshair"
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseMove={() => setHoveredIndex(index)}
                onPointerEnter={() => setHoveredIndex(index)}
                onPointerMove={() => setHoveredIndex(index)}
                onClick={() => setHoveredIndex(index)}
              />
            </g>
          ))}
          {points.map((point, index) => {
            const { showLeverage, labelWidth, labelX, labelY } = labelLayout(point);
            if (!showLeverage) return null;
            const withActive = leverageInfo?.index === index && leverageInfo.kind === "withProperty";
            const withoutActive = leverageInfo?.index === index && leverageInfo.kind === "withoutProperty";
            const activate = (kind: "withProperty" | "withoutProperty") =>
              toggleLeverageInfo(index, kind);
            return (
              <g key={`leverage-${point.month}`}>
                <text x={labelX + 4} y={labelY + 77} fontSize="8.5" fontWeight="500" fill="#64748b">
                  槓桿
                </text>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`房產視為風險資產，槓桿 ${leverageText(point.leverageWithProperty)}。點選查看計算說明。`}
                  aria-pressed={withActive}
                  style={{ cursor: "pointer", outline: "none" }}
                  onClick={(event) => {
                    event.stopPropagation();
                    activate("withProperty");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      activate("withProperty");
                    }
                  }}
                >
                  <rect x={labelX + 27} y={labelY + 65} width="38" height="16" rx="4" fill={withActive ? "#dbeafe" : "#eff6ff"} stroke={withActive ? "#2563eb" : "transparent"} />
                  <text x={labelX + 46} y={labelY + 77} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#1e3a5f">
                    {leverageText(point.leverageWithProperty)}
                  </text>
                </g>
                <text x={labelX + 69} y={labelY + 77} textAnchor="middle" fontSize="9" fill="#64748b">/</text>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`房產視同現金，槓桿 ${leverageText(point.leverageWithoutProperty)}。點選查看計算說明。`}
                  aria-pressed={withoutActive}
                  style={{ cursor: "pointer", outline: "none" }}
                  onClick={(event) => {
                    event.stopPropagation();
                    activate("withoutProperty");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      activate("withoutProperty");
                    }
                  }}
                >
                  <rect x={labelX + 74} y={labelY + 65} width="41" height="16" rx="4" fill={withoutActive ? "#dbeafe" : "#eff6ff"} stroke={withoutActive ? "#2563eb" : "transparent"} />
                  <text x={labelX + 94.5} y={labelY + 77} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#1e3a5f">
                    {leverageText(point.leverageWithoutProperty)}
                  </text>
                </g>
                {withActive && (
                  <TightLeverageExplanation
                    text={`房產視為風險資產：（金融部位曝險＋房地產）÷淨資產。`}
                    centerX={point.x}
                    bottomY={labelY - 10}
                    chartWidth={width}
                  />
                )}
{withoutActive && (
  <TightLeverageExplanation
    text={`房產視同現金，不計曝險：金融部位曝險÷淨資產。`}
    centerX={point.x}
    bottomY={labelY - 10}
    chartWidth={width}
  />
)}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function HealthCheckPanel({
  loading,
  result,
  error,
  onRun,
  onClose,
}: {
  loading: boolean;
  result: HealthCheckResult | null;
  error: string;
  onRun: () => void;
  onClose: () => void;
}) {
  const statusClass = (
    status: "良好" | "留意" | "警戒" | "資料不足",
  ) =>
    status === "良好"
      ? "bg-emerald-400/15 text-emerald-300"
      : status === "留意"
        ? "bg-amber-400/15 text-amber-200"
        : status === "資料不足"
          ? "bg-slate-400/15 text-slate-300"
          : "bg-red-400/15 text-red-200";
  return (
    <section
      id="health-check"
      className="relative overflow-hidden rounded-2xl border border-indigo-400/30 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-5 text-white shadow-xl md:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="關閉資產健檢"
        className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
      >
        <X size={24} />
      </button>
      <div className="pr-10">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-xl font-black text-indigo-200 md:text-2xl">
            <ShieldCheck size={26} /> 資產風險健檢
          </h2>
          <span className="rounded-full bg-indigo-400/15 px-2.5 py-1 text-xs font-bold text-indigo-200">
            依現有資料自動分析
          </span>
        </div>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-300">
          不詢問投資目標或風險偏好，直接以 SM、WL、持股、負債、房地產、
          汽車、預計加碼與月度淨資產紀錄，交叉檢查五大風險領域。
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 text-sm text-slate-300">
          {loading ? (
            <LoaderCircle className="spin text-indigo-300" size={22} />
          ) : (
            <CircleGauge className="text-indigo-300" size={22} />
          )}
          <span>
            {loading
              ? "正在合併跨帳戶部位並執行五組壓力測試…"
              : "分析使用固定且公開的判斷門檻，不會把主觀選項當成事實。"}
          </span>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={loading}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-indigo-300/25 bg-indigo-400/15 px-4 py-2 text-sm font-bold text-indigo-100 transition hover:bg-indigo-400/25 disabled:opacity-60"
        >
          <RefreshCw className={loading ? "spin" : ""} size={17} />
          重新檢測
        </button>
      </div>

      {error && (
        <div
          className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm leading-relaxed text-amber-100"
        >
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {result.domains.map((domain) => {
              const guide = domainGuides[domain.label];
              return (
                <div
                  key={domain.label}
                  className="group relative rounded-xl border border-white/10 bg-white/[0.05] p-4 transition hover:border-indigo-300/30 focus-within:border-indigo-300/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-slate-400">
                      {domain.label}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-black ${statusClass(domain.status)}`}
                      >
                        {domain.status}
                      </span>
                      {guide && (
                        <ExplanationTooltip
                          guide={guide}
                          label={`${domain.label}｜${domain.value.replace("\n", "｜")}`}
                          findings={domain.findings}
                        />
                      )}
                    </div>
                  </div>
                  <div className="mt-2 whitespace-pre-line font-black leading-7 text-white">
                    {domain.value}
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-slate-400">
                    {domain.explanation}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.05]">
              <div className="border-b border-white/10 px-5 py-4 font-black">
                五組壓力測試
              </div>
              <div className="grid gap-3 p-4">
                {result.stressTests.map((test) => (
                  <article
                    key={test.scenario}
                    className="group relative rounded-xl border border-white/10 bg-black/15 p-3 transition hover:border-indigo-300/30 focus-within:border-indigo-300/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-bold text-white">
                          {test.scenario}
                        </div>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">
                          {test.interpretation}
                        </p>
                      </div>
                      {stressScenarioGuides[test.scenario] && (
                        <ExplanationTooltip
                          guide={stressScenarioGuides[test.scenario]}
                          label={test.scenario}
                        />
                      )}
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-white/10 pt-3 text-[11px] sm:grid-cols-3 2xl:grid-cols-6">
                      <div>
                        <dt className="text-slate-400">估計損失</dt>
                        <dd className="mt-1 font-bold tabular-nums text-red-200">
                          -${money(test.estimatedLoss)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">回撤</dt>
                        <dd className="mt-1 font-bold tabular-nums text-white">
                          {test.drawdownPct.toFixed(1)}%
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">壓力後淨資產</dt>
                        <dd className="mt-1 break-words font-bold tabular-nums text-indigo-200">
                          ${money(test.netAssetsAfter)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">壓力後曝險</dt>
                        <dd className="mt-1 font-bold tabular-nums text-amber-100">
                          {test.exposureMultipleAfter.toFixed(2)} 倍
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">估算維持率</dt>
                        <dd className="mt-1 font-bold tabular-nums text-emerald-100">
                          {test.estimatedMaintenanceRatio === null
                            ? "無質押"
                            : `${test.estimatedMaintenanceRatio.toFixed(1)}%`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">流動比率</dt>
                        <dd className="mt-1 font-bold tabular-nums text-sky-100">
                          {test.currentRatioAfter === null
                            ? "無流動負債"
                            : `${test.currentRatioAfter.toFixed(1)}%`}
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-5">
              <h3 className="flex items-center gap-2 font-black">
                <ShieldCheck size={19} className="text-emerald-300" />
                建議行動
              </h3>
              <ol className="mt-4 space-y-3">
                {result.actions.map((action) => (
                  <li
                    key={`${action.priority}-${action.action}`}
                    className="flex gap-3 rounded-xl bg-black/15 p-3"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-indigo-400/20 text-xs font-black text-indigo-200">
                      {action.priority}
                    </span>
                    <div>
                      <div className="mb-1 text-[9px] font-bold text-indigo-200">
                        {action.domain}
                      </div>
                      <div className="text-sm font-bold leading-6 text-white">
                        {action.action}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">
                        {action.timeframe}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <p className="text-[11px] leading-5 text-slate-500">
            {result.disclaimer}
          </p>
        </div>
      )}
    </section>
  );
}

export default function Home({ baseline, reconnectGoogle, googleBusy, googleMessage }: { baseline: number; reconnectGoogle: () => Promise<void>; googleBusy: boolean; googleMessage: string }) {
  BASE_ASSET_2025 = baseline;
  const [sm, setSm] = useState<Account>(fallbackSm);
  const [wl, setWl] = useState<Account>(fallbackWl);
  const [history, setHistory] = useState<HistoryPoint[]>(fallbackHistory);
  const [sync, setSync] = useState<SyncState>("idle");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>(null);
  const [healthCheckOpen, setHealthCheckOpen] = useState(false);
  const [healthCheckLoading, setHealthCheckLoading] = useState(false);
  const [healthCheckResult, setHealthCheckResult] =
    useState<HealthCheckResult | null>(null);
  const [healthCheckError, setHealthCheckError] = useState("");
  const [storageReady, setStorageReady] = useState(false);

  const smMetrics = useMemo(() => metricsFor(sm), [sm]);
  const wlMetrics = useMemo(() => metricsFor(wl), [wl]);
  const global = useMemo(() => {
    const tw = smMetrics.twHolding + wlMetrics.twHolding;
    const foreign = smMetrics.foreignHolding + wlMetrics.foreignHolding;
    const total = tw + foreign;
    return {
      totalAssets: smMetrics.totalAssets + wlMetrics.totalAssets,
      liabilities: smMetrics.liabilities + wlMetrics.liabilities,
      netAssets: smMetrics.netAssets + wlMetrics.netAssets,
      twRatio: total ? ((tw * 100) / total).toFixed(1) : "0.0",
      foreignRatio: total ? ((foreign * 100) / total).toFixed(1) : "0.0",
    };
  }, [smMetrics, wlMetrics]);

  const readCloudSnapshot = async () => {
    const response = await fetchWithTimeout("/api/cloud", undefined, 20000);
    const result = (await response.json()) as {
      status?: string;
      message?: string;
      sm?: Record<string, unknown>;
      wl?: Record<string, unknown>;
    };
    if (
      !response.ok ||
      result.status === "error" ||
      result.status === "empty" ||
      !result.sm ||
      !result.wl
    ) {
      throw new Error(result.message || "雲端資料讀取失敗");
    }

    let nextHistory = history;
    if (typeof result.sm.historyData === "string") {
      const parsed = JSON.parse(result.sm.historyData);
      if (Array.isArray(parsed)) nextHistory = parsed as HistoryPoint[];
    }

    return {
      sm: fromLegacy(result.sm, sm),
      wl: fromLegacy(result.wl, wl),
      history: nextHistory,
    };
  };

  const loadCloud = async (manual = false) => {
    if (manual) {
      setSync("loading");
      setQuoteStatus(null);
    }
    try {
      const snapshot = await readCloudSnapshot();
      setSm(snapshot.sm);
      setWl(snapshot.wl);
      setHistory(snapshot.history);
      setStorageReady(true);
      if (manual) setSync("success");
    } catch {
      if (manual) setSync("error");
    } finally {
      if (manual) window.setTimeout(() => setSync("idle"), 3000);
    }
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(backupKey());
      if (raw) {
        const saved = JSON.parse(raw) as {
          sm?: Account;
          wl?: Account;
          history?: HistoryPoint[];
        };
        if (saved.sm?.tw && saved.sm?.foreign) setSm(saved.sm);
        if (saved.wl?.tw && saved.wl?.foreign) setWl(saved.wl);
        if (Array.isArray(saved.history) && saved.history.length) {
          setHistory(saved.history);
        }
      }
    } catch {
      // Ignore a damaged browser backup and continue with cloud data or defaults.
    } finally {
      void loadCloud(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const snapshot = JSON.stringify({ sm, wl, history });
    window.localStorage.setItem(backupKey(), snapshot);
  }, [sm, wl, history, storageReady]);

  const fetchQuote = async (ticker: string, isTw: boolean) => {
    const clean = formatTicker(ticker, isTw);
    if (!clean) return null;
    const symbol = isTw || /^\d+$/.test(clean) ? `TPE:${clean}` : clean;
    const response = await fetchWithTimeout(
      `/api/cloud?action=quote&ticker=${encodeURIComponent(symbol)}`,
      undefined,
      20000,
    );
    const result = (await response.json()) as {
      status?: string;
      price?: number;
      message?: string;
    };
    if (!response.ok || result.status === "error") {
      throw new Error(result.message || "報價讀取失敗");
    }
    return result.status === "success" && result.price != null
      ? { ticker: clean, price: String(result.price) }
      : null;
  };

  const updateOneQuote = async (
    accountName: "SM" | "WL",
    kind: "tw" | "foreign",
    id: string,
  ) => {
    const account = accountName === "SM" ? sm : wl;
    const setter = accountName === "SM" ? setSm : setWl;
    const row = account[kind].find((item) => item.id === id);
    if (!row) return;
    setter({
      ...account,
      [kind]: account[kind].map((item) =>
        item.id === id ? { ...item, price: "讀取中…" } : item,
      ),
    });
    try {
      const quote = await fetchQuote(row.name, kind === "tw");
      setter({
        ...account,
        [kind]: account[kind].map((item) =>
          item.id === id
            ? {
                ...item,
                name: quote?.ticker ?? formatTicker(item.name, kind === "tw"),
                price: quote?.price ?? row.price,
              }
            : item,
        ),
      });
    } catch {
      setter({
        ...account,
        [kind]: account[kind].map((item) =>
          item.id === id ? { ...item, price: row.price } : item,
        ),
      });
    }
  };

  const updateAllQuotes = async () => {
    if (!storageReady || sync === "loading") return;
    setQuoteLoading(true);
    setQuoteStatus(null);

    try {
      const snapshot = { sm, wl, history };
      const usedLocalSnapshot = false;
      const nextSm = structuredClone(snapshot.sm);
      const nextWl = structuredClone(snapshot.wl);
      const manualNames = new Set(["澳幣ETF"]);
      const targets: Array<{
        row: Position;
        clean: string;
        symbol: string;
      }> = [];

      for (const account of [nextSm, nextWl]) {
        for (const kind of ["tw", "foreign"] as const) {
          for (const row of account[kind]) {
            const clean = formatTicker(row.name, kind === "tw");
            if (!clean || manualNames.has(clean)) continue;
            targets.push({
              row,
              clean,
              symbol:
                kind === "tw" || /^\d+$/.test(clean)
                  ? `TPE:${clean}`
                  : clean,
            });
          }
        }
      }

      const symbols = [...new Set(targets.map((target) => target.symbol))];
      if (!symbols.length) {
        setSm(nextSm);
        setWl(nextWl);
        setHistory(snapshot.history);
        setQuoteStatus({
          type: "success",
          message: "沒有需要自動更新的股票；手動價格保持不變。",
        });
        return;
      }

      const response = await fetchWithTimeout(
        `/api/cloud?action=quotes&tickers=${encodeURIComponent(JSON.stringify(symbols))}`,
        undefined,
        60000,
      );
      const result = (await response.json()) as {
        status?: string;
        message?: string;
        quotedAt?: string;
        results?: Array<{
          ticker?: string;
          status?: string;
          price?: number;
          message?: string;
          stale?: boolean;
          quotedAt?: string | null;
        }>;
      };
      if (!response.ok || result.status !== "success" || !result.results) {
        throw new Error(result.message || "批次報價讀取失敗");
      }

      const resultByTicker = new Map(
        result.results.map((item) => [item.ticker, item]),
      );
      const failed = symbols.filter((symbol) => {
        const item = resultByTicker.get(symbol);
        return (
          !item ||
          item.status !== "success" ||
          !Number.isFinite(Number(item.price))
        );
      });

      for (const target of targets) {
        const item = resultByTicker.get(target.symbol);
        target.row.name = target.clean;
        if (
          item?.status === "success" &&
          Number.isFinite(Number(item.price))
        ) {
          target.row.price = String(item.price);
        }
      }

      setSm(nextSm);
      setWl(nextWl);
      setHistory(snapshot.history);
      const time = result.quotedAt
        ? new Intl.DateTimeFormat("zh-TW", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }).format(new Date(result.quotedAt))
        : "剛剛";
      const staleTickers = [
        ...new Set([
          ...result.results
            .filter((item) => item.stale)
            .map((item) => item.ticker)
            .filter((ticker): ticker is string => Boolean(ticker)),
          ...failed,
        ]),
      ];
      setQuoteStatus({
        type: staleTickers.length ? "warning" : "success",
        message: staleTickers.length
          ? `已完成其餘報價更新；${staleTickers.join("、")} 暫用上次有效報價，澳幣ETF維持手動價格。`
          : `${usedLocalSnapshot ? "雲端暫時不可讀，已使用目前資料；" : ""}已更新 ${symbols.length} 檔報價（${time}）；澳幣ETF維持手動價格。`,
      });
    } catch (error) {
      setQuoteStatus({
        type: "warning",
        message: "報價服務暫時沒有回覆有效資料，已保留目前／上次有效報價，未更動任何資產數字。",
      });
    } finally {
      setQuoteLoading(false);
    }
  };

  const saveCloud = async () => {
    if (!storageReady || sync === "loading") return;
    setSync("saving");
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const date = `${month}-${String(now.getDate()).padStart(2, "0")}`;
    const nextHistory = [
      ...history.filter((point) => point.month !== month),
      {
        month, date, netAssets: global.netAssets,
        ...monthlyLeverage(month, global.netAssets, smMetrics.exposure + wlMetrics.exposure, numberOf(sm.realEstate) + numberOf(wl.realEstate)),
      },
    ].sort((a, b) => a.month.localeCompare(b.month));
    try {
      const response = await fetchWithTimeout("/api/cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sm: toLegacy(sm, nextHistory),
          wl: toLegacy(wl),
          updatedAt: now.toISOString(),
        }),
      });
      const result = (await response.json()) as {
        status?: string;
        message?: string;
      };
      if (!response.ok || result.status !== "success") {
        throw new Error(result.message || "雲端資料儲存失敗");
      }
      setHistory(nextHistory);
      setSync("success");
    } catch {
      setSync("error");
    } finally {
      window.setTimeout(() => setSync("idle"), 3000);
    }
  };

  const openHealthCheck = () => {
    setHealthCheckOpen(true);
    void runAnalysis();
    window.setTimeout(
      () =>
        document
          .getElementById("health-check")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
  };

  const runAnalysis = async () => {
    setHealthCheckLoading(true);
    setHealthCheckError("");
    const positions: HealthCheckInput["positions"] = [];
    for (const [accountName, account] of [
      ["SM", sm],
      ["WL", wl],
    ] as const) {
      for (const market of ["tw", "foreign"] as const) {
        for (const position of account[market]) {
          positions.push({
            account: accountName,
            market,
            name: position.name,
            price: numberOf(position.price),
            shares: numberOf(position.shares),
            plannedPrice: numberOf(position.addPrice),
            plannedShares: numberOf(position.addShares),
            leverage: numberOf(position.leverage),
          });
        }
      }
    }
    const input: HealthCheckInput = {
      accounts: [
        {
          name: "SM",
          cash: numberOf(sm.cash),
          realEstate: numberOf(sm.realEstate),
          car: numberOf(sm.car),
          marginLoan: numberOf(sm.marginLoan),
          debt: numberOf(sm.debt),
          mortgage: numberOf(sm.mortgage),
          foreignDebt: numberOf(sm.foreignDebt),
          foreignMarginLoan: numberOf(sm.foreignMarginLoan),
        },
        {
          name: "WL",
          cash: numberOf(wl.cash),
          realEstate: numberOf(wl.realEstate),
          car: numberOf(wl.car),
          marginLoan: numberOf(wl.marginLoan),
          debt: numberOf(wl.debt),
          mortgage: numberOf(wl.mortgage),
          foreignDebt: numberOf(wl.foreignDebt),
          foreignMarginLoan: numberOf(wl.foreignMarginLoan),
        },
      ],
      positions,
      history: history.map((point) => ({
        month: point.month,
        netAssets: point.netAssets,
      })),
    };
    try {
      const response = await pagesFetch("/api/health-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as {
        analysis?: HealthCheckResult;
        error?: string;
      };
      if (!response.ok || !payload.analysis) {
        throw new Error(payload.error || "健檢服務暫時無法使用");
      }
      setHealthCheckResult(payload.analysis);
      setHealthCheckError(payload.error || "");
    } catch (error) {
      setHealthCheckError(
        error instanceof Error ? error.message : "健檢服務暫時無法使用",
      );
    } finally {
      setHealthCheckLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-3 py-4 pb-20 sm:px-6">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <header className="flex flex-col items-center justify-between gap-4 rounded-2xl bg-white px-6 py-4 shadow-sm sm:flex-row">
          <div className="flex items-center gap-3 self-start sm:self-auto">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-100 text-xl text-blue-700"><PieChart size={26} /></span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-800">SM 與 WL資產總覽</h1>
              <p className="text-sm font-medium text-slate-500">動態管理系統</p>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <button type="button" onClick={openHealthCheck} className="action-button bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-500 hover:to-indigo-500">
              <Sparkles size={19} /> <span>資產風險健檢</span>
            </button>
            <button type="button" onClick={() => void updateAllQuotes()} disabled={quoteLoading || sync === "saving"} className="action-button border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
              {quoteLoading ? <LoaderCircle className="spin" size={19} /> : <RefreshCw size={19} />}
              {quoteLoading ? "更新中…" : "自動更新報價"}
            </button>
            <button type="button" onClick={() => void loadCloud(true)} disabled={sync === "loading" || sync === "saving"} className="action-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
              {sync === "loading" ? <LoaderCircle className="spin" size={19} /> : <Download size={19} />}
              {sync === "loading" ? "讀取中…" : "讀取雲端資料"}
            </button>
            <button type="button" onClick={() => void saveCloud()} disabled={sync === "saving" || quoteLoading} className={`action-button ${sync === "error" ? "bg-red-100 text-red-700" : sync === "success" ? "bg-emerald-100 text-emerald-700" : "bg-slate-800 text-white hover:bg-slate-700"}`}>
              {sync === "saving" ? <LoaderCircle className="spin" size={19} /> : <Save size={19} />}
              {sync === "saving" ? "儲存中…" : sync === "success" ? "已完成" : sync === "error" ? "操作失敗" : "儲存至試算表"}
            </button>
            <button type="button" onClick={() => void reconnectGoogle()} disabled={googleBusy || sync === "saving" || quoteLoading} className="action-button border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
              {googleBusy ? <LoaderCircle className="spin" size={19} /> : <RefreshCw size={19} />}
              <span>{googleBusy ? "Google 連接中…" : "重新連接 Google"}</span>
            </button>
          </div>
        </header>
        {googleMessage && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{googleMessage}</p>}

        {quoteStatus && (
          <div
            role="status"
            aria-live="polite"
            className={`rounded-xl border px-4 py-3 text-sm font-bold ${
              quoteStatus.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : quoteStatus.type === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {quoteStatus.message}
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          <div className="metric-card border-slate-700">
            <p>1. 台灣 / 國外配置比例</p>
            <div className="flex items-center justify-between gap-1 text-sm font-black tracking-tight sm:text-xl">
              <span className="text-indigo-600">TW {global.twRatio}%</span>
              <span className="text-slate-300">|</span>
              <span className="text-emerald-600">US {global.foreignRatio}%</span>
            </div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-emerald-500">
              <div className="bg-indigo-500" style={{ width: `${global.twRatio}%` }} />
            </div>
          </div>
          {[
            ["2. 總資產", global.totalAssets, "border-blue-500", "text-slate-800"],
            ["3. 總負債", global.liabilities, "border-red-500", "text-slate-800"],
            ["4. 淨資產", global.netAssets, "border-purple-500", "text-blue-600"],
          ].map(([label, value, border, color]) => (
            <div key={String(label)} className={`metric-card ${border}`}>
              <p>{label}</p>
              <strong className={`text-base font-black leading-tight tracking-tight sm:text-xl lg:text-3xl ${color}`}>$ {money(Number(value))}</strong>
            </div>
          ))}
        </section>

        {healthCheckOpen && (
          <HealthCheckPanel
            loading={healthCheckLoading}
            result={healthCheckResult}
            error={healthCheckError}
            onRun={() => void runAnalysis()}
            onClose={() => setHealthCheckOpen(false)}
          />
        )}

        <TrendChart data={history} />

        <section className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
          <AccountPanel name="SM" account={sm} setAccount={setSm} metrics={smMetrics} onQuote={updateOneQuote} />
          <AccountPanel name="WL" account={wl} setAccount={setWl} metrics={wlMetrics} onQuote={updateOneQuote} />
        </section>
      </div>
    </main>
  );
}
