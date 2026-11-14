import test from 'node:test';
import assert from 'node:assert/strict';
import { account, accountPlan, accountAnswer } from '../server/account.mjs';
import { conversationReply } from '../server/conversation.mjs';
import { validatePresentation } from '../server/reply-format.mjs';
test('account identity and amounts match the engine snapshot',()=>{
  assert.equal(account.customerId,accountPlan.customerId);
  assert.equal(account.balanceCents,646614);
  assert.equal(account.balanceCents,account.accounts.reduce((sum,a)=>sum+a.balanceCents,0));
  assert.equal(account.spendingPlanCents,accountPlan.budget.totalPlannedSpendingCents);
  assert.equal(account.connection,'saved_account_snapshot');
  assert.equal(account.capabilities.recalculate,false);
});
test('account answers are server-grounded and do not need Gemini',async()=>{
  const reply=await conversationReply({scenario:'engine',message:'Show upcoming bills',history:[]},async()=>{throw Error('Must not call Gemini');});
  assert.equal(reply.source,'account');
  assert.equal(reply.presentation.metrics[0].value,'€799.13');
  assert.equal(reply.presentation.metrics[1].value,'€127.00');
  assert.ok(reply.presentation.evidence.every(e=>account.evidence.some(row=>row.id===e.id)));
  assert.equal(reply.planChanged,false);
});
test('account questions preserve pending confirmations and goals',async()=>{
  const input={scenario:'engine',message:'I want to save €300 monthly',history:[]};
  const initial=await conversationReply(input,async()=>{throw Error('No model');});
  const answer=await conversationReply({...input,message:'Show my spending plan',session:initial.session},async()=>{throw Error('No model');});
  assert.deepEqual(answer.session.awaiting,initial.session.awaiting);
  assert.equal(answer.session.draft.goal,null);
  assert.deepEqual(answer.suggestions,['Continue','Cancel']);
});
test('conditional savings are not presented as a confirmed monthly allowance',()=>{
  const answer=accountAnswer('Show my saving room');
  assert.equal(answer.metrics[1].value,'€2,184.54');
  assert.match(answer.bullets.join(' '),/one-time/);
  assert.match(answer.bullets.join(' '),/confirmation/);
});
test('malformed and oversized structured model replies fail validation',()=>{
  assert.throws(()=>validatePresentation({summary:'Fine',bullets:'not a list',nextQuestion:''}));
  assert.throws(()=>validatePresentation({summary:'x'.repeat(401),bullets:[],nextQuestion:''}));
  assert.throws(()=>validatePresentation({summary:'Fine',bullets:['a','b','c','d'],nextQuestion:''}));
});
