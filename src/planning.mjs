import { calculateGoalPlan } from './coach.mjs';
import { cents, date, evidenceIds, identifier, month, requireValue, sum, unique } from './validation.mjs';

const money = (value) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value / 100);
const baskets = ['mandatory_regular', 'mandatory_irregular', 'everyday'];
const isDelivery = (category) => category.trim().toLowerCase() === 'delivery';

/** Completed monthly consumption totals, including explicit zero-spend months. */
export function calculateCategoryBudgets({ history, reductionPercent = 0 }) {
  requireValue(Array.isArray(history), 'history must be an array');
  requireValue(Number.isInteger(reductionPercent) && reductionPercent >= 0 && reductionPercent <= 100,
    'reductionPercent must be an integer between 0 and 100');
  unique(history.map((row) => JSON.stringify([row.category, row.month])), 'category/month rows');
  const categories = new Map();
  for (const row of history) {
    identifier(row.category, 'category');
    month(row.month);
    cents(row.spentCents, 'spentCents');
    requireValue(baskets.includes(row.basket), 'unknown spending basket');
    requireValue(typeof row.adjustable === 'boolean', 'adjustable must be explicitly set by the customer or adapter');
    evidenceIds(row.evidenceIds);
    const rows = categories.get(row.category) ?? [];
    requireValue(rows.every((previous) => previous.basket === row.basket && previous.adjustable === row.adjustable),
      'category classifications must be consistent; apply customer corrections first');
    rows.push(row);
    categories.set(row.category, rows);
  }
  return [...categories].map(([category, rows]) => {
    const baselineCents = Math.round(sum(rows.map((row) => row.spentCents)) / rows.length);
    // Integer arithmetic avoids rounding errors when calculating percentage reductions.
    const estimatedReductionCents = rows[0].adjustable && rows[0].basket === 'everyday'
      ? Number(BigInt(baselineCents) * BigInt(reductionPercent) / 100n) : 0;
    return {
      category, basket: rows[0].basket, adjustable: rows[0].adjustable,
      baselineCents, suggestedBudgetCents: baselineCents - estimatedReductionCents,
      estimatedReductionCents, observedMonths: rows.map((row) => row.month).sort(),
      evidenceIds: evidenceIds(rows.flatMap((row) => row.evidenceIds ?? [])),
      basis: 'Mean of supplied complete months; a starting point the customer can edit.',
      uncertainty: rows.length < 3 ? 'Limited history: fewer than three complete months.' : 'Past spending can change.',
    };
  });
}

function validateProfile(profile) {
  identifier(profile.customerId, 'customerId');
  if (profile.deliveryAdjustable !== undefined) {
    requireValue(typeof profile.deliveryAdjustable === 'boolean', 'deliveryAdjustable must be a boolean');
  }
  requireValue(profile.currency === 'EUR', 'only EUR is supported');
  date(profile.asOf, 'asOf');
  requireValue(['illustrative_fixture', 'historical_bank_data'].includes(profile.dataSource), 'dataSource must identify fixture or historical bank data');
  requireValue(Array.isArray(profile.missingInputs) && profile.missingInputs.every((item) => typeof item === 'string'),
    'missingInputs must explicitly list missing financial inputs, or be []');
  requireValue(Array.isArray(profile.assumptions) && profile.assumptions.every((item) => typeof item === 'string'), 'assumptions must be an array of strings');
  for (const row of profile.deliveryHistory ?? []) {
    date(row.date);
    requireValue(row.date <= profile.asOf, 'delivery evidence cannot be after asOf');
  }
  for (const row of profile.spendingHistory ?? []) {
    month(row.month);
    requireValue(row.month < profile.asOf.slice(0, 7), 'budget history must contain completed months before asOf');
  }
  for (const period of profile.periods ?? []) {
    month(period.month);
    requireValue(period.month >= profile.asOf.slice(0, 7), 'planning periods cannot precede asOf');
  }
  for (const expense of profile.newExpenses ?? []) {
    date(expense.date);
    requireValue(expense.date >= profile.asOf, 'new expenses must not already be included in the reference balance');
  }
  if (profile.goal) {
    date(profile.goal.targetDate, 'goal.targetDate');
    requireValue(profile.goal.targetDate >= profile.asOf, 'goal deadline cannot precede asOf');
    identifier(profile.goal.label, 'goal.label');
    requireValue(Array.isArray(profile.periods) && profile.periods.length > 0, 'periods must not be empty');
    const months = profile.periods.map((period) => period.month).sort();
    requireValue(months[0] === profile.asOf.slice(0, 7)
      && months.at(-1) === profile.goal.targetDate.slice(0, 7), 'periods must cover asOf through the goal deadline');
    for (let index = 1; index < months.length; index++) {
      const previous = new Date(`${months[index - 1]}-01T00:00:00Z`);
      previous.setUTCMonth(previous.getUTCMonth() + 1);
      requireValue(previous.toISOString().slice(0, 7) === months[index], 'periods must be consecutive and unique');
    }
  }
}

function calculateProfilePlan(profile, budgets = calculateCategoryBudgets({ history: profile.spendingHistory ?? [] })) {
  // Customer corrections apply to every recommendation and preview, not just budgets.
  const deliveryBudgets = budgets.filter((budget) => isDelivery(budget.category));
  const deliveryAdjustable = profile.deliveryAdjustable !== false
    && deliveryBudgets.every((budget) => budget.adjustable && budget.basket === 'everyday');
  return calculateGoalPlan({ ...profile, deliveryAdjustable });
}

/** Pure preview. The purchase must not already be included in the input projection. */
export function calculatePurchaseScenario(profile, purchase) {
  validateProfile(profile);
  date(purchase.date, 'purchase.date');
  requireValue(purchase.date >= profile.asOf, 'purchase cannot precede asOf');
  const baseline = calculateProfilePlan(profile);
  const afterPurchase = calculateProfilePlan({ ...profile, newExpenses: [...(profile.newExpenses ?? []), purchase] });
  return {
    schemaVersion: 1, customerId: profile.customerId, currency: 'EUR',
    asOf: profile.asOf, dataSource: profile.dataSource,
    kind: 'purchase_preview', baseline, afterPurchase,
    impactCents: sum([afterPurchase.projectedSavedCents, -baseline.projectedSavedCents]),
    status: profile.missingInputs.length ? 'needs_information'
      : afterPurchase.cashShortfalls.length ? 'cash_shortfall'
        : afterPurchase.goalShortfallCents ? 'goal_shortfall' : 'within_projection',
    explanation: `This purchase changes projected goal savings from ${money(baseline.projectedSavedCents)} to ${money(afterPurchase.projectedSavedCents)}. This is conditional on the supplied monthly plan; it does not establish day-by-day affordability.`,
    assumptions: [...profile.assumptions], missingInputs: [...profile.missingInputs],
    evidenceIds: evidenceIds((profile.periods ?? []).flatMap((period) => period.evidenceIds ?? [])),
    scenarioExpenseIds: (profile.newExpenses ?? []).map((expense) => expense.id).concat(purchase.id),
    previewOnly: true,
  };
}

/** Preview the suggested experiment without persisting or claiming realized savings. */
export function calculateRecoveryScenario(profile) {
  validateProfile(profile);
  const baseline = calculateProfilePlan(profile);
  const option = baseline.recoveryOption;
  if (!option || profile.missingInputs.length || baseline.cashShortfalls.length) return null;
  const selectedMonths = new Set(option.months);
  const periods = profile.periods.map((period) => selectedMonths.has(period.month) ? {
    ...period,
    availableToSaveCents: sum([period.availableToSaveCents, option.estimatedSavingsPerDeliveryCents]),
    plannedDeliveryCents: period.plannedDeliveryCents - option.estimatedSavingsPerDeliveryCents,
  } : { ...period });
  // Do not offer a second experiment as though the first preview were actual history.
  const afterExperiment = calculateProfilePlan({ ...profile, periods, deliveryHistory: [] });
  return {
    schemaVersion: 1, customerId: profile.customerId, currency: 'EUR',
    asOf: profile.asOf, dataSource: profile.dataSource,
    kind: 'recovery_preview', baseline, afterExperiment,
    impactCents: sum([afterExperiment.projectedSavedCents, -baseline.projectedSavedCents]),
    evidenceIds: evidenceIds([
      ...profile.periods.flatMap((period) => period.evidenceIds ?? []),
      ...profile.deliveryHistory.map((transaction) => transaction.id),
    ]),
    scenarioExpenseIds: (profile.newExpenses ?? []).map((expense) => expense.id),
    previewOnly: true,
    assumptions: [...profile.assumptions, 'One planned delivery is avoided in each selected month; actual savings may differ.'],
  };
}

/** Data-owner handoff in; one mobile home-card action out. No LLM or network needed. */
export function createCoachAction(profile, { reductionPercent = 0, directAnswer = false } = {}) {
  validateProfile(profile);
  const categoryBudgets = calculateCategoryBudgets({ history: profile.spendingHistory ?? [], reductionPercent })
    .map((budget) => profile.deliveryAdjustable === false && isDelivery(budget.category)
      ? { ...budget, adjustable: false, suggestedBudgetCents: budget.baselineCents, estimatedReductionCents: 0 }
      : budget);
  const plan = profile.goal ? calculateProfilePlan(profile, categoryBudgets) : undefined;
  const signals = profile.signals ?? [];
  requireValue(Array.isArray(signals), 'signals must be an array');
  for (const signal of signals) {
    identifier(signal.id);
    requireValue(signal.type === 'recurring_bill', 'unsupported signal type');
    date(signal.dueDate, 'signal.dueDate');
    cents(signal.amountCents, 'signal.amountCents');
    requireValue(['low', 'medium', 'high', 'confirmed'].includes(signal.confidence), 'unknown signal confidence');
    requireValue(evidenceIds(signal.evidenceIds).length > 0, 'bill signal needs evidence');
  }
  unique(signals.map((signal) => signal.id), 'signal ids');
  const upcoming = [...signals].filter((signal) => signal.dueDate >= profile.asOf)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const result = {
    schemaVersion: 1, customerId: profile.customerId, asOf: profile.asOf, currency: 'EUR',
    dataSource: profile.dataSource, previewOnly: true, categoryBudgets,
    ...(plan ? { plan } : {}),
    assumptions: [...profile.assumptions], missingInputs: [...profile.missingInputs],
    limitations: [
      'Monthly projections cannot identify the weakest day or guarantee that a purchase is affordable.',
      'Selecting a plan changes a projection only; it does not record savings or move money.',
      ...(profile.dataSource === 'illustrative_fixture' ? ['Illustrative synthetic fixture; not a calculation from S-Bank records.'] : []),
      ...(plan && profile.periods.some((period) => !period.evidenceIds?.length)
        ? ['Some planning periods have no transaction evidence; inspect their supplied assumptions.'] : []),
      ...(plan?.recoveryOption && profile.deliveryHistory.length < 3
        ? ['The delivery estimate uses fewer than three observations; confirm whether it is representative.'] : []),
    ],
    evidenceIds: evidenceIds([
      ...(profile.periods ?? []).flatMap((period) => period.evidenceIds ?? []),
      ...(profile.deliveryHistory ?? []).map((row) => row.id),
    ]),
    scenarioExpenseIds: (profile.newExpenses ?? []).map((expense) => expense.id),
  };
  let action;
  if (profile.missingInputs.length) {
    action = { kind: 'confirm_inputs', title: 'Complete the picture',
      explanation: `Before relying on this plan, confirm: ${profile.missingInputs.join(', ')}.`,
      suggestedAction: 'Review the missing inputs and update the assumptions.' };
  } else if (plan?.cashShortfalls.length) {
    const first = plan.cashShortfalls[0];
    action = { kind: 'review_cash_shortfall', title: 'Check an earlier cash gap',
      explanation: `The supplied plan has a ${money(first.shortfallCents)} cash gap in ${first.month}, even if later income improves the total.`,
      suggestedAction: 'Review payment timing and essential commitments before choosing a spending experiment.' };
  } else if (plan?.recoveryOption) {
    const option = plan.recoveryOption;
    action = { kind: 'goal_recovery', title: 'Try a small adjustment',
      explanation: `You are projected to save ${money(plan.projectedSavedCents)} toward ${profile.goal.label}, with ${money(plan.goalShortfallCents)} left to the target. Skipping one planned delivery in each of ${option.months.join(', ')} could free up ${money(option.estimatedSavingsCents)} and bring the projection to ${money(option.projectedSavedIfFollowedCents)}.${option.remainingShortfallCents ? ` A gap of ${money(option.remainingShortfallCents)} would remain.` : ''}`,
      suggestedAction: 'Preview this experiment, edit it, or keep your current plan.',
      experiment: { category: 'delivery', months: option.months,
        estimatedSavingsCents: option.estimatedSavingsCents,
        projectedSavedIfFollowedCents: option.projectedSavedIfFollowedCents,
        implementationIntention: 'When I consider a delivery in a selected month, I will decide whether an alternative fits my priorities.',
        reflection: 'After the month, compare actual spending with the plan and decide whether to continue.' },
    };
  } else if (plan?.goalShortfallCents) {
    action = { kind: 'review_goal', title: 'Adjust the plan to your priorities',
      explanation: `Projected savings are ${money(plan.projectedSavedCents)}, leaving ${money(plan.goalShortfallCents)} to the target. ${plan.recoveryBlockedReason === 'delivery_protected'
        ? 'Your plan keeps delivery spending unchanged because you marked it as essential or non-adjustable.'
        : 'There is not enough supported delivery spending to suggest an experiment.'}`,
      suggestedAction: 'Try a different contribution, target amount, or deadline.' };
  } else if (upcoming) {
    const confirmed = upcoming.confidence === 'confirmed';
    action = { kind: 'review_bill', title: confirmed ? 'Plan for an upcoming bill' : 'Check an expected bill',
      explanation: `${money(upcoming.amountCents)} is ${confirmed ? 'confirmed' : 'estimated'} for ${upcoming.dueDate}.${upcoming.confidence === 'low' ? ' The evidence is weak; confirm it before relying on it.' : ''}`,
      suggestedAction: 'Inspect the evidence and confirm the date and amount. Check whether the bill is already in your plan.',
      signalId: upcoming.id, confidence: upcoming.confidence,
    };
    result.evidenceIds = evidenceIds([...result.evidenceIds, ...upcoming.evidenceIds]);
  } else if (plan) {
    action = { kind: 'goal_on_track', title: 'Your goal fits the supplied projection',
      explanation: `Projected savings of ${money(plan.projectedSavedCents)} cover the ${money(profile.goal.targetCents)} target if the assumptions hold.`,
      suggestedAction: 'Check the plan again when your income or expenses change.' };
  } else {
    action = { kind: 'observation', title: 'Start with what matters to you',
      explanation: 'There is no supported upcoming bill or goal plan to show yet.',
      suggestedAction: 'Inspect your category budgets, or choose a goal when you want a savings plan.' };
  }
  return { ...result, action,
    ...(!directAnswer ? { learning: {
      concept: 'Cash flow and trade-offs',
      explanation: 'Money needed for upcoming commitments is different from money available for a goal. A spending experiment only helps if that spending was already in the plan.',
      reflectionQuestion: 'Which adjustment would preserve the things that matter most to you?',
      optional: true,
    } } : {}),
  };
}
