import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBudgetCoachResponse, captureBudgetInputs } from '../src/budget-coach.mjs';
import { previewBudgetChange, runBudgetEngine } from '../src/budget-engine-client.mjs';

const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const { examples } = await read('../fixtures/budget-demo.json');
const adjustment = await read('../fixtures/budget-adjustment-demo.json');
const flexible = examples[3];
const clone = (v) => structuredClone(v);

test('all four customers produce grounded, independent frontend content', () => {
  const before = clone(examples);
  const responses = examples.map(createBudgetCoachResponse);
  assert.deepEqual(responses.map((r) => r.insight.kind), ['infeasible_budget', 'infeasible_budget', 'budget_fits', 'budget_adjustments']);
  for (let i = 0; i < responses.length; i++) {
    const r = responses[i], b = examples[i].budget;
    assert.equal(r.status, b.status);
    assert.equal(r.movesMoney, false);
    assert.equal(r.uncertainty.calibrationCoverageClaimApplies, false);
    assert.deepEqual(r.evidence.unresolvedIds, []);
    assert.ok(r.evidence.ids.length);
    for (const component of examples[i].originalForecast.cashFlowComponents) {
      for (const id of component.evidenceIds) assert.ok(r.evidence.ids.includes(id));
    }
    assert.equal(r.period.end, b.periodEnd);
    for (const fact of r.facts) assert.equal(fact.amountCents, b[fact.key]);
    r.balancePreview.daily[0].expectedBalanceCents = 0;
    r.evidence.records[0].amountCents = 0;
  }
  assert.deepEqual(examples, before);
  assert.match(responses[0].insight.explanation, /€82\.29/);
  assert.match(responses[1].insight.explanation, /€2,654\.14/);
  assert.match(responses[3].insight.explanation, /€100\.00.*€500\.00/);
});

test('infeasible diagnostic zero amounts are never renderable recommendations', () => {
  const r = createBudgetCoachResponse(examples[0]);
  assert.equal(r.balancePreview.displayMode, 'diagnostic');
  assert.ok(r.categories.some((c) => c.diagnosticLimitCents === 0));
  assert.ok(r.categories.every((c) => c.previewLimitCents === null && c.suggestedLimitCents === null && c.displayMode === 'diagnostic'));
});

test('withheld plans explain missing forecast components without requesting irrelevant input', async () => {
  const f = clone(flexible.originalForecast);
  delete f.cashFlowComponents;
  const budget = await runBudgetEngine(f, { buffer_cents: 50000, savings_target_cents: 10000 });
  const result = { budget, originalForecast: f };
  const r = createBudgetCoachResponse(result);
  assert.equal(r.status, 'withheld');
  assert.match(r.insight.explanation, /category cash-flow components/);
  assert.equal(r.followUp, null);
  assert.equal(r.balancePreview, null);
  assert.equal(captureBudgetInputs(result, { bufferCents: 40000 }).engineRequest.ready, false);
});

test('input capture is pending and preserves supplied protections, overrides, and zero choices', () => {
  const pending = captureBudgetInputs(flexible, { categoryOverrides: { Entertainment: 20509 }, savingsTargetCents: 0 });
  assert.equal(pending.status, 'awaiting_recalculation');
  assert.equal(pending.budgetChanged, false);
  assert.equal(pending.forecastChanged, false);
  assert.equal(pending.engineRequest.engineInputs.savings_target_cents, 0);
  assert.equal(pending.inputs.minimumCategoryCents.Housing, flexible.budget.categories.find((c) => c.category === 'Housing').protectedCents);
  const next = captureBudgetInputs(flexible, { bufferCents: 45000 }, pending.inputs);
  assert.equal(next.inputs.categoryOverrides.Entertainment, 20509);
  assert.equal(next.inputs.savingsTargetCents, 0);
  assert.equal(pending.inputs.bufferCents, 50000);
});

test('withheld plans distinguish missing history and inputs needing review', async () => {
  for (const status of ['insufficient_history', 'needs_review']) {
    const f = clone(flexible.originalForecast); f.status = status;
    const budget = await runBudgetEngine(f, { buffer_cents: 50000, savings_target_cents: 10000 });
    const response = createBudgetCoachResponse({ budget, originalForecast: f });
    assert.equal(response.status, 'withheld');
    assert.match(response.insight.explanation, status === 'insufficient_history' ? /three complete months/ : /inputs need review/);
  }
});

test('customer floors persist and changing adjustability alone cannot erase protections', async () => {
  const category = flexible.budget.categories.find((c) => c.category === 'Groceries');
  const adjustable = flexible.budget.categories.filter((c) => c.adjustable).map((c) => c.category);
  const retained = await previewBudgetChange(flexible, { adjustableCategories: [...adjustable, 'Groceries'] });
  assert.equal(retained.status, 'recalculated');
  assert.equal(retained.engineResult.budget.categories.find((c) => c.category === 'Groceries').protectedCents, category.protectedCents);
  const relaxed = await previewBudgetChange(retained.engineResult, { minimumCategoryCents: { Groceries: 1000 } }, retained.inputs);
  assert.equal(relaxed.status, 'recalculated');
  assert.equal(relaxed.engineResult.budget.categories.find((c) => c.category === 'Groceries').protectedCents, 1000);
  const next = captureBudgetInputs(relaxed.engineResult, { bufferCents: 40000 }, relaxed.inputs);
  assert.equal(next.inputs.minimumCategoryCents.Groceries, 1000);
});

test('real engine category edit matches Timurs before/after fixture exactly', async () => {
  const before = clone(flexible);
  const changed = await previewBudgetChange(flexible, { categoryOverrides: { Entertainment: 20509 } });
  assert.equal(changed.status, 'recalculated');
  assert.deepEqual(changed.engineResult.budget, adjustment.after);
  assert.deepEqual(flexible, before);
  assert.deepEqual(changed.engineResult.originalForecast, flexible.originalForecast);
  assert.equal(changed.forecastChanged, false);
  assert.equal(changed.coach.categories.find((c) => c.category === 'Entertainment').previewLimitCents, 20509);
  assert.equal(changed.coach.status, 'needs_confirmation');
  const again = await previewBudgetChange(changed.engineResult, { bufferCents: 50000 }, changed.inputs);
  assert.deepEqual(again.engineResult.budget, changed.engineResult.budget);
  const restored = await previewBudgetChange(changed.engineResult, { removeCategoryOverrides: ['Entertainment'] }, changed.inputs);
  assert.deepEqual(restored.engineResult.budget, adjustment.before);
});

test('confirmation progresses one material question at a time and resets on edits', async () => {
  const target = await previewBudgetChange(flexible, { savingsConfirmed: true });
  assert.equal(target.coach.followUp.kind, 'check_commitments');
  const confirmed = await previewBudgetChange(target.engineResult, { commitmentsConfirmed: true }, target.inputs);
  assert.equal(confirmed.coach.status, 'conditional_plan');
  assert.equal(confirmed.coach.followUp.kind, 'protect_category');
  assert.ok(confirmed.coach.categories.every((c) => c.suggestedLimitCents === c.previewLimitCents));
  const pending = captureBudgetInputs(confirmed.engineResult, { categoryOverrides: { Entertainment: 20509 } }, confirmed.inputs);
  assert.equal(pending.inputs.savingsConfirmed, false);
  assert.equal(pending.inputs.commitmentsConfirmed, false);
  const allFits = await previewBudgetChange(examples[2], { savingsConfirmed: true, commitmentsConfirmed: true });
  assert.equal(allFits.coach.followUp, null);
});

test('confirmation cannot make an infeasible plan feasible', async () => {
  const response = await previewBudgetChange(examples[0], { savingsConfirmed: true, commitmentsConfirmed: true });
  assert.equal(response.status, 'recalculated');
  assert.equal(response.coach.status, 'infeasible');
  assert.ok(response.coach.categories.every((c) => c.suggestedLimitCents === null));
});

test('new in-window costs block recalculation; later reserves persist across edits', async () => {
  const blocked = await previewBudgetChange(flexible, { futureCommitments: [{ id: 'trip', date: '2026-10-12', amountCents: 12000 }] });
  assert.equal(blocked.status, 'awaiting_recalculation');
  assert.deepEqual(blocked.engineRequest.blockers, ['in_horizon_expenses_need_forecast_update']);
  assert.deepEqual(blocked.engineResult, flexible);
  const reserved = await previewBudgetChange(flexible, { futureCommitments: [{ id: 'trip', date: '2026-12-01', amountCents: 12000 }] });
  assert.equal(reserved.status, 'recalculated');
  assert.equal(reserved.engineResult.budget.futureCostReserveCents, 12000);
  const pending = captureBudgetInputs(reserved.engineResult, { bufferCents: 60000 }, reserved.inputs);
  assert.equal(pending.engineRequest.engineInputs.future_commitments[0].amountCents, 12000);
});

test('engine validation failures retain previous output and do not claim a changed budget', async () => {
  const failed = await previewBudgetChange(flexible, { categoryOverrides: { Housing: 0 } });
  assert.equal(failed.status, 'recalculation_failed');
  assert.match(failed.error, /protected amount/);
  assert.equal(failed.budgetChanged, false);
  assert.deepEqual(failed.engineResult, flexible);
  assert.equal(failed.inputs.categoryOverrides.Housing, 0);
});

test('unavailable or timed-out engine retains previous output', async () => {
  const failed = await previewBudgetChange(flexible, { bufferCents: 40000 }, undefined, { python: '/nonexistent/python' });
  assert.equal(failed.status, 'recalculation_failed');
  assert.deepEqual(failed.engineResult, flexible);
  // A millisecond is intentionally below Python startup time; the process must be stopped.
  const timeout = await previewBudgetChange(flexible, { bufferCents: 40000 }, undefined, { timeoutMs: 1 });
  assert.equal(timeout.status, 'recalculation_failed');
  assert.match(timeout.error, /timed out/);
});

test('malformed amounts, categories, confirmations, and mismatched customer state are rejected', () => {
  for (const answer of [
    {}, { savingsTargetCents: 1.5 }, { bufferCents: -1 }, { savingsConfirmed: 'yes' },
    { categoryOverrides: { Unknown: 100 } }, { categoryOverrides: null },
    { minimumCategoryCents: { Housing: true } }, { adjustableCategories: ['Unknown'] },
    { categoryOverrides: { Entertainment: 1 }, removeCategoryOverrides: ['Entertainment'] },
    { futureCommitments: [{ id: 'past', date: '2026-09-30', amountCents: 5 }] },
  ]) assert.throws(() => captureBudgetInputs(flexible, answer), TypeError);
  const inputs = captureBudgetInputs(examples[0], { bufferCents: 1 }).inputs;
  assert.throws(() => captureBudgetInputs(flexible, { bufferCents: 1 }, inputs), /another customer/);
});

test('cross-customer evidence, future evidence, unsafe figures, and misleading statuses are rejected', () => {
  for (const edit of [
    (x) => { x.budget.customerId = 'other'; },
    (x) => { x.originalForecast.evidence[0].customerId = 'other'; },
    (x) => { x.originalForecast.evidence[0].date = '2027-01-01'; },
    (x) => { x.budget.totalPlannedSpendingCents = Number.MAX_SAFE_INTEGER + 1; },
    (x) => { x.budget.preview.calibrationCoverageClaimApplies = true; },
    (x) => { x.budget.categories[0].suggestedLimitCents = 1; },
    (x) => { x.budget.feasible = false; },
    (x) => { x.budget.status = 'conditional_plan'; },
  ]) {
    const result = clone(flexible); edit(result);
    assert.throws(() => createBudgetCoachResponse(result), TypeError);
  }
});

test('missing evidence is explicit and engine figures are used without independently derived forecasts', () => {
  const result = clone(flexible);
  result.originalForecast.evidence = [];
  result.budget.totalPlannedSpendingCents = 12345;
  const response = createBudgetCoachResponse(result);
  assert.match(response.insight.explanation, /€123\.45/);
  assert.deepEqual(response.evidence.unresolvedIds, response.evidence.ids);
  assert.deepEqual(response.balancePreview.daily, result.budget.preview.daily);
});
