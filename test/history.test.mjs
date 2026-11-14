import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeTransactionHistory } from '../src/history.mjs';
import { euroStringToCents, normalizeSBankTransaction, profilesFromSBankExtract } from '../src/sbank.mjs';
import { createCoachAction, calculateRecoveryScenario } from '../src/planning.mjs';

function input() {
  const months = ['2026-06', '2026-07', '2026-08', '2026-09'];
  const transactions = months.flatMap((month) => [
    { id: `income-${month}`, customerId: 'one', accountId: 'account', date: `${month}-01`, category: 'Salary', kind: 'income', amountCents: 100000, balanceAfterCents: 150000 },
    { id: `rent-${month}`, customerId: 'one', accountId: 'account', date: `${month}-02`, category: 'Housing', kind: 'expense', amountCents: -40000, balanceAfterCents: 110000 },
    { id: `food-${month}`, customerId: 'one', accountId: 'account', date: `${month}-10`, category: 'Groceries', kind: 'expense', amountCents: month === '2026-09' ? -20000 : -10000, balanceAfterCents: month === '2026-09' ? 90000 : 100000 },
  ]);
  transactions.push({ id: 'refund', customerId: 'one', accountId: 'account', date: '2026-09-15', category: 'Groceries', kind: 'refund', amountCents: 1000 });
  return { customerId: 'one', asOf: '2026-10-01', history: { startDate: '2026-06-01', endDate: '2026-09-30', transactions } };
}

function profile(data = input()) {
  return { customerId: data.customerId, asOf: data.asOf, currency: 'EUR', dataSource: 'illustrative_fixture',
    assumptions: ['Complete synthetic test history for one account.'], missingInputs: [],
    transactionHistory: data.history, categoryPreferences: data.categoryPreferences ?? [] };
}

test('calculates historical spending changes from complete months with transaction evidence', () => {
  const data = input();
  const before = structuredClone(data);
  const result = analyzeTransactionHistory(data);
  assert.equal(result.monthly.at(-1).netSpendingCents, 59000);
  assert.equal(result.monthly.at(-1).incomeLessSpendingCents, 41000);
  const change = result.insights.find((row) => row.category === 'Groceries');
  assert.equal(change.kind, 'spending_increase');
  assert.equal(change.baselineCents, 10000);
  assert.equal(change.currentCents, 19000);
  assert.equal(change.changeCents, 9000);
  assert.deepEqual(change.baselineMonths, ['2026-06', '2026-07', '2026-08']);
  assert.deepEqual(new Set(change.evidenceIds), new Set(['food-2026-06', 'food-2026-07', 'food-2026-08', 'food-2026-09', 'refund']));
  assert.equal(change.adjustable, false);
  assert.deepEqual(data, before);
});

test('transfers, investments, savings, and unknown movements do not inflate income or consumption', () => {
  const data = input();
  const original = analyzeTransactionHistory(data).monthly;
  for (const kind of ['transfer', 'investment', 'savings', 'other']) {
    data.history.transactions.push({ id: kind, customerId: 'one', accountId: 'account', date: '2026-09-21', category: kind, kind, amountCents: 700000 });
  }
  const result = analyzeTransactionHistory(data);
  assert.deepEqual(result.monthly, original);
  assert.equal(result.dataQuality.excludedMovementCount, 4);
  assert.equal(result.dataQuality.unclassifiedCount, 1);
  assert.ok(result.limitations.some((text) => text.startsWith('Unclassified')));
});

test('future transactions cannot affect historical advice', () => {
  const data = input();
  const original = analyzeTransactionHistory(data);
  data.history.endDate = '2026-10-31';
  data.history.transactions.push({ id: 'future', customerId: 'one', accountId: 'account', date: '2026-10-02', category: 'Salary', kind: 'income', amountCents: 9000000 });
  const result = analyzeTransactionHistory(data);
  assert.deepEqual(result.monthly, original.monthly);
  assert.deepEqual(result.insights, original.insights);
  assert.equal(result.dataQuality.ignoredFutureTransactionCount, 1);
});

test('partial months are excluded and stale coverage is disclosed', () => {
  const data = input();
  data.history.startDate = '2026-06-15';
  data.history.endDate = '2026-09-15';
  data.history.transactions = data.history.transactions.filter((row) => row.date >= data.history.startDate && row.date <= data.history.endDate);
  const result = analyzeTransactionHistory(data);
  assert.deepEqual(result.coverage.completeMonths, ['2026-07', '2026-08']);
  assert.ok(result.limitations.some((text) => text.includes('stale')));
  assert.ok(result.limitations.some((text) => text.startsWith('Limited history')));
});

test('a zero-spend month is counted only inside declared complete coverage', () => {
  const data = input();
  data.history.transactions = data.history.transactions.filter((row) => row.id !== 'food-2026-07');
  assert.equal(analyzeTransactionHistory(data).categoryComparisons.find((row) => row.category === 'Groceries').baselineCents, 6667);
});

test('income drops change the coach action without inventing a new forecast', () => {
  const data = input();
  data.history.transactions.find((row) => row.id === 'income-2026-09').amountCents = 70000;
  const card = createCoachAction(profile(data));
  assert.equal(card.action.kind, 'review_history');
  assert.equal(card.action.insightKind, 'income_decrease');
  assert.match(card.action.explanation, /€700.00/);
  assert.match(card.action.suggestedAction, /next income amount and date/);
  assert.equal(card.plan, undefined);
  assert.equal(card.historicalAnalysis.incomeSummary.medianMonthlyCents, 100000);
});

test('spending above recorded income takes priority over an optional category adjustment', () => {
  const data = input();
  data.history.transactions.find((row) => row.id === 'income-2026-09').amountCents = 30000;
  const card = createCoachAction(profile(data));
  assert.equal(card.action.insightKind, 'spending_above_income');
  assert.equal(card.historicalAnalysis.insights[0].amountCents, 29000);
  assert.ok(card.evidenceIds.includes('income-2026-09'));
});

test('observed balance minima stay separate for each account', () => {
  const data = input();
  data.history.transactions.push({ id: 'second-account', customerId: 'one', accountId: 'second', date: '2026-09-12', category: 'Transfer', kind: 'transfer', amountCents: -100, balanceAfterCents: -500 });
  const balances = analyzeTransactionHistory(data).observedBalances;
  assert.equal(balances.find((row) => row.accountId === 'account').minimumObservedCents, 90000);
  assert.equal(balances.find((row) => row.accountId === 'second').minimumObservedCents, -500);
  assert.deepEqual(balances.find((row) => row.accountId === 'second').evidenceIds, ['second-account']);
});

test('history-derived budgets require explicit category choices and keep refunds separate', () => {
  const data = input();
  assert.deepEqual(analyzeTransactionHistory(data).spendingHistory, []);
  data.categoryPreferences = [{ category: 'Groceries', basket: 'mandatory_irregular', adjustable: false }];
  const card = createCoachAction(profile(data), { reductionPercent: 20 });
  assert.equal(card.categoryBudgets[0].baselineCents, 12500);
  assert.equal(card.categoryBudgets[0].estimatedReductionCents, 0);
  assert.equal(card.historicalAnalysis.categoryComparisons[0].currentCents, 19000);
});

test('history cannot overwrite explicit budget aggregates or their protected classification', () => {
  const p = profile();
  p.categoryPreferences = [{ category: 'Groceries', basket: 'everyday', adjustable: true }];
  p.spendingHistory = [{ month: '2026-09', category: 'Groceries', spentCents: 8000, basket: 'mandatory_regular', adjustable: false }];
  const card = createCoachAction(p, { reductionPercent: 20 });
  assert.equal(card.categoryBudgets[0].baselineCents, 8000);
  assert.equal(card.historicalAnalysis.insights[0].adjustable, false);
  assert.match(card.action.suggestedAction, /No spending reduction/);
});

test('history-derived customer corrections protect recovery previews as well as cards', () => {
  const data = input();
  data.history.transactions = data.history.transactions.map((row) => ({ ...row, category: row.category === 'Groceries' ? 'delivery' : row.category }));
  const p = profile(data);
  p.goal = { label: 'Trip', savedCents: 0, targetCents: 10000, targetDate: '2026-10-31' };
  p.periods = [{ month: '2026-10', availableToSaveCents: 5000, plannedDeliveryCents: 5000 }];
  p.deliveryHistory = [{ id: 'delivery-evidence', date: '2026-09-10', amountCents: 1000 }];
  p.categoryPreferences = [{ category: 'delivery', basket: 'everyday', adjustable: true }];
  p.deliveryAdjustable = false;
  const card = createCoachAction(p, { reductionPercent: 20 });
  assert.equal(card.plan.recoveryBlockedReason, 'delivery_protected');
  assert.equal(card.historicalAnalysis.insights[0].adjustable, false);
  assert.equal(calculateRecoveryScenario(p), null);
});

test('no complete month returns a focused missing-history response', () => {
  const data = input();
  data.history = { startDate: '2026-09-15', endDate: '2026-09-30', transactions: [] };
  const card = createCoachAction(profile(data));
  assert.equal(card.action.kind, 'insufficient_history');
  assert.equal(card.historicalAnalysis.incomeSummary, null);
});

test('a stable history returns a factual summary instead of inventing a problem', () => {
  const data = input();
  data.history.transactions = data.history.transactions.filter((row) => row.kind !== 'refund');
  data.history.transactions.find((row) => row.id === 'food-2026-09').amountCents = -10000;
  assert.equal(createCoachAction(profile(data)).action.kind, 'history_summary');
});

test('historical coaching explains comparison limits and keeps education optional', () => {
  const p = profile();
  assert.equal(createCoachAction(p).learning.concept, 'Patterns are clues, not predictions');
  assert.equal(createCoachAction(p, { directAnswer: true }).learning, undefined);
});

for (const [name, mutate, pattern] of [
  ['cross-customer records', (data) => { data.history.transactions[0].customerId = 'another'; }, /different customer/],
  ['duplicate records', (data) => { data.history.transactions.push(data.history.transactions[0]); }, /unique/],
  ['wrong expense sign', (data) => { data.history.transactions[1].amountCents = 100; }, /negative/],
  ['invalid date', (data) => { data.history.transactions[0].date = '2026-06-31'; }, /calendar/],
  ['unknown movement kind', (data) => { data.history.transactions[0].kind = 'random'; }, /unknown transaction/],
  ['rows outside coverage', (data) => { data.history.startDate = '2026-06-02'; }, /outside declared/],
]) {
  test(`rejects ${name}`, () => { const data = input(); mutate(data); assert.throws(() => analyzeTransactionHistory(data), pattern); });
}

test('decimal parsing preserves cents and rejects ambiguous input', () => {
  assert.equal(euroStringToCents('-27.32'), -2732);
  assert.equal(euroStringToCents('3080.7'), 308070);
  assert.equal(euroStringToCents('0.29'), 29);
  for (const value of ['1.001', '1e3', '12,50', '', '90071992547409.92']) assert.throws(() => euroStringToCents(value));
});

test('S-Bank normalization preserves provenance and separates financial movements', () => {
  const row = { customer_id: 'one', bank_account_id: 'account', tx_date: '2026-09-10', category: 'Groceries', tx_amount_eur: '-10.99', balance_after_eur: '100.01', transaction_type: 'purchase', merchant_id: '' };
  const source = { sourceSha256: 'a'.repeat(64), sourceRow: 2 };
  const normalized = normalizeSBankTransaction(row, source);
  assert.equal(normalized.amountCents, -1099);
  assert.equal(normalized.balanceAfterCents, 10001);
  assert.equal(normalized.id, `sbank:${'a'.repeat(64)}:2`);
  assert.equal(normalized.merchantId, undefined);
  assert.equal(normalizeSBankTransaction({ ...row, transaction_type: 'salary_sweep' }, source).kind, 'transfer');
  assert.equal(normalizeSBankTransaction({ ...row, category: 'Invest Deposit', transaction_type: 'investment_deposit' }, source).kind, 'investment');
  assert.equal(normalizeSBankTransaction({ ...row, category: 'Invest Deposit' }, source).kind, 'other');
  assert.equal(normalizeSBankTransaction({ ...row, tx_amount_eur: '10.99' }, source).kind, 'refund');
});

test('organizer data extracts produce coach insights with resolvable source rows', async () => {
  const extract = JSON.parse(await readFile(new URL('../fixtures/sbank-history-extract.json', import.meta.url)));
  assert.equal(extract.source.sha256, '49b3265d8e44e751de305a074dcffcda732bb79aa1e07b46fcca774ce76f1e63');
  // Independently cross-checked against the source CSV using Python Decimal totals.
  const expected = {
    CUST00001: { income: [219484, 224289, 240831, 244781], spending: [159194, 235443, 254189, 187866], excluded: 4 },
    CUST00002: { income: [150488, 170445, 154921, 157242], spending: [187273, 222256, 161197, 68450], excluded: 0 },
  };
  for (const p of profilesFromSBankExtract(extract)) {
    const card = createCoachAction(p);
    assert.equal(card.asOf, '2026-10-01');
    assert.deepEqual(card.historicalAnalysis.coverage.completeMonths, ['2026-06', '2026-07', '2026-08', '2026-09']);
    assert.equal(card.dataSource, 'historical_bank_data');
    assert.ok(card.historicalAnalysis.insights.length > 0);
    const ids = new Set(p.transactionHistory.transactions.map((row) => row.id));
    assert.ok(card.evidenceIds.every((id) => ids.has(id)));
    assert.equal(card.historicalAnalysis.dataQuality.excludedMovementCount, expected[p.customerId].excluded);
    assert.deepEqual(card.historicalAnalysis.monthly.map((row) => row.incomeCents), expected[p.customerId].income);
    assert.deepEqual(card.historicalAnalysis.monthly.map((row) => row.netSpendingCents), expected[p.customerId].spending);
  }
});
