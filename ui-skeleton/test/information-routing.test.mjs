import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationReply} from '../server/conversation.mjs';
import {activity,getBudgetView} from '../server/budget.mjs';
import {historyAnswer} from '../server/transaction-history.mjs';
import {historyComparisonAnswer} from '../server/history-comparison.mjs';
import {restoreCoachMemory} from '../dist/coach-memory.mjs';
const noModel=()=>{throw Error('This financial query must use a calculator');};
const turn=(message,session,scenario='engine')=>conversationReply({scenario,message,session,history:[]},noModel);
const options={customerId:'CUST00005',today:'2026-09-30'};
test('comparisons reconcile to Budget with direction, scope and source evidence',async()=>{
 const r=await turn('Compare spending in August and September 2026');
 assert.match(r.reply,/€1,938.52.*August 2026.*€2,209.34.*September 2026/s);assert.match(r.reply,/€270.82 higher/);
 assert.equal(getBudgetView('2026-09').spentCents-getBudgetView('2026-08').spentCents,27082);
 assert.ok(r.presentation.evidence.every(e=>activity.transactions.some(t=>t.id===e.id)));
 const reversed=await turn('Compare spending in September and August 2026');assert.match(reversed.reply,/€270.82 lower/);
 const scoped=await turn('Compare groceries and housing in August and September 2026');assert.match(scoped.reply,/€24.17 higher/);
});
test('comparison missing/partial coverage never invents a change',async()=>{
 const missing=await turn('Compare spending in September and October 2026');assert.match(missing.reply,/missing verified coverage/);assert.doesNotMatch(missing.reply,/€0/);
 const partial=await turn('Compare income in 2025 and 2026');assert.match(partial.reply,/partial/);assert.match(partial.reply,/full-period change cannot/);
 const wrong=await turn('Compare spending in August and September 2026',undefined,'design');assert.match(wrong.reply,/aren’t connected/);
});
test('combined categories form a union and preserve filters on follow-up',async()=>{
 let r=await turn('How much did I spend on groceries and housing in September?');assert.match(r.reply,/€823.32/);
 r=await turn('What about August?',r.session);assert.match(r.reply,/€799.15.*groceries and housing/);
 const repeated=await turn('How much did I spend on housing and housing in September?');assert.match(repeated.reply,/€823.32/);
});
test('income matches source credits and excludes refunds and investment withdrawals',async()=>{
 const source=activity.transactions.filter(t=>t.date.startsWith('2025-')&&['salary','other_income'].includes(t.type)&&t.amountCents>0).reduce((n,t)=>n+t.amountCents,0);
 assert.equal(source,2918386);
 const income=await turn('What was my total income in 2025?');assert.match(income.reply,/€29,183.86/);
 const groceries=await turn('And groceries?',income.session);assert.match(groceries.reply,/€4,825.19.*groceries/);assert.equal(groceries.presentation.historyQuery.measure,'spending');
 const salary=await turn('And salary?',groceries.session);assert.equal(salary.presentation.historyQuery.measure,'income');assert.match(salary.reply,/salary credits only/);
 const ledger={customerId:'CUST00005',accountIds:['ACC000005'],coverage:{start:'2026-09-01',end:'2026-09-30'},transactions:[['salary',10000],['other_income',2000],['purchase',5000],['investment_withdrawal',9000]].map(([type,amountCents],i)=>({id:'t'+i,customerId:'CUST00005',accountId:'ACC000005',date:'2026-09-01',type,category:type==='salary'?'Salary':'Other',amountCents}))};
 const a=historyAnswer('How much did I earn in September?',{...options,ledger});assert.match(a.summary,/€120.00/);assert.deepEqual(a.evidence.map(e=>e.id),['t0','t1']);
 assert.match(historyAnswer('What was my salary in September?',{...options,ledger}).summary,/€100.00/);
 ledger.coverage.end='2026-09-15';assert.match(historyAnswer('How much did I earn in September?',{...options,ledger}).summary,/partial history/);
 ledger.transactions=[];assert.match(historyAnswer('How much did I earn in September?',{...options,ledger}).summary,/unknown/);
});
test('relative horizons count future contributions without converting income to savings',async()=>{
 let r=await turn('How much could I save over the next 18 months?');assert.equal(r.presentation.projection.months,18);assert.equal(r.presentation.projection.contributedCents,180000);assert.match(r.reply,/31 March 2028/);
 r=await turn('€200',r.session);assert.equal(r.presentation.projection.contributedCents,360000);
 r=await turn('What about next 2 years?',r.session);assert.equal(r.presentation.projection.months,24);assert.equal(r.presentation.projection.contributedCents,480000);
 assert.equal(r.planChanged,false);assert.equal(r.presentation.projection.affordabilityCalculated,false);
 const ordinary=await turn('I want to save €400 monthly for a car');assert.equal(ordinary.source,'planning');
});
test('memory restores read context and pending confirmations, isolated by profile',async()=>{
 let r=await turn('How much did I spend on groceries and housing in September?');
 let restored=restoreCoachMemory(JSON.stringify(r.session),'CUST00005');assert.ok(restored);
 r=await turn('What about August?',restored);assert.match(r.reply,/€799.15/);
 const proposal=await turn('I want to save €400 monthly');restored=restoreCoachMemory(JSON.stringify(proposal.session),'CUST00005');
 assert.deepEqual(restored.awaiting,proposal.session.awaiting);assert.equal(restored.draft.goal,null);
 const saved=await turn('Add goal',restored);assert.equal(saved.session.draft.goal.amountCents,40000);
 assert.equal(restoreCoachMemory(JSON.stringify(saved.session),'home-sample'),undefined);
});
test('malformed/oversized stored messages are not rendered as trusted conversation',async()=>{
 const r=await turn('What did I spend in September?');
 for(const mutate of [s=>s.messages[0].text={},s=>s.messages.at(-1).presentation.evidence=[{label:{},value:'bad'}],s=>s.messages.at(-1).suggestions={},s=>s.draft.expenses=[null]]){
  const s=structuredClone(r.session);mutate(s);assert.equal(restoreCoachMemory(JSON.stringify(s),'CUST00005'),undefined);
 }
 assert.equal(restoreCoachMemory('bad','CUST00005'),undefined);assert.equal(restoreCoachMemory('x'.repeat(90001),'CUST00005'),undefined);
});
test('information routing keeps forecasts, recorded income, targets and wishes distinct',async()=>{
 const checks=[['Show my spending plan','account'],['What was my income in 2025?','history'],['How much could I save over the next 18 months?','projection'],['I want to save €400 monthly','planning']];
 let session;
 for(const [message,source] of checks){const r=await turn(message,session);assert.equal(r.source,source);assert.equal(r.planChanged,false);session=r.session;}
 const snapshot=structuredClone(session);const observed=await turn('Compare spending in August and September 2026',session);assert.deepEqual(observed.session.draft,snapshot.draft);assert.deepEqual(observed.session.awaiting,snapshot.awaiting);
});
