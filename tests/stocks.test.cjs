const test = require('node:test');
const assert = require('node:assert/strict');
const { backend, frontend } = require('./helpers.cjs');
const codes = ['00878', '00919', '0056', '00982A', '0050'];

const create = () => {
  const app = frontend(backend()).app;
  app.selectedYear.value = 2026;
  app.selectedStockMonth.value = 10;
  return app;
};

// Seed an annual closing profit via the same prior-year editing path used by the UI.
const setClosingProfit = (app, profit, code = app.activeStockCode.value) => {
  const year = app.selectedYear.value;
  app.selectedYear.value = year + 1;
  app.previousStockPortfolio.value.rows.find(row => row.code === code).overview.profit = profit;
  app.selectedYear.value = year;
};

test('stock inputs are independent by year, code and month for every supported asset', () => {
  const a = create();
  Object.assign(a.stockMonthlyRows.value[0], { date: '10/15', shares: 100, price: 10, fee: 20 });
  a.stockManualDisplayRows.value[0].purchase = 200;
  a.stockDividendRows.value[0].shares = 1;
  a.stockOverview.value.estimatedFee = 2;
  a.stockPortfolioRows.value.find(row => row.code === '0056').overview.price = 25;

  a.selectedYear.value = 2027;
  assert.equal(a.stockMonthlyRows.value[0].shares, null);
  assert.equal(a.stockManualDisplayRows.value[0].purchase, null);
  assert.equal(a.stockDividendRows.value[0].shares, null);
  assert.equal(a.stockOverview.value.estimatedFee, null);
  assert.equal(a.stockPortfolioRows.value.find(row => row.code === '0056').overview.price, null);
  a.stockMonthlyRows.value[0].shares = 500;

  a.selectedYear.value = 2026;
  assert.equal(a.stockMonthlyRows.value[0].shares, 100);
  assert.equal(a.stockManualDisplayRows.value[0].purchase, 200);
  assert.equal(a.stockDividendRows.value[0].shares, 1);
  assert.equal(a.stockOverview.value.estimatedFee, 2);
  assert.equal(a.stockPortfolioRows.value.find(row => row.code === '0056').overview.price, 25);
  a.activeStockCode.value = '00919';
  assert.equal(a.stockMonthlyRows.value[0].shares, null);
  a.activeStockCode.value = '00878';
  a.selectedStockMonth.value = 9;
  assert.equal(a.stockMonthlyRows.value[0].shares, null);
  a.selectedStockMonth.value = 10;
  assert.equal(a.stockMonthlyRows.value[0].shares, 100);
});

test('prior-year comparison and that year selected as current share one source', () => {
  const a = create();
  const prior = a.previousStockPortfolio.value.rows;
  Object.assign(prior[0].overview, { cost: 1000, netValue: 1500, profit: 500, dividends: 100, totalReturn: 600 });
  prior.find(row => row.code === '0056').overview.cost = 200;
  Object.assign(a.previousStockYear.value.stocks['00878'].monthlyRecords[1][0], { shares: 1, price: 10, fee: 20 });
  assert.equal(a.stockPortfolioSections.value[1].totals.cost, 1200);

  a.selectedYear.value = 2025;
  assert.equal(a.stockOverview.value.cost, 1000);
  assert.equal(a.stockOverview.value.netValue, 1500);
  assert.equal(a.stockOverview.value.profit, 500);
  assert.equal(a.stockOverview.value.dividends, 100);
  assert.equal(a.stockPortfolioTotals.value.totalReturn, 619);
  assert.equal(a.stockPortfolioRefundTotal.value, 19);
  a.selectedYear.value = 2026;
  a.previousStockPortfolio.value.rows[0].overview.lots = 3;
  a.selectedYear.value = 2025;
  assert.equal(a.stockOverview.value.lots, 3);
  a.selectedYear.value = 2026;
  assert.equal(a.previousStockPortfolio.value.rows[0].overview.lots, 3);
  assert.equal(a.previousStockPortfolio.value.refund, 19);
});

for (const code of codes) test(`${code} cost carries forward recursively and adds only the matching year trades`, () => {
  const a = create();
  a.activeStockCode.value = code;
  a.selectedYear.value = 2025;
  a.previousStockPortfolio.value.rows.find(row => row.code === code).overview.cost = 1000; // 2024 closing cost
  Object.assign(a.stockMonthlyRows.value[0], { shares: 100, price: 10 });
  a.stockManualDisplayRows.value[0].purchase = 200;
  assert.equal(a.stockOverview.value.cost, 2200);

  a.selectedYear.value = 2026;
  Object.assign(a.stockMonthlyRows.value[0], { shares: 100, price: 20 });
  a.stockManualDisplayRows.value[0].purchase = 300;
  assert.equal(a.stockOverview.value.cost, 4500);
  assert.equal(a.previousStockPortfolio.value.rows.find(row => row.code === code).overview.cost, 2200);
  a.selectedYear.value = 2027;
  assert.equal(a.stockOverview.value.cost, 4500);
  assert.equal(a.previousStockPortfolio.value.rows.find(row => row.code === code).overview.cost, 4500);

  a.stockRecords.value[2025].stocks[code].monthlyRecords[10][0].price = 11;
  assert.equal(a.stockOverview.value.cost, 4600);
  a.selectedYear.value = 2026;
  assert.equal(a.stockOverview.value.cost, 4600);
  a.selectedStockMonth.value = 9;
  assert.equal(a.stockOverview.value.cost, 4600);
});

test('monthly and annual rollups, dividends and refunds use their own year', () => {
  const a = create();
  a.activeStockCode.value = '00919';
  a.selectedYear.value = 2025;
  Object.assign(a.previousStockPortfolio.value.rows.find(row => row.code === '00919').overview, { cost: 8000, lots: 0.9 });
  Object.assign(a.stockMonthlyRows.value[0], { shares: 100, price: 10, fee: 20 });
  Object.assign(a.stockDividendRows.value[0], { shares: 1, perShare: 0.5, transferFee: 10 });
  Object.assign(a.stockOverview.value, { price: 10, estimatedFee: 20, estimatedTax: 10 });
  assert.equal(a.stockOverview.value.cost, 9020);
  assert.equal(a.stockDisplayRows.value[9].quantity, 0.1);
  assert.equal(a.stockRegularTotals.value.purchase, 1000);
  assert.equal(a.stockOverview.value.profit, 950);
  assert.equal(a.stockOverview.value.dividends, 490);
  assert.equal(a.stockPortfolioRefundTotal.value, 19);

  a.selectedYear.value = 2026;
  Object.assign(a.stockMonthlyRows.value[0], { shares: 200, price: 20, fee: 40 });
  Object.assign(a.stockDividendRows.value[0], { shares: 2, perShare: 0.6, transferFee: 20 });
  Object.assign(a.stockOverview.value, { price: 20, estimatedFee: 40, estimatedTax: 20 });
  assert.equal(a.stockOverview.value.lots, 1.2);
  assert.equal(a.stockOverview.value.cost, 13060);
  assert.equal(a.stockRegularTotals.value.purchase, 4000);
  assert.equal(a.stockOverview.value.profit, 10880);
  assert.equal(a.stockDividendTotals.value.cashDividend, 1200);
  assert.equal(a.stockOverview.value.dividends, 1180);
  assert.equal(a.stockPortfolioRefundTotal.value, 39);
  const prior = a.previousStockPortfolio.value.rows.find(row => row.code === '00919');
  assert.equal(prior.overview.profit, 950);
  assert.equal(prior.overview.dividends, 490);
  assert.equal(a.previousStockPortfolio.value.refund, 19);
  assert.equal(a.stockPortfolioSections.value[0].totals.dividends, 1180);
  assert.equal(a.stockPortfolioSections.value[1].totals.dividends, 490);
});

test('explicit historical closing values can be cleared to resume detail calculations', () => {
  const a = create();
  a.selectedYear.value = 2025;
  Object.assign(a.stockMonthlyRows.value[0], { shares: 100, price: 10, fee: 20 });
  a.selectedYear.value = 2026;
  const prior = a.previousStockPortfolio.value.rows[0].overview;
  assert.equal(prior.cost, 1020);
  prior.cost = 1200;
  assert.equal(a.stockOverview.value.cost, 1200);
  a.selectedYear.value = 2025;
  assert.equal(a.stockOverview.value.cost, 1200);
  a.selectedYear.value = 2026;
  prior.cost = '';
  assert.equal(a.stockOverview.value.cost, 1020);
  assert.equal(a.previousStockPortfolio.value.refund, 19);
});

test('annual source contains inputs only, and dates use the selected year', () => {
  const a = create();
  a.selectedYear.value = 2020;
  a.stockMonthlyRows.value[0].date = '10/15';
  assert.equal(a.stockDateInputValue('10/15'), '2020-10-15');
  assert.ok(a.availableYears.value.includes(2020));
  a.stockOverview.value.price = 34.9;
  a.previousStockPortfolio.value.rows[0].overview.lots = 48.561;
  assert.equal(a.stockOverview.value.marketValue, 1694778);
  const record = a.stockRecords.value[2020].stocks['00878'];
  assert.equal(record.overview.marketValue, null);
  assert.equal(record.monthlyRecords[10][0].purchase, undefined);
  assert.notStrictEqual(record.monthlyRecords[1][0], record.monthlyRecords[2][0]);
  a.selectedYear.value = 2021;
  assert.equal(a.stockDateInputValue('10/15'), '2021-10-15');
  assert.equal(a.stockMonthlyRows.value[0].date, '');
  assert.ok(JSON.parse(JSON.stringify(a.stockRecords.value))[2020].stocks['00878']);
});

test('all five stocks share derived fields and calculations without sharing inputs', () => {
  const a = create();
  const results = [];
  for (const code of codes) {
    a.activeStockCode.value = code;
    a.selectedStockMonth.value = 10;
    Object.assign(a.previousStockPortfolio.value.rows.find(row => row.code === code).overview, { cost: 1000, lots: 0.8 });
    Object.assign(a.stockMonthlyRows.value[0], { shares: 100, price: 10, fee: 20 });
    Object.assign(a.stockManualDisplayRows.value[0], { quantity: 0.1, purchase: 200, fee: 1, price: 2 });
    Object.assign(a.stockDividendRows.value[0], { shares: 1, perShare: 0.5, transferFee: 10 });
    Object.assign(a.stockOverview.value, { price: 10, estimatedFee: 20, estimatedTax: 10 });
    const before = {};
    for (const field of ['lots', 'cost', 'marketValue', 'netValue', 'profit', 'dividends', 'totalReturn']) {
      assert.equal(a.isStockDerivedField(code, field), true);
      before[field] = a.stockOverview.value[field];
      a.stockOverview.value[field] = 999999; // Computed fields cannot be overwritten in current-year views.
      assert.equal(a.stockOverview.value[field], before[field]);
    }
    assert.equal(before.cost, 2221);
    assert.equal(before.profit, 7749);
    assert.equal(before.dividends, 490);
    assert.equal(before.totalReturn, 8239);
    assert.equal(a.stockPortfolioRows.value.find(row => row.code === code).overview.cost, 2221);
    assert.equal(a.stockRefundTotal.value, 19);
    results.push(JSON.stringify({ overview: before, annual: a.stockDisplayRows.value, manual: a.stockManualTotals.value, dividends: a.stockDividendTotals.value }));
  }
  assert.ok(results.every(result => result === results[0]));
  a.activeStockCode.value = '00919';
  a.stockMonthlyRows.value[0].price = 20; // Only 00919 changes.
  assert.equal(a.stockOverview.value.cost, 3221);
  a.activeStockCode.value = '00878';
  assert.equal(a.stockOverview.value.cost, 2221);
});

test('portfolio refunds equal the five supported stocks annual totals in the same year', () => {
  const a = create();
  let expected = 0;
  for (const [index, code] of codes.entries()) {
    const fee = (index + 1) * 20;
    a.activeStockCode.value = code;
    Object.assign(a.stockMonthlyRows.value[0], { shares: 1, price: 10, fee });
    a.selectedStockMonth.value = 9;
    Object.assign(a.stockMonthlyRows.value[0], { shares: 1, price: 10, fee });
    expected += a.stockRefundTotal.value;
    a.selectedStockMonth.value = 10;
  }
  assert.equal(expected, 590);
  assert.equal(a.stockPortfolioRefundTotal.value, expected);
  assert.deepEqual(Array.from(a.stockCodes), codes);
  assert.deepEqual(Array.from(a.stockPortfolioRows.value, row => row.code), codes);
  assert.equal(a.stockRecords.value[2026].stocks['6757'], undefined);
  a.selectedYear.value = 2025;
  assert.equal(a.stockPortfolioRefundTotal.value, 0);
  Object.assign(a.stockMonthlyRows.value[0], { shares: 1, price: 10, fee: 10 });
  assert.equal(a.stockPortfolioRefundTotal.value, 9);
  a.selectedYear.value = 2026;
  assert.equal(a.stockPortfolioRefundTotal.value, expected);
  assert.equal(a.previousStockPortfolio.value.refund, 9);
  a.stockMonthlyRows.value[0].fee = 30;
  assert.equal(a.stockPortfolioRefundTotal.value, expected - 70);
});

test('cumulative results use the fixed opening balance and selected-year profit without replaying history', () => {
  const a = create();
  a.selectedYear.value = 2025;
  Object.assign(a.previousStockPortfolio.value.rows[0].overview, { dividends: 100, totalReturn: 200 });
  Object.assign(a.stockDividendRows.value[0], { shares: 1, perShare: 0.5, transferFee: 10 });
  setClosingProfit(a, 110);
  a.selectedYear.value = 2026;
  a.activeStockCode.value = '00919';
  Object.assign(a.stockDividendRows.value[0], { shares: 2, perShare: 0.6, transferFee: 20 });
  setClosingProfit(a, -1230);
  Object.assign(a.stockRecords.value[2026].stocks['0056'].dividends[0], { shares: 1, perShare: 0.03, transferFee: 0 });
  setClosingProfit(a, 10, '0056');
  assert.equal(a.stockPortfolioTotals.value.dividends, 1210);
  assert.equal(a.stockCumulativeTotals.value.dividends, 175911);
  assert.equal(a.stockCumulativeTotals.value.totalReturn, 174691);
  assert.equal(a.stockPortfolioSections.value[1].totals.dividends, 490);
  a.selectedYear.value = 2025;
  assert.equal(a.stockCumulativeTotals.value.dividends, 174701);
  assert.equal(a.stockCumulativeTotals.value.totalReturn, 171675);
  a.previousStockPortfolio.value.rows[0].overview.totalReturn = '';
  assert.equal(a.stockCumulativeTotals.value.totalReturn, 171675);
  a.selectedYear.value = 2026;
  assert.equal(a.stockCumulativeTotals.value.totalReturn, 174691);
  a.selectedYear.value = 2027;
  assert.equal(a.stockCumulativeTotals.value.dividends, 175911);
  assert.equal(a.stockCumulativeTotals.value.totalReturn, 175911);
});

test('annual table keeps its own totals while cumulative returns exclude historical profits and refunds', () => {
  const a = create();
  a.selectedYear.value = 2025;
  setClosingProfit(a, 100);
  Object.assign(a.stockMonthlyRows.value[0], { shares: 1, price: 10, fee: 20 });
  a.activeStockCode.value = '00919';
  setClosingProfit(a, -20);
  Object.assign(a.stockMonthlyRows.value[0], { shares: 1, price: 10, fee: 40 });
  setClosingProfit(a, 30, '0056');
  assert.equal(a.stockPortfolioRefundTotal.value, 58);
  assert.equal(a.stockPortfolioTotals.value.totalReturn, 168);

  a.selectedYear.value = 2026;
  a.activeStockCode.value = '00878';
  setClosingProfit(a, 200);
  Object.assign(a.stockMonthlyRows.value[0], { shares: 1, price: 10, fee: 30 });
  a.activeStockCode.value = '00919';
  setClosingProfit(a, 300);
  Object.assign(a.stockMonthlyRows.value[0], { shares: 1, price: 10, fee: 50 });
  assert.equal(a.stockPortfolioRefundTotal.value, 78);
  assert.equal(a.stockPortfolioTotals.value.totalReturn, 578);
  assert.equal(a.stockPortfolioSections.value[1].totals.totalReturn, 168);
  assert.equal(a.stockCumulativeTotals.value.totalReturn, 175279);
  assert.equal(a.stockOverview.value.totalReturn, 300); // Do not write refunds into per-stock returns.

  a.activeStockCode.value = '00878';
  a.stockMonthlyRows.value[0].fee = 20;
  assert.equal(a.stockPortfolioTotals.value.totalReturn, 568);
  assert.equal(a.stockCumulativeTotals.value.totalReturn, 175269);
  assert.equal(a.stockOverview.value.totalReturn, 200);
  a.selectedYear.value = 2025;
  assert.equal(a.stockPortfolioTotals.value.totalReturn, 168);
  assert.equal(a.stockCumulativeTotals.value.totalReturn, 171675);
});

test('per-stock return follows profit plus net dividends as prices and transfer fees change', () => {
  for (const code of codes) {
    const a = create();
    a.activeStockCode.value = code;
    Object.assign(a.previousStockPortfolio.value.rows.find(row => row.code === code).overview, { cost: 1000, lots: 1 });
    Object.assign(a.stockOverview.value, { price: 1, estimatedFee: 20, estimatedTax: 10 });
    Object.assign(a.stockDividendRows.value[0], { shares: 1, perShare: 0.05, transferFee: 10 });
    assert.equal(a.stockOverview.value.profit, -30);
    assert.equal(a.stockOverview.value.dividends, 40);
    assert.equal(a.stockOverview.value.totalReturn, 10);
    assert.equal(a.stockPortfolioRows.value.find(row => row.code === code).overview.totalReturn, 10);
    a.stockDividendRows.value[0].transferFee = 20;
    assert.equal(a.stockOverview.value.totalReturn, 0);
    a.stockOverview.value.price = 0.9;
    assert.equal(a.stockOverview.value.totalReturn, -100);
    assert.equal(a.stockPortfolioTotals.value.totalReturn, -100);
    a.stockOverview.value.price = '';
    assert.equal(a.stockOverview.value.totalReturn, null);
  }
});

for (const code of codes) test(`${code} holdings carry forward with regular shares converted to lots and manual quantities in lots`, () => {
  const a = create();
  a.activeStockCode.value = code;
  a.selectedYear.value = 2025;
  a.previousStockPortfolio.value.rows.find(row => row.code === code).overview.lots = 0.5;
  Object.assign(a.stockMonthlyRows.value[0], { shares: 100, price: 10 });
  a.stockManualDisplayRows.value[0].quantity = 0.2;
  assert.equal(a.stockOverview.value.lots, 0.8);
  a.selectedYear.value = 2026;
  Object.assign(a.stockMonthlyRows.value[0], { shares: 250, price: 10 });
  a.stockManualDisplayRows.value[0].quantity = 0.05;
  assert.equal(a.stockOverview.value.lots, 1.1);
  assert.equal(a.stockPortfolioRows.value.find(row => row.code === code).overview.lots, 1.1);
  a.selectedYear.value = 2027;
  a.stockOverview.value.price = 10;
  assert.equal(a.stockOverview.value.lots, 1.1);
  assert.equal(a.stockOverview.value.marketValue, 11000);
  a.stockRecords.value[2025].stocks[code].monthlyRecords[10][0].shares = 200;
  assert.equal(a.stockOverview.value.lots, 1.2);
  assert.equal(a.stockOverview.value.marketValue, 12000);
  a.stockOverview.value.lots = 999;
  assert.equal(a.stockOverview.value.lots, 1.2);
  assert.equal(a.isStockDerivedField(code, 'lots'), true);
  for (const [field, value] of [['estimatedFee', 40], ['estimatedTax', 5]]) {
    assert.equal(a.isStockDerivedField(code, field), false);
    a.stockOverview.value[field] = value;
    assert.equal(a.stockOverview.value[field], value);
  }
  assert.equal(a.stockOverview.value.netValue, 11955);
  const previous = a.previousStockPortfolio.value.rows.find(row => row.code === code).overview;
  previous.lots = 0;
  assert.equal(a.stockOverview.value.lots, 0);
  previous.lots = '';
  assert.equal(a.stockOverview.value.lots, 1.2);
  assert.equal(a.stockRecords.value[2027].stocks[code].overview.lots, null);
});

test('regular average prices use completed purchase amounts weighted by shares, excluding fees and incomplete rows', () => {
  for (const code of codes) {
    const a = create();
    a.activeStockCode.value = code;
    assert.equal(a.stockDisplayRows.value[9].averagePrice, null);
    assert.equal(a.stockRegularAveragePrice.value, null);
    Object.assign(a.stockMonthlyRows.value[0], { shares: 100, price: 10, fee: 500 });
    Object.assign(a.stockMonthlyRows.value[1], { shares: 300, price: 20 });
    a.stockMonthlyRows.value[2].shares = 100; // No unit price yet: do not dilute the average.
    Object.assign(a.stockMonthlyRows.value[3], { shares: 0, price: 999 });
    assert.equal(a.stockDisplayRows.value[9].averagePrice, 17.5);
    assert.equal(a.stockRegularAveragePrice.value, 17.5);
    a.selectedStockMonth.value = 9;
    Object.assign(a.stockMonthlyRows.value[0], { shares: 100, price: 30 });
    assert.equal(a.stockDisplayRows.value[8].averagePrice, 30);
    assert.equal(a.stockRegularAveragePrice.value, 20); // (7000 + 3000) / (400 + 100), not (17.5 + 30) / 2.
    a.selectedStockMonth.value = 8;
    Object.assign(a.stockMonthlyRows.value[0], { shares: 3, price: 10.999 });
    assert.equal(a.stockMonthlyTotals.value.purchase, 32);
    assert.equal(a.stockDisplayRows.value[7].averagePrice, 10.67);
    assert.equal(a.stockRegularAveragePrice.value, 19.94);
    a.selectedStockMonth.value = 10;
    a.stockMonthlyRows.value[0].shares = 0;
    a.stockMonthlyRows.value[1].shares = 0;
    assert.equal(a.stockDisplayRows.value[9].averagePrice, null);
  }
});

test('all stocks include actual regular and manual purchase fees in cost without double counting historical closing costs', () => {
  for (const code of codes) {
    const a = create();
    a.activeStockCode.value = code;
    a.selectedYear.value = 2025;
    a.previousStockPortfolio.value.rows.find(row => row.code === code).overview.cost = 1000;
    Object.assign(a.stockMonthlyRows.value[0], { shares: 100, price: 10, fee: 20.1 });
    Object.assign(a.stockManualDisplayRows.value[0], { quantity: 0.2, purchase: 200, fee: 1.2 });
    assert.equal(a.stockOverview.value.cost, 2221.3);
    assert.equal(a.stockRefundTotal.value, 19.1); // Refund is reported separately, not deducted from cost.
    a.selectedYear.value = 2026;
    Object.assign(a.stockMonthlyRows.value[0], { shares: 300, price: 10, fee: 40.2 });
    Object.assign(a.stockManualDisplayRows.value[0], { quantity: 0.5, purchase: 500, fee: 2.3 });
    assert.equal(a.stockOverview.value.cost, 5763.8);
    assert.equal(a.stockPortfolioRows.value.find(row => row.code === code).overview.cost, 5763.8);
    a.selectedYear.value = 2027;
    Object.assign(a.stockOverview.value, { estimatedFee: 999, estimatedTax: 888 });
    assert.equal(a.stockOverview.value.cost, 5763.8); // Estimated sale charges are not purchase cost.
    a.stockRecords.value[2025].stocks[code].monthlyRecords[10][0].fee = 30.1;
    assert.equal(a.stockOverview.value.cost, 5773.8);
    a.selectedYear.value = 2026;
    a.previousStockPortfolio.value.rows.find(row => row.code === code).overview.cost = 2220;
    assert.equal(a.stockOverview.value.cost, 5762.5); // Closing cost already includes 2025 fees.
  }
});

test('entered year-end returns remain closing values while later-year prices change', () => {
  const a = create();
  const closed = a.previousStockPortfolio.value.rows[0].overview;
  Object.assign(closed, { profit: 100, dividends: 20, totalReturn: 120 });
  Object.assign(a.stockMonthlyRows.value[0], { shares: 100, price: 10, fee: 20 });
  a.stockOverview.value.price = 50;
  assert.equal(a.stockPortfolioSections.value[1].totals.totalReturn, 120);
  assert.equal(a.stockPortfolioTotals.value.totalReturn, 3999);
  assert.equal(a.stockCumulativeTotals.value.totalReturn, 178700);
  a.stockOverview.value.price = 60;
  assert.equal(a.stockPortfolioSections.value[1].totals.totalReturn, 120);
  assert.equal(a.stockPortfolioTotals.value.totalReturn, 4999);
  assert.equal(a.stockCumulativeTotals.value.totalReturn, 179700);
});
