import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createFinancialCoachResponse, captureFinancialPlanInputs } from '../src/financial-coach-client.mjs';
import { loadCustomerPlan, saveCustomerPlan, selectRecoveryOption, reviewPaymentMatch, prepareProtectedCategory } from '../src/saved-plan-client.mjs';

// Actual Python scenario/recovery arithmetic on the committed fixture; no bank DB needed.
const fixture = JSON.parse(execFileSync('python3', ['-c', `
import json
from src.planned_expenses import normalize_expenses,expense_scenario,public_expenses
from src.plan_recovery import current_and_recovery
from src.forecast_safety import estimate_savings
f=json.load(open('fixtures/financial-plan-demo.json'))['forecast']
r=json.load(open('fixtures/financial-plan-request.json'));r['plannedExpenses']=[dict(id='repair',date='2026-10-07',amountCents=20000,category='Transportation',inclusion='additional')]
e=normalize_expenses(r['plannedExpenses'],r['customerId'],r['asOf']);s,c=expense_scenario(f,e,[],[])
b,a,limits=current_and_recovery(f,s,r,c,source=dict(planId='test-plan',revision=1))
result=dict(customerId=r['customerId'],asOf=r['asOf'],modelVersion=f['modelVersion'],forecast=f,planScenario=s,savings=estimate_savings(s,r['bufferCents'],c),budget=b,plannedExpenses=e,alternatives=a,matchingReviews=[],matchingDecisions=[],expenseBlockers=[],legacyFutureCommitments=[],sourcePlanId='test-plan',sourceRevision=1)
r['plannedExpenses']=public_expenses(e)
state=dict(customerId=r['customerId'],asOf=r['asOf'],request=r,plannedExpenses=e,spendingPlan=limits,selectedAlternative=None,priorityNotes={'Entertainment':'Time with friends'})
print(json.dumps(dict(status='loaded',planId='test-plan',revision=1,customerId=r['customerId'],state=state,engineResult=result)))
`], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8' }));

async function server(t, handler) {
  const app = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    handler(req, res, raw ? JSON.parse(raw) : null);
  });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); return new Promise((resolve) => app.close(resolve)); });
  return { endpoint: `http://127.0.0.1:${app.address().port}/api/plan` };
}
const send = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };

test('scenario coach uses expense-adjusted amounts and keeps the historical path separately', () => {
  const result = createFinancialCoachResponse(fixture.engineResult);
  assert.equal(result.cashFlow.facts.lowestExpectedBalance.amountCents, fixture.engineResult.planScenario.lowestExpectedBalance.amountCents);
  assert.deepEqual(result.historicalForecast, fixture.engineResult.forecast);
  assert.equal(result.cashFlow.uncertainty.calibrationCoverageClaimApplies, false);
  assert.equal(result.lockedCommitments[0].amountCents, 20000);
  assert.ok(result.alternatives.some((o) => o.selectable));
  for (const option of result.alternatives) {
    assert.equal(option.selectable, option.available);
    if (!option.available) assert.match(option.title, /Unavailable/);
  }
});

test('saved-plan loading restores exact inputs and customer-written priorities', async (t) => {
  const options = await server(t, (req, res) => { assert.equal(req.method, 'GET'); send(res, fixture); });
  const loaded = await loadCustomerPlan(fixture.customerId, options);
  assert.equal(loaded.inputs.sourceRevision, 1);
  assert.equal(loaded.inputs.plannedExpenses[0].id, 'repair');
  assert.equal(loaded.coach.priorities[0].reason, 'Time with friends');
  assert.equal(loaded.coach.followUp.kind, 'choose_recovery');
  assert.deepEqual(loaded.state, fixture.state);
});

test('no-saved-plan response is explicit and does not invent defaults', async (t) => {
  const options = await server(t, (_req, res) => send(res, { status: 'no_saved_plan', customerId: fixture.customerId }));
  assert.deepEqual(await loadCustomerPlan(fixture.customerId, options), { status: 'no_saved_plan', customerId: fixture.customerId });
});

test('save sends stable mutation/revision identifiers and confirmation only when supplied', async (t) => {
  let wire;
  const options = await server(t, (req, res, body) => { wire = { method: req.method, body }; send(res, { ...fixture, status: 'saved' }); });
  const response = await saveCustomerPlan(fixture.customerId, { ...fixture.state.request, sourcePlanId: 'test-plan', sourceRevision: 1 },
    { ...options, savedPlan: fixture, mutationId: 'same-retry-id', confirmations: { savingsConfirmed: true } });
  assert.equal(response.status, 'saved');
  assert.equal(wire.method, 'PUT');
  assert.equal(wire.body.expectedRevision, 1);
  assert.equal(wire.body.mutationId, 'same-retry-id');
  assert.equal(wire.body.request.sourcePlanId, undefined);
  assert.deepEqual(wire.body.confirmations, { savingsConfirmed: true });
});

test('conflict retains pending input and last valid display', async (t) => {
  const options = await server(t, (_req, res) => send(res, { error: 'Plan revision changed' }, 409));
  const response = await saveCustomerPlan(fixture.customerId, { ...fixture.state.request, bufferCents: 60000 },
    { ...options, savedPlan: fixture, mutationId: 'edit' });
  assert.equal(response.status, 'revision_conflict');
  assert.equal(response.pendingMutation.request.bufferCents, 60000);
  assert.deepEqual(response.engineResult, fixture.engineResult);
  assert.equal(response.savedPlan.revision, 1);
});

test('protection remembers a supplied engine amount and does not weaken an existing higher floor', () => {
  const value = structuredClone(fixture);
  value.state.request.minimumCategoryCents = { Entertainment: 99999 };
  const pending = prepareProtectedCategory(value, { category: 'Entertainment', reason: 'Friends matter' });
  assert.equal(pending.request.minimumCategoryCents.Entertainment, 99999);
  assert.equal(pending.priorityNotes.Entertainment, 'Friends matter');
  assert.equal(pending.request.savingsConfirmed, false);
  assert.deepEqual(value.state.request.minimumCategoryCents, { Entertainment: 99999 });
  assert.throws(() => prepareProtectedCategory(value, { category: 'Unknown', reason: 'x' }), /no engine/);
});

test('only an available option from the current revision can be selected', async (t) => {
  let wire;
  const options = await server(t, (req, res, body) => { wire = { path: req.url, body }; send(res, { ...fixture, status: 'saved' }); });
  const available = fixture.engineResult.alternatives.find((o) => o.available);
  await selectRecoveryOption(fixture, available.id, { ...options, mutationId: 'choose' });
  assert.match(wire.path, /\/select$/);
  assert.equal(wire.body.optionId, available.id);
  assert.equal(wire.body.expectedRevision, fixture.revision);
  await assert.rejects(selectRecoveryOption({ ...fixture, revision: 2 }, available.id, { ...options, mutationId: 'stale' }), /current saved revision/);
  const unavailable = fixture.engineResult.alternatives.find((o) => !o.available);
  await assert.rejects(selectRecoveryOption(fixture, unavailable.id, { ...options, mutationId: 'bad' }), /available option/);
});

test('matching decisions are explicit scoped mutations, and cross-customer state is rejected', async (t) => {
  let wire;
  const options = await server(t, (_req, res, body) => { wire = body; send(res, { ...fixture, status: 'saved' }); });
  const decisions = [{ expenseId: 'repair', transactionId: 'tx', action: 'reject' }];
  await reviewPaymentMatch(fixture, decisions, { ...options, mutationId: 'reject' });
  assert.deepEqual(wire.decisions, decisions);
  await assert.rejects(saveCustomerPlan('OTHER', { ...fixture.state.request, customerId: 'OTHER' }, { ...options, savedPlan: fixture, mutationId: 'foreign' }), /another customer/);
});

test('foreign responses and options cannot replace a customer plan', async (t) => {
  const options = await server(t, (_req, res) => send(res, { ...fixture, customerId: 'OTHER' }));
  await assert.rejects(loadCustomerPlan(fixture.customerId, options), /another customer/);
  const result = structuredClone(fixture.engineResult);
  result.alternatives[0].sourceRevision = 999;
  assert.throws(() => createFinancialCoachResponse(result), /another plan revision/);
});

test('saved expense identifiers and revision survive later coach edits', () => {
  const previous = { ...fixture.state.request, upcomingExpenses: fixture.state.request.plannedExpenses,
    expenseContract: 'planned', sourcePlanId: fixture.planId, sourceRevision: fixture.revision };
  const pending = captureFinancialPlanInputs(fixture.engineResult, { bufferCents: 60000 }, previous);
  assert.equal(pending.engineRequest.ready, true);
  assert.equal(pending.engineRequest.request.sourceRevision, 1);
  assert.equal(pending.engineRequest.request.plannedExpenses[0].id, 'repair');
  assert.deepEqual(pending.engineRequest.request.futureCommitments, []);
});

test('restoring a withheld plan does not replace engine defaults with an empty adjustable set', async (t) => {
  const saved = structuredClone(fixture);
  const result = saved.engineResult;
  result.planScenario.status = 'needs_review';
  result.savings = { ...result.savings, status: 'withheld', conditionalCapacityCents: null, suggestedSavingsCents: null };
  result.budget = { ...result.budget, status: 'withheld', categories: [], preview: null, reason: 'Expense needs review' };
  result.alternatives = [];
  result.expenseBlockers = [{ expenseId: 'repair', reason: 'expense_inclusion_requires_review' }];
  saved.state.request.plannedExpenses[0].inclusion = 'unsure';
  saved.state.plannedExpenses[0].inclusion = 'unsure';
  const options = await server(t, (_req, res) => send(res, saved));
  const loaded = await loadCustomerPlan(saved.customerId, options);
  const pending = captureFinancialPlanInputs(loaded.engineResult, { upcomingExpenses: [{ ...saved.state.request.plannedExpenses[0], inclusion: 'additional' }] }, loaded.inputs);
  assert.equal(pending.engineRequest.ready, true);
  assert.equal(Object.hasOwn(pending.engineRequest.request, 'adjustableCategories'), false);
  assert.equal(Object.hasOwn(pending.engineRequest.request, 'minimumCategoryCents'), false);
});
