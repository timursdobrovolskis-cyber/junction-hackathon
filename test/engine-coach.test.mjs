import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createEngineCoachResponse, captureCoachInputs } from '../src/engine-coach.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/savings-demo.json', import.meta.url)));
const example = (index = 0) => structuredClone(fixture.examples[index]);
function withheld(result, status = 'withheld') {
  result.savings = { currency: 'EUR', asOf: result.forecast.asOf, status,
    suggestedSavingsCents: null, conditionalCapacityCents: null, bufferCents: 50000, movesMoney: false };
  return result;
}

test('all three engine examples produce one grounded insight and useful question', () => {
  const kinds = ['conditional_savings_preview', 'expected_buffer_gap', 'conditional_savings_preview'];
  const amounts = [40079, 0, 286139];
  for (let index = 0; index < fixture.examples.length; index++) {
    const input = example(index);
    const original = structuredClone(input);
    const result = createEngineCoachResponse(input);
    assert.equal(result.customerId, input.forecast.customerId);
    assert.equal(result.insight.kind, kinds[index]);
    assert.equal(result.facts.savings.amountCents, amounts[index]);
    assert.equal(result.facts.savings.requiresConfirmation, true);
    assert.equal(result.facts.buffer.amountCents, 50000);
    assert.ok(result.followUp.prompt);
    assert.equal(Array.isArray(result.followUp), false);
    const evidence = new Set(input.forecast.evidence.map((row) => row.id));
    assert.ok(result.evidence.transactionIds.length > 0);
    assert.ok(result.evidence.transactionIds.every((id) => evidence.has(id)));
    assert.deepEqual(result.evidence.unresolvedTransactionIds, []);
    assert.equal(result.movesMoney, false);
    assert.match(result.uncertainty.message, /€2,438.53/);
    assert.deepEqual(input, original);
  }
});

test('cent amounts and estimated payment windows are explained without promising a payday', () => {
  const result = createEngineCoachResponse(example());
  assert.match(result.insight.explanation, /€400.79/);
  assert.match(result.insight.explanation, /€500.00/);
  assert.match(result.insight.explanation, /conditional/);
  assert.match(result.insight.explanation, /€523.88/);
  assert.match(result.insight.explanation, /already included/);
  const salary = result.paymentContext.find((row) => row.direction === 'inflow');
  assert.equal(salary.earliestDate, '2026-10-03');
  assert.equal(salary.latestDate, '2026-10-30');
  assert.equal(salary.isEstimate, true);
  assert.match(result.uncertainty.incomeTimingNote, /not a promise/);
  assert.equal(result.followUp.kind, 'cash_buffer');
  assert.equal(createEngineCoachResponse(example(), { bufferConfirmed: true }).followUp.kind, 'upcoming_expenses');
});

test('the low-balance customer is not told the broad income window guarantees money before the low point', () => {
  const result = createEngineCoachResponse(example(1));
  assert.match(result.insight.explanation, /€459.32/);
  assert.match(result.insight.explanation, /2026-10-14/);
  assert.match(result.insight.explanation, /below/);
  assert.doesNotMatch(result.insight.explanation, /before payday|will arrive/);
  assert.equal(result.followUp.kind, 'upcoming_expenses');
});

test('calibrated risk uses the supplied daily lower bound, not stale raw scenario flags', () => {
  const input = example();
  input.forecast.daily[0].calibratedLowerBalanceCents = 49999;
  input.forecast.possibleBelowBufferDates = [];
  input.savings.conditionalCapacityCents = 0;
  const result = createEngineCoachResponse(input);
  assert.equal(result.insight.kind, 'uncertain_buffer_gap');
  assert.match(result.insight.explanation, /€499.99/);
  assert.match(result.insight.explanation, /not a prediction/);
});

test('an opening balance below the customer buffer takes priority over later recovery', () => {
  const input = example();
  input.forecast.startingBalanceCents = 20000;
  const result = createEngineCoachResponse(input);
  assert.equal(result.insight.kind, 'current_buffer_gap');
  assert.match(result.insight.explanation, /€200.00/);
});

test('insufficient history explains the missing coverage without inventing zero forecasts', () => {
  const input = withheld(example());
  input.forecast = { customerId: 'short-history', asOf: '2026-09-30', currency: 'EUR', modelVersion: 'conditioned-income-v2',
    status: 'insufficient_history', horizonDays: 30, daily: [], upcomingPayments: [],
    warnings: ['An account has fewer than three complete months; forecast withheld.'] };
  const result = createEngineCoachResponse(input);
  assert.equal(result.insight.kind, 'insufficient_history');
  assert.match(result.insight.explanation, /three complete months/);
  assert.equal(result.facts.savings.amountCents, null);
  assert.equal(result.facts.lowestExpectedBalance, null);
  assert.equal(result.facts.startingBalance, null);
  assert.equal(result.followUp.id, 'history_coverage');
});

test('needs_review explains stale balances and unknown flows and withholds savings', () => {
  const input = withheld(example());
  input.forecast.status = 'needs_review';
  input.forecast.accounts[0].daysSinceLastTransaction = 40;
  input.forecast.warnings.push('Unclassified or reversed flows remain in cash totals but need review before forecasting.');
  const result = createEngineCoachResponse(input);
  assert.equal(result.insight.kind, 'needs_review');
  assert.match(result.insight.explanation, /out of date/);
  assert.match(result.insight.explanation, /classification/);
  assert.equal(result.facts.savings.amountCents, null);
  assert.equal(result.followUp.kind, 'review_inputs');
});

test('a forecast needing review cannot expose a stale positive savings preview', () => {
  const input = example();
  input.forecast.status = 'needs_review';
  assert.equal(createEngineCoachResponse(input).facts.savings.amountCents, null);
});

test('withheld savings retain the engine reason', () => {
  const input = withheld(example());
  delete input.forecast.calibration;
  input.savings.reason = 'An eligible calibrated forecast is required.';
  const result = createEngineCoachResponse(input);
  assert.equal(result.insight.kind, 'savings_withheld');
  assert.ok(result.insight.explanation.startsWith(input.savings.reason));
  assert.equal(result.facts.savings.amountCents, null);
  assert.equal(result.followUp, null);
});

test('confirmed commitments still produce a conditional estimate, never a guarantee', () => {
  const input = example();
  input.savings.status = 'conditional_estimate';
  input.savings.suggestedSavingsCents = input.savings.conditionalCapacityCents;
  const result = createEngineCoachResponse(input, { bufferConfirmed: true });
  assert.equal(result.insight.kind, 'conditional_savings_estimate');
  assert.equal(result.facts.savings.requiresConfirmation, false);
  assert.equal(result.facts.savings.isConditional, true);
  assert.match(result.insight.explanation, /remain uncertain/);
});

test('missing evidence is named rather than fabricated', () => {
  const input = example();
  const removed = input.forecast.evidence.pop();
  const result = createEngineCoachResponse(input);
  assert.ok(result.evidence.unresolvedTransactionIds.includes(removed.id));
  assert.ok(!result.evidence.transactions.some((row) => row.id === removed.id));
});

test('chosen buffer and expenses become pending engine inputs without changing results', () => {
  const input = example();
  const original = structuredClone(input);
  const result = captureCoachInputs(input, { bufferCents: 60000,
    upcomingExpenses: [{ id: 'repair', date: '2026-10-10', amountCents: 15000, inclusion: 'additional' },
      { id: 'trip', date: '2026-12-01', amountCents: 20000, inclusion: 'additional' }] });
  assert.equal(result.status, 'awaiting_recalculation');
  assert.equal(result.forecastChanged, false);
  assert.equal(result.savingsChanged, false);
  assert.equal(result.inputs.bufferCents, 60000);
  assert.equal(result.inputs.commitmentsConfirmed, false);
  assert.equal(result.engineRequest.forecastInputs.buffer_cents, 60000);
  assert.deepEqual(result.engineRequest.savingsInputs.future_commitments, [{ id: 'trip', date: '2026-12-01', amountCents: 20000 }]);
  assert.equal(result.engineRequest.inHorizonExpenses[0].id, 'repair');
  assert.equal(result.engineRequest.readyForCurrentEngine, true);
  assert.deepEqual(result.engineRequest.plannedExpenses.map((e) => e.id), ['repair', 'trip']);
  assert.equal(result.movesMoney, false);
  assert.deepEqual(input, original);
});

test('the final horizon day goes to the forecast, the following day goes to the savings reserve', () => {
  const input = example();
  const result = captureCoachInputs(input, { upcomingExpenses: [
    { id: 'last', date: '2026-10-30', amountCents: 1000, inclusion: 'additional' },
    { id: 'next', date: '2026-10-31', amountCents: 2000, inclusion: 'additional' },
  ] });
  assert.equal(result.engineRequest.inHorizonExpenses[0].id, 'last');
  assert.equal(result.engineRequest.savingsInputs.future_commitments[0].id, 'next');
});

test('uncertain inclusion is held for review and already forecast costs are not added again', () => {
  const result = captureCoachInputs(example(), { upcomingExpenses: [
    { id: 'unknown', date: '2026-12-01', amountCents: 1000 },
    { id: 'rent', date: '2026-10-03', amountCents: 50000, inclusion: 'already_included' },
  ] });
  assert.equal(result.engineRequest.needsInclusionReview[0].id, 'unknown');
  assert.equal(result.engineRequest.alreadyIncludedExpenses[0].id, 'rent');
  assert.deepEqual(result.engineRequest.savingsInputs.future_commitments, []);
  assert.equal(result.engineRequest.readyForCurrentEngine, false);
});

test('expense updates preserve previous costs and reset confirmation unless explicitly renewed', () => {
  const first = captureCoachInputs(example(), { upcomingExpenses: [{ id: 'trip', date: '2026-12-01', amountCents: 20000, inclusion: 'additional' }], commitmentsConfirmed: true });
  const second = captureCoachInputs(example(), { bufferCents: 0 }, first.inputs);
  assert.equal(second.inputs.bufferCents, 0);
  assert.equal(second.inputs.upcomingExpenses.length, 1);
  assert.equal(second.inputs.commitmentsConfirmed, false);
  const third = captureCoachInputs(example(), { removeExpenseIds: ['trip'], commitmentsConfirmed: true }, second.inputs);
  assert.deepEqual(third.inputs.upcomingExpenses, []);
  assert.equal(third.engineRequest.savingsInputs.commitments_confirmed, true);
  assert.equal(second.inputs.upcomingExpenses.length, 1);
});

test('existing future-cost reserves survive buffer changes and already-included answers', () => {
  const input = example();
  input.savings.futureCommitments = [{ id: 'existing', date: '2026-12-01', amountCents: 10000 }];
  const result = captureCoachInputs(input, { bufferCents: 0, upcomingExpenses: [
    { id: 'existing', date: '2026-12-01', amountCents: 10000, inclusion: 'already_included' },
  ] });
  assert.deepEqual(result.engineRequest.savingsInputs.future_commitments, input.savings.futureCommitments);
  const unknown = captureCoachInputs(example(), { upcomingExpenses: [
    { id: 'not-listed', date: '2026-12-01', amountCents: 10000, inclusion: 'already_included' },
  ] });
  assert.equal(unknown.engineRequest.readyForCurrentEngine, false);
});

test('only the real Python savings engine supplies recalculated amounts', () => {
  const input = example();
  const pending = captureCoachInputs(input, { bufferCents: 60000, commitmentsConfirmed: true,
    upcomingExpenses: [{ id: 'trip', date: '2026-12-01', amountCents: 10000, inclusion: 'additional' }] });
  assert.equal(pending.engineRequest.readyForCurrentEngine, true);
  assert.equal(createEngineCoachResponse(input).facts.savings.amountCents, 40079);
  const engine = spawnSync('python3', ['-c',
    'import json,sys; from src.forecast_safety import estimate_savings; x=json.load(sys.stdin); print(json.dumps(estimate_savings(x["forecast"], **x["inputs"])))'],
  { cwd: new URL('..', import.meta.url), input: JSON.stringify({ forecast: input.forecast, inputs: pending.engineRequest.savingsInputs }), encoding: 'utf8' });
  assert.equal(engine.status, 0, engine.stderr);
  const recalculated = { forecast: input.forecast, savings: JSON.parse(engine.stdout) };
  const response = createEngineCoachResponse(recalculated, { bufferConfirmed: true });
  assert.equal(response.facts.savings.amountCents, 20079);
  assert.equal(response.facts.savings.sourcePath, 'savings.suggestedSavingsCents');
  assert.equal(input.savings.conditionalCapacityCents, 40079);
});

for (const [name, mutate, expected] of [
  ['mixed cutoffs', (x) => { x.savings.asOf = '2026-09-29'; }, /same reference/],
  ['mixed customers', (x) => { x.savings.customerId = 'someone-else'; }, /different customers/],
  ['fractional cents', (x) => { x.savings.bufferCents = 5.5; }, /safe integer/],
  ['unconfirmed suggested amount', (x) => { x.savings.suggestedSavingsCents = 1; }, /no suggested amount/],
  ['invalid status', (x) => { x.forecast.status = 'guaranteed'; }, /unsupported/],
  ['future evidence', (x) => { x.forecast.evidence[0].date = '2027-01-01'; }, /cannot follow/],
]) test(`rejects ${name}`, () => { const x = example(); mutate(x); assert.throws(() => createEngineCoachResponse(x), expected); });

test('answer validation rejects ambiguous money, duplicate expenses and cross-customer state', () => {
  for (const bufferCents of [null, -1, 5.5, '500']) assert.throws(() => captureCoachInputs(example(), { bufferCents }));
  const expense = { id: 'x', date: '2026-12-01', amountCents: 1000, inclusion: 'additional' };
  assert.throws(() => captureCoachInputs(example(), { upcomingExpenses: [expense, expense] }), /unique/);
  assert.throws(() => captureCoachInputs(example(), { commitmentsConfirmed: 'yes' }), /explicit/);
  const overdue = captureCoachInputs(example(), { upcomingExpenses: [{ ...expense, date: '2026-09-30' }] });
  assert.equal(overdue.engineRequest.readyForCurrentEngine, false);
  assert.equal(overdue.engineRequest.needsInclusionReview[0].id, 'x');
  const previous = captureCoachInputs(example(1), { bufferCents: 10000 });
  assert.throws(() => captureCoachInputs(example(), { bufferCents: 20000 }, previous.inputs), /this customer/);
});
