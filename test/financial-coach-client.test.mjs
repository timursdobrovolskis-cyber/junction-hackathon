import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createFinancialCoachResponse, fetchFinancialPlan, captureFinancialPlanInputs, previewFinancialPlanChange } from '../src/financial-coach-client.mjs';

const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const fixture = await read('../fixtures/financial-plan-demo.json');
const request = await read('../fixtures/financial-plan-request.json');
const adjustment = await read('../fixtures/budget-adjustment-demo.json');
const clone = (x) => structuredClone(x);

async function serve(t, handler) {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    handler(req, res, JSON.parse(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return { endpoint: `http://127.0.0.1:${server.address().port}/api/plan` };
}
const send = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };

test('combined fixture produces both panels with one active question and distinct forecast bases', () => {
  const response = createFinancialCoachResponse(fixture);
  assert.equal(response.activeSource, 'budget');
  assert.equal(response.followUp.kind, 'confirm_savings_target');
  assert.equal(response.budget.status, 'needs_confirmation');
  assert.equal(response.cashFlow.facts.savings.requiresConfirmation, true);
  assert.match(response.basis.cashFlow, /before category edits/);
  assert.equal(response.budget.uncertainty.calibrationCoverageClaimApplies, false);
  assert.equal(createFinancialCoachResponse(fixture, { focus: 'cash_flow' }).followUp.kind, 'cash_buffer');
  response.budget.categories[0].previewLimitCents = 0;
  assert.notEqual(fixture.budget.categories[0].previewLimitCents, 0);
});

test('HTTP client posts the documented request and validates the complete response', async (t) => {
  let received;
  const options = await serve(t, (req, res, body) => {
    received = { method: req.method, path: req.url, type: req.headers['content-type'], body };
    send(res, fixture);
  });
  assert.deepEqual(await fetchFinancialPlan(request, options), fixture);
  assert.deepEqual(received, { method: 'POST', path: '/api/plan', type: 'application/json', body: request });
});

test('category edit uses combined API, preserves all panels, and removes coach-only metadata from wire input', async (t) => {
  let received;
  const options = await serve(t, (_req, res, body) => { received = body; send(res, { ...fixture, budget: adjustment.after }); });
  const response = await previewFinancialPlanChange(fixture, { categoryOverrides: { Entertainment: 20509 } }, undefined, options);
  assert.equal(response.status, 'recalculated');
  assert.equal(response.budgetChanged, true);
  assert.equal(response.forecastChanged, false);
  assert.equal(response.savingsChanged, false);
  assert.equal(received.categoryOverrides.Entertainment, 20509);
  assert.equal(received.customerId, fixture.customerId);
  assert.equal(received.bufferConfirmed, undefined);
  assert.equal(received.upcomingExpenses, undefined);
  assert.deepEqual(response.engineResult.budget, adjustment.after);
});

test('expense capture preserves known reserves, strips labels, and avoids adding already projected expenses', () => {
  const pending = captureFinancialPlanInputs(fixture, { upcomingExpenses: [
    { id: 'later', date: '2026-12-01', amountCents: 10000, label: 'Trip', inclusion: 'additional' },
    { id: 'rent', date: '2026-10-03', amountCents: 10000, inclusion: 'already_included' },
  ] });
  assert.equal(pending.engineRequest.ready, true);
  assert.deepEqual(pending.engineRequest.request.futureCommitments, [{ id: 'later', date: '2026-12-01', amountCents: 10000 }]);
  assert.equal(pending.inputs.upcomingExpenses[0].label, 'Trip');
  const next = captureFinancialPlanInputs(fixture, { savingsTargetCents: 40000 }, pending.inputs);
  assert.deepEqual(next.engineRequest.request.futureCommitments, pending.engineRequest.request.futureCommitments);
  assert.equal(next.engineRequest.request.savingsTargetCents, 40000);
  assert.equal(next.budgetChanged, false);
  assert.equal(next.savingsChanged, false);
  assert.equal(next.forecastChanged, false);
});

test('unknown expense inclusion and new in-window costs remain blocked on later edits', async () => {
  for (const [inclusion, blocker] of [['unsure', 'expense_inclusion_requires_review'], ['additional', 'in_horizon_expenses_need_engine_support']]) {
    const pending = await previewFinancialPlanChange(fixture, { upcomingExpenses: [{ id: 'repair', date: '2026-10-20', amountCents: 10000, inclusion }] }, undefined,
      { endpoint: 'http://127.0.0.1:1/api/plan' });
    assert.equal(pending.status, 'awaiting_recalculation');
    assert.ok(pending.engineRequest.blockers.includes(blocker));
    assert.deepEqual(pending.engineResult, fixture);
    const edited = captureFinancialPlanInputs(fixture, { bufferCents: 60000 }, pending.inputs);
    assert.equal(edited.engineRequest.ready, false);
    const corrected = captureFinancialPlanInputs(fixture, { upcomingExpenses: [{ id: 'repair', date: '2026-12-20', amountCents: 10000, inclusion: 'additional' }] }, edited.inputs);
    assert.equal(corrected.engineRequest.ready, true);
  }
});

test('full commitment replacement and removals are explicit and reset confirmations', () => {
  const initial = captureFinancialPlanInputs(fixture, { futureCommitments: [{ id: 'later', date: '2026-12-20', amountCents: 10000 }], savingsConfirmed: true, commitmentsConfirmed: true });
  assert.equal(initial.inputs.commitmentsConfirmed, true);
  const changed = captureFinancialPlanInputs(fixture, { futureCommitments: [] }, initial.inputs);
  assert.deepEqual(changed.inputs.upcomingExpenses, []);
  assert.deepEqual(changed.engineRequest.request.futureCommitments, []);
  assert.equal(changed.inputs.commitmentsConfirmed, false);
  assert.equal(changed.inputs.savingsConfirmed, false);
  assert.throws(() => captureFinancialPlanInputs(fixture, { futureCommitments: [], upcomingExpenses: [] }), /either/);
});

test('API failures keep prior forecast, savings and budget while retaining pending choices', async (t) => {
  const options = await serve(t, (_req, res) => send(res, { error: 'Unknown customer' }, 400));
  const response = await previewFinancialPlanChange(fixture, { savingsTargetCents: 40000 }, undefined, options);
  assert.equal(response.status, 'recalculation_failed');
  assert.equal(response.error, 'Unknown customer');
  assert.deepEqual(response.engineResult, fixture);
  assert.equal(response.inputs.savingsTargetCents, 40000);
  assert.equal(response.forecastChanged, false);
  assert.equal(response.savingsChanged, false);
  assert.equal(response.budgetChanged, false);
});

test('mismatched customer, preferences, confirmations and ignored overrides cannot replace a preview', async (t) => {
  const options = await serve(t, (_req, res) => send(res, fixture));
  await assert.rejects(fetchFinancialPlan({ ...request, customerId: 'CUST00001' }, options), /another customer/);
  await assert.rejects(fetchFinancialPlan({ ...request, bufferCents: 40000 }, options), /different financial preferences/);
  await assert.rejects(fetchFinancialPlan({ ...request, savingsConfirmed: true }, options), /different confirmations/);
  const response = await previewFinancialPlanChange(fixture, { categoryOverrides: { Entertainment: 20509 } }, undefined, options);
  assert.equal(response.status, 'recalculation_failed');
  assert.match(response.error, /did not apply/);
});

test('timeouts and malformed JSON return the previous complete plan', async (t) => {
  const hanging = await serve(t, () => {});
  const timeout = await previewFinancialPlanChange(fixture, { savingsTargetCents: 40000 }, undefined, { ...hanging, timeoutMs: 20 });
  assert.equal(timeout.status, 'recalculation_failed');
  assert.deepEqual(timeout.engineResult, fixture);
  const malformed = await serve(t, (_req, res) => res.end('not JSON'));
  const failed = await previewFinancialPlanChange(fixture, { bufferCents: 40000 }, undefined, malformed);
  assert.equal(failed.status, 'recalculation_failed');
  assert.deepEqual(failed.engineResult, fixture);
});

test('invalid requests and cross-customer state are rejected before submission', async () => {
  for (const update of [{ bufferCents: 1.5 }, { savingsTargetCents: -1 }, { savingsConfirmed: 'yes' }, { extra: true }, { adjustableCategories: 'Housing' }, { futureCommitments: [{ id: 'x', date: '2026-12-01', amountCents: 1, label: 'extra' }] }]) {
    await assert.rejects(fetchFinancialPlan({ ...request, ...update }), TypeError);
  }
  const inputs = captureFinancialPlanInputs(fixture, { savingsConfirmed: true }).inputs;
  inputs.customerId = 'other';
  assert.throws(() => captureFinancialPlanInputs(fixture, { savingsConfirmed: true }, inputs), /customer/);
  const invalid = clone(fixture); invalid.savings.bufferCents = 1;
  assert.throws(() => createFinancialCoachResponse(invalid), /same buffer/);
});
