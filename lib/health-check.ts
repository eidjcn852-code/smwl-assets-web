export type HealthStatus = "良好" | "留意" | "警戒" | "資料不足";
export type HealthSeverity = "高" | "中" | "低";
export type HealthFinding = {
  severity: HealthSeverity;
  title: string;
  evidence: string;
  impact: string;
};
export type HealthDomainLabel =
  | "資產結構"
  | "集中度"
  | "槓桿與質押"
  | "流動性與負債"
  | "壓力承受能力";

export type HealthAccount = {
  name: "SM" | "WL";
  cash: number;
  realEstate: number;
  car: number;
  marginLoan: number;
  debt: number;
  mortgage: number;
  foreignDebt: number;
  foreignMarginLoan: number;
};

export type HealthPosition = {
  account: "SM" | "WL";
  market: "tw" | "foreign";
  name: string;
  price: number;
  shares: number;
  plannedPrice: number;
  plannedShares: number;
  leverage: number;
};

export type HealthHistoryPoint = {
  month: string;
  netAssets: number;
};

export type HealthCheckInput = {
  accounts: HealthAccount[];
  positions: HealthPosition[];
  history: HealthHistoryPoint[];
};

export type HealthCheckResult = {
  grade: "穩健" | "留意" | "警戒" | "高風險";
  headline: string;
  summary: string;
  domains: Array<{
    label: HealthDomainLabel;
    value: string;
    status: HealthStatus;
    explanation: string;
    findings: HealthFinding[];
  }>;
  metrics: Array<{
    label: string;
    value: string;
    explanation: string;
  }>;
  risks: Array<{
    domain: HealthDomainLabel;
    severity: HealthSeverity;
    title: string;
    evidence: string;
    impact: string;
    action: string;
  }>;
  stressTests: Array<{
    scenario: string;
    estimatedLoss: number;
    netAssetsAfter: number;
    drawdownPct: number | null;
    exposureMultipleAfter: number | null;
    estimatedMaintenanceRatio: number | null;
    currentRatioAfter: number | null;
    interpretation: string;
    findings: HealthFinding[];
  }>;
  actions: Array<{
    priority: number;
    domain: HealthDomainLabel;
    action: string;
    reason: string;
    timeframe: string;
  }>;
  dataNotes: string[];
  disclaimer: string;
};

type PositionSnapshot = HealthPosition & {
  normalizedName: string;
  currentValue: number;
  plannedValue: number;
  effectiveLeverage: number;
  isLeveragedProduct: boolean;
};

type ScenarioDefinition = {
  scenario: string;
  shocks: {
    tw: number;
    foreign: number;
    realEstate: number;
  };
  positionShocks?: Record<string, number>;
};

const safeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const positive = (value: unknown) => Math.max(safeNumber(value), 0);
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
// Ignore floating-point noise at exact percentage boundaries (e.g. 179.99999999999997).
const below = (value: number, threshold: number) => value < threshold - 1e-9;
const above = (value: number, threshold: number) => value > threshold + 1e-9;
const percent = (value: number) => `${value.toFixed(1)}%`;
const multiple = (value: number) =>
  Number.isFinite(value) ? `${value.toFixed(2)} 倍` : "無法計算";
const money = (value: number) =>
  `$${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(
    Math.round(value),
  )}`;
const normalizedTicker = (value: string) =>
  value.trim().toUpperCase().replace(/\s+/g, "")
    .replace(/^(?:TPE|TWSE|TPEX):(?=\d{4,6}[A-Z]*$)/, "")
    .replace(/^(\d{4,6}[A-Z]*)\.(?:TW|TWO)$/, "$1");
const statusRank: Record<HealthStatus, number> = {
  良好: 0,
  資料不足: 1,
  留意: 2,
  警戒: 3,
};
const severityRank: Record<HealthSeverity, number> = { 低: 1, 中: 2, 高: 3 };

const maxStatus = (...statuses: HealthStatus[]) =>
  statuses.sort((a, b) => statusRank[b] - statusRank[a])[0] ?? "良好";

const positionSnapshot = (position: HealthPosition): PositionSnapshot => {
  const normalizedName = normalizedTicker(position.name);
  const price = positive(position.price);
  const shares = positive(position.shares);
  const plannedPrice = positive(position.plannedPrice);
  const plannedShares = positive(position.plannedShares);
  const effectiveLeverage = Math.max(positive(position.leverage), 1);
  return {
    ...position,
    normalizedName,
    price,
    shares,
    plannedPrice,
    plannedShares,
    effectiveLeverage,
    currentValue: price * shares,
    plannedValue: plannedPrice * plannedShares,
    isLeveragedProduct:
      effectiveLeverage > 1 ||
      /^[0-9]{4,6}[LR]$/i.test(normalizedName) ||
      /槓桿|反向/.test(position.name),
  };
};

const accountLiabilities = (account: HealthAccount) =>
  positive(account.marginLoan) +
  positive(account.debt) +
  positive(account.mortgage) +
  positive(account.foreignDebt) +
  positive(account.foreignMarginLoan);

const scenarioPositionShock = (
  definition: ScenarioDefinition,
  position: PositionSnapshot,
) => {
  const positionSpecificShock =
    definition.positionShocks?.[position.normalizedName];
  if (positionSpecificShock !== undefined) {
    return clamp(positionSpecificShock, 0, 1);
  }

  const marketShock =
    position.market === "tw"
      ? definition.shocks.tw
      : definition.shocks.foreign;
  return clamp(marketShock * position.effectiveLeverage, 0, 1);
};

const scenarioResult = (
  definition: ScenarioDefinition,
  positions: PositionSnapshot[],
  accounts: HealthAccount[],
  netAssets: number,
  pledgedLoan: number,
) => {
  const marketLoss = positions.reduce((sum, position) => {
    return sum + position.currentValue * scenarioPositionShock(definition, position);
  }, 0);
  const realEstate = accounts.reduce(
    (sum, account) => sum + positive(account.realEstate),
    0,
  );
  const cash = accounts.reduce(
    (sum, account) => sum + positive(account.cash),
    0,
  );
  const estimatedCurrentLiabilities = accounts.reduce(
    (sum, account) =>
      sum +
      positive(account.marginLoan) +
      positive(account.debt) +
      positive(account.foreignDebt) +
      positive(account.foreignMarginLoan),
    0,
  );
  const nonMarketLoss = realEstate * definition.shocks.realEstate;
  const estimatedLoss = marketLoss + nonMarketLoss;
  const netAssetsAfter = netAssets - estimatedLoss;
  const drawdownPct =
    netAssets > 0 ? (estimatedLoss / netAssets) * 100 : null;
  const stressedSecurities = positions.reduce((sum, position) => {
    return (
      sum +
      position.currentValue * (1 - scenarioPositionShock(definition, position))
    );
  }, 0);
  const stressedExposure =
    positions.reduce((sum, position) => {
      return (
        sum +
        position.currentValue *
          (1 - scenarioPositionShock(definition, position)) *
          position.effectiveLeverage
      );
    }, 0) +
    realEstate * (1 - definition.shocks.realEstate);
  const exposureMultipleAfter =
    netAssetsAfter > 0 ? stressedExposure / netAssetsAfter : Number.POSITIVE_INFINITY;
  const estimatedMaintenanceRatio =
    pledgedLoan > 0 ? (stressedSecurities / pledgedLoan) * 100 : null;
  const currentRatioAfter =
    estimatedCurrentLiabilities > 0
      ? ((cash + stressedSecurities) / estimatedCurrentLiabilities) * 100
      : null;

  // One source for the card interpretation, tooltip and domain risk status.
  const findings: HealthFinding[] = [];
  if (netAssetsAfter <= 0) {
    findings.push({ severity: "高", title: "壓力後淨資產為零或負值",
      evidence: `壓力後淨資產 ${money(netAssetsAfter)}，已達 ≤0 門檻。`,
      impact: "此情境下淨資產可能轉為零或負值，屬最高優先風險。" });
  }
  if (
    estimatedMaintenanceRatio !== null &&
    below(estimatedMaintenanceRatio, 180)
  ) {
    findings.push({ severity: "高", title: "壓力後估算維持率低於 180%",
      evidence: `估算維持率 ${percent(estimatedMaintenanceRatio)}，以全部證券市值估算。`,
      impact: "估算質押安全空間明顯縮小；實際門檻仍須以券商契約與質押品折算率為準。" });
  }
  if (drawdownPct !== null && above(drawdownPct, 30)) {
    findings.push({ severity: above(drawdownPct, 50) ? "高" : "中",
      title: `壓力回撤超過 ${above(drawdownPct, 50) ? 50 : 30}%`,
      evidence: `估計損失 ${money(estimatedLoss)}，占目前淨資產 ${percent(drawdownPct)}。`,
      impact: `淨資產回落幅度超過 ${above(drawdownPct, 50) ? 50 : 30}%，可能顯著壓縮後續調整空間。` });
  }
  const interpretation = findings[0]?.impact ??
    "此情境未達淨資產≤0、估算維持率<180%或回撤>30%的提醒門檻；仍需搭配集中度與流動性判讀。";

  return {
    scenario: definition.scenario,
    estimatedLoss: Math.round(estimatedLoss),
    netAssetsAfter: Math.round(netAssetsAfter),
    drawdownPct: drawdownPct === null ? null : Number(drawdownPct.toFixed(1)),
    exposureMultipleAfter: Number.isFinite(exposureMultipleAfter)
      ? Number(exposureMultipleAfter.toFixed(2))
      : null,
    estimatedMaintenanceRatio:
      estimatedMaintenanceRatio === null
        ? null
        : Number(estimatedMaintenanceRatio.toFixed(1)),
    currentRatioAfter:
      currentRatioAfter === null ? null : Number(currentRatioAfter.toFixed(1)),
    interpretation,
    findings,
  };
};

export const buildDeterministicHealthCheck = (
  input: HealthCheckInput,
): HealthCheckResult => {
  const accounts = input.accounts.map((account) => ({
    ...account,
    cash: positive(account.cash),
    realEstate: positive(account.realEstate),
    car: positive(account.car),
    marginLoan: positive(account.marginLoan),
    debt: positive(account.debt),
    mortgage: positive(account.mortgage),
    foreignDebt: positive(account.foreignDebt),
    foreignMarginLoan: positive(account.foreignMarginLoan),
  }));
  const positions = input.positions.map(positionSnapshot);
  const currentPositions = positions.filter((position) => position.currentValue > 0);

  const cash = accounts.reduce((sum, account) => sum + account.cash, 0);
  const realEstate = accounts.reduce(
    (sum, account) => sum + account.realEstate,
    0,
  );
  const car = accounts.reduce((sum, account) => sum + account.car, 0);
  const liabilities = accounts.reduce(
    (sum, account) => sum + accountLiabilities(account),
    0,
  );
  const pledgedLoan = accounts.reduce(
    (sum, account) => sum + account.marginLoan + account.foreignMarginLoan,
    0,
  );
  const securities = currentPositions.reduce(
    (sum, position) => sum + position.currentValue,
    0,
  );
  const plannedSecurities = positions.reduce(
    (sum, position) => sum + position.plannedValue,
    0,
  );
  const totalAssets = cash + securities + realEstate + car;
  const netAssets = totalAssets - liabilities;
  const debtRatio = totalAssets > 0 ? (liabilities / totalAssets) * 100 : 0;
  const cashRatio = netAssets > 0 ? (cash / netAssets) * 100 : 0;
  const cashCoverage = liabilities > 0 ? (cash / liabilities) * 100 : 100;
  const estimatedCurrentLiabilities = accounts.reduce(
    (sum, account) =>
      sum +
      account.marginLoan +
      account.debt +
      account.foreignDebt +
      account.foreignMarginLoan,
    0,
  );
  const currentAssets = cash + securities;
  const currentRatio =
    estimatedCurrentLiabilities > 0
      ? (currentAssets / estimatedCurrentLiabilities) * 100
      : null;
  const illiquidRatio =
    totalAssets > 0 ? ((realEstate + car) / totalAssets) * 100 : 0;
  const realEstateRatio = totalAssets > 0 ? (realEstate / totalAssets) * 100 : 0;

  const twSecurities = currentPositions
    .filter((position) => position.market === "tw")
    .reduce((sum, position) => sum + position.currentValue, 0);
  const foreignSecurities = currentPositions
    .filter((position) => position.market === "foreign")
    .reduce((sum, position) => sum + position.currentValue, 0);
  const geographicBase = twSecurities + foreignSecurities;
  const twRatio = geographicBase > 0 ? (twSecurities / geographicBase) * 100 : 0;
  const foreignRatio =
    geographicBase > 0 ? (foreignSecurities / geographicBase) * 100 : 0;
  const geographicConcentration = Math.max(twRatio, foreignRatio);

  const aggregate = new Map<
    string,
    {
      label: string;
      value: number;
      plannedValue: number;
      exposure: number;
      accounts: Set<string>;
      leveraged: boolean;
    }
  >();
  for (const position of positions) {
    if (position.currentValue <= 0 && position.plannedValue <= 0) continue;
    const key =
      position.normalizedName ||
      `${position.account}-${position.market}-未命名部位`;
    const item = aggregate.get(key) ?? {
      label: position.name.trim() || "未命名部位",
      value: 0,
      plannedValue: 0,
      exposure: 0,
      accounts: new Set<string>(),
      leveraged: false,
    };
    item.value += position.currentValue;
    item.plannedValue += position.plannedValue;
    item.exposure += position.currentValue * position.effectiveLeverage;
    item.accounts.add(position.account);
    item.leveraged ||= position.isLeveragedProduct;
    aggregate.set(key, item);
  }
  const aggregatedPositions = [...aggregate.values()].filter(item => item.value > 0).sort(
    (a, b) => b.value - a.value,
  );
  const largestPosition = aggregatedPositions[0];
  const largestPositionRatio =
    securities > 0 && largestPosition
      ? (largestPosition.value / securities) * 100
      : 0;
  const topThreeRatio =
    securities > 0
      ? (aggregatedPositions
          .slice(0, 3)
          .reduce((sum, item) => sum + item.value, 0) /
          securities) *
        100
      : 0;
  const leveragedValue = currentPositions
    .filter((position) => position.isLeveragedProduct)
    .reduce((sum, position) => sum + position.currentValue, 0);
  const leveragedRatio =
    securities > 0 ? (leveragedValue / securities) * 100 : 0;

  const marketExposure = currentPositions.reduce(
    (sum, position) =>
      sum + position.currentValue * position.effectiveLeverage,
    0,
  );
  const riskExposure = marketExposure + realEstate;
  const exposureMultiple =
    netAssets > 0 ? riskExposure / netAssets : Number.POSITIVE_INFINITY;
  const plannedExposure = positions.reduce(
    (sum, position) =>
      sum + position.plannedValue * position.effectiveLeverage,
    0,
  );
  const exposureAfterPlanned =
    netAssets > 0
      ? (riskExposure + plannedExposure) / netAssets
      : Number.POSITIVE_INFINITY;
  const estimatedMaintenance =
    pledgedLoan > 0 ? (securities / pledgedLoan) * 100 : null;
  const estimatedMaintenanceAfterPlanned =
    pledgedLoan > 0
      ? ((securities + plannedSecurities) / pledgedLoan) * 100
      : null;

  const accountSummaries = accounts.map((account) => {
    const accountSecurities = currentPositions
      .filter((position) => position.account === account.name)
      .reduce((sum, position) => sum + position.currentValue, 0);
    const assets =
      account.cash + accountSecurities + account.realEstate + account.car;
    const accountDebt = accountLiabilities(account);
    return {
      name: account.name,
      assets,
      liabilities: accountDebt,
      netAssets: assets - accountDebt,
    };
  });
  const dominantAccount = [...accountSummaries].sort(
    (a, b) => b.netAssets - a.netAssets,
  )[0];
  const dominantAccountRatio =
    netAssets > 0 && dominantAccount
      ? (Math.max(dominantAccount.netAssets, 0) / netAssets) * 100
      : 0;

  const history = [...input.history]
    .filter(point => typeof point.netAssets === "number" && Number.isFinite(point.netAssets))
    .map((point) => ({
      month: String(point.month || "").trim(),
      netAssets: safeNumber(point.netAssets),
    }))
    .filter((point) => point.month)
    .sort((a, b) => a.month.localeCompare(b.month));
  let historicalPeak = 0;
  let maximumDrawdown = 0;
  for (const point of history) {
    historicalPeak = Math.max(historicalPeak, point.netAssets);
    if (historicalPeak > 0) {
      maximumDrawdown = Math.max(
        maximumDrawdown,
        ((historicalPeak - point.netAssets) / historicalPeak) * 100,
      );
    }
  }
  const latestHistory = history.at(-1);
  const firstHistory = history[0];
  const historicalChange =
    firstHistory && latestHistory && firstHistory.netAssets > 0
      ? ((latestHistory.netAssets - firstHistory.netAssets) /
          firstHistory.netAssets) *
        100
      : null;
  let consecutiveDeclines = 0;
  for (let index = history.length - 1; index > 0; index -= 1) {
    if (history[index].netAssets < history[index - 1].netAssets) {
      consecutiveDeclines += 1;
    } else {
      break;
    }
  }

  const dataNotes: string[] = [];
  // Draft orders must not invalidate the concentration of existing holdings.
  const incompletePositions = positions.filter(
    (position) =>
      (!position.normalizedName &&
        (position.price > 0 || position.shares > 0)) ||
      ((position.price > 0 || position.shares > 0) &&
        !(position.price > 0 && position.shares > 0)),
  );
  const describePosition = (position: PositionSnapshot) =>
    `${position.account}／${position.market === "tw" ? "國內" : "國外"}／${position.name.trim() || "未命名部位"}`;
  const incompletePlans = positions.filter(position =>
    (position.plannedPrice > 0 || position.plannedShares > 0) &&
    (!position.normalizedName || !(position.plannedPrice > 0 && position.plannedShares > 0)));
  if (incompletePositions.length) {
    dataNotes.push(
      `目前持倉資料不完整：${incompletePositions.map(describePosition).join("、")}；請核對名稱、價格與股數。比例僅依可計算資料估算，不會隱藏已確認的風險。`,
    );
  }
  for (const position of incompletePlans) {
    dataNotes.push(`加碼草稿未完成：${describePosition(position)}，${!position.normalizedName ? "缺少名稱；" : ""}加碼價位 ${position.plannedPrice}、加碼股數 ${position.plannedShares}；未納入加碼模擬，不影響目前持倉集中度判讀。`);
  }
  if (plannedSecurities > 0) {
    dataNotes.push(
      `預計加碼 ${money(plannedSecurities)} 已從目前總資產排除。加碼模擬假設以現有現金支應、淨資產不變；未建模新增借款或外部入金。${plannedSecurities > cash ? "預計金額超過現有現金，此模擬不可視為可執行方案。" : ""}`,
    );
  }
  if (pledgedLoan > 0) {
    dataNotes.push(
      "質押維持率以全部證券市值估算；實際結果須以券商認列質押品、折算率及契約門檻為準。",
    );
  }
  if (history.length < 3) {
    dataNotes.push("歷史資料少於 3 個月，趨勢與最大回落僅供參考。");
  }
  dataNotes.push(
    "海外部位目前依你放置的市場區域分類；尚未穿透 ETF 底層持股、幣別、匯率與產業重疊。",
  );
  dataNotes.push(
    "淨資產歷史包含存款、提款、負債與估值變化，因此顯示為淨資產變動，不等同投資報酬率。",
  );

  const stressDefinitions: ScenarioDefinition[] = [
    {
      scenario: "2000 網路泡沫",
      shocks: { tw: 0.662, foreign: 0.4741, realEstate: 0.1 },
      positionShocks: { "00631L": 0.95 },
    },
    {
      scenario: "2008 全球金融海嘯",
      shocks: { tw: 0.583, foreign: 0.5525, realEstate: 0.2 },
      positionShocks: { "00631L": 0.85 },
    },
    {
      scenario: "2015 中國股災與全球市場震盪",
      shocks: { tw: 0.281, foreign: 0.12, realEstate: 0.05 },
      positionShocks: { "00631L": 0.459 },
    },
    {
      scenario: "2020 COVID 急跌",
      shocks: { tw: 0.287, foreign: 0.338, realEstate: 0.05 },
      positionShocks: { "00631L": 0.5341 },
    },
    {
      scenario: "2022 通膨升息熊市",
      shocks: { tw: 0.316, foreign: 0.254, realEstate: 0.1 },
      positionShocks: { "00631L": 0.5169 },
    },
  ];
  const stressTests = stressDefinitions.map((definition) =>
    scenarioResult(
      definition,
      currentPositions,
      accounts,
      netAssets,
      pledgedLoan,
    ),
  );
  const severeStress = stressTests.reduce((mostSevere, current) =>
    current.estimatedLoss > mostSevere.estimatedLoss ? current : mostSevere,
  );

  const risks: HealthCheckResult["risks"] = [];
  const addRisk = (
    domain: HealthDomainLabel,
    severity: HealthSeverity,
    title: string,
    evidence: string,
    impact: string,
    action: string,
  ) => risks.push({ domain, severity, title, evidence, impact, action });

  if (netAssets <= 0) {
    addRisk(
      "流動性與負債",
      "高",
      "淨資產為零或負值",
      `目前總資產 ${money(totalAssets)}、總負債 ${money(liabilities)}。`,
      "一般比例在淨資產非正數時會失真，家庭財務緩衝已明顯不足。",
      "先核對資產與負債資料，並優先處理會造成追繳或高利息的負債。",
    );
  }

  if (exposureMultiple > 2) {
    addRisk(
      "槓桿與質押",
      "高",
      "總曝險相對淨資產過高",
      `目前估算曝險 ${multiple(exposureMultiple)}；預計加碼後為 ${multiple(exposureAfterPlanned)}。`,
      "市場下跌時，槓桿與負債會同步放大淨資產波動。",
      "先降低最集中的槓桿部位，再評估任何新增曝險。",
    );
  } else if (exposureMultiple > 1.5) {
    addRisk(
      "槓桿與質押",
      "中",
      "總曝險需要持續監控",
      `目前估算曝險 ${multiple(exposureMultiple)}。`,
      "組合波動可能高於未使用槓桿的家庭資產組合。",
      "以壓力後淨資產與估算維持率設定風險警戒線。",
    );
  }

  if (geographicConcentration > 80) {
    const market = twRatio >= foreignRatio ? "台灣" : "海外";
    addRisk(
      "集中度",
      "高",
      "金融資產集中單一市場",
      `${market}金融部位占 ${percent(geographicConcentration)}；房地產與汽車未混入此比例。`,
      "單一市場、產業與政策事件可能同時影響大部分金融資產。",
      "先確認 ETF 底層市場與重疊，再規劃分散，不只增加不同代號。",
    );
  } else if (geographicConcentration > 65) {
    addRisk(
      "集中度",
      "中",
      "地域配置偏向單一市場",
      `較大市場占金融部位 ${percent(geographicConcentration)}。`,
      "家庭金融資產表現較依賴單一市場。",
      "定期檢查市場占比與 ETF 底層曝險。",
    );
  }

  if (largestPositionRatio > 50 && largestPosition) {
    addRisk(
      "集中度",
      "高",
      "單一標的集中度過高",
      `${largestPosition.label} 跨 SM／WL 合併後占金融部位 ${percent(largestPositionRatio)}。`,
      "單一標的的波動會主導家庭整體投資結果。",
      "設定單一標的上限，並檢查其他 ETF 是否持有相同底層資產。",
    );
  } else if (largestPositionRatio > 30 && largestPosition) {
    addRisk(
      "集中度",
      "中",
      "最大持倉占比較高",
      `${largestPosition.label} 跨帳戶合併後占金融部位 ${percent(largestPositionRatio)}。`,
      "多帳戶並不會降低相同標的帶來的集中風險。",
      "以家庭合併口徑追蹤最大持倉，而不是分別看 SM 與 WL。",
    );
  }

  if (topThreeRatio > 75 && aggregatedPositions.length >= 3) {
    addRisk(
      "集中度",
      topThreeRatio > 90 ? "高" : "中",
      "前三大部位高度集中",
      `前三大標的合計占金融部位 ${percent(topThreeRatio)}。`,
      "少數標的同步下跌時，其他部位難以提供足夠緩衝。",
      "檢查前三大標的的國家、產業與指數重疊。",
    );
  }

  if (leveragedRatio > 25) {
    const leveragedNames = aggregatedPositions
      .filter((position) => position.leveraged)
      .slice(0, 3)
      .map((position) => position.label)
      .join("、");
    addRisk(
      "槓桿與質押",
      "高",
      "槓桿型商品占比偏高",
      `${leveragedNames || "槓桿部位"}約占金融資產 ${percent(leveragedRatio)}。`,
      "每日重設、波動耗損與追蹤偏離可能使長期結果不同於指數倍數。",
      "將槓桿 ETF 獨立列管，使用壓力測試而非只看名目倍數。",
    );
  } else if (leveragedRatio > 10) {
    addRisk(
      "槓桿與質押",
      "中",
      "槓桿型商品需要獨立監控",
      `槓桿型商品約占金融資產 ${percent(leveragedRatio)}。`,
      "長期持有結果可能受每日重設與波動路徑影響。",
      "每月檢查槓桿商品占比、最大回落與壓力損失。",
    );
  }

  if (debtRatio > 50) {
    addRisk(
      "流動性與負債",
      "高",
      "負債占資產比例偏高",
      `總負債占總資產 ${percent(debtRatio)}。`,
      "市場回落或收入變化時，固定還款可能壓縮資產調整空間。",
      "優先盤點投資借款、一般負債與房貸的成本及到期條件。",
    );
  } else if (debtRatio > 30) {
    addRisk(
      "流動性與負債",
      "中",
      "負債需要納入投資風險管理",
      `總負債占總資產 ${percent(debtRatio)}。`,
      "資產波動期間仍需維持還款能力。",
      "保留可動用現金，避免以低流動性資產支應短期負債。",
    );
  }

  if (pledgedLoan > 0 && estimatedMaintenance !== null) {
    if (below(estimatedMaintenance, 180)) {
      addRisk(
        "槓桿與質押",
        "高",
        "估算質押安全空間偏低",
        `以全部證券市值估算維持率約 ${percent(estimatedMaintenance)}。`,
        "市場下跌時可能出現補繳或被動處分風險。",
        "立即依券商實際質押品、折算率與追繳門檻重新核對。",
      );
    } else if (below(estimatedMaintenance, 250)) {
      addRisk(
        "槓桿與質押",
        "中",
        "質押維持率需持續監控",
        `估算維持率約 ${percent(estimatedMaintenance)}。`,
        "市場回落會快速縮小安全空間。",
        "以券商實際數字設定提醒，並保留可補繳資金。",
      );
    }
  }

  if (realEstateRatio > 60) {
    addRisk(
      "資產結構",
      "高",
      "房地產占家庭資產比重過高",
      `房地產約占總資產 ${percent(realEstateRatio)}。`,
      "低流動性資產過高，緊急時可能無法快速轉為現金。",
      "將自用房產與可投資資產分開管理，避免把房產淨值當作短期資金。",
    );
  } else if (realEstateRatio > 40) {
    addRisk(
      "資產結構",
      "中",
      "家庭資產偏向低流動性",
      `房地產約占總資產 ${percent(realEstateRatio)}。`,
      "資產總額看似充足，但可立即調度的比例較低。",
      "維持獨立現金緩衝，並定期更新房產估值。",
    );
  }

  if (cashCoverage < 20 && liabilities > 0) {
    addRisk(
      "流動性與負債",
      cashCoverage < 10 ? "高" : "中",
      "現金相對負債緩衝有限",
      `現金約可覆蓋總負債 ${percent(cashCoverage)}。`,
      "這不代表現金流不足，但遇到追繳或大額到期時調度空間較小。",
      "補充每月支出、收入與負債到期資料前，先將此項視為結構性提醒。",
    );
  }

  if (illiquidRatio > 50) {
    addRisk("資產結構", illiquidRatio > 70 ? "高" : "中", "低流動性資產占比偏高",
      `房地產與汽車合計占總資產 ${percent(illiquidRatio)}。`,
      "帳面資產不一定能即時變現，須保留緊急資金。", "分開管理房產、汽車與可動用資金。");
  }
  if (currentRatio !== null && currentRatio < 150) {
    addRisk("流動性與負債", currentRatio < 100 ? "高" : "中", "估算流動比率偏低",
      `估算流動比率 ${percent(currentRatio)}；低於150%留意、低於100%警戒。`,
      "此估算不含房貸一年內到期額，證券下跌也會削弱覆蓋能力。", "核對一年內到期負債與可變現資產。");
  }

  if (maximumDrawdown > 20) {
    addRisk(
      "壓力承受能力",
      maximumDrawdown > 30 ? "高" : "中",
      "歷史淨資產回落幅度偏大",
      `現有月度紀錄的最大回落約 ${percent(maximumDrawdown)}。`,
      "淨資產變動可能來自市場、資金進出、負債或估值，仍顯示家庭資產波動明顯。",
      "核對回落月份的資金進出與負債變化，不直接當成投資報酬。",
    );
  }

  if (consecutiveDeclines >= 2) {
    addRisk(
      "壓力承受能力",
      "中",
      "淨資產連續下降",
      `月度紀錄已連續 ${consecutiveDeclines} 個月下降。`,
      "若同時伴隨負債增加或槓桿上升，風險可能累積。",
      "先核對最新報價、資金進出與負債餘額。",
    );
  }

  if (
    plannedSecurities > 0 &&
    exposureAfterPlanned > exposureMultiple &&
    exposureAfterPlanned > 1.5
  ) {
    addRisk(
      "槓桿與質押",
      exposureAfterPlanned > 2 ? "高" : "中",
      "預計加碼會提高整體曝險",
      `加碼未計入目前總資產；曝險將由 ${multiple(exposureMultiple)} 升至約 ${multiple(exposureAfterPlanned)}。`,
      "若資金來源是借款，實際風險可能高於目前估算。",
      "執行前確認資金來源，並比較加碼前後的嚴重壓力結果。",
    );
  }

  if (incompletePositions.length) {
    addRisk(
      "集中度",
      "中",
      "部位資料不完整",
      `${incompletePositions.map(describePosition).join("、")}：目前持倉缺少名稱、價格或股數。`,
      "集中度、總資產與壓力損失可能被低估。",
      "先補齊名稱、價格及股數，再以報價時間核對。",
    );
  }

  for (const finding of severeStress.findings) {
    addRisk("壓力承受能力", finding.severity, finding.title,
      `${severeStress.scenario}：${finding.evidence}`, finding.impact,
      "核對壓力後淨資產與質押安全空間，再評估資金調度。");
  }

  // Badge and tooltip derive from the same complete risk list (not the top 8).
  const statusFor = (domain: HealthDomainLabel): HealthStatus => {
    const findings = risks.filter(risk => risk.domain === domain);
    return findings.some(finding => finding.severity === "高") ? "警戒"
      : findings.some(finding => finding.severity === "中") ? "留意" : "良好";
  };

  const rankedRisks = [...risks].sort(
    (a, b) => severityRank[b.severity] - severityRank[a.severity],
  );
  const sortedRisks = rankedRisks.slice(0, 8);
  const findingsFor = (domain: HealthDomainLabel) =>
    rankedRisks
      .filter((risk) => risk.domain === domain)
      .map(({ severity, title, evidence, impact }) => ({
        severity,
        title,
        evidence,
        impact,
      }));

  const domains: HealthCheckResult["domains"] = [
    {
      label: "資產結構",
      value: `低流動性資產占比 ${percent(illiquidRatio)}`,
      status: statusFor("資產結構"),
      explanation: "房地產與汽車獨立計算，不混入台灣金融資產。",
      findings: findingsFor("資產結構"),
    },
    {
      label: "集中度",
      value: largestPosition
        ? `${largestPosition.label} ${percent(largestPositionRatio)}`
        : "無金融部位",
      status: maxStatus(statusFor("集中度"),
        incompletePositions.length || geographicBase <= 0 ? "資料不足" : "良好"),
      explanation: `相同代號已跨 SM／WL 合併，並同時檢查地域與前三大部位。${incompletePositions.length ? "目前持倉有缺漏，比例為暫估；詳見本次判讀。" : ""}${incompletePlans.length ? "加碼草稿未完成，不影響目前集中度；詳見資料檢查。" : ""}`,
      findings: findingsFor("集中度"),
    },
    {
      label: "槓桿與質押",
      value: multiple(exposureMultiple),
      status: statusFor("槓桿與質押"),
      explanation: "包含商品槓桿與估算質押安全空間；不等同券商正式維持率。",
      findings: findingsFor("槓桿與質押"),
    },
    {
      label: "流動性與負債",
      value: `負債比 ${percent(debtRatio)}\n流動比率 ${
        currentRatio === null ? "無流動負債" : percent(currentRatio)
      }`,
      status: statusFor("流動性與負債"),
      explanation:
        "流動比率以現金與可交易證券對估算流動負債計算；不含房貸、房地產與汽車。",
      findings: findingsFor("流動性與負債"),
    },
    {
      label: "壓力承受能力",
      value: severeStress.drawdownPct === null ? "淨資產非正，回撤比例不適用" : `重壓回落 ${percent(severeStress.drawdownPct)}`,
      status: statusFor("壓力承受能力"),
      explanation: "以固定公開情境計算，不使用主觀風險選項。",
      findings: findingsFor("壓力承受能力"),
    },
  ];

  const critical =
    netAssets <= 0 ||
    severeStress.netAssetsAfter <= 0 ||
    exposureMultiple > 2.5;
  const highestStatus = maxStatus(...domains.map((domain) => domain.status));
  const grade: HealthCheckResult["grade"] = critical
    ? "高風險"
    : highestStatus === "警戒"
      ? "警戒"
      : highestStatus === "留意" || highestStatus === "資料不足"
        ? "留意"
        : "穩健";

  const actions = sortedRisks.slice(0, 4).map((risk, index) => ({
    priority: index + 1,
    domain: risk.domain,
    action: risk.action,
    reason: risk.evidence,
    timeframe: index === 0 ? "優先處理" : index === 1 ? "本月檢查" : "持續監控",
  }));
  if (!actions.length) {
    actions.push({
      priority: 1,
      domain: "資產結構",
      action: "維持每月更新報價、負債與淨資產快照。",
      reason: "目前未偵測到達到警戒門檻的主要結構性風險。",
      timeframe: "每月",
    });
  }

  const metrics: HealthCheckResult["metrics"] = [
    {
      label: "目前總資產",
      value: money(totalAssets),
      explanation: "不含尚未成交的預計加碼。",
    },
    {
      label: "目前淨資產",
      value: money(netAssets),
      explanation: `SM／WL 中較大帳戶約占 ${percent(dominantAccountRatio)}。`,
    },
    {
      label: "金融資產配置",
      value: `TW ${percent(twRatio)}／海外 ${percent(foreignRatio)}`,
      explanation: "只計入證券，不含房地產與汽車。",
    },
    {
      label: "現金緩衝",
      value: `${money(cash)}（淨資產 ${percent(cashRatio)}）`,
      explanation: `約可覆蓋總負債 ${percent(cashCoverage)}，不代表每月現金流。`,
    },
    {
      label: "預計加碼",
      value: money(plannedSecurities),
      explanation: `目前未計入資產；模擬後曝險約 ${multiple(exposureAfterPlanned)}。`,
    },
    {
      label: "歷史淨資產變動",
      value:
        history.length >= 2 && historicalChange !== null
          ? `${historicalChange >= 0 ? "+" : ""}${percent(historicalChange)}`
          : "資料不足",
      explanation: `最大歷史回落約 ${percent(maximumDrawdown)}，不等同投資報酬。`,
    },
  ];

  return {
    grade,
    headline:
      grade === "穩健"
        ? "整體結構穩定，持續用家庭合併口徑監控"
        : grade === "留意"
          ? "目前可管理，但已有需要追蹤的結構性風險"
          : grade === "警戒"
            ? "至少一個核心風險已達警戒，應優先處理"
            : "淨資產或壓力結果顯示高風險，需先降低被動賣出可能",
    summary: `系統直接使用 SM、WL、負債、房地產、汽車、目前持股、預計加碼與 ${history.length} 筆月度淨資產紀錄分析。相同代號已跨帳戶合併，目前淨資產 ${money(netAssets)}，辨識出 ${sortedRisks.length} 項主要風險。`,
    domains,
    metrics,
    risks: sortedRisks,
    stressTests,
    actions,
    dataNotes,
    disclaimer:
      "本健檢依目前登錄資料與固定壓力假設提供風險教育，不是個別證券買賣建議、報酬保證、券商正式維持率或專業財務顧問服務。實際決策前請核對報價、質押契約、負債條件、稅務與家庭現金流。",
  };
};
