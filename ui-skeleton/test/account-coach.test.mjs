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
test('saving more gives the October estimate without opening a goal draft', async () => {
  const noModel = () => { throw Error('Must not call Gemini'); };
  for (const message of ['I want to save more', 'How much more can I save?', 'Show my saving room']) {
    const answer = await conversationReply({ scenario: 'engine', message, history: [] }, noModel);
    assert.equal(answer.source, 'account');
    assert.match(answer.presentation.summary, /€100\.00/);
    assert.match(answer.presentation.bullets.join(' '), /€2,184\.54.*one-time.*€500\.00.*Confirm upcoming costs/);
    assert.equal(answer.session.awaiting, null);
    assert.equal(answer.session.draft.goal, null);
  }
  const monthly = accountAnswer('How much can I save each month?');
  assert.match(monthly.summary, /needs estimates for more than one month/);
  assert.equal(monthly.bullets.length, 0);
});
const noModel = () => { throw Error('Must not call Gemini'); };
const coachTurn = (message, session) => conversationReply({ scenario:'engine', message, history:[], session }, noModel);

test('a purchase interrupts an unfinished savings question and gets the October verdict', async () => {
  const saving = await coachTurn('I want to save');
  assert.equal(saving.session.awaiting.kind, 'goal_amount');
  const purchase = await coachTurn('okei i want to buy a phone for 300 euro', saving.session);
  assert.match(purchase.presentation.summary, /€300\.00 phone looks like it fits in October/);
  assert.equal(purchase.session.awaiting, null);
  assert.equal(purchase.session.draft.goal, null);
  assert.deepEqual(purchase.session.draft.expenses, []);
});

test('a purchase over forecast room offers a named goal and saves only after confirmation', async () => {
  const purchase = await coachTurn('Can I buy a €2400 laptop?');
  assert.match(purchase.presentation.summary, /wait and save for the laptop/);
  assert.deepEqual(purchase.suggestions, ['Add goal', 'Cancel']);
  assert.equal(purchase.session.draft.goal, null);
  const declined = await coachTurn('Cancel', purchase.session);
  assert.equal(declined.session.draft.goal, null);
  const saved = await coachTurn('Add goal', purchase.session);
  assert.deepEqual(saved.session.draft.goal, {label:'laptop', amountCents:240000, currency:'EUR', period:'one_time'});
  assert.equal(saved.planChanged,false);
});

test('a next-month purchase gets no October fit verdict', async () => {
  const purchase = await coachTurn('I want to buy a phone for 300 euro next month');
  assert.match(purchase.presentation.summary, /forecast only covers October/);
  assert.deepEqual(purchase.suggestions, ['Add goal', 'Cancel']);
});
test('malformed and oversized structured model replies fail validation',()=>{
  assert.throws(()=>validatePresentation({summary:'Fine',bullets:'not a list',nextQuestion:''}));
  assert.throws(()=>validatePresentation({summary:'x'.repeat(401),bullets:[],nextQuestion:''}));
  assert.throws(()=>validatePresentation({summary:'Fine',bullets:['a','b','c','d'],nextQuestion:''}));
});
