import { readFileSync } from 'node:fs';
export const accountPlan = JSON.parse(readFileSync(new URL('./coach/financial-plan-demo.json', import.meta.url)));
const p = accountPlan;
const money = cents => new Intl.NumberFormat('en-IE', {style:'currency',currency:'EUR'}).format(cents/100);
const accounts = p.forecast.accounts;
export const account = {
  customerId:p.customerId, asOf:p.asOf, source:'bank_provided_synthetic_data', connection:'saved_account_snapshot',
  label:'Account •' + accounts[0].accountId.slice(-4), accounts,
  balanceCents:p.forecast.startingBalanceCents, balance:money(p.forecast.startingBalanceCents),
  observedDate:accounts[0].balanceObservedDate,
  periodStart:p.budget.periodStart,periodEnd:p.budget.periodEnd,
  spendingPlanCents:p.budget.totalPlannedSpendingCents,savingsTargetCents:p.budget.savingsTargetCents,bufferCents:p.budget.bufferCents,
  payments:p.forecast.upcomingPayments, categories:p.budget.categories,
  evidence:p.forecast.evidence,
  capabilities:{readAccount:true,explainForecast:true,explainPayments:true,draftChanges:true,recalculate:false,saveToBank:false,moveMoney:false,cancelSubscriptions:false},
};
function basis(ids) { return account.evidence.filter(e=>ids.includes(e.id)).slice(-6).map(e=>({label:`${e.date} · ${e.category}`,value:money(e.amountCents),id:e.id})); }
export function accountAnswer(message) {
  const text = message.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/[.!?]+$/, '');
  if (/^(?:show my spending plan|explain my plan|what can i spend|how much can i spend)(?: in october)?$/.test(text)) return {
    title:'',summary:`Your draft spending budget for 1–30 October is ${money(p.budget.totalPlannedSpendingCents)}.`,
    bullets:[], nextQuestion:'',
    evidence:p.budget.categories.map(c=>({label:c.category,value:money(c.previewLimitCents)})),
    suggestions:['Show my category budgets'],
  };
  if (/^(?:show my category budgets|where is my money going)$/.test(text)) {
    const categories = [...p.budget.categories].sort((a,b) => b.previewLimitCents - a.previewLimitCents);
    return {
      title:'Largest October budget categories',summary:'Here’s where the draft budget sets aside the most.',
      bullets:categories.slice(0,3).map(c=>`${c.category}: ${money(c.previewLimitCents)}`),nextQuestion:'',
      evidence:categories.map(c=>({label:c.category,value:money(c.previewLimitCents)})),suggestions:[],
    };
  }
  const categoryName = text.match(/^(?:how much (?:can i spend on|is budgeted for)|what(?:'s| is) my budget for) (.+?)(?: in october)?$/)?.[1];
  const category = p.budget.categories.find(c => c.category.toLowerCase() === categoryName);
  if (category) return {
    title:'',summary:`Your draft October budget for ${category.category.toLowerCase()} is ${money(category.previewLimitCents)}.`,
    bullets:[],nextQuestion:'',suggestions:[],
  };
  if (/^(?:show (?:my )?upcoming bills|what bills (?:are coming(?: up)?|are due next|do i have coming up)|what(?:'s| is) coming up)$/.test(text)) {
    const payments=p.forecast.upcomingPayments.filter(x=>x.direction==='outflow'&&['Housing','Utilities'].includes(x.category));
    return {title:'',summary:'These estimated bills are already included in the October forecast.',metrics:payments.map(x=>({label:x.category,value:money(x.expectedTotalCents)})),
      bullets:payments.map(x=>`${x.category}: ${x.earliestDate.slice(8)}–${x.latestDate.slice(8)} October.`),
      nextQuestion:'',evidence:basis(payments.flatMap(x=>x.evidenceIds)),suggestions:['I have an expense coming up']};
  }
  if (/^(?:what(?:'s| is) my (?:cash )?buffer|how much (?:cash )?buffer do i have|show my (?:cash )?buffer)$/.test(text)) return {
    title:'',summary:`Your October plan keeps ${money(p.budget.bufferCents)} available for surprises.`,
    bullets:[],nextQuestion:'',suggestions:['Set my buffer'],
  };
  if (/^(?:how much (?:more )?(?:can|could|should) i save|can i save more|i (?:want|need|would like) to save more) (?:each month|per month|a month|every month|monthly)$/.test(text)) return {
    title:'',summary:`The October plan targets ${money(p.budget.savingsTargetCents)}. A recurring savings target needs estimates for more than one month.`,
    bullets:[],nextQuestion:'',suggestions:['Show my saving room'],
  };
  if (/^(?:show my sav(?:ing|ings) room|(?:can|could|how can) i save more|how much (?:more )?(?:can|could|should) i save|i (?:want|need|would like) to save more|i'd like to save more)(?: (?:this month|in october))?$/.test(text)) {
    const { conditionalCapacityCents, suggestedSavingsCents, bufferCents } = p.savings;
    const target = `Your October plan sets a ${money(p.budget.savingsTargetCents)} savings target.`;
    return {
      title:'',summary:suggestedSavingsCents == null ? target : `The October forecast suggests saving ${money(suggestedSavingsCents)} once.`,
      bullets:suggestedSavingsCents == null && conditionalCapacityCents != null
        ? [`The forecast estimates up to ${money(conditionalCapacityCents)} in one-time savings while keeping a ${money(bufferCents)} cash buffer. Confirm upcoming costs before raising your target.`] : [],
      nextQuestion:'',suggestions:['I have an expense coming up'],
    };
  }
  return null;
}
