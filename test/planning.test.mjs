import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateGoalPlan } from '../src/coach.mjs';
import { calculateCategoryBudgets, calculatePurchaseScenario, calculateRecoveryScenario, createCoachAction } from '../src/planning.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/coach-demo.json', import.meta.url)));
function profile() {
  return structuredClone({
    ...fixture, customerId: 'demo-student', dataSource: 'illustrative_fixture',
    assumptions: ['Each period includes essential spending and delivery; amounts cover only the remaining planning window.'],
    missingInputs: [], newExpenses: fixture.scenarios.afterExpense.newExpenses,
  });
}

test('shared fixture remains compatible: 270 → 210 → 240 euros', () => {
  for (const scenario of Object.values(fixture.scenarios)) {
    const actual = calculateGoalPlan({ ...fixture, newExpenses: scenario.newExpenses });
    assert.equal(actual.projectedSavedCents, scenario.expected.projectedSavedCents);
    assert.equal(actual.goalShortfallCents, scenario.expected.goalShortfallCents);
    for (const [key, value] of Object.entries(scenario.expected.recoveryOption ?? {})) {
      assert.deepEqual(actual.recoveryOption[key], value);
    }
  }
});

test('purchase preview subtracts expense exactly once and does not mutate profile', () => {
  const input = profile();
  const original = structuredClone(input);
  const result = calculatePurchaseScenario(input, { id: 'tickets', date: '2026-12-01', amountCents: 20000 });
  assert.equal(result.baseline.projectedSavedCents, 21000);
  assert.equal(result.afterPurchase.projectedSavedCents, 1000);
  assert.equal(result.impactCents, -20000);
  assert.equal(result.status, 'cash_shortfall');
  assert.equal(result.dataSource, 'illustrative_fixture');
  assert.equal(result.asOf, input.asOf);
  assert.deepEqual(input, original);
});

test('negative early cash is visible even when goal total is sufficient', () => {
  const input = profile();
  input.periods[0].availableToSaveCents = 5000;
  input.periods[2].availableToSaveCents = 20000;
  const result = createCoachAction(input);
  assert.equal(result.plan.goalShortfallCents, 0);
  assert.deepEqual(result.plan.cashShortfalls, [{ month: '2026-11', shortfallCents: 1000 }]);
  assert.equal(result.action.kind, 'review_cash_shortfall');
});

test('recovery never frees more delivery spend than already planned', () => {
  const input = profile();
  input.goal.targetCents = 50000;
  input.periods[0].plannedDeliveryCents = 999;
  input.periods[1].plannedDeliveryCents = 0;
  const result = calculateGoalPlan(input);
  assert.deepEqual(result.recoveryOption.months, ['2027-01']);
  assert.equal(result.recoveryOption.estimatedSavingsCents, 1000);
  assert.equal(result.recoveryOption.remainingShortfallCents, 28000);
  assert.match(createCoachAction(input).action.explanation, /gap.*remain/);
});

test('empty delivery evidence never invents a recovery amount', () => {
  const input = profile();
  input.deliveryHistory = [];
  assert.equal(calculateGoalPlan(input).recoveryOption, undefined);
  assert.equal(createCoachAction(input).action.kind, 'review_goal');
});

test('even median rounds to integer cents', () => {
  const input = profile();
  input.deliveryHistory = input.deliveryHistory.slice(0, 2);
  input.deliveryHistory[0].amountCents = 901;
  assert.equal(calculateGoalPlan(input).recoveryOption.estimatedSavingsPerDeliveryCents, 951);
});

test('periods are processed chronologically without mutating inputs', () => {
  const input = profile();
  input.periods.reverse();
  assert.deepEqual(calculateGoalPlan(input).breakdown.map((row) => row.month), ['2026-11', '2026-12', '2027-01']);
  assert.equal(input.periods[0].month, '2027-01');
});

test('missing financial inputs take priority over a recommendation', () => {
  const input = profile();
  input.missingInputs = ['next income date', 'rent'];
  const result = createCoachAction(input);
  assert.equal(result.action.kind, 'confirm_inputs');
  assert.match(result.action.explanation, /next income date, rent/);
  assert.equal(calculatePurchaseScenario(input, { id: 'p', date: input.asOf, amountCents: 100 }).status, 'needs_information');
});

test('coaching is optional and figures come from the plan', () => {
  const result = createCoachAction(profile(), { directAnswer: true });
  assert.equal(result.learning, undefined);
  assert.equal(result.action.kind, 'goal_recovery');
  assert.match(result.action.explanation, /€210.00/);
  assert.match(result.action.explanation, /€240.00/);
  assert.equal(result.previewOnly, true);
  assert.ok(result.limitations.some((text) => text.includes('Illustrative')));
});

test('customer can get an evidence-backed bill action without setting a goal', () => {
  const input = profile();
  delete input.goal;
  input.signals = [
    { id: 'past', type: 'recurring_bill', dueDate: '2026-11-01', amountCents: 90000, confidence: 'high', evidenceIds: ['rent-1'] },
    { id: 'bill', type: 'recurring_bill', dueDate: '2026-11-18', amountCents: 1299, confidence: 'low', evidenceIds: ['bill-1', 'bill-2'] },
  ];
  const result = createCoachAction(input);
  assert.equal(result.action.kind, 'review_bill');
  assert.equal(result.action.signalId, 'bill');
  assert.match(result.action.explanation, /estimated.*evidence is weak/);
  assert.ok(result.evidenceIds.includes('bill-1'));
  assert.equal(result.plan, undefined);
});

test('no history or goal produces an observation, not invented finances', () => {
  const input = profile();
  delete input.goal;
  delete input.periods;
  delete input.deliveryHistory;
  delete input.newExpenses;
  const result = createCoachAction(input);
  assert.equal(result.action.kind, 'observation');
  assert.deepEqual(result.categoryBudgets, []);
});

test('category budgets respect baskets, corrections, zero months, and explicit reductions', () => {
  const history = [
    { month: '2026-09', category: 'Restaurants', spentCents: 20000, basket: 'everyday', adjustable: true, evidenceIds: ['r-1'] },
    { month: '2026-10', category: 'Restaurants', spentCents: 0, basket: 'everyday', adjustable: true, evidenceIds: [] },
    { month: '2026-10', category: 'Transportation', spentCents: 8000, basket: 'mandatory_regular', adjustable: true, evidenceIds: ['t-1'] },
    { month: '2026-10', category: 'Social', spentCents: 5000, basket: 'everyday', adjustable: false, evidenceIds: ['s-1'] },
  ];
  const [restaurant, transport, social] = calculateCategoryBudgets({ history, reductionPercent: 20 });
  assert.equal(restaurant.baselineCents, 10000);
  assert.equal(restaurant.suggestedBudgetCents, 8000);
  assert.equal(transport.estimatedReductionCents, 0);
  assert.equal(social.estimatedReductionCents, 0);
  assert.equal(calculateCategoryBudgets({ history })[0].estimatedReductionCents, 0);
});

for (const [name, change, error] of [
  ['fractional money', (p) => { p.goal.targetCents = 1.5; }, /safe integer/],
  ['overflow', (p) => { p.goal.savedCents = Number.MAX_SAFE_INTEGER; }, /safe integer/],
  ['negative expense', (p) => { p.newExpenses[0].amountCents = -1; }, /non-negative/],
  ['duplicate expense', (p) => { p.newExpenses.push(p.newExpenses[0]); }, /unique/],
  ['duplicate month', (p) => { p.periods.push(p.periods[0]); }, /unique/],
  ['invalid date', (p) => { p.newExpenses[0].date = '2026-11-31'; }, /calendar date/],
  ['outside horizon', (p) => { p.newExpenses[0].date = '2027-02-01'; }, /outside/],
  ['period after deadline', (p) => { p.goal.targetDate = '2026-12-31'; }, /goal deadline/],
  ['missing month', (p) => { p.periods.splice(1, 1); }, /consecutive/],
  ['incomplete horizon', (p) => { p.periods.pop(); }, /cover asOf/],
  ['future evidence', (p) => { p.deliveryHistory[0].date = '2026-11-15'; }, /after asOf/],
  ['already accounted expense', (p) => { p.newExpenses[0].date = '2026-11-13'; }, /reference balance/],
  ['foreign currency', (p) => { p.currency = 'USD'; }, /only EUR/],
  ['unsigned bank row', (p) => { p.deliveryHistory[0].amountCents = -900; }, /non-negative/],
  ['unlabelled data', (p) => { delete p.dataSource; }, /dataSource/],
]) {
  test(`rejects ${name}`, () => {
    const input = profile(); change(input);
    assert.throws(() => createCoachAction(input), error);
  });
}

test('rejects duplicate purchase already present in projection', () => {
  const input = profile();
  assert.throws(() => calculatePurchaseScenario(input, input.newExpenses[0]), /unique/);
});

test('category budget validation rejects transfers, conflicting classifications, and partial history', () => {
  const row = { month: '2026-10', category: 'Food', spentCents: 1000, basket: 'everyday', adjustable: true };
  assert.throws(() => calculateCategoryBudgets({ history: [{ ...row, basket: 'investment' }] }), /basket/);
  assert.throws(() => calculateCategoryBudgets({ history: [row, { ...row, month: '2026-09', adjustable: false }] }), /classifications/);
  assert.throws(() => calculateCategoryBudgets({ history: [row, row] }), /unique/);
  const input = profile();
  input.spendingHistory = [{ ...row, month: '2026-11' }];
  assert.throws(() => createCoachAction(input), /completed months/);
});

test('experiment preview updates each period and preserves actual saved money', () => {
  const input = profile();
  const original = structuredClone(input);
  const result = calculateRecoveryScenario(input);
  assert.equal(result.afterExperiment.projectedSavedCents, 24000);
  assert.equal(result.afterExperiment.goalShortfallCents, 0);
  assert.equal(result.impactCents, 3000);
  assert.equal(result.dataSource, 'illustrative_fixture');
  assert.deepEqual(result.scenarioExpenseIds, ['expense-1']);
  assert.ok(result.evidenceIds.includes('delivery-1'));
  assert.deepEqual(result.afterExperiment.breakdown.map((row) => row.plannedDeliveryCents), [1000, 1000, 1000]);
  assert.equal(result.afterExperiment.recoveryOption, undefined);
  assert.deepEqual(input, original);
});

test('experiment preview is unavailable with missing inputs, cash gaps, or no supported experiment', () => {
  const input = profile();
  input.missingInputs = ['rent'];
  assert.equal(calculateRecoveryScenario(input), null);
  input.missingInputs = [];
  input.periods[0].availableToSaveCents = 0;
  assert.equal(calculateRecoveryScenario(input), null);
  input.periods[0].availableToSaveCents = 100000;
  assert.equal(calculateRecoveryScenario(input), null);
});
