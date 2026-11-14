import { cents, date, evidenceIds, identifier, requireValue, unique } from './validation.mjs';

const money = (amount) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(amount / 100);
const forecastStatuses = ['estimated', 'needs_review', 'insufficient_history'];
const savingsStatuses = ['needs_confirmation', 'conditional_estimate', 'withheld'];

function validateResult({ forecast, savings }) {
  requireValue(forecast && savings, 'forecast and savings engine results are required');
  identifier(forecast.customerId, 'forecast.customerId');
  requireValue(forecast.currency === 'EUR' && savings.currency === 'EUR', 'only EUR is supported');
  date(forecast.asOf, 'forecast.asOf');
  requireValue(savings.asOf === forecast.asOf, 'forecast and savings must use the same reference date');
  if (savings.customerId !== undefined) requireValue(savings.customerId === forecast.customerId, 'engine results belong to different customers');
  requireValue(forecastStatuses.includes(forecast.status), 'unsupported forecast status');
  requireValue(savingsStatuses.includes(savings.status), 'unsupported savings status');
  requireValue(savings.movesMoney === false, 'coach accepts non-executing savings previews only');
  cents(savings.bufferCents, 'savings.bufferCents');
  for (const field of ['conditionalCapacityCents', 'suggestedSavingsCents']) {
    if (savings[field] != null) cents(savings[field], `savings.${field}`);
  }
  if (savings.status === 'needs_confirmation') {
    requireValue(savings.conditionalCapacityCents != null && savings.suggestedSavingsCents === null,
      'unconfirmed savings must supply a conditional preview and no suggested amount');
  }
  if (savings.status === 'conditional_estimate') {
    requireValue(savings.suggestedSavingsCents != null, 'conditional estimate requires the engine suggested amount');
  }
  for (const field of ['warnings', 'daily', 'upcomingPayments']) {
    requireValue(Array.isArray(forecast[field]), `forecast.${field} must be an array`);
  }
  requireValue(forecast.warnings.every((warning) => typeof warning === 'string'), 'forecast warnings must be strings');
  if (savings.assumptions !== undefined) requireValue(Array.isArray(savings.assumptions) && savings.assumptions.every((text) => typeof text === 'string'), 'savings assumptions must be strings');
  if (forecast.startingBalanceCents !== undefined) cents(forecast.startingBalanceCents, 'startingBalanceCents', { signed: true });
  if (forecast.lowestExpectedBalance) {
    date(forecast.lowestExpectedBalance.date);
    cents(forecast.lowestExpectedBalance.amountCents, 'lowestExpectedBalance.amountCents', { signed: true });
  }
  const dates = [];
  for (const row of forecast.daily) {
    date(row.date);
    requireValue(row.date > forecast.asOf, 'forecast daily dates must follow asOf');
    requireValue(!dates.length || dates.at(-1) < row.date, 'forecast daily rows must be chronological and unique');
    dates.push(row.date);
    cents(row.expectedBalanceCents, 'expectedBalanceCents', { signed: true });
    for (const field of ['calibratedLowerBalanceCents', 'calibratedUpperBalanceCents', 'conditionalLowerBalanceCents', 'conditionalUpperBalanceCents']) {
      if (row[field] !== undefined) cents(row[field], field, { signed: true });
    }
  }
  if (forecast.status === 'estimated') {
    requireValue(forecast.daily.length > 0 && forecast.lowestExpectedBalance && forecast.startingBalanceCents !== undefined,
      'estimated forecast must include its daily path, opening balance, and supplied minimum');
    requireValue(dates.includes(forecast.lowestExpectedBalance.date), 'forecast minimum date must be in the supplied daily path');
  }
  if (savings.horizonEnd !== undefined) {
    date(savings.horizonEnd);
    requireValue(savings.horizonEnd === dates.at(-1), 'savings and forecast horizons must match');
  }
  if (forecast.calibration) cents(forecast.calibration.marginCents, 'calibration.marginCents');
  for (const payment of forecast.upcomingPayments) {
    identifier(payment.category, 'payment.category');
    requireValue(['inflow', 'outflow'].includes(payment.direction), 'unknown payment direction');
    date(payment.earliestDate); date(payment.latestDate);
    requireValue(payment.earliestDate <= payment.latestDate, 'invalid payment window');
    cents(payment.expectedTotalCents, 'payment.expectedTotalCents');
    evidenceIds(payment.evidenceIds);
  }
  const transactions = forecast.evidence ?? [];
  requireValue(Array.isArray(transactions), 'forecast.evidence must be an array');
  unique(transactions.map((row) => row.id), 'evidence ids');
  for (const row of transactions) {
    identifier(row.id); date(row.date);
    requireValue(row.date <= forecast.asOf, 'transaction evidence cannot follow the reference date');
    if (row.customerId !== undefined) requireValue(row.customerId === forecast.customerId, 'evidence belongs to another customer');
    cents(row.amountCents, 'evidence.amountCents', { signed: true });
  }
}

function paymentContext(forecast) {
  const payments = [...forecast.upcomingPayments].sort((a, b) => a.earliestDate.localeCompare(b.earliestDate));
  return ['outflow', 'inflow'].flatMap((direction) => {
    const payment = payments.find((item) => item.direction === direction && item.expectedTotalCents > 0);
    if (!payment) return [];
    const index = forecast.upcomingPayments.indexOf(payment);
    return [{
      category: payment.category, direction, amountCents: payment.expectedTotalCents,
      earliestDate: payment.earliestDate, latestDate: payment.latestDate, isEstimate: true,
      alreadyIncludedInForecast: payment.alreadyIncludedInForecast === true,
      scope: payment.scope, evidenceIds: evidenceIds(payment.evidenceIds),
      sourcePath: `forecast.upcomingPayments[${index}]`,
      explanation: `Past ${payment.category} payments support an estimated ${direction === 'inflow' ? 'inflow' : 'outflow'} total of ${money(payment.expectedTotalCents)} during ${payment.earliestDate}–${payment.latestDate}. ${payment.alreadyIncludedInForecast ? 'It is already included in the forecast.' : 'Its inclusion in the forecast needs checking.'}`,
    }];
  });
}

/** Explain one {forecast, savings} entry from savings-demo.json. No financial calculations. */
export function createEngineCoachResponse(result, { bufferConfirmed = false } = {}) {
  validateResult(result);
  requireValue(typeof bufferConfirmed === 'boolean', 'bufferConfirmed must be a boolean');
  const { forecast, savings } = result;
  const validForecast = forecast.status === 'estimated';
  const payments = paymentContext(forecast);
  const buffer = money(savings.bufferCents);
  const lowest = forecast.lowestExpectedBalance;
  const conditional = forecast.scenarioBasis === 'known_expense_plan';
  const lowerKey = conditional ? 'conditionalLowerBalanceCents' : 'calibratedLowerBalanceCents';
  // Compare supplied engine records with the chosen buffer; never calculate a new balance.
  const rangeRisk = forecast.calibration || conditional
    ? forecast.daily.find((row) => row[lowerKey] !== undefined && row[lowerKey] < savings.bufferCents)
    : undefined;
  const previewAmount = validForecast && savings.status !== 'withheld'
    ? savings.status === 'needs_confirmation' ? savings.conditionalCapacityCents : savings.suggestedSavingsCents : null;
  let insight;
  if (forecast.status === 'insufficient_history') {
    insight = { kind: 'insufficient_history', title: 'More payment history is needed',
      explanation: 'The engine does not have enough complete payment history for the observed accounts to produce a forecast. It needs at least three complete months per account, so no savings amount is available.' };
  } else if (forecast.status === 'needs_review') {
    const stale = (forecast.accounts ?? []).some((account) => account.daysSinceLastTransaction > 35);
    const unknown = forecast.warnings.some((warning) => /unclassified|reversed flows/i.test(warning));
    const reason = [stale ? 'an account balance may be out of date' : '', unknown ? 'some cash movements need classification or review' : ''].filter(Boolean).join(' and ');
    insight = { kind: 'needs_review', title: 'Check the inputs before choosing savings',
      explanation: `The forecast needs review${reason ? ` because ${reason}` : '; the engine has not cleared the supplied data for a recommendation'}. Confirm the account coverage and flagged payments before relying on a savings estimate.` };
  } else if (forecast.startingBalanceCents < savings.bufferCents) {
    insight = { kind: 'current_buffer_gap', title: 'Your recorded balance is below the buffer',
      explanation: `The recorded balance of ${money(forecast.startingBalanceCents)} is below the supplied ${buffer} cash buffer. Check upcoming costs and income before setting money aside.` };
  } else if (lowest.amountCents < savings.bufferCents) {
    insight = { kind: 'expected_buffer_gap', title: 'Your balance could get tight',
      explanation: `The engine's lowest expected balance is ${money(lowest.amountCents)}, estimated for ${lowest.date}, below the supplied ${buffer} cash buffer. ${previewAmount === 0 ? 'Its conditional savings preview is €0.00; this is not a confirmed recommendation.' : 'Review the payment timing before setting money aside.'}` };
  } else if (rangeRisk) {
    insight = { kind: 'uncertain_buffer_gap', title: 'Allow for uncertainty before saving',
      explanation: `The ${conditional ? 'conditional' : 'calibrated'} lower balance estimate is ${money(rangeRisk[lowerKey])} on ${rangeRisk.date}, below the supplied ${buffer} buffer. This is a possible outcome within an uncertain range, not a prediction that this balance will occur.` };
  } else if (savings.status === 'withheld') {
    insight = { kind: 'savings_withheld', title: 'A savings estimate is not available yet',
      explanation: savings.reason ?? 'The engine has withheld savings pending a review of the forecast and account coverage.' };
  } else if (previewAmount === 0) {
    insight = { kind: 'no_savings_capacity', title: 'Keep the buffer available for now',
      explanation: `The engine's conditional savings ${savings.status === 'needs_confirmation' ? 'preview' : 'estimate'} is ${money(previewAmount)} with the supplied ${buffer} buffer and listed future costs. This does not rule out other plans after the inputs are reviewed.` };
  } else {
    insight = { kind: savings.status === 'needs_confirmation' ? 'conditional_savings_preview' : 'conditional_savings_estimate',
      title: savings.status === 'needs_confirmation' ? 'A savings preview to confirm' : 'An uncertain savings estimate',
      explanation: `The engine ${savings.status === 'needs_confirmation' ? 'previews' : 'estimates'} ${money(previewAmount)} that could be set aside while retaining the supplied ${buffer} buffer. ${savings.status === 'needs_confirmation' ? 'This is conditional on checking your commitments; no savings recommendation is confirmed yet.' : 'Even with commitments checked, future balances and savings remain uncertain.'}` };
  }
  if (validForecast && payments.length) {
    const context = ['expected_buffer_gap', 'uncertain_buffer_gap', 'current_buffer_gap'].includes(insight.kind)
      ? payments.find((payment) => payment.direction === 'inflow') ?? payments[0] : payments[0];
    insight.explanation += ` ${context.explanation}`;
  }
  let followUp;
  if (forecast.status === 'insufficient_history') {
    followUp = { id: 'history_coverage', kind: 'review_inputs',
      prompt: 'Can you provide at least three complete months of transactions for each account you want included?',
      changesRecommendation: 'Additional history can allow the engine to produce a forecast.' };
  } else if (forecast.status === 'needs_review') {
    followUp = { id: 'review_engine_inputs', kind: 'review_inputs',
      prompt: 'Can you confirm the current balances and explain any flagged transactions or missing accounts?',
      changesRecommendation: 'Corrected source data or account coverage can change whether the engine can offer a savings estimate.' };
  } else if (savings.status === 'withheld') {
    followUp = (forecast.accounts ?? []).length > 1 ? {
      id: 'account_liquidity', kind: 'review_inputs',
      prompt: 'Which account would you use for savings, and which payments must that account cover?',
      changesRecommendation: 'Account-specific commitments can inform the liquidity model needed before combining account balances.',
    } : null; // Missing model/calibration is a backend task, not something a customer can confirm away.
  } else if (!bufferConfirmed && !['expected_buffer_gap', 'uncertain_buffer_gap', 'current_buffer_gap'].includes(insight.kind)) {
    followUp = { id: 'choose_buffer', kind: 'cash_buffer',
      prompt: `What minimum cash buffer would you like to keep? This calculation currently uses ${buffer}.`,
      changesRecommendation: 'Your chosen buffer is an input to the engine’s savings calculation.',
      fields: [{ name: 'bufferCents', type: 'integer', minimum: 0, unit: 'EUR cents' }] };
  } else {
    followUp = { id: 'check_expenses', kind: 'upcoming_expenses',
      prompt: 'Do you have any upcoming expenses that are not already reflected in this calculation?',
      changesRecommendation: 'Additional costs must be included by the engine before relying on a savings amount.',
      fields: [{ name: 'upcomingExpenses', type: 'expense_list', requiredFields: ['id', 'date', 'amountCents', 'inclusion'] },
        { name: 'commitmentsConfirmed', type: 'boolean', explicitCustomerConfirmation: true }] };
  }
  const ids = evidenceIds([
    ...(forecast.accounts ?? []).flatMap((account) => account.evidenceIds ?? []),
    ...payments.flatMap((payment) => payment.evidenceIds),
  ]);
  const transactions = forecast.evidence ?? [];
  const atLowest = forecast.daily.find((row) => row.date === lowest?.date);
  return {
    schemaVersion: '1.0.0', customerId: forecast.customerId, asOf: forecast.asOf, currency: 'EUR',
    modelVersion: forecast.modelVersion, insight, followUp,
    facts: {
      buffer: { amountCents: savings.bufferCents, sourcePath: 'savings.bufferCents', customerConfirmed: bufferConfirmed },
      startingBalance: forecast.startingBalanceCents === undefined ? null
        : { amountCents: forecast.startingBalanceCents, sourcePath: 'forecast.startingBalanceCents', basis: 'historical_observation' },
      lowestExpectedBalance: validForecast ? { ...lowest, sourcePath: 'forecast.lowestExpectedBalance', isEstimate: true } : null,
      savings: { status: validForecast ? savings.status : 'withheld', engineStatus: savings.status,
        amountCents: previewAmount, isConditional: true, requiresConfirmation: savings.status === 'needs_confirmation',
        sourcePath: previewAmount === null ? null : savings.status === 'needs_confirmation'
          ? 'savings.conditionalCapacityCents' : 'savings.suggestedSavingsCents' },
    },
    paymentContext: payments,
    evidence: { transactionIds: ids, transactions: transactions.filter((row) => ids.includes(row.id)).map((row) => ({ ...row })),
      unresolvedTransactionIds: ids.filter((id) => !transactions.some((row) => row.id === id)),
      scopeNote: 'These transactions support opening balances and payment estimates; they are not the complete spending history behind the forecast.' },
    uncertainty: {
      ...(conditional ? { calibrationCoverageClaimApplies: false } : {}),
      message: conditional ? 'Known expenses are included in this conditional plan. The original forecast calibration does not establish coverage for these changed balances; payment dates and savings remain uncertain.' : forecast.calibration
        ? `The model expands its scenario range by ${money(forecast.calibration.marginCents)} on each side to account for past errors. Payment dates and savings remain uncertain; this is not an individual guarantee.`
        : 'A calibrated uncertainty range is unavailable. Payment dates are estimates; savings must not be treated as guaranteed.',
      calibrationMarginCents: forecast.calibration?.marginCents ?? null,
      calibratedRangeAtExpectedLow: validForecast && atLowest?.calibratedLowerBalanceCents !== undefined && atLowest?.calibratedUpperBalanceCents !== undefined
        ? { date: atLowest.date, lowerCents: atLowest.calibratedLowerBalanceCents, upperCents: atLowest.calibratedUpperBalanceCents } : null,
      incomeTimingNote: 'An income date window can spread an expectation across dates; it is not a promise of installments or an exact payday.',
    },
    warnings: [...forecast.warnings], assumptions: [...(savings.assumptions ?? [])],
    calculationState: 'engine_result', movesMoney: false,
  };
}

/** Capture customer choices only. The caller must run the engine before showing new figures. */
export function captureCoachInputs(result, answer, previousInputs) {
  validateResult(result);
  requireValue(answer && typeof answer === 'object' && !Array.isArray(answer), 'answer must be structured inputs');
  const allowed = ['bufferCents', 'upcomingExpenses', 'removeExpenseIds', 'commitmentsConfirmed'];
  requireValue(Object.keys(answer).every((key) => allowed.includes(key)), 'unsupported answer field');
  requireValue(Object.keys(answer).length > 0, 'at least one customer answer is required');
  const { forecast, savings } = result;
  if (previousInputs) {
    requireValue(previousInputs.customerId === forecast.customerId && previousInputs.asOf === forecast.asOf,
      'previous inputs must belong to this customer and reference date');
  }
  if (Object.hasOwn(answer, 'bufferCents')) cents(answer.bufferCents, 'bufferCents');
  const bufferCents = answer.bufferCents ?? previousInputs?.bufferCents ?? savings.bufferCents;
  cents(bufferCents, 'bufferCents');
  const incoming = answer.upcomingExpenses ?? [];
  const removed = answer.removeExpenseIds ?? [];
  requireValue(Array.isArray(incoming) && Array.isArray(removed), 'expense updates and removals must be arrays');
  removed.forEach((id) => identifier(id));
  unique(incoming.map((expense) => expense.id), 'incoming expense ids');
  unique(removed, 'removed expense ids');
  requireValue(!incoming.some((expense) => removed.includes(expense.id)), 'cannot update and remove the same expense');
  const existing = previousInputs?.upcomingExpenses ?? result.plannedExpenses ?? (savings.futureCommitments ?? []).map((expense) => ({ ...expense, inclusion: 'additional' }));
  requireValue(Array.isArray(existing), 'previous upcomingExpenses must be an array');
  unique(existing.map((expense) => expense.id), 'existing expense ids');
  const expenses = new Map(existing.map((expense) => [expense.id, { ...expense }]));
  for (const id of removed) {
    requireValue(expenses.has(id), 'cannot remove an unknown expense');
    expenses.delete(id);
  }
  for (const expense of incoming) expenses.set(expense.id, { ...expense, inclusion: expense.inclusion ?? 'unsure' });
  for (const expense of expenses.values()) {
    identifier(expense.id); date(expense.date);
    cents(expense.amountCents, 'expense.amountCents');
    requireValue(['additional', 'already_included', 'unsure'].includes(expense.inclusion), 'unknown expense inclusion');
    if (expense.label !== undefined) identifier(expense.label, 'expense.label');
  }
  if (answer.commitmentsConfirmed !== undefined) requireValue(typeof answer.commitmentsConfirmed === 'boolean', 'commitmentsConfirmed must be explicit true or false');
  const changedInputs = answer.bufferCents !== undefined || incoming.length > 0 || removed.length > 0;
  const commitmentsConfirmed = answer.commitmentsConfirmed ?? (changedInputs ? false : previousInputs?.commitmentsConfirmed ?? false);
  requireValue(typeof commitmentsConfirmed === 'boolean', 'previous confirmation must be a boolean');
  const horizonEnd = forecast.daily.at(-1)?.date ?? null;
  const reservedByEngine = new Map((savings.futureCommitments ?? []).map((expense) => [expense.id, expense]));
  const inHorizonExpenses = [], futureCommitments = [], needsInclusionReview = [], alreadyIncludedExpenses = [];
  for (const expense of expenses.values()) {
    if (expense.status === 'matched' || expense.status === 'cancelled') continue;
    if (expense.date <= forecast.asOf) { needsInclusionReview.push(expense); continue; }
    if (!horizonEnd || expense.inclusion === 'unsure') needsInclusionReview.push(expense);
    else if (expense.inclusion === 'already_included') {
      if (expense.date <= horizonEnd) alreadyIncludedExpenses.push(expense);
      else {
        const reserved = reservedByEngine.get(expense.id);
        if (reserved?.date === expense.date && reserved.amountCents === expense.amountCents) {
          futureCommitments.push({ id: expense.id, date: expense.date, amountCents: expense.amountCents });
        } else needsInclusionReview.push(expense);
      }
    }
    else if (expense.date <= horizonEnd) inHorizonExpenses.push(expense);
    else futureCommitments.push({ id: expense.id, date: expense.date, amountCents: expense.amountCents });
  }
  const blockers = [];
  if (forecast.status !== 'estimated') blockers.push('source_data_requires_review');
  if (!forecast.calibration) blockers.push('calibrated_forecast_required');
  if (needsInclusionReview.length) blockers.push('expense_inclusion_requires_review');
  return {
    status: 'awaiting_recalculation', customerId: forecast.customerId, asOf: forecast.asOf,
    message: 'Your choices have been captured. The displayed forecast and savings have not changed; the engine must return a recalculated result first.',
    inputs: { customerId: forecast.customerId, asOf: forecast.asOf, bufferCents,
      bufferConfirmed: answer.bufferCents !== undefined || previousInputs?.bufferConfirmed === true,
      commitmentsConfirmed, upcomingExpenses: [...expenses.values()] },
    engineRequest: {
      customerId: forecast.customerId, asOf: forecast.asOf, readyForCurrentEngine: blockers.length === 0, blockers,
      forecastInputs: { customer_id: forecast.customerId, as_of: forecast.asOf, horizon_days: forecast.horizonDays, buffer_cents: bufferCents },
      savingsInputs: { buffer_cents: bufferCents, future_commitments: futureCommitments, commitments_confirmed: commitmentsConfirmed },
      inHorizonExpenses, needsInclusionReview, alreadyIncludedExpenses,
      plannedExpenses: [...expenses.values()].map((expense) => Object.fromEntries(Object.entries(expense)
        .filter(([key]) => ['id', 'date', 'amountCents', 'label', 'category', 'accountId', 'merchantId', 'inclusion', 'status'].includes(key)))),
    },
    forecastChanged: false, savingsChanged: false, movesMoney: false,
  };
}
