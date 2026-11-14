import { cents, date, evidenceIds, identifier, requireValue, sum, unique } from './validation.mjs';

const kinds = ['income', 'expense', 'refund', 'transfer', 'savings', 'investment', 'other'];
const baskets = ['mandatory_regular', 'mandatory_irregular', 'everyday'];
const money = (value) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value / 100);
const average = (values) => Math.round(sum(values) / values.length);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round(sorted[middle - 1] + (sorted[middle] - sorted[middle - 1]) / 2);
};

function previousMonth(value) {
  const [year, month] = value.split('-').map(Number);
  return `${String(month === 1 ? year - 1 : year).padStart(4, '0')}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`;
}

function monthEnd(value) {
  const result = new Date(`${value}-01T00:00:00Z`);
  result.setUTCMonth(result.getUTCMonth() + 1);
  result.setUTCDate(0);
  return result.toISOString().slice(0, 10);
}

/** Analyze one customer's normalized history; never infer coverage from missing rows. */
export function analyzeTransactionHistory({ customerId, asOf, history, categoryPreferences = [] }, {
  lookbackMonths = 6, baselineMonths = 3, minChangeCents = 2000, minChangePercent = 20,
} = {}) {
  identifier(customerId, 'customerId');
  date(asOf, 'asOf');
  requireValue(history && typeof history === 'object', 'history is required');
  date(history.startDate, 'history.startDate');
  date(history.endDate, 'history.endDate');
  requireValue(history.startDate <= history.endDate && history.startDate <= asOf, 'invalid history coverage');
  requireValue(Array.isArray(history.transactions), 'history.transactions must be an array');
  requireValue(Number.isInteger(lookbackMonths) && lookbackMonths >= 2 && lookbackMonths <= 24, 'lookbackMonths must be 2–24');
  requireValue(Number.isInteger(baselineMonths) && baselineMonths >= 1 && baselineMonths < lookbackMonths, 'baselineMonths must be smaller than lookbackMonths');
  cents(minChangeCents, 'minChangeCents');
  requireValue(Number.isInteger(minChangePercent) && minChangePercent >= 0 && minChangePercent <= 100, 'minChangePercent must be 0–100');
  requireValue(Array.isArray(categoryPreferences), 'categoryPreferences must be an array');
  categoryPreferences.forEach((preference) => {
    identifier(preference.category, 'category');
    requireValue(baskets.includes(preference.basket), 'unknown category preference basket');
    requireValue(typeof preference.adjustable === 'boolean', 'category preference adjustable must be explicit');
  });
  unique(categoryPreferences.map((row) => row.category), 'category preferences');
  unique(history.transactions.map((row) => row.id), 'transaction ids');
  for (const row of history.transactions) {
    identifier(row.id);
    requireValue(row.customerId === customerId, 'history contains a different customer');
    identifier(row.accountId, 'accountId');
    identifier(row.category, 'category');
    date(row.date);
    requireValue(row.date >= history.startDate && row.date <= history.endDate, 'transaction is outside declared history coverage');
    requireValue(kinds.includes(row.kind), 'unknown transaction kind');
    cents(row.amountCents, 'transaction amountCents', { signed: true });
    if (row.kind === 'expense') requireValue(row.amountCents < 0, 'expenses must be negative');
    if (row.kind === 'income' || row.kind === 'refund') requireValue(row.amountCents > 0, 'income and refunds must be positive');
    if (row.balanceAfterCents !== undefined) cents(row.balanceAfterCents, 'balanceAfterCents', { signed: true });
  }

  const coveredThrough = history.endDate < asOf ? history.endDate : asOf;
  const months = [];
  let candidate = previousMonth(asOf.slice(0, 7));
  for (let index = 0; index < lookbackMonths; index++) {
    if (`${candidate}-01` >= history.startDate && monthEnd(candidate) <= coveredThrough) months.unshift(candidate);
    candidate = previousMonth(candidate);
  }
  const monthSet = new Set(months);
  const rows = history.transactions.filter((row) => row.date <= asOf && monthSet.has(row.date.slice(0, 7)));
  const categories = [...new Set(rows.filter((row) => ['expense', 'refund'].includes(row.kind)).map((row) => row.category))].sort();
  const monthly = months.map((month) => {
    const current = rows.filter((row) => row.date.slice(0, 7) === month);
    const incomeCents = sum(current.filter((row) => row.kind === 'income').map((row) => row.amountCents));
    const grossSpendingCents = sum(current.filter((row) => row.kind === 'expense').map((row) => -row.amountCents));
    const refundsCents = sum(current.filter((row) => row.kind === 'refund').map((row) => row.amountCents));
    const netSpendingCents = sum([grossSpendingCents, -refundsCents]);
    return { month, incomeCents, grossSpendingCents, refundsCents, netSpendingCents,
      incomeLessSpendingCents: sum([incomeCents, -netSpendingCents]),
      evidenceIds: current.filter((row) => ['income', 'expense', 'refund'].includes(row.kind)).map((row) => row.id) };
  });
  const categoryMonths = categories.flatMap((category) => months.map((month) => {
    const current = rows.filter((row) => row.category === category && row.date.slice(0, 7) === month && ['expense', 'refund'].includes(row.kind));
    const grossSpendingCents = sum(current.filter((row) => row.kind === 'expense').map((row) => -row.amountCents));
    const refundsCents = sum(current.filter((row) => row.kind === 'refund').map((row) => row.amountCents));
    return { month, category, grossSpendingCents, refundsCents,
      netSpendingCents: sum([grossSpendingCents, -refundsCents]), evidenceIds: current.map((row) => row.id) };
  }));
  const latest = monthly.at(-1);
  const reference = monthly.slice(0, -1).slice(-baselineMonths);
  const baseline = reference.map((row) => row.month);
  const insights = [];
  const noticeable = (change, previous) => Math.abs(change) >= minChangeCents
    && (previous === 0 || BigInt(Math.abs(change)) * 100n >= BigInt(Math.abs(previous)) * BigInt(minChangePercent));
  if (latest && latest.incomeLessSpendingCents < 0) {
    insights.push({ kind: 'spending_above_income', month: latest.month,
      amountCents: -latest.incomeLessSpendingCents, evidenceIds: latest.evidenceIds,
      explanation: `Recorded spending after refunds exceeded recorded income by ${money(-latest.incomeLessSpendingCents)} in ${latest.month}. This describes those transactions; it does not establish your available balance.`,
      suggestedAction: 'Review whether income or accounts are missing, and check upcoming commitments before setting a savings contribution.' });
  }
  if (latest && reference.length) {
    const typicalIncomeCents = average(reference.map((row) => row.incomeCents));
    const incomeChangeCents = sum([latest.incomeCents, -typicalIncomeCents]);
    if (incomeChangeCents < 0 && noticeable(incomeChangeCents, typicalIncomeCents)) {
      insights.push({ kind: 'income_decrease', month: latest.month, baselineMonths: baseline,
        currentCents: latest.incomeCents, baselineCents: typicalIncomeCents, changeCents: incomeChangeCents,
        evidenceIds: evidenceIds(rows.filter((row) => row.kind === 'income' && [latest.month, ...baseline].includes(row.date.slice(0, 7))).map((row) => row.id)),
        explanation: `Recorded income was ${money(latest.incomeCents)} in ${latest.month}, compared with an average of ${money(typicalIncomeCents)} across ${baseline.join(', ')}. Payment timing or a one-off change may explain the difference.`,
        suggestedAction: 'Confirm your next income amount and date before relying on the previous savings plan.' });
    }
  }
  const categoryComparisons = categories.map((category) => {
    const current = categoryMonths.find((row) => row.category === category && row.month === latest?.month);
    const earlier = categoryMonths.filter((row) => row.category === category && baseline.includes(row.month));
    if (!current || !earlier.length) return null;
    const baselineCents = average(earlier.map((row) => row.netSpendingCents));
    const changeCents = sum([current.netSpendingCents, -baselineCents]);
    return { category, month: latest.month, baselineMonths: baseline,
      currentCents: current.netSpendingCents, baselineCents, changeCents,
      evidenceIds: evidenceIds([...earlier.flatMap((row) => row.evidenceIds), ...current.evidenceIds]) };
  }).filter(Boolean).sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents) || a.category.localeCompare(b.category));
  for (const comparison of categoryComparisons) {
    if (!noticeable(comparison.changeCents, comparison.baselineCents) || comparison.changeCents === 0) continue;
    const preference = categoryPreferences.find((row) => row.category === comparison.category);
    const adjustable = preference?.basket === 'everyday' && preference.adjustable;
    insights.push({ ...comparison, kind: comparison.changeCents > 0 ? 'spending_increase' : 'spending_decrease',
      adjustable: Boolean(adjustable),
      explanation: `${comparison.category} spending after refunds was ${money(comparison.currentCents)} in ${comparison.month}, compared with an average of ${money(comparison.baselineCents)} across ${baseline.join(', ')}. That is ${money(Math.abs(comparison.changeCents))} ${comparison.changeCents > 0 ? 'higher' : 'lower'}.`,
      suggestedAction: adjustable
        ? 'Check the transactions and decide whether a different budget fits your priorities.'
        : comparison.changeCents < 0
          ? 'Check whether payment timing or a one-off expense explains the change. A lower historical total is not automatically extra money to spend.'
          : 'Inspect the transactions and decide whether the change is expected. No spending reduction is assumed.' });
  }
  const observedBalances = [...new Set(rows.map((row) => row.accountId))].map((accountId) => {
    const observations = rows.filter((row) => row.accountId === accountId && row.balanceAfterCents !== undefined)
      .sort((a, b) => a.balanceAfterCents - b.balanceAfterCents || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const minimum = observations[0];
    return minimum ? { accountId, minimumObservedCents: minimum.balanceAfterCents,
      date: minimum.date, evidenceIds: [minimum.id], observationCount: observations.length } : null;
  }).filter(Boolean);
  const spendingHistory = categoryMonths.flatMap((row) => {
    const preference = categoryPreferences.find((item) => item.category === row.category);
    return preference ? [{ month: row.month, category: row.category,
      spentCents: row.grossSpendingCents, basket: preference.basket, adjustable: preference.adjustable,
      evidenceIds: row.evidenceIds }] : [];
  });
  const excluded = rows.filter((row) => ['transfer', 'savings', 'investment', 'other'].includes(row.kind));
  return {
    customerId, asOf, coverage: { startDate: history.startDate, endDate: coveredThrough, completeMonths: months },
    monthly, categoryComparisons, insights, observedBalances, spendingHistory,
    incomeSummary: monthly.length ? { observedMonths: months.length,
      medianMonthlyCents: median(monthly.map((row) => row.incomeCents)),
      minimumMonthlyCents: Math.min(...monthly.map((row) => row.incomeCents)),
      maximumMonthlyCents: Math.max(...monthly.map((row) => row.incomeCents)),
      monthsWithoutRecordedIncome: monthly.filter((row) => row.incomeCents === 0).map((row) => row.month) } : null,
    dataQuality: { ignoredFutureTransactionCount: history.transactions.filter((row) => row.date > asOf).length,
      excludedMovementCount: excluded.length, unclassifiedCount: excluded.filter((row) => row.kind === 'other').length },
    method: { lookbackMonths, baselineMonths, minChangeCents, minChangePercent,
      budgetBasis: 'Gross consumption in complete months; refunds are reported separately and are not assumed to recur.' },
    limitations: [
      'Historical observations are not forecasts or a safe-to-spend estimate.',
      'Complete-month coverage is declared by the data adapter; missing accounts or records cannot be detected from transactions alone.',
      'Income less spending is not realized savings; transfers, savings movements, investments, and unclassified movements are excluded.',
      'Balance minima are observed after transactions for each account, not daily or combined-account minima.',
      ...(months.length < 4 ? ['Limited history: fewer than four complete months are available for comparison.'] : []),
      ...(months.at(-1) !== previousMonth(asOf.slice(0, 7)) ? ['History does not cover the most recent complete month; findings may be stale.'] : []),
      ...(excluded.some((row) => row.kind === 'other') ? ['Unclassified transactions were excluded; review their classification before relying on totals.'] : []),
    ],
  };
}
