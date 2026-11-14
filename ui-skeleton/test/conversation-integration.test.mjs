import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationReply, validateConversation } from '../server/conversation.mjs';

const blockedModel = async () => { throw new Error('Confirmation must not call Gemini'); };
async function turn(message, session, generate = blockedModel, scenario = 'design') {
  return conversationReply({ scenario, message, session, history: [] }, generate);
}
test('goal changes require confirmation and remain uncalculated', async () => {
  const proposal = await turn('I want to save €400 monthly but don’t cut my gym');
  assert.equal(proposal.session.draft.goal, null);
  assert.equal(proposal.session.awaiting.goal.amountCents, 40000);
  const correction = await turn('actually €300', proposal.session);
  assert.equal(correction.session.awaiting.goal.amountCents, 30000);
  const saved = await turn('Add goal', correction.session);
  assert.equal(saved.session.draft.goal.amountCents, 30000);
  assert.equal(saved.session.draft.priorities[0].name, 'gym');
  assert.equal(saved.session.draft.status, 'not_calculated');
  assert.equal(saved.planChanged, false);
  assert.equal(saved.movesMoney, false);
});
test('expense confirmation preserves exact dates and does not duplicate a retry', async () => {
  let result = await turn('I have a €200 car repair tomorrow');
  assert.equal(result.session.awaiting.expense.date, '2026-11-15');
  result = await turn('Extra cost', result.session);
  const before = structuredClone(result.session);
  const once = await turn('Add expense', before);
  const retry = await turn('Add expense', before);
  assert.deepEqual(once.session.draft, retry.session.draft);
  assert.equal(once.session.draft.expenses.length, 1);
  assert.equal(once.session.draft.expenses[0].amountCents, 20000);
});
test('Gemini can explain but cannot mutate the draft', async () => {
  let s = (await turn('I want to save €400 monthly but don’t cut my gym')).session;
  s = (await turn('Add goal', s)).session;
  let input;
  const response = await turn('Explain my plan in simple words.', s, async value => { input = value; return 'Your goal is a requested preference, ready for a forecast check.'; });
  assert.equal(response.source, 'gemini');
  assert.deepEqual(response.session.draft, s.draft);
  assert.equal(input.draft.goal.amountCents, 40000);
});
test('profile switching cannot submit a foreign draft; failed Gemini leaves input intact', async () => {
  const proposal = await turn('I want to save €300 monthly');
  assert.throws(() => validateConversation(proposal.session, 'engine'));
  const initial = structuredClone(proposal.session);
  // Unknown phrasing reaches Gemini without confirming the open goal.
  const fresh = (await turn('Cancel', proposal.session)).session;
  const snapshot = structuredClone(fresh);
  await assert.rejects(turn('Tell me about my current plan', fresh, async () => { throw new Error('offline'); }), /offline/);
  assert.deepEqual(fresh, snapshot);
  assert.deepEqual(proposal.session, initial);
});
test('historical profile uses its observation date for relative expenses', async () => {
  const response = await turn('I have a €200 car repair tomorrow', undefined, blockedModel, 'engine');
  assert.equal(response.session.awaiting.expense.date, '2026-10-01');
});
