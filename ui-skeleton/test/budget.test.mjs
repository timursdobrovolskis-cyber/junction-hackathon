import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBudgetView, getBudgetView, activity, explainBudget } from '../server/budget.mjs';
import { accountPlan } from '../server/account.mjs';
import handler from '../api/budget.js';
test('October limits reconcile and missing activity is not zero',()=>{
  const view=getBudgetView('plan');
  assert.equal(view.customerId,accountPlan.customerId);assert.equal(view.totalPlannedCents,179399);
  assert.equal(view.categories.reduce((n,c)=>n+c.plannedCents,0),view.totalPlannedCents);
  assert.equal(view.spentCents,null);assert.equal(view.remainingCents,null);assert.equal(view.through,null);
  assert.ok(view.categories.every(c=>c.spentCents===null&&c.remainingCents===null));
});
test('September totals exclude salary and investment transfers',()=>{
  const view=getBudgetView('history');assert.equal(view.spentCents,220934);
  assert.equal(view.categories.find(c=>c.category==='Lifestyle').spentCents,128419);
  assert.equal(view.categories.flatMap(c=>c.transactions).length,5);
  assert.equal(view.totalPlannedCents,null);assert.equal(view.remainingCents,null);assert.equal(view.through,'2026-09-30');
});
const october=()=>({...structuredClone(activity),coverage:{start:'2026-10-01',end:'2026-10-14'},transactions:[]});
const tx=(id,category,amountCents,type='purchase')=>({id,category,amountCents,type,date:'2026-10-05',customerId:accountPlan.customerId,accountId:'ACC000005'});
test('same-period actuals calculate overspend and unbudgeted categories in exact cents',()=>{
  const ledger=october();ledger.transactions=[tx('a','Groceries',-10000),tx('b','Travel',-3000),tx('c','Savings',-50000,'investment_deposit')];
  const view=buildBudgetView(accountPlan,ledger);assert.equal(view.spentCents,13000);assert.equal(view.remainingCents,166399);
  assert.equal(view.categories.find(c=>c.category==='Groceries').remainingCents,-2010);
  assert.equal(view.categories.find(c=>c.category==='Travel').remainingCents,null);assert.equal(view.through,'2026-10-14');
});
test('covered empty periods are zero, incomplete opening coverage is unknown, refunds are separate',()=>{
  const ledger=october();let view=buildBudgetView(accountPlan,ledger);assert.equal(view.spentCents,0);assert.equal(view.remainingCents,179399);
  ledger.transactions=[tx('a','Groceries',-5000),tx('b','Groceries',1000)];view=buildBudgetView(accountPlan,ledger);
  assert.equal(view.spentCents,5000);assert.equal(view.refundsCents,1000);assert.equal(view.remainingCents,174399);
  ledger.coverage.start='2026-10-03';view=buildBudgetView(accountPlan,ledger);assert.equal(view.spentCents,null);assert.equal(view.remainingCents,null);
});
test('rejects foreign accounts, duplicate transactions and unsupported requests',()=>{
  const ledger=structuredClone(activity);ledger.transactions[0].accountId='OTHER';assert.throws(()=>buildBudgetView(accountPlan,ledger));
  const duplicate=structuredClone(activity);duplicate.transactions.push(duplicate.transactions[0]);assert.throws(()=>buildBudgetView(accountPlan,duplicate));assert.throws(()=>getBudgetView('invalid'));
  const response={setHeader(){},end(body){this.body=JSON.parse(body);}};
  handler({method:'POST',url:'/api/budget'},response);assert.equal(response.statusCode,405);
  handler({method:'GET',url:'/api/budget?period=invalid'},response);assert.equal(response.statusCode,400);
});

test('month catalog covers all 24 observed months and marks future periods unavailable',()=>{
  const view=getBudgetView('plan');
  assert.equal(view.catalog.filter(c=>c.kind==='history').length,24);
  assert.equal(view.catalog[0].month,'2024-10');assert.equal(view.catalog.at(-1).month,'2026-12');
  const future=getBudgetView('2026-11');assert.equal(future.mode,'unavailable');assert.equal(future.spentCents,null);assert.equal(future.totalPlannedCents,null);assert.deepEqual(future.categories,[]);
  assert.match(future.explanation.label,/No plan/);assert.throws(()=>getBudgetView('2024-09'));
});
test('historical comparisons explain reconciled changes and link to their evidence',()=>{
  const sept=getBudgetView('2026-09');const aug=getBudgetView('2026-08');
  assert.equal(aug.spentCents,193852);assert.equal(sept.comparison.changeCents,27082);
  assert.equal(sept.comparison.categories.reduce((sum,c)=>sum+c.changeCents,0),27082);
  assert.equal(sept.explanation.action.category,'Lifestyle');assert.equal(sept.paymentInsight.category,'Lifestyle');
  assert.equal(sept.series.length,6);assert.equal(sept.series.at(-1).spentCents,sept.spentCents);
  assert.equal(getBudgetView('2024-10').comparison,null);
  assert.equal(getBudgetView('2024-10').series.length,1);
});
test('all monthly actuals reconcile to the source without applying a future budget',()=>{
  const months=getBudgetView('plan').catalog.filter(c=>c.kind==='history');
  const total=months.reduce((sum,m)=>sum+getBudgetView(m.month).spentCents,0);
  const source=activity.transactions.filter(t=>t.amountCents<0&&['purchase','housing_payment','utilities_payment'].includes(t.type)).reduce((sum,t)=>sum-t.amountCents,0);
  assert.equal(total,source);
  for(const month of months){const view=getBudgetView(month.month);assert.equal(view.totalPlannedCents,null);assert.equal(view.remainingCents,null);}
});

test('status distinguishes missing data, proposed limits, overspend, and observed progress',()=>{
  assert.equal(getBudgetView('plan').explanation.label,'Ready for your review');
  const ledger=october();ledger.transactions=[tx('a','Groceries',-10000)];
  let view=buildBudgetView(accountPlan,ledger);assert.match(explainBudget(view).label,/over its limit/);assert.equal(explainBudget(view).action.category,'Groceries');
  ledger.transactions=[tx('a','Groceries',-1000)];view=buildBudgetView(accountPlan,ledger);assert.match(explainBudget(view).label,/Confirm/);
  view.status='ready';assert.equal(explainBudget(view).label,'Within your limits so far');
  ledger.transactions=[tx('a','Travel',-1000)];view=buildBudgetView(accountPlan,ledger);assert.match(explainBudget(view).label,/needs a budget/);
});
