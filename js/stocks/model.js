// Stock input schema and normalization. No Vue, DOM or cloud dependencies.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.StockModel = factory();
})(globalThis, function () {
    'use strict';
    const stockCodes = Object.freeze(['00878', '00919', '0056', '00982A', '0050']);
    // Agreed historical cutoff: pre-2026 totals are fixed, not reconstructed from old trades.
    const stockTrackingPolicy = Object.freeze({startYear: 2026, openingDividends: 174701, openingTotalReturn: 171675});
    const overviewFields = Object.freeze(['cost','marketValue','price','estimatedFee','netValue','lots','estimatedTax','profit','dividends','totalReturn']);
    const emptyStockMonths = () => Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 1,
        Array.from({ length: 15 }, () => ({ date: '', shares: null, fee: null, price: null }))
    ]));
    const hasStockValue = value => value !== null && value !== undefined && value !== '';
    const emptyStockRecord = () => ({
        overview: Object.fromEntries(overviewFields.map(key => [key, null])),
        manualRows: Array.from({ length: 12 }, () => ({ date: '', quantity: null, purchase: null, fee: null, price: null })),
        monthlyRecords: emptyStockMonths(),
        dividends: Array.from({ length: 4 }, () => ({ exDate: '', payDate: '', shares: null, perShare: null, transferFee: null }))
    });

    const emptyStockYear = () => ({stocks: Object.fromEntries(stockCodes.map(code => [code, emptyStockRecord()]))});
    // Browsing creates empty defaults; only entered values (including zero) belong in a snapshot.
    const stockSnapshot = data => {
        const result = {};
        const fill = (template, source) => {
            if (Array.isArray(template)) return template.map((v,i) => fill(v,source?.[i]));
            if (template && typeof template === 'object') return Object.fromEntries(Object.entries(template).map(([k,v]) => [k,fill(v,source?.[k])]));
            if (!hasStockValue(source)) return template;
            if (typeof template === 'string') return String(source);
            return typeof source === 'string' && source.trim() !== '' && Number.isFinite(Number(source)) ? Number(source) : source;
        };
        const populated = value => value && typeof value === 'object' ? Object.values(value).some(populated) : hasStockValue(value);
        for (const year of Object.keys(data || {}).sort()) {
            const annual = {stocks:Object.fromEntries(stockCodes.map(code => [code,fill(emptyStockRecord(),data[year]?.stocks?.[code])]))};
            if (populated(annual)) result[year] = annual;
        }
        return result;
    };
    const validateStockInputs = data => {
        const dates = ['date','exDate','payDate'];
        const check = (value,year,field='') => {
            if (value && typeof value === 'object') { for (const [k,v] of Object.entries(value)) check(v,year,k); return; }
            if (!hasStockValue(value)) return;
            if (dates.includes(field)) {
                const match=String(value).match(/^(\d{1,2})\/(\d{1,2})$/);
                const month=Number(match?.[1]),day=Number(match?.[2]);
                if (!match || month<1 || month>12 || day<1 || day>new Date(Number(year),month,0).getDate()) throw new Error('請確認股票日期，格式為月／日，並須為該年度有效日期。');
            } else if (typeof value !== 'number' || !Number.isFinite(value) || (value<0 && !['profit','totalReturn'].includes(field))) throw new Error('請確認股票數值；僅投資損益與總收益可為負數。');
        };
        for (const year in data) {
            if (!/^[1-9]\d{3}$/.test(year)) throw new Error('股票年份須為四位數。');
            check(data[year],year);
        }
    };
    // User-provided year-end snapshots. Unknown 2024 refunds remain unspecified.
    const stockHistoricalYears = Object.freeze({
        2024: Object.freeze({refund: null, stocks: Object.freeze({
            '00878': Object.freeze({lots:25,price:22.18,cost:558670,netValue:553156,profit:-5514,dividends:14740,totalReturn:9226}),
            '00919': Object.freeze({lots:9,price:23.38,cost:209354,netValue:209911,profit:557,dividends:6480,totalReturn:7037}),
            '0056': Object.freeze({lots:2,price:36.68,cost:73003,netValue:73183,profit:180,dividends:0,totalReturn:180})
        })}),
        2025: Object.freeze({refund:3515, stocks:Object.freeze({
            '00878': Object.freeze({lots:43.128,price:21.71,cost:948764,netValue:934038,profit:-14726,dividends:64348,totalReturn:49622}),
            '00919': Object.freeze({lots:18.194,price:22.4,cost:413524,netValue:406558,profit:-6966,dividends:36036,totalReturn:29070}),
            '0056': Object.freeze({lots:17.081,price:36.73,cost:614503,netValue:625864,profit:11361,dividends:52129,totalReturn:63490}),
            '00982A': Object.freeze({lots:5.780,price:14.61,cost:76936,netValue:84241,profit:7305,dividends:968,totalReturn:8273})
        })})
    });
    const initializeStockHistory = data => {
        const result = stockSnapshot(data);
        const populated = value => value && typeof value === 'object' ? Object.values(value).some(populated) : hasStockValue(value);
        for (const [year, historical] of Object.entries(stockHistoricalYears)) {
            result[year] ||= emptyStockYear();
            for (const [code, overview] of Object.entries(historical.stocks)) {
                if (populated(result[year].stocks[code])) continue;
                result[year].stocks[code] = emptyStockRecord();
                Object.assign(result[year].stocks[code].overview, overview);
            }
        }
        return result;
    };
    const isStockDerivedField = (code, key) => key === 'marketValue' ||
        (stockCodes.includes(code) && ['lots', 'cost', 'netValue', 'profit', 'dividends', 'totalReturn'].includes(key));
    return Object.freeze({stockCodes, stockTrackingPolicy, stockHistoricalYears, initializeStockHistory, overviewFields, hasStockValue, emptyStockRecord, emptyStockYear, stockSnapshot, validateStockInputs, isStockDerivedField});
});
