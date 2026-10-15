// Parse copied spreadsheet cells without touching page state or cloud data.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'), require('./calculations.js'));
    else root.StockImport = factory(root.StockModel, root.StockCalculations);
})(globalThis, function (model, calculations) {
    'use strict';
    const {stockPurchase, stockMonthTotals} = calculations.createStockCalculations(() => ({}));
    const isBlank = value => value === '' || value === '—' || value === '–' || value === '-';
    function numberCell(text, line, label) {
        if (isBlank(text)) return null;
        if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text.replaceAll(',', '')))) {
            throw new Error(`第 ${line} 行的${label}須為非負數字。`);
        }
        return Number(text.replaceAll(',', ''));
    }
    function parseMonthlyPaste(text, {year, code, month}) {
        if (!/^[1-9]\d{3}$/.test(String(year)) || !model.stockCodes.includes(code) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('請先選擇有效的年度、股票與月份。');
        const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
            .map((line, index) => ({line: index + 1, cells: line.split('\t').map(cell => cell.trim())}))
            .filter(({cells}) => cells.some(cell => cell !== ''));
        if (!lines.length) throw new Error('請先貼上試算表的五欄資料。');
        const rows = [], warnings = [];
        let sawFooter = false;
        for (const item of lines) {
            const cells = item.cells.slice();
            while (cells.length > 5 && cells.at(-1) === '') cells.pop();
            const nonempty = cells.filter(cell => cell !== '');
            // Optional merged title, including the source stock code.
            if (!rows.length && nonempty.length === 1 && /^定期定額/.test(nonempty[0])) {
                const sourceCode = /^定期定額\s*(\d{4,5}[A-Z]?)(?:\s|[（(]|$)/i.exec(nonempty[0])?.[1]?.toUpperCase();
                if (!sourceCode) throw new Error(`第 ${item.line} 行的標題無法辨識股票代碼，請只複製表格五欄。`);
                if (sourceCode !== code) throw new Error(`來源是 ${sourceCode}，目前選擇的是 ${code}，請先切換股票。`);
                continue;
            }
            if (!rows.length && ['股數','股數（股）'].includes(cells[1]) && cells[2] === '購入價格' && cells[3] === '手續費' && cells[4] === '單價') {
                if (cells.length !== 5 || !['','時間','日期'].includes(cells[0])) throw new Error(`第 ${item.line} 行的表頭須依序為日期、股數、購入價格、手續費、單價。`);
                continue;
            }
            // A copied total is optional and never imported as a trade.
            if (rows.length && (['總計','合計'].includes(cells[0]) || cells[0] === '') && item === lines.at(-1)) {
                if (cells.length < 4 || cells.length > 5 || !isBlank(cells[4] || '')) throw new Error(`第 ${item.line} 行的總計格式無法辨識。`);
                const totals = cells.slice(1,4).map((cell,i) => numberCell(cell,item.line,['總股數','總購入價格','總手續費'][i]));
                if (totals.some(value => value === null)) throw new Error(`第 ${item.line} 行的總計須包含股數、購入價格、手續費。`);
                const expected = stockMonthTotals(rows);
                if (totals.some((v,i) => Math.abs(v - [expected.shares,expected.purchase,expected.fee][i]) > 0.000001)) warnings.push('來源總計與重新計算結果不同，將以匯入後的公式總計為準。');
                sawFooter = true;
                continue;
            }
            if (cells.length !== 5) throw new Error(`第 ${item.line} 行須有五欄，請從試算表複製完整儲存格範圍。`);
            const date = /^(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})$/.exec(cells[0]);
            if (!date) throw new Error(`第 ${item.line} 行日期格式錯誤，請使用月／日。`);
            if (date[1] && Number(date[1]) !== Number(year)) throw new Error(`第 ${item.line} 行年份不符，目前匯入 ${year} 年。`);
            if (Number(date[2]) !== month) throw new Error(`第 ${item.line} 行是 ${Number(date[2])} 月，目前匯入 ${month} 月，請先切換月份。`);
            const shares = numberCell(cells[1], item.line, '股數');
            const sourcePurchase = numberCell(cells[2], item.line, '購入價格');
            const fee = numberCell(cells[3], item.line, '手續費');
            const price = numberCell(cells[4], item.line, '單價');
            if (shares !== null && !Number.isSafeInteger(shares)) throw new Error(`第 ${item.line} 行股數須為整數（單位為股）。`);
            if (shares === null || price === null) throw new Error(`第 ${item.line} 行請填寫股數與單價；未下單的空白列請不要複製。`);
            const row = {date: Number(date[2]) + '/' + Number(date[3]), shares, fee, price};
            const purchase = stockPurchase(row);
            if (purchase === '' || !Number.isSafeInteger(purchase)) throw new Error(`第 ${item.line} 行購入價格超出可安全計算範圍。`);
            if (sourcePurchase !== null && sourcePurchase !== purchase) warnings.push(`第 ${item.line} 行購入價格 ${sourcePurchase} 與公式結果 ${purchase} 不同，將採用公式結果。`);
            rows.push(row);
            if (rows.length > 15) throw new Error('單月最多匯入 15 筆；請縮小複製範圍，不會自動截斷資料。');
        }
        if (!rows.length) throw new Error('找不到可匯入的下單資料。');
        model.validateStockInputs({[year]: {stocks: {[code]: {monthlyRecords: {[month]: rows}}}}});
        const monthlyRows = model.emptyStockRecord().monthlyRecords[month];
        rows.forEach((row, index) => {monthlyRows[index] = row;});
        return {rows, monthlyRows, warnings, totals: stockMonthTotals(rows), sawFooter};
    }
    return Object.freeze({parseMonthlyPaste});
});
