import { createFinancialCoachResponse } from './financial-coach-client.mjs';
import { cents, identifier, requireValue } from './validation.mjs';

const copy = (value) => structuredClone(value);
const money = (value) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value / 100);
const publicExpense = (expense) => Object.fromEntries(Object.entries(expense).filter(([key]) =>
  ['id', 'date', 'amountCents', 'label', 'category', 'accountId', 'merchantId', 'inclusion', 'status'].includes(key)));

function endpoint(customerId, action, options) {
  identifier(customerId, 'customerId');
  const url = new URL(options.endpoint ?? 'http://127.0.0.1:8765/api/plan');
  url.pathname = `/api/customers/${encodeURIComponent(customerId)}/plan${action ? `/${action}` : ''}`;
  url.search = ''; url.hash = '';
  return url;
}

function decorate(response, customerId) {
  requireValue(response.customerId === customerId, 'saved response belongs to another customer');
  if (response.status === 'no_saved_plan') return response;
  identifier(response.planId, 'planId'); cents(response.revision, 'revision');
  requireValue(response.state?.customerId === customerId && response.engineResult?.customerId === customerId,
    'saved state and result must belong to the customer');
  requireValue(response.state.asOf === response.engineResult.asOf, 'saved state and result have different cutoffs');
  const coach = createFinancialCoachResponse(response.engineResult);
  coach.priorities = Object.entries(response.state.priorityNotes ?? {}).map(([category, reason]) => ({
    category, reason, minimumCents: response.state.request.minimumCategoryCents?.[category] ?? null,
    source: 'customer_choice',
  }));
  coach.tradeoffs = coach.budget.categories.filter((c) => c.changeFromHistoryCents !== 0).map((c) => ({
    category: c.category, historicalProjectionCents: c.historicalForecastCents,
    plannedLimitCents: c.previewLimitCents, evidenceIds: c.evidenceIds,
    explanation: c.previewLimitCents === null ? 'This plan does not fit; no category limit is recommended.'
      : `Your ${money(response.engineResult.budget.savingsTargetCents)} savings target leaves ${money(c.previewLimitCents)} for ${c.category}, compared with ${money(c.historicalForecastCents)} projected from payment history.`,
  }));
  const available = coach.alternatives?.filter((option) => option.available) ?? [];
  if (available.length && !coach.expenseBlockers?.length) {
    coach.followUp = { kind: 'choose_recovery', question: available.length === 2
      ? 'Would you prefer to save less and keep your spending plan, or keep your savings target and adjust flexible spending?'
      : `Would you like to preview the available ${available[0].kind === 'save_less' ? 'lower savings target' : 'flexible spending adjustment'}?`,
      optionIds: available.map((option) => option.id), requiresCustomerSelection: true };
  }
  const inputs = { categoryOverrides: {}, minimumCategoryCents: {}, futureCommitments: [],
    adjustableCategories: response.engineResult.budget.categories.filter((c) => c.adjustable).map((c) => c.category),
    ...response.state.request,
    engineDefaults: ['adjustableCategories', 'minimumCategoryCents', 'categoryOverrides'].filter((key) => !Object.hasOwn(response.state.request, key)),
    upcomingExpenses: response.state.plannedExpenses.map(publicExpense), expenseContract: 'planned',
    sourcePlanId: response.planId, sourceRevision: response.revision };
  return { ...response, inputs, coach };
}

async function call(customerId, action, method, body, options) {
  const timeoutMs = options.timeoutMs ?? 10000;
  requireValue(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, 'timeoutMs must be positive');
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(endpoint(customerId, action, options), { method, cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error ?? `Plan service returned HTTP ${response.status}`), { status: response.status });
  return decorate(data, customerId);
}

export async function loadCustomerPlan(customerId, options = {}) {
  return call(customerId, '', 'GET', null, options);
}

async function mutation(customerId, saved, action, payload, options) {
  identifier(options.mutationId, 'mutationId');
  if (saved) requireValue(saved.customerId === customerId, 'saved plan belongs to another customer');
  const body = { ...payload, expectedRevision: saved?.revision ?? 0, mutationId: options.mutationId,
    ...(saved ? { planId: saved.planId } : {}), ...(options.confirmations ? { confirmations: options.confirmations } : {}) };
  try {
    return await call(customerId, action, action ? 'POST' : 'PUT', body, options);
  } catch (error) {
    return { status: error.status === 409 ? 'revision_conflict' : 'save_failed', error: error.message,
      httpStatus: error.status ?? null, pendingMutation: copy(body), savedPlan: copy(saved ?? null),
      engineResult: copy(saved?.engineResult ?? null), coach: copy(saved?.coach ?? null),
      message: 'Your changes have not been saved. Pending choices and the previous plan are retained; reload on a revision conflict.' };
  }
}

/** Save only in response to an explicit customer action. Reuse mutationId when retrying. */
export async function saveCustomerPlan(customerId, request, options = {}) {
  requireValue(request.customerId === customerId, 'request belongs to another customer');
  const wire = copy(request);
  delete wire.sourcePlanId; delete wire.sourceRevision;
  wire.plannedExpenses ??= [];
  return mutation(customerId, options.savedPlan, '', { request: wire,
    ...(options.priorityNotes ? { priorityNotes: options.priorityNotes } : {}) }, options);
}

export async function selectRecoveryOption(saved, optionId, options = {}) {
  const option = saved.engineResult.alternatives.find((entry) => entry.id === optionId);
  requireValue(option?.available && option.sourcePlanId === saved.planId && option.sourceRevision === saved.revision,
    'select an available option from the current saved revision');
  return mutation(saved.customerId, saved, 'select', { optionId }, options);
}

export async function reviewPaymentMatch(saved, decisions, options = {}) {
  return mutation(saved.customerId, saved, 'matches', { decisions, ...(options.asOf ? { asOf: options.asOf } : {}) }, options);
}

export async function reconcileCustomerPlan(saved, asOf, options = {}) {
  return mutation(saved.customerId, saved, 'reconcile', { asOf }, options);
}

/** Remember a priority using a supplied engine amount or explicit customer minimum; no calculation. */
export function prepareProtectedCategory(saved, { category, reason, minimumCents }) {
  identifier(reason, 'customer reason');
  const row = saved.engineResult.budget.categories.find((entry) => entry.category === category);
  requireValue(row, 'category has no engine spending projection');
  const previousMinimum = saved.state.request.minimumCategoryCents?.[category] ?? 0;
  const minimum = minimumCents ?? (previousMinimum > row.historicalForecastCents ? previousMinimum : row.historicalForecastCents);
  cents(minimum, 'minimumCents');
  const request = copy(saved.state.request);
  request.minimumCategoryCents = { ...request.minimumCategoryCents, [category]: minimum };
  request.savingsConfirmed = false; request.commitmentsConfirmed = false;
  return { request, priorityNotes: { ...saved.state.priorityNotes, [category]: reason },
    message: `You asked to protect at least ${money(minimum)} for ${category}: ${reason}. Save and recalculate to see whether the plan fits.` };
}
