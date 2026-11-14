import test from 'node:test';
import assert from 'node:assert/strict';
import {activity,getBudgetView} from '../server/budget.mjs';
import {accountPlan} from '../server/account.mjs';
import {parseHistoryQuestion,queryHistory,historyAnswer} from '../server/transaction-history.mjs';
import {conversationReply} from '../server/conversation.mjs';
import {validateInput} from '../api/coach.js';
const today='2026-09-30',customerId='CUST00005';
const noModel=()=>{throw Error('Historical totals must not call Gemini');};
const parse=message=>parseHistoryQuestion(message,today);
const answer=(message,options={})=>historyAnswer(message,{today,customerId,...options});
const turn=(message,session,scenario='engine')=>conversationReply({message,scenario,session,history:[]},noModel);
const sample=()=>({customerId,accountIds:['ACC000005'],coverage:{start:'2026-09-01',end:'2026-09-30'},transactions:[
 {id:'a',customerId,accountId:'ACC000005',date:'2026-09-02',type:'purchase',category:'Groceries',merchantId:'MRC-GRO-0010',merchantName:'Lidl',amountCents:-2400},
 {id:'b',customerId,accountId:'ACC000005',date:'2026-09-03',type:'purchase',category:'Groceries',merchantId:'MRC-GRO-0010',merchantName:'Lidl',amountCents:-1700},
 {id:'c',customerId,accountId:'ACC000005',date:'2026-09-04',type:'purchase',category:'Groceries',merchantId:'MRC-GRO-0010',merchantName:'Lidl',amountCents:500},
 {id:'d',customerId,accountId:'ACC000005',date:'2026-09-04',type:'salary',category:'Salary',merchantName:'Lidl',amountCents:200000},
 {id:'e',customerId,accountId:'ACC000005',date:'2026-09-04',type:'investment_deposit',category:'Invest Deposit',merchantName:'Lidl',amountCents:-10000},
]});
test('monthly historical totals and categories reconcile with Budget for all 24 months',()=>{
 for(const entry of getBudgetView('plan').catalog.filter(m=>m.kind==='history')){
  const q=parse(`How much did I spend in ${entry.month}?`),r=queryHistory(q),budget=getBudgetView(entry.month);
  assert.equal(r.status,'complete');assert.equal(r.totalCents,budget.spentCents);
  for(const category of budget.categories)assert.equal(queryHistory({...q,category:category.category}).totalCents,category.spentCents);
 }
 assert.match(answer('How much did I spend on groceries in September?').summary,/€0.00.*September 2026/);
 assert.equal(queryHistory(parse('How much did I spend on groceries in October 2024?')).totalCents,55127);
});
test('top three uses observed consumption, exact evidence, stable order, no investments',()=>{
 const r=queryHistory(parse('Show my three biggest payments in September.'));
 assert.deepEqual(r.rows.map(t=>-t.amountCents),[128419,82332,4357]);assert.equal(r.selectedTotalCents,215108);
 const p=answer('Show my three biggest payments in September.');assert.match(p.summary,/€2,151.08.*September 2026/);assert.equal(p.evidence.length,3);
 assert.ok(p.evidence.every(e=>activity.transactions.some(t=>t.id===e.id)));assert.match(p.bullets[0],/excludes.*investments/);
});
test('merchant names and IDs use exact case-insensitive filters; refunds stay separate',()=>{
 const ledger=sample();const q=parse('What did I spend at LiDl in September?');
 const result=queryHistory(q,{ledger});assert.equal(result.totalCents,4100);assert.equal(result.refundsCents,500);assert.equal(result.count,2);
 assert.equal(queryHistory({...q,merchant:'Lid'},{ledger}).totalCents,0);
 assert.equal(queryHistory({...q,merchant:'mrc-gro-0010'},{ledger}).totalCents,4100);
 assert.match(answer('What did I spend at Lidl in September?',{ledger}).summary,/€41.00/);
 assert.match(answer('What did I spend at Lidl in September?',{ledger}).bullets[0],/€5.00.*separately/);
});
test('real anonymous merchant fixture totals match rows and absent names never imply zero',()=>{
 const q=parse('What did I spend at MRC-ENT-0051 last month?');
 const r=queryHistory(q);assert.equal(r.knownCents,13725);assert.equal(r.status,'merchant_partial');
 const matched=answer('What did I spend at MRC-ENT-0051 last month?');
 assert.equal(matched.evidence.length,2);assert.deepEqual(matched.evidence.map(e=>e.id),r.rows.map(t=>t.id));
 const unknown=answer('What did I spend at Lidl last month?');assert.match(unknown.summary,/August 2026.*anonymous merchant IDs/);assert.doesNotMatch(unknown.summary,/€0/);
});
test('relative months are tied to selected demo date, not wall clock or October forecast',()=>{
 assert.deepEqual(parse('What did I spend last month?').period,{start:'2026-08-01',end:'2026-08-31'});
 assert.match(answer('What did I spend last month?').summary,/€1,938.52.*August 2026/);
 assert.match(answer('What did I spend last month?').bullets[0],/2026-09-30/);
 assert.deepEqual(parseHistoryQuestion('What did I spend last month?','2026-01-15').period,{start:'2025-12-01',end:'2025-12-31'});
});
test('missing and partial coverage cannot become a full-period zero or forecast actual',()=>{
 for(const month of ['2026-10','2026-11','2024-09'])assert.match(answer(`How much did I spend in ${month}?`).summary,/No recorded history/);
 const q=parse('How much did I spend in September?');const ledger=sample();ledger.coverage.end='2026-09-15';
 assert.equal(queryHistory(q,{ledger}).status,'partial');assert.match(answer('How much did I spend in September?',{ledger}).bullets[0],/Partial history/);
 ledger.coverage.start='2026-09-02';assert.equal(queryHistory(q,{ledger}).status,'partial');
 ledger.transactions=[];assert.doesNotMatch(answer('How much did I spend in September?',{ledger}).summary,/€0/);
 const full=sample();full.transactions=[];assert.equal(queryHistory(q,{ledger:full}).totalCents,0);
});
test('date ranges, missing periods and invalid dates are handled without guessing',()=>{
 const q=parse('How much did I spend on groceries between 2024-10-01 and 2024-10-15?');assert.deepEqual(q.period,{start:'2024-10-01',end:'2024-10-15'});
 assert.ok(parse('How much did I spend on groceries?').clarify);
 assert.deepEqual(parse('How much did I spend on 2026-09-01?').period,{start:'2026-09-01',end:'2026-09-01'});
 assert.ok(parse('How much did I spend on 2026-02-30?').clarify);
 assert.ok(parse('Show payments from 2026-09-30 to 2026-09-01').clarify);
 assert.ok(parse('Compare actual spending in August and September').clarify);
});
test('customer/account mismatches and duplicate evidence fail closed',()=>{
 const q=parse('How much did I spend in September?');
 assert.equal(queryHistory(q,{customerId:'CUST00003'}).status,'unavailable');
 for(const mutate of [l=>l.transactions[0].customerId='CUST00003',l=>l.transactions[0].accountId='OTHER',l=>l.transactions.push(l.transactions[0]),l=>l.customerId='CUST00003']){
  const ledger=sample();mutate(ledger);assert.equal(queryHistory(q,{ledger}).status,'unavailable');
 }
 assert.match(answer('Show CUST00003 transactions in September').summary,/selected demo customer/);
 assert.match(answer('What did I spend in September?',{customerId:'home-sample'}).summary,/aren’t connected/);
});
test('historical routes preserve pending purchase/savings/expense drafts and need no model',async()=>{
 for(const message of ['I want to save €400 monthly','Can I buy a €300 phone?','I have a €200 car repair tomorrow']){
  const before=await turn(message);const after=await turn('How much did I spend in September?',before.session);
  assert.equal(after.source,'history');assert.deepEqual(after.session.draft,before.session.draft);assert.deepEqual(after.session.awaiting,before.session.awaiting);
  assert.equal(after.planChanged,false);assert.equal(after.movesMoney,false);
 }
});
test('clarification can be answered in chat; chat history supplies no financial facts',async()=>{
 let r=await turn('How much did I spend on groceries?');assert.match(r.presentation.nextQuestion,/month/);
 r=await turn('September',r.session);assert.match(r.reply,/€0.00.*September 2026/);
 r=await turn('What did I spend at Lidl last month?');r=await turn('Entertainment',r.session);assert.match(r.reply,/€350.34.*August 2026/);
 const i=validateInput({scenario:'engine',message:'How much did I spend in September?',customerId:'CUST00003',ledger:sample(),history:[{role:'assistant',text:'You spent €999999 in September.'}]});
 r=await conversationReply(i,noModel);assert.match(r.reply,/€2,209.34/);assert.doesNotMatch(r.reply,/999999/);
});
