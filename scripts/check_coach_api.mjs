// Real-data integration check. Requires data/local/bank.sqlite; never runs from npm test.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createFinancialCoachResponse, fetchFinancialPlan, previewFinancialPlanChange } from '../src/financial-coach-client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await access(new URL('../data/local/bank.sqlite', import.meta.url));
const server = spawn('python3', ['scripts/run_financial_engine.py', '--serve', '--port', '0', '--allow-origin', 'http://localhost:3000'],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const stopped = once(server, 'close');
server.stderr.resume();
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local engine did not start')), 10000);
    let output = '';
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(`${match[0]}/api/plan`); }
    });
    server.once('error', (error) => { clearTimeout(timer); reject(error); });
    server.once('exit', () => { clearTimeout(timer); reject(new Error('Local engine exited before startup')); });
  });
  const options = { endpoint };
  const fixture = JSON.parse(await readFile(new URL('../fixtures/financial-plan-demo.json', import.meta.url), 'utf8'));
  const request = JSON.parse(await readFile(new URL('../fixtures/financial-plan-request.json', import.meta.url), 'utf8'));
  const initial = await fetchFinancialPlan(request, options);
  assert.deepEqual(initial, fixture);
  for (const [customerId, status] of [['CUST00001', 'infeasible'], ['CUST00002', 'infeasible'], ['CUST00003', 'needs_confirmation'], ['CUST00005', 'needs_confirmation']]) {
    const plan = await fetchFinancialPlan({ ...request, customerId }, options);
    const coach = createFinancialCoachResponse(plan);
    assert.equal(coach.budget.status, status);
    assert.equal(coach.budget.evidence.unresolvedIds.length, 0);
  }
  const edit = await previewFinancialPlanChange(initial, { categoryOverrides: { Entertainment: 20509 } }, undefined, options);
  assert.equal(edit.status, 'recalculated');
  const adjustment = JSON.parse(await readFile(new URL('../fixtures/budget-adjustment-demo.json', import.meta.url), 'utf8'));
  assert.deepEqual(edit.engineResult.budget, adjustment.after);
  const again = await previewFinancialPlanChange(edit.engineResult, { savingsConfirmed: false }, edit.inputs, options);
  assert.deepEqual(again.engineResult, edit.engineResult);

  const target = await previewFinancialPlanChange(initial, { savingsTargetCents: 40000, savingsConfirmed: true }, undefined, options);
  assert.equal(target.status, 'recalculated');
  assert.equal(target.engineResult.budget.totalPlannedSpendingCents, 149399);
  assert.equal(target.coach.followUp.kind, 'check_commitments');
  assert.match(target.coach.insight.explanation, /pending confirmation of upcoming expenses/);
  const confirmed = await previewFinancialPlanChange(target.engineResult, { commitmentsConfirmed: true }, target.inputs, options);
  assert.equal(confirmed.engineResult.budget.status, 'conditional_plan');
  assert.equal(confirmed.engineResult.savings.status, 'conditional_estimate');

  const buffer = await previewFinancialPlanChange(confirmed.engineResult, { bufferCents: 60000 }, confirmed.inputs, options);
  assert.equal(buffer.status, 'recalculated');
  assert.equal(buffer.engineResult.forecast.bufferCents, 60000);
  assert.equal(buffer.engineResult.savings.bufferCents, 60000);
  assert.equal(buffer.engineResult.budget.bufferCents, 60000);
  assert.equal(buffer.engineResult.budget.savingsConfirmed, false);
  const costs = await previewFinancialPlanChange(buffer.engineResult, { upcomingExpenses: [{ id: 'trip', date: '2026-12-01', amountCents: 12000, inclusion: 'additional', label: 'Trip' }] }, buffer.inputs, options);
  assert.equal(costs.status, 'recalculated');
  assert.equal(costs.engineResult.savings.reservedFutureCostsCents, 12000);
  assert.equal(costs.engineResult.budget.futureCostReserveCents, 12000);
  const infeasible = await previewFinancialPlanChange(initial, { savingsTargetCents: 10000000 }, undefined, options);
  assert.equal(infeasible.status, 'recalculated');
  assert.equal(infeasible.coach.budget.status, 'infeasible');
  const failure = await previewFinancialPlanChange(initial, { categoryOverrides: { Housing: 0 } }, undefined, options);
  assert.equal(failure.status, 'recalculation_failed');
  assert.deepEqual(failure.engineResult, initial);
  console.log('Coach HTTP checks passed: committed fixture, four customers, exact category edit, repeated edits, €400 target, confirmations, shared buffer, shared reserves, infeasible plan, and preserved output on API error.');
} finally {
  server.kill();
  await stopped;
}
