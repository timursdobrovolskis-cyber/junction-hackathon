import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createChatSession, respondToChat, validateChatSession, restoreChatSession, persistChatSession } from '../server/conversation/chat-coach.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/chat-conversations.json', import.meta.url), 'utf8'));
const fresh = () => createChatSession({ customerId: 'conversation-test', today: fixture.today });
const run = (messages, session = fresh()) => messages.reduce((previous, message) => {
  const snapshot = structuredClone(previous);
  const next = respondToChat(previous, message);
  assert.deepEqual(previous, snapshot, 'caller state stays immutable');
  validateChatSession(next, previous.customerId);
  assert.equal(next.draft.status, 'not_calculated');
  assert.equal(next.messages.at(-2).text, message, 'original input remains in the transcript');
  return next;
}, session);
const last = (s) => s.messages.at(-1);

for (const { id, messages, expected } of fixture.scenarios) test(`conversation: ${id}`, () => {
  const session = run(messages);
  if (expected.goalCents !== undefined) assert.equal(session.draft.goal?.amountCents, expected.goalCents);
  if (expected.period) assert.equal(session.draft.goal?.period, expected.period);
  if (expected.bufferCents !== undefined) assert.equal(session.draft.bufferCents, expected.bufferCents);
  if (expected.priorities) assert.deepEqual(session.draft.priorities.map((p) => p.name), expected.priorities);
  if (expected.expenseCents) assert.deepEqual(session.draft.expenses.map((e) => e.amountCents), expected.expenseCents);
  if (expected.expenseDates) assert.deepEqual(session.draft.expenses.map((e) => e.date), expected.expenseDates);
  if (expected.expenseInclusion) assert.deepEqual(session.draft.expenses.map((e) => e.inclusion), expected.expenseInclusion);
  if (expected.hasSources) assert.ok(session.messages.some((m) => m.sources?.length));
  if (expected.lastReplyIncludes) assert.ok(last(session).text.includes(expected.lastReplyIncludes), last(session).text);
});

test('every educational topic cites approved sources and never changes customer facts', () => {
  for (const question of ['My salary varies', 'Should I repay debt or save?', 'What is an emergency fund?', 'How do I start saving?', 'What is a budget?']) {
    const session = run([question]);
    assert.equal(last(session).kind, 'education', question);
    assert.equal(last(session).sources.length, 1);
    assert.deepEqual(session.draft, fresh().draft);
    assert.equal((last(session).text.match(/\?/g) ?? []).length, 1, 'one focused question');
  }
});

test('negative, ambiguous and unsupported corrections never become accepted amounts', () => {
  const initial = run(['I want to save €400 monthly']);
  for (const correction of ['actually -300', 'no, 300 or 400', 'actually 300.999']) {
    const session = run([correction], initial);
    assert.equal(session.awaiting.goal.amountCents, 40000);
    assert.equal(session.draft.goal, null);
    assert.match(last(session).text, /Nothing has changed/);
  }
});

test('expense dates correct in place and do not create a second expense', () => {
  const initial = run(['A €200 repair tomorrow', 'Extra cost', 'Add expense']);
  const pending = run(['Change repair to next Friday'], initial);
  assert.equal(pending.draft.expenses[0].date, '2026-11-15');
  const updated = run(['Update expense'], pending);
  assert.equal(updated.draft.expenses.length, 1);
  assert.equal(updated.draft.expenses[0].date, '2026-11-20');
  assert.equal(updated.draft.expenses[0].id, initial.draft.expenses[0].id);
});

test('ambiguous expense removal asks for the exact record and cancellation preserves both', () => {
  const initial = run(['A €200 repair tomorrow', 'Extra cost', 'Add expense', 'A €300 repair next Friday', 'Extra cost', 'Add expense']);
  const unsure = run(['Remove repair'], initial);
  assert.match(last(unsure).text, /Which expense/);
  assert.deepEqual(unsure.draft, initial.draft);
  const pending = run([`Remove ${initial.draft.expenses[1].id}`], unsure);
  assert.equal(pending.awaiting.expenseId, initial.draft.expenses[1].id);
  assert.deepEqual(run(['Cancel'], pending).draft, initial.draft);
  const removed = run(['Remove expense'], pending);
  assert.deepEqual(removed.draft.expenses.map((e) => e.id), [initial.draft.expenses[0].id]);
});

test('new expense identifiers are not reused after removal', () => {
  const first = run(['A €200 repair tomorrow', 'Extra cost', 'Add expense']);
  const second = run(['Remove repair', 'yes', 'A €200 repair tomorrow', 'Extra cost', 'Add expense'], first);
  assert.notEqual(first.draft.expenses[0].id, second.draft.expenses[0].id);
});

test('pending expense edits and sourced detours survive browser storage', () => {
  const session = run(['A €200 repair tomorrow', 'Extra cost', 'Add expense', 'Edit repair', 'What is an emergency fund?']);
  const data = new Map(); const storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  persistChatSession(storage, session);
  const restored = restoreChatSession(storage, { customerId: session.customerId, today: fixture.today });
  assert.deepEqual(restored, session);
  const updated = run(['€250', 'Update expense'], restored);
  assert.deepEqual(updated.draft.expenses.map((e) => e.amountCents), [25000]);
});

test('old sessions without new optional context restore without losing the draft', () => {
  const old = run(['I want to save €400 monthly', 'Add goal']); delete old.context;
  validateChatSession(old);
  const resumed = run(['What is an emergency fund?'], old);
  assert.deepEqual(resumed.draft, old.draft);
  assert.ok(resumed.context);
});

test('unknown source URLs and forged expense edit IDs are rejected on restore', () => {
  const sourceSession = run(['What is an emergency fund?']);
  last(sourceSession).sources[0].url = 'javascript:alert(1)';
  assert.throws(() => validateChatSession(sourceSession), /source/);
  const expenseSession = run(['A €200 repair tomorrow', 'Extra cost', 'Add expense', 'Edit repair']);
  expenseSession.awaiting.expense.id = 'not-this-customers-record';
  assert.throws(() => validateChatSession(expenseSession), /Unknown expense/);
});

test('a knowledge detour cannot turn yes into a financial confirmation from another topic', () => {
  const session = run(['I want to save €400', 'My income changes every month', 'Both', 'yes']);
  assert.equal(session.draft.goal, null);
  assert.equal(session.draft.bufferCents, null);
  assert.equal(session.awaiting.kind, 'goal_period');
});

test('an educational offer expires when the customer changes topic', () => {
  const session = run(['My income changes every month', 'Both', 'Show my draft', 'yes']);
  assert.equal(session.awaiting, null);
  assert.equal(session.draft.bufferCents, null);
});
