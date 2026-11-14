import { readFileSync } from 'node:fs';
import { account, accountPlan } from './account.mjs';
export const activity = JSON.parse(readFileSync(new URL('./budget/activity.json', import.meta.url)));
const spendingTypes = new Set(['purchase', 'housing_payment', 'utilities_payment']);

// Only compare a budget and transactions inside the very same date window.
export function buildBudgetView(plan, ledger, mode = 'plan', historyMonth = ledger.coverage.end.slice(0,7)) {
  if (!['plan', 'history'].includes(mode)) throw new Error('Unknown budget period');
  const accountIds = plan.forecast.accounts.map(a => a.accountId);
  if (ledger.customerId !== plan.customerId || ledger.accountIds.some(id => !accountIds.includes(id))) throw new Error('Account mismatch');
  const seen = new Set();
  for (const tx of ledger.transactions) {
    if (tx.customerId !== plan.customerId || !accountIds.includes(tx.accountId) || seen.has(tx.id)
      || !Number.isSafeInteger(tx.amountCents) || tx.date < ledger.coverage.start || tx.date > ledger.coverage.end) throw new Error('Invalid account activity');
    seen.add(tx.id);
  }
  const period = mode === 'plan'
    ? { start: plan.budget.periodStart, end: plan.budget.periodEnd }
    : monthPeriod(historyMonth);
  const covered = ledger.coverage.start <= period.start && ledger.coverage.end >= period.start;
  const through = covered ? (ledger.coverage.end < period.end ? ledger.coverage.end : period.end) : null;
  const transactions = ledger.transactions.filter(tx => tx.date >= period.start && tx.date <= period.end && spendingTypes.has(tx.type));
  const planned = mode === 'plan' ? plan.budget.categories : [];
  const names = [...new Set([...planned.map(c => c.category), ...transactions.map(t => t.category)])];
  const categories = names.map(category => {
    const limit = planned.find(c => c.category === category);
    const rows = transactions.filter(t => t.category === category);
    const spentCents = covered ? rows.filter(t => t.amountCents < 0).reduce((sum, t) => sum - t.amountCents, 0) : null;
    const refundCents = covered ? rows.filter(t => t.amountCents > 0).reduce((sum, t) => sum + t.amountCents, 0) : null;
    const plannedCents = limit?.previewLimitCents ?? null;
    return { category, plannedCents, spentCents, refundCents,
      remainingCents: covered && plannedCents !== null ? plannedCents - spentCents : null,
      adjustable: limit?.adjustable ?? false, transactions: rows };
  }).sort((a,b) => (mode === 'plan' ? b.plannedCents - a.plannedCents : b.spentCents - a.spentCents));
  const totalPlannedCents = mode === 'plan' ? categories.reduce((sum,c) => sum + (c.plannedCents ?? 0),0) : null;
  const spentCents = covered ? categories.reduce((sum,c) => sum + c.spentCents,0) : null;
  // Unbudgeted categories count toward the overall remainder too.
  return { mode, customerId: plan.customerId, accountIds, period, through,
    status: mode === 'plan' ? plan.budget.status : 'observed', activityAvailable: covered,
    totalPlannedCents, spentCents,
    remainingCents: covered && totalPlannedCents !== null ? totalPlannedCents - spentCents : null,
    refundsCents: covered ? categories.reduce((sum,c) => sum + c.refundCents,0) : null,
    savingsTargetCents: plan.budget.savingsTargetCents, bufferCents: plan.budget.bufferCents,
    categories, source: ledger.source, coverage: ledger.coverage,
    calculation: 'Spending includes purchases, housing and utilities. Transfers, investments and income are excluded. Refunds are shown separately and do not increase the available budget.',
    canEdit: false, movesMoney: false };
}

const money = cents => new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(cents/100);
export function monthPeriod(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid month');
  const [year,m]=month.split('-').map(Number);
  return {start:month+'-01',end:month+'-'+String(new Date(Date.UTC(year,m,0)).getUTCDate()).padStart(2,'0')};
}
const shiftMonth=(month,n)=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7);};
const labelMonth=month=>new Date(month+'-01T12:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
export function availableMonths(plan,ledger) {
  const result=[], planMonth=plan.budget.periodStart.slice(0,7), last=shiftMonth(planMonth,2);
  for(let month=ledger.coverage.start.slice(0,7);month<=last;month=shiftMonth(month,1)) {
    const kind=month===planMonth?'plan':month<=ledger.coverage.end.slice(0,7)?'history':'unavailable';
    result.push({month,label:labelMonth(month),kind});
  }
  return result;
}
function compareMonths(view,previous) {
  if(!view.activityAvailable || !previous?.activityAvailable || view.through!==view.period.end || previous.through!==previous.period.end)return null;
  const names=[...new Set([...view.categories.map(c=>c.category),...previous.categories.map(c=>c.category)])];
  return {month:previous.period.start.slice(0,7),label:labelMonth(previous.period.start.slice(0,7)),spentCents:previous.spentCents,
    changeCents:view.spentCents-previous.spentCents,
    changePercent:previous.spentCents>0?Math.round((view.spentCents-previous.spentCents)/previous.spentCents*100):null,
    categories:names.map(category=>{const spent=view.categories.find(c=>c.category===category)?.spentCents??0;const before=previous.categories.find(c=>c.category===category)?.spentCents??0;return {category,spentCents:spent,previousCents:before,changeCents:spent-before};})};
}
export function explainBudget(view,comparison=null) {
  if(view.mode==='unavailable')return {tone:'neutral',label:'No plan for this month yet',reason:'There is no saved forecast or recorded spending for this month. Later months need updated account activity and a new plan.',action:{label:'Open the available plan',period:'plan'}};
  if(view.mode==='plan') {
    if(!view.activityAvailable)return {tone:'neutral',label:'Ready for your review',reason:`These proposed limits reserve ${money(view.savingsTargetCents)} for savings and a ${money(view.bufferCents)} buffer. Confirm upcoming costs first; spending for this period is not available yet.`,action:{label:'Review category limits',category:null}};
    const over=view.categories.filter(c=>c.remainingCents!==null&&c.remainingCents<0).sort((a,b)=>a.remainingCents-b.remainingCents)[0];
    if(over)return {tone:'attention',label:`${over.category} is over its limit`,reason:`Recorded spending is ${money(-over.remainingCents)} above the ${money(over.plannedCents)} ${view.status==='needs_confirmation'?'proposed ':''}limit. Review the payments before adjusting your plan.`,action:{label:`Review ${over.category.toLowerCase()}`,category:over.category}};
    if(view.categories.some(c=>c.plannedCents===null&&c.spentCents>0))return {tone:'attention',label:'Some spending needs a budget',reason:'A recorded category has no proposed limit. Include it before judging whether the plan is on track.',action:{label:'Review categories',category:null}};
    if(view.status==='needs_confirmation')return {tone:'neutral',label:'Confirm your limits first',reason:'Spending is within the proposed limits so far. Confirm the costs and savings target before treating these as your agreed budget.',action:{label:'Review category limits',category:null}};
    return {tone:'positive',label:view.spentCents===0?'No spending recorded yet':'Within your limits so far',reason:'Recorded spending has not exceeded any category limit. This does not predict later bills or guarantee that the whole period will fit.',action:{label:'Check category spending',category:null}};
  }
  if(!comparison)return {tone:'neutral',label:'Your spending, in context',reason:'There is no complete previous month to compare with. Review the recorded categories and payments below.',action:{label:'Review payments',category:view.categories[0]?.category??null}};
  const change=comparison.changeCents;
  const driver=[...comparison.categories].sort((a,b)=>change>=0?b.changeCents-a.changeCents:a.changeCents-b.changeCents)[0];
  const offset=driver?change-driver.changeCents:0;
  const detail=driver&&driver.changeCents!==0?` ${driver.category} was ${money(Math.abs(driver.changeCents))} ${driver.changeCents>0?'higher':'lower'}.${offset!==0?` Other categories together were ${money(Math.abs(offset))} ${offset>0?'higher':'lower'}.`:''}`:'';
  return {tone:change>0?'attention':'neutral',label:change===0?'Spending stayed the same':`Spending ${change>0?'rose':'fell'} ${money(Math.abs(change))}`,
    reason:`Compared with ${comparison.label}.${detail}`,
    action:{label:driver?`Review ${driver.category.toLowerCase()}`:'Review payments',category:driver?.category??null}};
}
export function getBudgetView(selection='plan') {
  const catalog=availableMonths(accountPlan,activity);
  const month=selection==='plan'?accountPlan.budget.periodStart.slice(0,7):selection==='history'?activity.coverage.end.slice(0,7):selection;
  const entry=catalog.find(c=>c.month===month);if(!entry)throw new Error('Unknown budget period');
  let view;
  if(entry.kind==='unavailable')view={mode:'unavailable',period:monthPeriod(month),categories:[],activityAvailable:false,totalPlannedCents:null,spentCents:null,remainingCents:null,through:null};
  else view=buildBudgetView(accountPlan,activity,entry.kind,month);
  const previousMonth=shiftMonth(month,-1);
  const previous=previousMonth>=activity.coverage.start.slice(0,7)&&previousMonth<=activity.coverage.end.slice(0,7)?buildBudgetView(accountPlan,activity,'history',previousMonth):null;
  const comparison=view.mode==='history'?compareMonths(view,previous):null;
  if(comparison)for(const row of comparison.categories){if(!view.categories.some(c=>c.category===row.category))view.categories.push({category:row.category,plannedCents:null,spentCents:0,refundCents:0,remainingCents:null,transactions:[]});}
  const explanation=explainBudget(view,comparison);
  const series=[];
  if(view.mode==='history')for(let offset=-5;offset<=0;offset++) {
    const m=shiftMonth(month,offset);if(m<activity.coverage.start.slice(0,7))continue;
    const result=buildBudgetView(accountPlan,activity,'history',m);
    series.push({month:m,label:labelMonth(m),spentCents:result.spentCents});
  }
  const largePayment=view.categories.flatMap(c=>c.transactions).filter(t=>t.amountCents<0).sort((a,b)=>a.amountCents-b.amountCents)[0];
  const paymentInsight=view.mode==='history'&&view.spentCents>0&&largePayment&&-largePayment.amountCents/view.spentCents>=0.4?
    {category:largePayment.category,text:`One ${largePayment.category.toLowerCase()} payment of ${money(-largePayment.amountCents)} represents ${Math.round(-largePayment.amountCents/view.spentCents*100)}% of this month’s spending. Check whether it was a one-off before planning the same amount again.`}:null;
  return {...view,selectedMonth:month,catalog,comparison,series,explanation,paymentInsight,accountLabel:account.label};
}
