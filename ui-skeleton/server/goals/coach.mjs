function medianCents(amounts) {
  const sorted = [...amounts].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

export function calculateGoalPlan({ goal, periods, deliveryHistory, newExpenses }) {
  const expensesByMonth = Map.groupBy(newExpenses, (expense) => expense.date.slice(0, 7));
  const breakdown = periods.map(({ month, availableToSaveCents, plannedDeliveryCents }) => {
    const expenses = expensesByMonth.get(month) ?? [];
    const expenseCents = expenses.reduce((total, expense) => total + expense.amountCents, 0);

    return {
      month,
      availableToSaveCents,
      plannedDeliveryCents,
      expenseCents,
      projectedContributionCents: availableToSaveCents - expenseCents,
      expenseIds: expenses.map((expense) => expense.id),
    };
  });

  const projectedSavedCents = breakdown.reduce(
    (total, period) => total + period.projectedContributionCents,
    goal.savedCents,
  );
  const goalShortfallCents = Math.max(0, goal.targetCents - projectedSavedCents);
  const result = { projectedSavedCents, goalShortfallCents, breakdown };

  if (goalShortfallCents === 0 || deliveryHistory.length === 0) return result;

  const estimatedSavingsPerDeliveryCents = medianCents(
    deliveryHistory.map((transaction) => transaction.amountCents),
  );
  if (estimatedSavingsPerDeliveryCents <= 0) return result;

  const months = breakdown
    .filter((period) => period.plannedDeliveryCents >= estimatedSavingsPerDeliveryCents)
    .slice(0, Math.ceil(goalShortfallCents / estimatedSavingsPerDeliveryCents));
  if (months.length === 0) return result;

  const estimatedSavingsCents = months.length * estimatedSavingsPerDeliveryCents;
  return {
    ...result,
    recoveryOption: {
      category: 'delivery',
      months: months.map((period) => period.month),
      estimatedSavingsPerDeliveryCents,
      estimatedSavingsCents,
      projectedSavedIfFollowedCents: projectedSavedCents + estimatedSavingsCents,
      evidenceIds: [
        ...breakdown.flatMap((period) => period.expenseIds),
        ...deliveryHistory.map((transaction) => transaction.id),
      ],
    },
  };
}
