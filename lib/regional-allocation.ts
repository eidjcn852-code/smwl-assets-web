/** Allocation by the location of current assets; cash and liabilities have no region. */
export const regionalAllocation = (
  domesticSecurities: number,
  foreignSecurities: number,
  realEstate: number,
  car: number,
) => {
  const domestic = domesticSecurities + realEstate + car;
  const foreign = foreignSecurities;
  const total = domestic + foreign;
  return {
    domestic,
    foreign,
    twRatio: total ? ((domestic * 100) / total).toFixed(1) : "0.0",
    foreignRatio: total ? ((foreign * 100) / total).toFixed(1) : "0.0",
  };
};
