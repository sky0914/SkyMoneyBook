// Recurring expense schedules. Each item has non-overlapping effective-month versions.
(function(root,factory){
    if(typeof module==='object' && module.exports) module.exports=factory();
    else root.FixedExpenseModel=factory();
})(globalThis,function(){
    'use strict';
    const validMonth=value=>typeof value==='string' && /^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(value);
    const previousMonth=month=>{
        const [year,m]=month.split('-').map(Number);
        return `${m===1?year-1:year}-${String(m===1?12:m-1).padStart(2,'0')}`;
    };
    const snapshot=data=>{
        if(!data || typeof data!=='object' || Array.isArray(data) || Object.keys(data).length>1000) throw new Error('固定開銷資料格式無效，最多 1,000 個項目。');
        const result={};let count=0;
        for(const id of Object.keys(data).sort()){
            const source=data[id];
            if(['__proto__','constructor','prototype'].includes(id) || !/^[A-Za-z0-9_-]{1,80}$/.test(id) || !Array.isArray(source) || !source.length) throw new Error('固定開銷項目或期間格式無效。');
            const versions=source.map(row=>{
                if(!row || typeof row!=='object' || Array.isArray(row) || Object.keys(row).some(key=>!['startMonth','endMonth','title','amount','category','payDay'].includes(key))) throw new Error('固定開銷欄位格式無效。');
                const end=row.endMonth ?? '';
                if(!validMonth(row.startMonth) || (end!=='' && (!validMonth(end) || end<row.startMonth))) throw new Error('固定開銷生效月份格式無效。');
                if(typeof row.title!=='string' || !row.title.trim() || row.title.length>200) throw new Error('請填寫固定開銷名稱（最多 200 字）。');
                if(!['number','string'].includes(typeof row.amount) || !String(row.amount).trim() || !Number.isFinite(Number(row.amount)) || Number(row.amount)<=0) throw new Error('固定開銷金額須大於 0。');
                if(typeof row.category!=='string' || !row.category.trim() || row.category.length>80) throw new Error('請選擇有效的固定開銷分類。');
                const day=Number(row.payDay);
                if(!Number.isInteger(day) || day<1 || day>31) throw new Error('每月扣款日須為 1 至 31。');
                return {startMonth:row.startMonth,endMonth:end,title:row.title.trim(),amount:Number(row.amount),category:row.category.trim(),payDay:day};
            }).sort((a,b)=>a.startMonth.localeCompare(b.startMonth));
            for(let i=1;i<versions.length;i++) if(!versions[i-1].endMonth || versions[i-1].endMonth>=versions[i].startMonth) throw new Error('同一固定開銷的生效期間不可重疊。');
            count+=versions.length;if(count>10000) throw new Error('固定開銷期間過多。');
            result[id]=versions;
        }
        return result;
    };
    const forMonth=(data,month)=>{
        if(!validMonth(month)) return [];
        const [year,m]=month.split('-').map(Number);
        const lastDay=new Date(year,m,0).getDate();
        return Object.entries(data).flatMap(([id,versions])=>{
            const version=versions.find(row=>row.startMonth<=month && (!row.endMonth || row.endMonth>=month));
            return version?[{...version,id,seriesId:id,date:month+'-'+String(Math.min(version.payDay,lastDay)).padStart(2,'0')}]:[];
        }).sort((a,b)=>a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    };
    const upsert=(data,id,month,fields)=>{
        if(!validMonth(month)) throw new Error('請選擇有效月份。');
        const result=snapshot(data),versions=result[id] || [];
        const index=versions.findIndex(row=>row.startMonth<=month && (!row.endMonth || row.endMonth>=month));
        const old=versions[index];
        if(versions.length && !old) throw new Error('此月份已無這筆固定開銷，請重新新增。');
        const next={...fields,startMonth:month,endMonth:old?.endMonth || ''};
        if(old?.startMonth===month) versions[index]=next;
        else {
            if(old) old.endMonth=previousMonth(month);
            versions.push(next);
        }
        result[id]=versions;
        return snapshot(result);
    };
    const upsertMonth=(data,id,month,fields)=>{
        if(!validMonth(month)) throw new Error('請選擇有效月份。');
        const source=snapshot(data);
        const original=source[id]?.find(row=>row.startMonth<=month && (!row.endMonth || row.endMonth>=month));
        if(!original) throw new Error('此月份已無這筆固定開銷，請重新新增。');
        let result=upsert(source,id,month,fields);
        if(original.endMonth===month) return result;
        const [year,m]=month.split('-').map(Number);
        const next=`${m===12?year+1:year}-${String(m===12?1:m+1).padStart(2,'0')}`;
        if(!validMonth(next)) throw new Error('無法建立下一個月份，請確認年度。');
        // Restore the previous recurring settings next month, preserving later scheduled versions.
        const {startMonth,endMonth,...previousFields}=original;
        result=upsert(result,id,next,previousFields);
        return result;
    };
    const stop=(data,id,month)=>{
        if(!validMonth(month)) throw new Error('請選擇有效月份。');
        const result=snapshot(data);
        if(!result[id]) return result;
        result[id]=result[id].filter(row=>row.startMonth<month).map(row=>!row.endMonth || row.endMonth>=month?{...row,endMonth:previousMonth(month)}:row);
        if(!result[id].length) delete result[id];
        return snapshot(result);
    };
    return Object.freeze({snapshot,forMonth,upsert,upsertMonth,stop});
});
