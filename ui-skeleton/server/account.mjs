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
  const text=message.trim().toLowerCase();
  if (/^(show my spending plan|explain my plan[.!]?|what can i spend\??|how much can i spend\??)$/.test(text)) return {
    title:'Your spending plan',summary:'A category budget for 1–30 October, pending your confirmation.',
    metrics:[{label:'Planned spending',value:money(p.budget.totalPlannedSpendingCents)},{label:'Savings target',value:money(p.budget.savingsTargetCents)}],
    bullets:['Your account balance is separate from your spending budget.',`The plan retains a ${money(p.budget.bufferCents)} cash buffer. Confirm upcoming costs before relying on it.`],
    nextQuestion:'Would you like to review the category limits?',
    evidence:p.budget.categories.map(c=>({label:c.category,value:money(c.previewLimitCents)})),
    suggestions:['Show my category budgets','Show upcoming bills','I want to save more'],
  };
  if (/^(show my category budgets|where is my money going\??)$/.test(text)) return {
    title:'Your category budgets',summary:'These limits follow your spending history and the current savings target.',
    metrics:[],bullets:['These are proposed limits, not amounts already spent.'],nextQuestion:'Which spending would you like to protect?',
    evidence:p.budget.categories.map(c=>({label:c.category,value:money(c.previewLimitCents)})),suggestions:['Protect my groceries','Protect my gym','Show my spending plan'],
  };
  if (/^(show upcoming bills|what bills are coming\??|what.s coming up\??)$/.test(text)) {
    const payments=p.forecast.upcomingPayments.filter(x=>x.direction==='outflow'&&['Housing','Utilities'].includes(x.category));
    return {title:'Bills coming up',summary:'Expected payment windows from your account history.',metrics:payments.map(x=>({label:x.category,value:money(x.expectedTotalCents)})),
      bullets:payments.map(x=>`${x.category}: ${x.earliestDate.slice(8)}–${x.latestDate.slice(8)} October. Already included in the forecast.`),
      nextQuestion:'Is there another cost your plan should include?',evidence:basis(payments.flatMap(x=>x.evidenceIds)),suggestions:['I have an expense coming up','Show my spending plan']};
  }
  if (/^(show my saving room|can i save more\??|how much can i save\??)$/.test(text)) return {
    title:'Room to save',summary:'Your savings target and your conditional capacity are different things.',
    metrics:[{label:'Current target',value:money(p.budget.savingsTargetCents)},{label:'Conditional capacity',value:money(p.savings.conditionalCapacityCents)}],
    bullets:[`The capacity uses the lower balance estimate while keeping a ${money(p.savings.bufferCents)} buffer.`, 'It is a one-time estimate for this forecast—not a monthly recommendation. Known costs and your target still need confirmation.'],
    nextQuestion:'What amount would you like to explore?',evidence:[{label:'Forecast ends',value:p.savings.horizonEnd},{label:'Status',value:'Needs confirmation'}],suggestions:['I want to save more','I have an expense coming up'],
  };
  return null;
}
