import { createEngineCoachResponse, captureCoachInputs } from './engine-coach.mjs';
import { createBudgetCoachResponse, captureBudgetInputs } from './budget-coach.mjs';
import { cents, date, identifier, requireValue, unique } from './validation.mjs';

const requestFields = ['customerId', 'asOf', 'bufferCents', 'savingsTargetCents', 'savingsConfirmed',
  'commitmentsConfirmed', 'futureCommitments', 'adjustableCategories', 'minimumCategoryCents', 'categoryOverrides',
  'plannedExpenses', 'sourcePlanId', 'sourceRevision'];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const budgetResult = (result) => ({ budget: result.budget, originalForecast: result.planScenario ?? result.forecast });
const money = (value) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value / 100);
const commitmentsKey = (costs) => JSON.stringify(costs.map(({ id, date, amountCents }) => ({ id, date, amountCents }))
  .sort((a, b) => a.id.localeCompare(b.id)));

function validateRequest(request) {
  requireValue(object(request) && Object.keys(request).every((key) => requestFields.includes(key)), 'unsupported financial API request');
  identifier(request.customerId, 'customerId'); date(request.asOf, 'asOf');
  cents(request.bufferCents, 'bufferCents'); cents(request.savingsTargetCents, 'savingsTargetCents');
  if (request.sourcePlanId !== undefined || request.sourceRevision !== undefined) {
    identifier(request.sourcePlanId, 'sourcePlanId'); cents(request.sourceRevision, 'sourceRevision');
  }
  if (Object.hasOwn(request, 'plannedExpenses')) {
    requireValue(Array.isArray(request.plannedExpenses) && request.plannedExpenses.length <= 100, 'plannedExpenses must contain at most 100 expenses');
    const allowed = ['id', 'date', 'amountCents', 'label', 'category', 'accountId', 'merchantId', 'inclusion', 'status'];
    for (const expense of request.plannedExpenses) {
      requireValue(object(expense) && Object.keys(expense).every((key) => allowed.includes(key)), 'unsupported planned expense field');
      identifier(expense.id); date(expense.date); cents(expense.amountCents, 'expense amount');
      requireValue(expense.amountCents > 0, 'expense amount must be positive');
      requireValue(['additional', 'already_included', 'unsure'].includes(expense.inclusion), 'unknown expense inclusion');
      if (expense.status !== undefined) requireValue(['planned', 'matched', 'cancelled'].includes(expense.status), 'unknown expense lifecycle');
      for (const key of ['label', 'category', 'accountId', 'merchantId']) if (expense[key] !== undefined) identifier(expense[key], key);
    }
    unique(request.plannedExpenses.map((e) => e.id), 'planned expense IDs');
    requireValue(!request.plannedExpenses.some((e) => (request.futureCommitments ?? []).some((c) => c.id === e.id)), 'duplicate IDs across plannedExpenses and futureCommitments');
  }
  for (const key of ['savingsConfirmed', 'commitmentsConfirmed']) {
    if (Object.hasOwn(request, key)) requireValue(typeof request[key] === 'boolean', `${key} must be a boolean`);
  }
  for (const key of ['categoryOverrides', 'minimumCategoryCents']) if (Object.hasOwn(request, key)) {
    requireValue(object(request[key]), `${key} must be a category map`);
    for (const [category, amount] of Object.entries(request[key])) { identifier(category); cents(amount, key); }
  }
  if (Object.hasOwn(request, 'adjustableCategories')) {
    requireValue(Array.isArray(request.adjustableCategories), 'adjustableCategories must be an array');
    unique(request.adjustableCategories, 'adjustableCategories');
    request.adjustableCategories.forEach((category) => identifier(category));
  }
  if (Object.hasOwn(request, 'futureCommitments')) {
    requireValue(Array.isArray(request.futureCommitments), 'futureCommitments must be an array');
    for (const cost of request.futureCommitments) {
      requireValue(object(cost) && Object.keys(cost).length === 3 && ['id', 'date', 'amountCents'].every((key) => Object.hasOwn(cost, key)), 'each API commitment needs only id, date, and amountCents');
      identifier(cost.id); date(cost.date); cents(cost.amountCents, 'commitment amount');
      requireValue(cost.date > request.asOf, 'commitments must follow the observation date');
    }
    unique(request.futureCommitments.map((cost) => cost.id), 'commitment IDs');
  }
}

/** Render one complete /api/plan result, keeping historical and changed-budget paths distinct. */
export function createFinancialCoachResponse(result, { focus = 'budget', bufferConfirmed = false } = {}) {
  requireValue(['budget', 'cash_flow'].includes(focus), 'focus must be budget or cash_flow');
  requireValue(result?.forecast && result?.savings && result?.budget, 'a complete financial engine result is required');
  requireValue(result.customerId === result.forecast.customerId && result.asOf === result.forecast.asOf,
    'financial result identity does not match its forecast');
  requireValue(result.modelVersion === result.forecast.modelVersion, 'financial result model version does not match its forecast');
  requireValue(result.savings.bufferCents === result.budget.bufferCents && result.forecast.bufferCents === result.budget.bufferCents,
    'financial results must use the same buffer');
  const scenario = result.planScenario ?? result.forecast;
  if (result.planScenario) {
    requireValue(scenario.customerId === result.customerId && scenario.asOf === result.asOf
      && scenario.scenarioBasis === 'known_expense_plan' && scenario.calibrationCoverageClaimApplies === false && !scenario.calibration,
    'plan scenario must match the customer/date and retain conditional uncertainty');
  }
  const cashFlow = createEngineCoachResponse({ forecast: scenario, savings: result.savings }, { bufferConfirmed });
  const budget = createBudgetCoachResponse(budgetResult(result));
  for (const option of result.alternatives ?? []) {
    identifier(option.id, 'option id');
    requireValue(option.customerId === result.customerId && option.asOf === result.asOf
      && option.sourcePlanId === result.sourcePlanId && option.sourceRevision === result.sourceRevision, 'recovery option belongs to another plan revision');
    requireValue(['save_less', 'reduce_flexible_spending'].includes(option.kind)
      && typeof option.available === 'boolean' && option.calibrationCoverageClaimApplies === false, 'invalid recovery option');
    cents(option.savingsTargetBeforeCents, 'previous savings target'); cents(option.savingsTargetAfterCents, 'option savings target');
    if (option.budget) createBudgetCoachResponse({ budget: option.budget, originalForecast: scenario });
    requireValue(option.available === Boolean(option.budget?.feasible), 'recovery availability disagrees with engine feasibility');
    for (const change of option.categoryChanges) {
      cents(change.beforeCents, 'category before');
      if (change.afterCents !== null) cents(change.afterCents, 'category after');
      if (change.changeCents !== null) cents(change.changeCents, 'category change', { signed: true });
    }
  }
  const source = scenario.status !== 'estimated' ? 'cash_flow'
    : result.budget.status === 'infeasible' || result.budget.status === 'withheld' ? 'budget' : focus;
  const active = source === 'budget' ? budget : cashFlow;
  if (result.expenseBlockers?.length) {
    active.insight = { kind: 'expense_review', title: 'Check the expense before relying on this plan',
      explanation: 'An expense has uncertain inclusion, a possible payment match, or an unresolved past due date. Savings and budget recommendations are withheld until it is reviewed.' };
    active.followUp = { kind: 'review_expense', question: result.matchingReviews?.length
      ? 'Does one of these observed transactions settle the planned expense?'
      : 'Is this expense still unpaid, and is it already included in the forecast?',
      expenseIds: [...new Set(result.expenseBlockers.map((b) => b.expenseId))] };
  }
  const followUp = active.followUp ? {
    ...active.followUp,
    question: active.followUp.question ?? active.followUp.prompt,
  } : null;
  return structuredClone({
    customerId: result.customerId, asOf: result.asOf, modelVersion: result.modelVersion,
    insight: active.insight, followUp, activeSource: source,
    cashFlow, budget,
    ...(result.planScenario ? { historicalForecast: result.forecast, plannedExpenses: result.plannedExpenses,
      matchingReviews: result.matchingReviews, expenseBlockers: result.expenseBlockers,
      lockedCommitments: scenario.lockedCommitments, sourcePlanId: result.sourcePlanId, sourceRevision: result.sourceRevision,
      alternatives: (result.alternatives ?? []).map((option) => ({ ...option,
        title: `${option.available ? '' : 'Unavailable: '}${option.kind === 'save_less' ? `Save ${money(option.savingsTargetAfterCents)} and keep spending unchanged` : `Keep saving ${money(option.savingsTargetAfterCents)} and adjust flexible spending`}`,
        explanation: option.explanation, selectable: option.available,
        categoryChanges: option.categoryChanges.map((change) => ({ ...change,
          explanation: option.available ? `${change.category}: ${money(change.beforeCents)} in your existing plan → ${money(change.afterCents)} in this option.` : 'Diagnostic amounts only; this option does not fit.' })) })) } : {}),
    basis: {
      cashFlow: result.planScenario ? 'Expense-adjusted conditional scenario and savings capacity, before category recovery edits.' : 'Forecast and savings capacity based on historical spending, before category edits.',
      budget: 'Conditional spending plan using your savings target and category choices. Its changed balance path has no new calibration coverage claim.',
    },
    calculationState: 'engine_result', movesMoney: false,
  });
}

/** Fetch all three calculations together. This module works in Node and browsers. */
export async function fetchFinancialPlan(request, {
  endpoint = 'http://127.0.0.1:8765/api/plan', timeoutMs = 10000, signal,
} = {}) {
  validateRequest(request);
  requireValue(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, 'timeoutMs must be a positive integer');
  const expected = structuredClone(request);
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(expected), cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(typeof result.error === 'string' ? result.error : `Financial engine returned HTTP ${response.status}`), { status: response.status });
  requireValue(result.customerId === expected.customerId && result.asOf === expected.asOf, 'API returned another customer or observation date');
  requireValue(result.budget?.bufferCents === expected.bufferCents && result.budget?.savingsTargetCents === expected.savingsTargetCents,
    'API returned different financial preferences');
  if (result.budget.status !== 'withheld') {
    requireValue(result.budget.savingsConfirmed === (expected.savingsConfirmed ?? false)
      && result.budget.commitmentsConfirmed === (expected.commitmentsConfirmed ?? false), 'API returned different confirmations');
    const plannedLater = (result.plannedExpenses ?? []).filter((e) => e.status === 'planned'
      && (e.inclusion === 'additional' || e.reservedPreviously) && e.date > result.forecast.daily.at(-1).date);
    requireValue(commitmentsKey(result.budget.futureCommitments) === commitmentsKey([...(expected.futureCommitments ?? []), ...plannedLater]), 'API returned different future commitments');
    for (const [category, amount] of Object.entries(expected.categoryOverrides ?? {})) {
      const returned = result.budget.categories.find((row) => row.category === category);
      requireValue(returned?.source === 'user_override' && returned.previewLimitCents === amount, 'API did not apply the category override');
    }
    for (const row of result.budget.categories) {
      if (row.source === 'user_override') requireValue(Object.hasOwn(expected.categoryOverrides ?? {}, row.category), 'API returned an outdated category override');
    }
  }
  if (expected.plannedExpenses !== undefined) {
    requireValue(result.planScenario && Array.isArray(result.plannedExpenses), 'API did not return the expense-adjusted plan');
    for (const expense of expected.plannedExpenses) {
      const returned = result.plannedExpenses.find((e) => e.id === expense.id);
      requireValue(returned && ['date', 'amountCents', 'inclusion'].every((k) => returned[k] === expense[k]), 'API returned different planned expenses');
    }
  }
  if (expected.sourcePlanId !== undefined) requireValue(result.sourcePlanId === expected.sourcePlanId && result.sourceRevision === expected.sourceRevision, 'API returned a stale plan revision');
  createFinancialCoachResponse(result);
  return result;
}

/** Capture budget preferences and expense-inclusion answers in one pending API request. */
export function captureFinancialPlanInputs(result, answer, previousInputs) {
  createFinancialCoachResponse(result);
  requireValue(object(answer) && Object.keys(answer).length > 0, 'a structured customer answer is required');
  requireValue(!(Object.hasOwn(answer, 'futureCommitments')
    && (Object.hasOwn(answer, 'upcomingExpenses') || Object.hasOwn(answer, 'removeExpenseIds'))),
  'use either a full futureCommitments replacement or expense updates');
  const budgetAnswer = Object.fromEntries(Object.entries(answer).filter(([key]) => !['upcomingExpenses', 'removeExpenseIds'].includes(key)));
  const expenseAnswer = Object.fromEntries(Object.entries(answer).filter(([key]) => ['bufferCents', 'commitmentsConfirmed', 'upcomingExpenses', 'removeExpenseIds'].includes(key)));
  const expenseChanges = ['futureCommitments', 'upcomingExpenses', 'removeExpenseIds'].some((key) => Object.hasOwn(answer, key));
  const plannedMode = Boolean(result.planScenario || previousInputs?.expenseContract === 'planned'
    || Object.hasOwn(answer, 'upcomingExpenses') || Object.hasOwn(answer, 'removeExpenseIds'));
  if (Object.hasOwn(answer, 'futureCommitments')) {
    requireValue(Array.isArray(answer.futureCommitments), 'futureCommitments must be an array');
    const prior = previousInputs?.upcomingExpenses ?? result.savings.futureCommitments ?? [];
    expenseAnswer.upcomingExpenses = answer.futureCommitments.map((cost) => ({ ...cost, inclusion: 'additional' }));
    expenseAnswer.removeExpenseIds = prior.map((cost) => cost.id).filter((id) => !answer.futureCommitments.some((cost) => cost.id === id));
  }
  const expensePending = captureCoachInputs(result, Object.keys(expenseAnswer).length ? expenseAnswer : {
    commitmentsConfirmed: previousInputs?.commitmentsConfirmed ?? result.budget.commitmentsConfirmed ?? false,
  }, previousInputs);
  if (expenseChanges && !plannedMode) budgetAnswer.futureCommitments = expensePending.engineRequest.savingsInputs.future_commitments;
  if (plannedMode && expenseChanges) {
    budgetAnswer.savingsConfirmed = answer.savingsConfirmed ?? false;
    budgetAnswer.commitmentsConfirmed = answer.commitmentsConfirmed ?? false;
  }
  const budgetPending = captureBudgetInputs(budgetResult(result), budgetAnswer, previousInputs);
  const inputs = { ...budgetPending.inputs, upcomingExpenses: expensePending.inputs.upcomingExpenses,
    bufferConfirmed: expensePending.inputs.bufferConfirmed };
  if (plannedMode) {
    inputs.expenseContract = 'planned';
    inputs.plannedExpenses = expensePending.engineRequest.plannedExpenses;
    inputs.futureCommitments = previousInputs?.expenseContract === 'planned' ? previousInputs.futureCommitments ?? []
      : result.planScenario ? result.legacyFutureCommitments ?? [] : [];
    if (answer.futureCommitments !== undefined) inputs.futureCommitments = [];
    if (result.sourcePlanId) { inputs.sourcePlanId = result.sourcePlanId; inputs.sourceRevision = result.sourceRevision; }
  }
  const request = Object.fromEntries(requestFields.filter((key) => inputs[key] !== undefined).map((key) => [key, inputs[key]]));
  if (inputs.engineDefaults) {
    inputs.engineDefaults = inputs.engineDefaults.filter((key) => !Object.hasOwn(answer, key)
      && !(key === 'categoryOverrides' && Object.hasOwn(answer, 'removeCategoryOverrides')));
    for (const key of inputs.engineDefaults) delete request[key];
  }
  // Expense labels and inclusion status belong to coach state, not the engine's strict wire contract.
  request.futureCommitments = inputs.futureCommitments.map(({ id, date, amountCents }) => ({ id, date, amountCents }));
  validateRequest(request);
  const blockers = [...new Set([...budgetPending.engineRequest.blockers, ...expensePending.engineRequest.blockers])]
    .filter((blocker) => !(blocker === 'forecast_needs_review_or_regeneration' && result.planScenario && result.forecast.status === 'estimated'));
  return structuredClone({
    status: 'awaiting_recalculation', inputs,
    engineRequest: { ready: blockers.length === 0, blockers, request },
    message: 'Your choices are captured. The displayed forecast, savings and budget remain unchanged until the engine returns a new result.',
    forecastChanged: false, planScenarioChanged: false, savingsChanged: false, budgetChanged: false, movesMoney: false,
  });
}

/** Submit the captured choices and replace all panels only after a validated API response. */
export async function previewFinancialPlanChange(result, answer, previousInputs, options = {}) {
  const snapshot = structuredClone(result);
  const pending = captureFinancialPlanInputs(snapshot, answer, previousInputs);
  const previousCoach = createFinancialCoachResponse(snapshot, { focus: options.focus,
    bufferConfirmed: previousInputs?.bufferConfirmed ?? false });
  if (!pending.engineRequest.ready) return { ...pending, engineResult: snapshot, coach: previousCoach };
  try {
    const engineResult = await fetchFinancialPlan(pending.engineRequest.request, options);
    return {
      status: 'recalculated', inputs: pending.inputs, engineResult,
      coach: createFinancialCoachResponse(engineResult, { focus: options.focus, bufferConfirmed: pending.inputs.bufferConfirmed }),
      forecastChanged: JSON.stringify(engineResult.forecast) !== JSON.stringify(snapshot.forecast),
      planScenarioChanged: JSON.stringify(engineResult.planScenario) !== JSON.stringify(snapshot.planScenario),
      savingsChanged: JSON.stringify(engineResult.savings) !== JSON.stringify(snapshot.savings),
      budgetChanged: JSON.stringify(engineResult.budget) !== JSON.stringify(snapshot.budget), movesMoney: false,
    };
  } catch (error) {
    return { ...pending, status: 'recalculation_failed', error: error.message,
      message: 'The financial engine could not return a new plan. Your choices are saved; the previous forecast, savings and budget are still displayed.',
      engineResult: snapshot, coach: previousCoach };
  }
}

