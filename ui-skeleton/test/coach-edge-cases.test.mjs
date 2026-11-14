import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationReply} from '../server/conversation.mjs';
import {historyAnswer,parseHistoryQuestion,queryHistory} from '../server/transaction-history.mjs';
const blocked=()=>{throw Error('Unexpected model fallback');};
const turn=(message,session)=>conversationReply({message,session,scenario:'engine',history:[]},blocked);
const ledger=()=>({customerId:'CUST00005',accountIds:['ACC000005'],coverage:{start:'2026-09-01',end:'2026-09-30'},transactions:[
 ...[-4000,700,300].map((amountCents,i)=>({id:'row'+i,customerId:'CUST00005',accountId:'ACC000005',date:`2026-09-0${i+1}`,category:'Groceries',type:'purchase',amountCents})),
 {id:'salary',customerId:'CUST00005',accountId:'ACC000005',date:'2026-09-04',category:'Salary',type:'salary',amountCents:250000}
]});
const answer=(message,data)=>historyAnswer(message,{customerId:'CUST00005',today:'2026-09-30',ledger:data});
test('refund totals and evidence use actual positive spending entries, never salary',()=>{
 const p=answer('How much was I refunded in September?',ledger());assert.match(p.summary,/€10.00.*refunds.*September 2026/);
 assert.deepEqual(p.evidence.map(e=>e.id),['row1','row2']);
 const gross=answer('How much did I spend in September?',ledger());assert.match(gross.summary,/€40.00/);assert.match(gross.bullets.join(' '),/€10.00.*separately/);
 const ranked=answer('Show my one biggest refund in September',ledger());assert.match(ranked.summary,/€7.00.*1 largest/);assert.deepEqual(ranked.evidence.map(e=>e.id),['row1']);
});
test('refund queries preserve missing/partial coverage and merchant uncertainty',()=>{
 let data=ledger();data.coverage.end='2026-09-15';assert.match(answer('What were my refunds in September?',data).summary,/partial history/);
 data.transactions=[];assert.match(answer('What were my refunds in September?',data).summary,/unknown/);assert.doesNotMatch(answer('What were my refunds in September?',data).summary,/€0/);
 assert.match(answer('What were my refunds in October?',ledger()).summary,/No recorded history/);
 data=ledger();data.transactions[1].merchantId='MRC-GRO-0001';
 const partial=answer('What were my refunds at MRC-GRO-0001 in September?',data);assert.match(partial.summary,/incomplete.*€7.00/);assert.equal(partial.evidence[0].id,'row1');
});
test('refund mode survives category/period follow-ups and unknown metadata is not trusted',async()=>{
 let r=await turn('What did I spend on groceries in September?');r=await turn('What about refunds?',r.session);
 assert.match(r.reply,/refunds on groceries in September/);r=await turn('And August?',r.session);assert.match(r.reply,/refunds on groceries in August/);
 r=await turn('And transport?',r.session);assert.match(r.reply,/refunds on transportation in August/);
 const s=structuredClone(r.session);s.messages.at(-1).presentation.historyQuery.measure='invent';
 const response=await conversationReply({scenario:'engine',message:'And 2025?',session:s,history:[]},()=>({title:'',summary:'Which figures do you mean?',bullets:[],nextQuestion:''}));
 assert.equal(response.source,'gemini');
});
test('mixed historical/future read keeps periods separate and preserves a pending goal',async()=>{
 const initial=await turn('I want to save €400 monthly');
 const r=await turn('How much did I spend in 2025 and how much could I save by 2027?',initial.session);
 assert.match(r.reply,/€20,792.23 recorded spending in 2025/);assert.match(r.reply,/€1,500.00 in new savings by 31 December 2027/);
 assert.deepEqual(r.session.awaiting,initial.session.awaiting);assert.equal(r.planChanged,false);
});
test('changing topics expires prior projection corrections and keeps buffer confirmation',async()=>{
 let r=await turn('How much could I save by 2027?');r=await turn('Set my buffer to €500',r.session);r=await turn('Make it €200',r.session);
 assert.equal(r.source,'planning');assert.equal(r.session.awaiting.kind,'buffer_confirm');assert.equal(r.session.draft.bufferCents,null);
});
test('income shock asks for a revised contribution and never claims affordability',async()=>{
 let r=await turn('How much could I save at €200 monthly by 2027 if I lose my job?');assert.match(r.reply,/Losing income/);assert.equal(r.presentation.projection.contributedCents,undefined);
 r=await turn('€50',r.session);assert.equal(r.presentation.projection.contributedCents,75000);assert.equal(r.presentation.projection.affordabilityCalculated,false);
 r=await turn('I lost my job',r.session);assert.match(r.reply,/Losing income/);assert.equal(r.presentation.projection.contributedCents,undefined);
});

test('overdue essentials receive relevant guidance and preserve pending confirmations',async()=>{
 const initial=await turn('I want to save €400 monthly');
 const r=await turn('I am behind on rent. Should I invest my emergency money in crypto to catch up?',initial.session);
 assert.match(r.reply,/Prioritise overdue rent/);assert.match(r.reply,/risky investments can lose value/);
 assert.doesNotMatch(r.reply,/Are you preparing for an unexpected cost/);assert.deepEqual(r.session.awaiting,initial.session.awaiting);
 assert.equal(r.session.draft.goal,null);
});
