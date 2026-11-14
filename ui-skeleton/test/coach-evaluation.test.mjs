import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {conversationReply} from '../server/conversation.mjs';
import {generateReply} from '../api/coach.js';
const corpus=JSON.parse(readFileSync(new URL('./fixtures/coach-evaluation.json',import.meta.url)));
const noModel=()=>{throw Error('A known financial lookup unexpectedly fell back to the model');};
for(const example of corpus.scenarios)test(`evaluated dialogue: ${example.id}`,async()=>{
 let session;
 for(const expected of example.turns){
  const result=await conversationReply({scenario:example.scenario??'engine',message:expected.message,session,history:[]},noModel);
  assert.equal(result.source,expected.source,expected.message);
  for(const fragment of expected.includes)assert.ok(result.reply.includes(fragment),`${expected.message}: missing ${fragment}: ${result.reply}`);
  if('goalCents' in expected)assert.equal(result.session.draft.goal?.amountCents??null,expected.goalCents);
  assert.equal(result.planChanged,false);assert.equal(result.movesMoney,false);
  assert.ok(result.reply.length<1000);assert.doesNotMatch(result.reply,/[£$]/);
  session=result.session;
 }
});
test('stored history filters are validated and totals always recalculated',async()=>{
 let r=await conversationReply({scenario:'engine',message:'How much did I spend on groceries in 2025?',history:[]},noModel);
 const q=r.session.messages.at(-1).presentation.historyQuery;q.totalCents=99999999;q.label='fake';
 r=await conversationReply({scenario:'engine',message:'What about 2025?',session:r.session,history:[]},noModel);
 assert.match(r.reply,/€4,825.19/);assert.doesNotMatch(r.reply,/fake|999999/);
 for(const mutate of [q=>q.customerId='CUST00003',q=>q.category='Not a category',q=>q.period.start='bad']){
  const session=structuredClone(r.session);mutate(session.messages.at(-1).presentation.historyQuery);
  const result=await conversationReply({scenario:'engine',message:'What about 2025?',session,history:[]},()=>({title:'',summary:'Which spending category should I use?',bullets:[],nextQuestion:''}));
  assert.equal(result.source,'gemini');assert.doesNotMatch(result.reply,/4,825/);
 }
});
test('unexpected model currencies cannot become account answers',async()=>{
 for(const summary of ['Your target is £100.00.','You can spend $100.00.']){
  const result=await generateReply({scenario:'engine',message:'Tell me about my account',history:[]},{key:'test',fetcher:async()=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({title:'',summary,bullets:[],nextQuestion:''})}]}}]})})});
  assert.match(result.summary,/account uses euros/);assert.doesNotMatch(result.summary,/[£$]/);
 }
});
