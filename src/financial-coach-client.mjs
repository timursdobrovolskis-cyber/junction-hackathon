import { createEngineCoachResponse, captureCoachInputs } from './engine-coach.mjs';
import { createBudgetCoachResponse, captureBudgetInputs } from './budget-coach.mjs';
import { cents, date, identifier, requireValue, unique } from './validation.mjs';

const requestFields = ['customerId', 'asOf', 'bufferCents', 'savingsTargetCents', 'savingsConfirmed',
  'commitmentsConfirmed', 'futureCommitments', 'adjustableCategories', 'minimumCategoryCents', 'categoryOverrides'];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const budgetResult = (result) => ({ budget: result.budget, originalForecast: result.forecast });
const commitmentsKey = (costs) => JSON.stringify(costs.map(({ id, date, amountCents }) => ({ id, date, amountCents }))
  .sort((a, b) => a.id.localeCompare(b.id)));

function validateRequest(request) {
  requireValue(object(request) && Object.keys(request).every((key) => requestFields.includes(key)), 'unsupported financial API request');
  identifier(request.customerId, 'customerId'); date(request.asOf, 'asOf');
  cents(request.bufferCents, 'bufferCents'); cents(request.savingsTargetCents, 'savingsTargetCents');
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
  const cashFlow = createEngineCoachResponse(result, { bufferConfirmed });
  const budget = createBudgetCoachResponse(budgetResult(result));
  const source = result.forecast.status !== 'estimated' ? 'cash_flow'
    : result.budget.status === 'infeasible' || result.budget.status === 'withheld' ? 'budget' : focus;
  const active = source === 'budget' ? budget : cashFlow;
  const followUp = active.followUp ? {
    ...active.followUp,
    question: active.followUp.question ?? active.followUp.prompt,
  } : null;
  return structuredClone({
    customerId: result.customerId, asOf: result.asOf, modelVersion: result.modelVersion,
    insight: active.insight, followUp, activeSource: source,
    cashFlow, budget,
    basis: {
      cashFlow: 'Forecast and savings capacity based on historical spending, before category edits.',
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
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Financial engine returned HTTP ${response.status}`);
  requireValue(result.customerId === expected.customerId && result.asOf === expected.asOf, 'API returned another customer or observation date');
  requireValue(result.budget?.bufferCents === expected.bufferCents && result.budget?.savingsTargetCents === expected.savingsTargetCents,
    'API returned different financial preferences');
  if (result.budget.status !== 'withheld') {
    requireValue(result.budget.savingsConfirmed === (expected.savingsConfirmed ?? false)
      && result.budget.commitmentsConfirmed === (expected.commitmentsConfirmed ?? false), 'API returned different confirmations');
    requireValue(commitmentsKey(result.budget.futureCommitments) === commitmentsKey(expected.futureCommitments ?? []), 'API returned different future commitments');
    for (const [category, amount] of Object.entries(expected.categoryOverrides ?? {})) {
      const returned = result.budget.categories.find((row) => row.category === category);
      requireValue(returned?.source === 'user_override' && returned.previewLimitCents === amount, 'API did not apply the category override');
    }
    for (const row of result.budget.categories) {
      if (row.source === 'user_override') requireValue(Object.hasOwn(expected.categoryOverrides ?? {}, row.category), 'API returned an outdated category override');
    }
  }
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
  if (Object.hasOwn(answer, 'futureCommitments')) {
    requireValue(Array.isArray(answer.futureCommitments), 'futureCommitments must be an array');
    const prior = previousInputs?.upcomingExpenses ?? result.savings.futureCommitments ?? [];
    expenseAnswer.upcomingExpenses = answer.futureCommitments.map((cost) => ({ ...cost, inclusion: 'additional' }));
    expenseAnswer.removeExpenseIds = prior.map((cost) => cost.id).filter((id) => !answer.futureCommitments.some((cost) => cost.id === id));
  }
  const expensePending = captureCoachInputs(result, Object.keys(expenseAnswer).length ? expenseAnswer : {
    commitmentsConfirmed: previousInputs?.commitmentsConfirmed ?? result.budget.commitmentsConfirmed ?? false,
  }, previousInputs);
  if (expenseChanges) budgetAnswer.futureCommitments = expensePending.engineRequest.savingsInputs.future_commitments;
  const budgetPending = captureBudgetInputs(budgetResult(result), budgetAnswer, previousInputs);
  const inputs = { ...budgetPending.inputs, upcomingExpenses: expensePending.inputs.upcomingExpenses,
    bufferConfirmed: expensePending.inputs.bufferConfirmed };
  const request = Object.fromEntries(requestFields.filter((key) => inputs[key] !== undefined).map((key) => [key, inputs[key]]));
  // Expense labels and inclusion status belong to coach state, not the engine's strict wire contract.
  request.futureCommitments = inputs.futureCommitments.map(({ id, date, amountCents }) => ({ id, date, amountCents }));
  validateRequest(request);
  const blockers = [...new Set([...budgetPending.engineRequest.blockers, ...expensePending.engineRequest.blockers])];
  return structuredClone({
    status: 'awaiting_recalculation', inputs,
    engineRequest: { ready: blockers.length === 0, blockers, request },
    message: 'Your choices are captured. The displayed forecast, savings and budget remain unchanged until the engine returns a new result.',
    forecastChanged: false, savingsChanged: false, budgetChanged: false, movesMoney: false,
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
      savingsChanged: JSON.stringify(engineResult.savings) !== JSON.stringify(snapshot.savings),
      budgetChanged: JSON.stringify(engineResult.budget) !== JSON.stringify(snapshot.budget), movesMoney: false,
    };
  } catch (error) {
    return { ...pending, status: 'recalculation_failed', error: error.message,
      message: 'The financial engine could not return a new plan. Your choices are saved; the previous forecast, savings and budget are still displayed.',
      engineResult: snapshot, coach: previousCoach };
  }
}
