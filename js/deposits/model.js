// Fully manual TWD deposit rows; no interest or payout formulas.
(function(root,factory){
    if(typeof module==='object' && module.exports) module.exports=factory();
    else root.DepositModel=factory();
})(globalThis,function(){
    'use strict';
    const fields=Object.freeze(['amount','rate','interest','date','status','note']);
    const emptyRow=()=>({amount:'',rate:'',interest:'',date:'',status:'',note:''});
    const emptyYear=()=>Array.from({length:3},emptyRow);
    const blank=value=>value===null || value===undefined || value==='';
    const snapshot=(data,strict=false)=>{
        const result={};
        for(const [year,source] of Object.entries(data || {})){
            if(!/^[1-9]\d{3}$/.test(year) || !Array.isArray(source) || source.length>1000) throw new Error('定存年度或資料列格式無效（每年最多 1,000 筆）。');
            const rows=source.map(row=>{
                if(!row || typeof row!=='object' || Array.isArray(row) || Object.keys(row).some(key=>!fields.includes(key))) throw new Error('定存欄位格式無效。');
                return Object.fromEntries(fields.map(key=>{
                    const value=row[key];
                    if(blank(value)) return [key,''];
                    if(['amount','interest'].includes(key)){
                        if(!['number','string'].includes(typeof value) || !String(value).trim() || !Number.isFinite(Number(value)) || Number(value)<0) {
                            if(strict) throw new Error('定存金額與利息須為非負數字。');
                            return [key,value];
                        }
                        return [key,Number(value)];
                    }
                    if(strict && typeof value!=='string') throw new Error('定存利率、日期、狀態與備註請輸入文字。');
                    if(strict && key==='rate' && !/^\d+(?:\.\d+)?%?$/.test(value)) throw new Error('利率請輸入數字，可加上 %，例如 1.50%。');
                    return [key,value];
                }));
            });
            const populated=row=>fields.some(key=>!blank(row[key]));
            if(!rows.some(populated)) continue;
            while(rows.length>3 && !populated(rows.at(-1))) rows.pop();
            while(rows.length<3) rows.push(emptyRow());
            result[year]=rows;
        }
        return result;
    };
    const validateSnapshot=data=>snapshot(data,true);
    return Object.freeze({fields,emptyRow,emptyYear,snapshot,validateSnapshot});
});
