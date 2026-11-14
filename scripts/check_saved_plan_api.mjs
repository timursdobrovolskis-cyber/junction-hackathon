// Real v2 engine + HTTP + durable SQLite. Test-only store is removed after the run.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFinancialPlan, previewFinancialPlanChange } from '../src/financial-coach-client.mjs';
import { loadCustomerPlan, saveCustomerPlan, selectRecoveryOption, reconcileCustomerPlan, reviewPaymentMatch, prepareProtectedCategory } from '../src/saved-plan-client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'coach-plans-'));
let processHandle, closed, options;
async function start() {
  processHandle = spawn('python3', ['scripts/run_financial_engine.py', '--serve', '--port', '0', '--plans-database', join(temp, 'plans.sqlite'), '--allow-origin', 'http://localhost:3000'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  closed = once(processHandle, 'close');
  processHandle.stderr.resume();
  options = { endpoint: await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Engine startup timed out')), 10000);
    let output = '';
    processHandle.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(`${match[0]}/api/plan`); }
    });
    processHandle.once('error', (error) => { clearTimeout(timer); reject(error); });
    processHandle.once('exit', () => { clearTimeout(timer); reject(new Error('Engine exited')); });
  }) };
}
async function stop() { if (processHandle) { processHandle.kill(); await closed; processHandle = null; } }
const assertSaved = (reply) => assert.equal(reply.status, 'saved', JSON.stringify({ error: reply.error, status: reply.status }));
try {
  await start();
  const request = JSON.parse(await readFile(new URL('../fixtures/financial-plan-request.json', import.meta.url), 'utf8'));
  const initial = await fetchFinancialPlan(request, options);
  const cost = { id: 'repair-200', date: '2026-10-07', amountCents: 20000, label: 'Car repair', category: 'Transportation', inclusion: 'additional' };
  const preview = await previewFinancialPlanChange(initial, { upcomingExpenses: [cost] }, undefined, options);
  assert.equal(preview.status, 'recalculated', preview.error);
  assert.equal(preview.coach.cashFlow.uncertainty.calibrationCoverageClaimApplies, false);
  assert.equal((await loadCustomerPlan(request.customerId, options)).status, 'no_saved_plan');
  for (let i = 0; i < initial.forecast.daily.length; i++) {
    const row = preview.engineResult.planScenario.daily[i];
    assert.equal(row.expectedBalanceCents, initial.forecast.daily[i].expectedBalanceCents - (row.date >= cost.date ? cost.amountCents : 0));
  }
  const payload = { ...request, plannedExpenses: [cost], minimumCategoryCents: { Groceries: 7990 } };
  const saved = await saveCustomerPlan(request.customerId, payload, { ...options, mutationId: 'save-repair' });
  assertSaved(saved);
  const retry = await saveCustomerPlan(request.customerId, payload, { ...options, mutationId: 'save-repair' });
  assert.equal(retry.revision, saved.revision);
  assert.equal(retry.state.plannedExpenses.length, 1);
  const recovery = saved.engineResult.alternatives.find((option) => option.available);
  assert.ok(recovery);
  const selected = await selectRecoveryOption(saved, recovery.id, { ...options, mutationId: 'choose-option' });
  assertSaved(selected);
  await stop(); await start();
  const loaded = await loadCustomerPlan(request.customerId, options);
  assert.deepEqual(loaded.state, selected.state);
  assert.equal(loaded.state.plannedExpenses[0].amountCents, 20000);
  assert.equal(loaded.state.selectedAlternative.id, recovery.id);
  assert.equal((await loadCustomerPlan('CUST00003', options)).status, 'no_saved_plan');
  const foreignUrl = new URL(options.endpoint); foreignUrl.pathname = '/api/customers/CUST00003/plan/select';
  const foreign = await fetch(foreignUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId: loaded.planId, expectedRevision: loaded.revision, mutationId: 'foreign', optionId: recovery.id }) });
  assert.equal(foreign.status, 404);
  foreignUrl.pathname = `/api/customers/${request.customerId}/plan`;
  assert.equal((await fetch(foreignUrl, { headers: { Origin: 'http://example.com' } } )).status, 403);
  await assert.rejects(fetchFinancialPlan({ ...request, plannedExpenses: [{ ...cost, accountId: 'ACC000001' }] }, options), /account does not belong/);
  const stale = await saveCustomerPlan(request.customerId, payload, { ...options, savedPlan: saved, mutationId: 'stale' });
  assert.equal(stale.status, 'revision_conflict');
  assert.deepEqual(stale.engineResult, saved.engineResult);
  const failed = await saveCustomerPlan(request.customerId, { ...loaded.state.request, categoryOverrides: { Housing: 0 } },
    { ...options, savedPlan: loaded, mutationId: 'invalid-override' });
  assert.equal(failed.status, 'save_failed');
  assert.equal(failed.pendingMutation.request.categoryOverrides.Housing, 0);
  assert.deepEqual((await loadCustomerPlan(request.customerId, options)).state, loaded.state);
  const protectedPlan = prepareProtectedCategory(loaded, { category: 'Entertainment', reason: 'Time with friends matters to me' });
  const priority = await saveCustomerPlan(request.customerId, protectedPlan.request,
    { ...options, savedPlan: loaded, mutationId: 'priority', priorityNotes: protectedPlan.priorityNotes });
  assertSaved(priority);
  assert.equal((await loadCustomerPlan(request.customerId, options)).coach.priorities[0].reason, 'Time with friends matters to me');

  // Select real September observations; never invent October sponsor transactions.
  const cases = JSON.parse(execFileSync('python3', ['-c', `
import json,sqlite3
from src.planned_expenses import normalize_expenses,reconcile
db=sqlite3.connect('file:data/local/bank.sqlite?mode=ro',uri=True);db.row_factory=sqlite3.Row
result={}
for customer in ['CUST00001','CUST00003']:
 rows=[dict(r) for r in db.execute("SELECT * FROM transactions WHERE customer_id=? AND date BETWEEN '2026-09-01' AND '2026-09-20' ORDER BY date,source_row",(customer,))]
 for t in rows:
  if t['amount_cents']>=0:continue
  raw=dict(id='observed-payment',date=t['date'],amountCents=-t['amount_cents'],category=t['category'],accountId=t['account_id'],inclusion='additional')
  if t['merchant_id']:raw['merchantId']=t['merchant_id']
  expense=normalize_expenses([raw],customer,'2026-08-31')
  matched,reviews,_=reconcile(expense,rows,t['date'])
  kind='clear' if matched[0]['status']=='matched' else 'ambiguous' if not t['merchant_id'] and reviews else None
  if kind and kind not in result:result[kind]=dict(customerId=customer,expense=raw,cutoff=t['date'],transactionId=t['transaction_id'])
print(json.dumps(result))
`], { cwd: root, encoding: 'utf8' }));
  assert.ok(cases.clear && cases.ambiguous);
  // These use different customers or a fresh plan store to keep replays isolated.
  for (const [kind, replay] of Object.entries(cases)) {
    const existing = await loadCustomerPlan(replay.customerId, options);
    if (existing.status !== 'no_saved_plan') {
      // Restart with a separate durable store for the next deterministic historical replay.
      await stop();
      await rm(join(temp, 'plans.sqlite'));
      await start();
    }
    const r = { ...request, customerId: replay.customerId, asOf: '2026-08-31', plannedExpenses: [replay.expense] };
    const before = await saveCustomerPlan(replay.customerId, r, { ...options, mutationId: `record-${kind}` });
    assertSaved(before);
    const reconciled = await reconcileCustomerPlan(before, replay.cutoff, { ...options, mutationId: `reconcile-${kind}` });
    assertSaved(reconciled);
    if (kind === 'clear') {
      assert.equal(reconciled.state.plannedExpenses[0].status, 'matched');
      assert.equal(reconciled.state.plannedExpenses[0].matchedTransactionId, replay.transactionId);
      assert.equal(reconciled.engineResult.planScenario.lockedCommitments.length, 0);
      assert.equal(reconciled.engineResult.planScenario.startingBalanceCents, reconciled.engineResult.forecast.startingBalanceCents);
      const repeat = await reconcileCustomerPlan(reconciled, replay.cutoff, { ...options, mutationId: 'repeat-match' });
      assertSaved(repeat);
      assert.equal(repeat.engineResult.matchingDecisions.length, 0);
    } else {
      assert.equal(reconciled.state.plannedExpenses[0].status, 'planned');
      assert.ok(reconciled.engineResult.matchingReviews.length);
      assert.equal(reconciled.engineResult.savings.status, 'withheld');
      const confirmed = await reviewPaymentMatch(reconciled,
        [{ expenseId: replay.expense.id, transactionId: replay.transactionId, action: 'confirm' }], { ...options, mutationId: 'confirm-match' });
      assertSaved(confirmed);
      assert.equal(confirmed.state.plannedExpenses[0].status, 'matched');
      const undone = await reviewPaymentMatch(confirmed,
        [{ expenseId: replay.expense.id, transactionId: replay.transactionId, action: 'undo' }], { ...options, mutationId: 'undo-match' });
      assertSaved(undone);
      assert.equal(undone.state.plannedExpenses[0].status, 'planned');
      assert.equal(undone.engineResult.savings.status, 'withheld');
    }
  }
  console.log('Saved-plan HTTP checks passed: real v2 calculation, €200 once, preview isolation, idempotent save, process restart, recovery selection, stale edits, failed saves, remembered priorities, real September auto-match, ambiguous review, confirmation and undo.');
} finally {
  await stop();
  await rm(temp, { recursive: true, force: true });
}
