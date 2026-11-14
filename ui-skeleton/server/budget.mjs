import { readFileSync } from 'node:fs';
import { account, accountPlan } from './account.mjs';
export const activity = JSON.parse(readFileSync(new URL('./budget/activity.json', import.meta.url)));
const spendingTypes = new Set(['purchase', 'housing_payment', 'utilities_payment']);

// Only compare a budget and transactions inside the very same date window.
export function buildBudgetView(plan, ledger, mode = 'plan') {
  if (!['plan', 'history'].includes(mode)) throw new Error('Unknown budget period');
  const accountIds = plan.forecast.accounts.map(a => a.accountId);
  if (ledger.customerId !== plan.customerId || ledger.accountIds.some(id => !accountIds.includes(id))) throw new Error('Account mismatch');
  const seen = new Set();
  for (const tx of ledger.transactions) {
    if (tx.customerId !== plan.customerId || !accountIds.includes(tx.accountId) || seen.has(tx.id)
      || !Number.isSafeInteger(tx.amountCents) || tx.date < ledger.coverage.start || tx.date > ledger.coverage.end) throw new Error('Invalid account activity');
    seen.add(tx.id);
  }
  const period = mode === 'plan'
    ? { start: plan.budget.periodStart, end: plan.budget.periodEnd }
    : { ...ledger.coverage };
  const covered = ledger.coverage.start <= period.start && ledger.coverage.end >= period.start;
  const through = covered ? (ledger.coverage.end < period.end ? ledger.coverage.end : period.end) : null;
  const transactions = ledger.transactions.filter(tx => tx.date >= period.start && tx.date <= period.end && spendingTypes.has(tx.type));
  const planned = mode === 'plan' ? plan.budget.categories : [];
  const names = [...new Set([...planned.map(c => c.category), ...transactions.map(t => t.category)])];
  const categories = names.map(category => {
    const limit = planned.find(c => c.category === category);
    const rows = transactions.filter(t => t.category === category);
    const spentCents = covered ? rows.filter(t => t.amountCents < 0).reduce((sum, t) => sum - t.amountCents, 0) : null;
    const refundCents = covered ? rows.filter(t => t.amountCents > 0).reduce((sum, t) => sum + t.amountCents, 0) : null;
    const plannedCents = limit?.previewLimitCents ?? null;
    return { category, plannedCents, spentCents, refundCents,
      remainingCents: covered && plannedCents !== null ? plannedCents - spentCents : null,
      adjustable: limit?.adjustable ?? false, transactions: rows };
  }).sort((a,b) => (mode === 'plan' ? b.plannedCents - a.plannedCents : b.spentCents - a.spentCents));
  const totalPlannedCents = mode === 'plan' ? categories.reduce((sum,c) => sum + (c.plannedCents ?? 0),0) : null;
  const spentCents = covered ? categories.reduce((sum,c) => sum + c.spentCents,0) : null;
  // Unbudgeted categories count toward the overall remainder too.
  return { mode, customerId: plan.customerId, accountIds, period, through,
    status: mode === 'plan' ? plan.budget.status : 'observed', activityAvailable: covered,
    totalPlannedCents, spentCents,
    remainingCents: covered && totalPlannedCents !== null ? totalPlannedCents - spentCents : null,
    refundsCents: covered ? categories.reduce((sum,c) => sum + c.refundCents,0) : null,
    savingsTargetCents: plan.budget.savingsTargetCents, bufferCents: plan.budget.bufferCents,
    categories, source: ledger.source, coverage: ledger.coverage,
    calculation: 'Spending includes purchases, housing and utilities. Transfers, investments and income are excluded. Refunds are shown separately and do not increase the available budget.',
    canEdit: false, movesMoney: false };
}
export function getBudgetView(mode) { return { ...buildBudgetView(accountPlan, activity, mode), accountLabel: account.label }; }
