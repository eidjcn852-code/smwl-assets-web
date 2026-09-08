export type MonthlyLeverage = {
  leverageWithProperty?: number | null;
  leverageWithoutProperty?: number | null;
  riskExposure?: number;
  propertyValue?: number;
};

export function monthlyLeverage(month: string, netAssets: number, exposure: number, property: number): MonthlyLeverage {
  if (month < "2026-09") return {};
  const valid = [netAssets, exposure, property].every(Number.isFinite) && netAssets > 0;
  return {
    riskExposure: Number.isFinite(exposure) ? exposure : undefined,
    propertyValue: Number.isFinite(property) ? property : undefined,
    leverageWithProperty: valid ? exposure / netAssets : null,
    leverageWithoutProperty: valid ? (exposure - property) / netAssets : null,
  };
}

export function leverageText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}倍` : "—";
}
