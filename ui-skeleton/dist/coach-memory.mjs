// Browser-local display validation. The API independently validates the complete
// draft/session and recalculates all financial results before replying.
export function restoreCoachMemory(raw, customerId) {
  try {
    if(typeof raw!=='string'||raw.length>90000)return undefined;
    const s=JSON.parse(raw);
    if(s?.version!==1 || s.customerId!==customerId || s.mode!=='demo' || s.draft?.status!=='not_calculated'
      || !Array.isArray(s.messages)||s.messages.length>40 || !Array.isArray(s.draft.expenses)||s.draft.expenses.length>30
      || !Array.isArray(s.draft.priorities)||s.draft.priorities.length>20)return undefined;
    const text=v=>typeof v==='string';
    const rows=(value,max)=>value===undefined || Array.isArray(value)&&value.length<=max&&value.every(e=>e&&text(e.label)&&text(e.value)&&(e.id===undefined||text(e.id)));
    for(const m of s.messages){
      if(!['user','assistant'].includes(m.role)||!text(m.id)||!text(m.text)||m.text.length>3000)return undefined;
      if(m.suggestions!==undefined && (!Array.isArray(m.suggestions)||!m.suggestions.every(text)))return undefined;
      if(m.sources!==undefined && (!Array.isArray(m.sources)||!m.sources.every(v=>v&&text(v.title)&&text(v.url))))return undefined;
      const p=m.presentation;
      if(p && (!text(p.summary)||!Array.isArray(p.bullets)||p.bullets.length>3||!p.bullets.every(text)
        || !rows(p.metrics,3)||!rows(p.evidence,12)||(p.nextQuestion!==undefined&&!text(p.nextQuestion))))return undefined;
    }
    if(s.draft.expenses.some(e=>!e||!text(e.label)||!text(e.date)||!Number.isSafeInteger(e.amountCents))
      ||s.draft.priorities.some(p=>!p||!text(p.name)))return undefined;
    if(s.draft.goal!==null && (!s.draft.goal||!Number.isSafeInteger(s.draft.goal.amountCents)))return undefined;
    return s;
  }catch{return undefined;}
}
