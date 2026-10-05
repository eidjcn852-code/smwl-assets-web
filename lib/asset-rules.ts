type RegionalLiabilities = {
  marginLoan: string;
  foreignMarginLoan: string;
  debt: string;
  foreignDebt: string;
};

const amount = (value: string) => {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isExcludedExposure = (name: string) =>
  /^(?:(?:TPE|TWSE|TPEX):)?00865B(?:\.(?:TW|TWO))?$/i.test(name.trim());

// Keep the original spreadsheet fields readable while presenting one region-neutral
// pledge loan and one general debt amount. Running this again must not double-count.
export const mergeRegionalLiabilities = <T extends RegionalLiabilities>(account: T): T => ({
  ...account,
  marginLoan: String(amount(account.marginLoan) + amount(account.foreignMarginLoan)),
  foreignMarginLoan: "0",
  debt: String(amount(account.debt) + amount(account.foreignDebt)),
  foreignDebt: "0",
});
