// Formula engine. Reads current records through a getter and never changes inputs.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'));
    else root.StockCalculations = factory(root.StockModel);
})(globalThis, function (model) {
    'use strict';
    const {stockCodes, stockTrackingPolicy, overviewFields, hasStockValue, emptyStockRecord, emptyStockYear, isStockDerivedField} = model;
    function createStockCalculations(getRecords, historicalRefundForYear = () => null) {
        const detailedStockCodes = stockCodes;
        const stockRecordForYear = (year, code) => getRecords()[year]?.stocks[code] || emptyStockRecord();
        const readYear = year => getRecords()[year] || emptyStockYear();
        const stockInputNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
        const stockInputRound = value => Math.round((value + Number.EPSILON) * 100) / 100;
        const stockDividendCash = row => {
            if ([row.shares, row.perShare].some(value => value === null || value === undefined || value === '')) return '';
            const value = Number(row.shares) * Number(row.perShare) * 1000;
            return Number.isFinite(value) ? Number(value.toPrecision(15)) : '';
        };
        const stockCashDividends = (code, year) => Number(stockRecordForYear(year, code).dividends.reduce((sum, row) =>
            sum + stockInputNumber(stockDividendCash(row)), 0).toPrecision(15));
        const stockNetDividends = (code, year) => {
            const fees = stockRecordForYear(year, code).dividends.reduce((sum, row) => sum + stockInputNumber(row.transferFee), 0);
            return Number((stockCashDividends(code, year) - stockInputRound(fees)).toPrecision(15));
        };
        const stockMarketValue = (overview, code, year) => {
            const lots = stockLotsForYear(year, code);
            if (!hasStockValue(overview.price)) return null;
            const value = Number(overview.price) * lots * 1000;
            return Number.isFinite(value) ? Math.trunc(Number(value.toPrecision(15))) : null;
        };
        const stockNetValue = (overview, code, year) => {
            const marketValue = stockMarketValue(overview, code, year);
            return marketValue === null ? null : stockInputRound(marketValue - stockInputNumber(overview.estimatedFee) - stockInputNumber(overview.estimatedTax));
        };
        const stockInvestmentProfit = (code, overview, year) => {
            const netValue = hasStockValue(overview.netValue) ? stockInputNumber(overview.netValue) : stockNetValue(overview, code, year);
            const cost = detailedStockCodes.includes(code) ? stockCostForYear(year, code) : overview.cost;
            if (netValue === null || cost === null || cost === undefined || cost === '') return null;
            return stockInputRound(netValue - stockInputNumber(cost));
        };
        const stockTotalReturn = (code, overview, year) => {
            const profit = hasStockValue(overview.profit) ? stockInputNumber(overview.profit) : stockInvestmentProfit(code, overview, year);
            if (profit === null) return null;
            const dividends = hasStockValue(overview.dividends) ? stockInputNumber(overview.dividends) : stockNetDividends(code, year);
            return stockInputRound(profit + dividends);
        };
        const sumStockPortfolio = rows => Object.fromEntries(['cost', 'netValue', 'profit', 'dividends', 'totalReturn'].map(key =>
            [key, stockInputRound(rows.reduce((sum, row) => sum + stockInputNumber(row.overview[key]), 0))]));
        const stockAnnualTotals = (year, rows = stockPortfolioRowsForYear(year)) => {
            const totals = sumStockPortfolio(rows);
            return { ...totals, totalReturn: stockInputRound(totals.totalReturn + stockRefundTotalForYear(year)) };
        };
        const stockRefundTotalForYear = year => {
            const historical = historicalRefundForYear(year);
            if (hasStockValue(historical)) return stockInputNumber(historical);
            const data = readYear(year);
            return stockInputRound(detailedStockCodes.reduce((sum, code) =>
                sum + stockRefundsForRecord(data.stocks[code]).reduce((subtotal, amount) => subtotal + stockInputNumber(amount), 0), 0));
        };
        const stockOrderTotals = rows => {
            const totals = rows.reduce((sum, row) => ({
                quantity: sum.quantity + stockInputNumber(row.quantity),
                purchase: sum.purchase + stockInputNumber(row.purchase),
                fee: sum.fee + stockInputNumber(row.fee)
            }), { quantity: 0, purchase: 0, fee: 0 });
            return { quantity: Math.round((totals.quantity + Number.EPSILON) * 1000) / 1000,
                purchase: stockInputRound(totals.purchase), fee: stockInputRound(totals.fee) };
        };
        const stockPurchase = row => {
            if ([row.shares, row.price].some(value => value === null || value === undefined || value === '')) return '';
            const product = Number(row.shares) * Number(row.price);
            if (!Number.isFinite(product)) return '';
            // Remove binary floating-point noise before applying INT (floor).
            return Math.floor(Number(product.toPrecision(15)));
        };
        const stockMonthTotals = rows => {
            const totals = rows.reduce((total, row) => ({
                shares: total.shares + stockInputNumber(row.shares),
                purchase: total.purchase + stockInputNumber(stockPurchase(row)),
                fee: total.fee + stockInputNumber(row.fee)
            }), { shares: 0, purchase: 0, fee: 0 });
            return { ...totals, fee: stockInputRound(totals.fee) };
        };
        const stockAveragePrice = rows => {
            const purchased = rows.filter(row => stockPurchase(row) !== '' && stockInputNumber(row.shares) > 0);
            const shares = purchased.reduce((sum, row) => sum + stockInputNumber(row.shares), 0);
            return shares > 0 ? stockInputRound(purchased.reduce((sum, row) => sum + stockPurchase(row), 0) / shares) : null;
        };
        const stockRefundsForRecord = record => Array.from({ length: 12 }, (_, index) => {
            const rows = record.monthlyRecords[index + 1];
            const count = rows.filter(row => stockInputNumber(row.shares) > 0 && stockInputNumber(row.price) > 0).length;
            const hasFee = rows.some(row => row.fee !== null && row.fee !== undefined && row.fee !== '');
            if (!count && !hasFee) return null;
            return stockInputRound(stockMonthTotals(rows).fee - count);
        });
        const stockCostForYear = (year, code) => {
            const record = getRecords()[year]?.stocks[code];
            if (!record) return 0;
            if (hasStockValue(record.overview.cost)) return stockInputNumber(record.overview.cost);
            const base = stockCostForYear(year - 1, code);
            const regular = Object.values(record.monthlyRecords)
                .reduce((sum, rows) => {
                    const totals = stockMonthTotals(rows);
                    return sum + totals.purchase + totals.fee;
                }, 0);
            const manual = stockOrderTotals(record.manualRows);
            return stockInputRound(base + regular + manual.purchase + manual.fee);
        };
        const stockLotsForYear = (year, code) => {
            const record = getRecords()[year]?.stocks[code];
            if (!record) return 0;
            if (hasStockValue(record.overview.lots)) return stockInputNumber(record.overview.lots);
            const base = stockLotsForYear(year - 1, code);
            const regular = Object.values(record.monthlyRecords).reduce((sum, rows) => sum + stockMonthTotals(rows).shares, 0) / 1000;
            const manual = stockOrderTotals(record.manualRows).quantity;
            return Math.round((base + regular + manual + Number.EPSILON) * 1000) / 1000;
        };
        const stockAnnualRows = record => Array.from({ length: 12 }, (_, index) => {
            const month = index + 1;
            const rows = record.monthlyRecords[month];
            const totals = stockMonthTotals(rows);
            const hasValue = value => value !== null && value !== undefined && value !== '';
            return {
                month,
                quantity: rows.some(row => hasValue(row.shares)) ? totals.shares / 1000 : null,
                purchase: rows.some(row => stockPurchase(row) !== '') ? totals.purchase : null,
                fee: rows.some(row => hasValue(row.fee)) ? totals.fee : null,
                averagePrice: stockAveragePrice(rows)
            };
        });
        const stockCumulativeTotals = (year = Math.max(stockTrackingPolicy.startYear, ...Object.keys(getRecords()).map(Number))) => {
            const {startYear, openingDividends, openingTotalReturn} = stockTrackingPolicy;
            // The opening figures cover all history through 2025; never add those years again.
            if (Number(year) < startYear) return {dividends: openingDividends, totalReturn: openingTotalReturn};
            let dividends = openingDividends, refunds = 0;
            for (const storedYear of Object.keys(getRecords()).map(Number)) {
                if (storedYear < startYear || storedYear > Number(year)) continue;
                const totals = sumStockPortfolio(stockPortfolioRowsForYear(storedYear));
                dividends += totals.dividends;
                refunds += stockRefundTotalForYear(storedYear);
            }
            const current = sumStockPortfolio(stockPortfolioRowsForYear(Number(year)));
            return {dividends: stockInputRound(dividends),
                totalReturn: stockInputRound(dividends + current.profit + refunds)};
        };
        const stockOverviewValue = (year, code, key) => {
            const target = stockRecordForYear(year, code).overview;
            if (isStockDerivedField(code, key) && hasStockValue(target[key])) return target[key];
            switch (key) {
                case 'marketValue': return stockMarketValue(target, code, year);
                case 'lots': return stockLotsForYear(year, code);
                case 'cost': return stockCostForYear(year, code);
                case 'netValue': return stockNetValue(target, code, year);
                case 'profit': return stockInvestmentProfit(code, target, year);
                case 'dividends': return stockNetDividends(code, year);
                case 'totalReturn': return stockTotalReturn(code, target, year);
                default: return target[key];
            }
        };
        const stockPortfolioRowsForYear = year => stockCodes.map(code => ({
            code, overview: Object.fromEntries(overviewFields.map(key => [key, stockOverviewValue(year, code, key)]))
        }));
        const stockDividendTotals = (code, year) => {
            const rows = stockRecordForYear(year, code).dividends;
            const shares = rows.reduce((sum, row) => sum + stockInputNumber(row.shares), 0);
            const fees = rows.reduce((sum, row) => sum + stockInputNumber(row.transferFee), 0);
            return {shares: Math.round((shares + Number.EPSILON) * 1000) / 1000,
                cashDividend: stockCashDividends(code, year), transferFee: stockInputRound(fees)};
        };
        return Object.freeze({stockPurchase, stockDividendCash, stockMonthTotals, stockOrderTotals, stockAveragePrice,
            stockRefundsForRecord, stockCostForYear, stockLotsForYear, stockMarketValue, stockNetValue,
            stockInvestmentProfit, stockCashDividends, stockNetDividends, stockTotalReturn, stockOverviewValue,
            stockAnnualRows, stockAnnualTotals, stockDividendTotals, stockRefundTotalForYear, stockCumulativeTotals});
    }
    return Object.freeze({createStockCalculations});
});
