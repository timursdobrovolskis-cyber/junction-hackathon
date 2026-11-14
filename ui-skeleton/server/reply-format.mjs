export function validatePresentation(value) {
  if(!value || typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>400
    || !Array.isArray(value.bullets)||value.bullets.length>3||value.bullets.some(x=>typeof x!=='string'||x.length>220)
    || typeof value.nextQuestion!=='string'||value.nextQuestion.length>200)throw new Error('Invalid structured reply');
  return {title: typeof value.title==='string'?value.title.slice(0,80):'Your next step',summary:value.summary,bullets:value.bullets,nextQuestion:value.nextQuestion};
}
export function presentationText(p){return [p.title,p.summary,...p.bullets,p.nextQuestion].filter(Boolean).join('\n\n');}
export function formatPlanning(session) {
  const pending=session.awaiting;const text=session.messages.at(-1).text;
  if(pending?.kind==='goal_confirm')return {title:'Confirm your savings goal',summary:'Add this requested target to your draft?',metrics:[{label:pending.goal.period==='monthly'?'Each month':'In total',value:new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(pending.goal.amountCents/100)}],bullets:['Your forecast will stay unchanged until this target is checked.'],nextQuestion:''};
  if(pending?.kind==='expense_confirm')return {title:'Check this expense',summary:pending.expense.label,metrics:[{label:'Amount',value:new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(pending.expense.amountCents/100)},{label:'Payment date',value:pending.expense.date}],bullets:[pending.expense.inclusion==='additional'?'Extra spending beyond the plan.':pending.expense.inclusion==='already_included'?'Already covered by the plan.':'Whether this is already included needs review.'],nextQuestion:'Add it to your draft?'};
  const parts=text.split(/\n\n/).filter(Boolean);
  return {title:'',summary:parts[0],bullets:parts.slice(1,3),nextQuestion:''};
}
