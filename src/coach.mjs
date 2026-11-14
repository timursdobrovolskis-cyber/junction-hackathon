import { cents, date, evidenceIds, identifier, month, requireValue, sum, unique } from './validation.mjs';

function medianCents(amounts) {
  const sorted = [...amounts].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(sorted[middle - 1] + (sorted[middle] - sorted[middle - 1]) / 2)
    : sorted[middle];
}

// Period amounts are remaining cash AFTER projected spending, before newExpenses.
// Historical delivery amounts are positive expense magnitudes, never signed bank rows.
export function calculateGoalPlan({ goal, periods, deliveryHistory = [], newExpenses = [] }) {
  requireValue(goal && typeof goal === 'object', 'goal is required');
  cents(goal.targetCents, 'goal.targetCents');
  cents(goal.savedCents, 'goal.savedCents');
  if (goal.targetDate !== undefined) date(goal.targetDate, 'goal.targetDate');
  requireValue(Array.isArray(periods) && periods.length > 0, 'periods must not be empty');
  requireValue(Array.isArray(deliveryHistory) && Array.isArray(newExpenses), 'history and expenses must be arrays');
  periods.forEach((period) => {
    month(period.month);
    cents(period.availableToSaveCents, 'availableToSaveCents', { signed: true });
    cents(period.plannedDeliveryCents, 'plannedDeliveryCents');
    evidenceIds(period.evidenceIds);
    if (goal.targetDate) requireValue(period.month <= goal.targetDate.slice(0, 7), 'period is after goal deadline');
  });
  unique(periods.map((period) => period.month), 'period months');
  newExpenses.forEach((expense) => {
    identifier(expense.id);
    date(expense.date);
    cents(expense.amountCents, 'expense.amountCents');
    requireValue(periods.some((period) => period.month === expense.date.slice(0, 7)), 'expense is outside planning periods');
    if (goal.targetDate) requireValue(expense.date <= goal.targetDate, 'expense is after goal deadline');
  });
  unique(newExpenses.map((expense) => expense.id), 'expense ids');
  deliveryHistory.forEach((transaction) => {
    identifier(transaction.id);
    date(transaction.date);
    cents(transaction.amountCents, 'delivery amountCents');
    requireValue(transaction.amountCents > 0, 'delivery history must contain positive consumption expenses');
  });
  unique(deliveryHistory.map((transaction) => transaction.id), 'delivery history ids');

  const breakdown = [...periods].sort((a, b) => a.month.localeCompare(b.month)).map((period) => {
    const expenses = newExpenses.filter((expense) => expense.date.slice(0, 7) === period.month);
    const expenseCents = sum(expenses.map((expense) => expense.amountCents));
    return {
      month: period.month,
      availableToSaveCents: period.availableToSaveCents,
      plannedDeliveryCents: period.plannedDeliveryCents,
      expenseCents,
      projectedContributionCents: sum([period.availableToSaveCents, -expenseCents]),
      expenseIds: expenses.map((expense) => expense.id),
    };
  });
  const projectedSavedCents = sum([goal.savedCents, ...breakdown.map((period) => period.projectedContributionCents)]);
  const goalShortfallCents = Math.max(0, sum([goal.targetCents, -projectedSavedCents]));
  const cashShortfalls = breakdown.filter((period) => period.projectedContributionCents < 0)
    .map((period) => ({ month: period.month, shortfallCents: -period.projectedContributionCents }));
  const result = { projectedSavedCents, goalShortfallCents, breakdown, cashShortfalls };
  if (goalShortfallCents === 0 || deliveryHistory.length === 0) return result;

  const estimatedSavingsPerDeliveryCents = medianCents(deliveryHistory.map((transaction) => transaction.amountCents));
  // A small experiment: at most one avoided delivery per period, only where already budgeted.
  const months = breakdown
    .filter((period) => period.plannedDeliveryCents >= estimatedSavingsPerDeliveryCents)
    .slice(0, Math.ceil(goalShortfallCents / estimatedSavingsPerDeliveryCents));
  if (months.length === 0) return result;
  const estimatedSavingsCents = sum(months.map(() => estimatedSavingsPerDeliveryCents));
  const projectedSavedIfFollowedCents = sum([projectedSavedCents, estimatedSavingsCents]);
  return {
    ...result,
    recoveryOption: {
      category: 'delivery',
      months: months.map((period) => period.month),
      estimatedSavingsPerDeliveryCents,
      estimatedSavingsCents,
      projectedSavedIfFollowedCents,
      remainingShortfallCents: Math.max(0, sum([goal.targetCents, -projectedSavedIfFollowedCents])),
      evidenceIds: evidenceIds([
        ...breakdown.flatMap((period) => period.expenseIds),
        ...deliveryHistory.map((transaction) => transaction.id),
        ...periods.flatMap((period) => period.evidenceIds ?? []),
      ]),
    },
  };
}
