import { readFile } from 'node:fs/promises';
import { fetchFinancialPlan, createFinancialCoachResponse } from '../src/financial-coach-client.mjs';

// Read-only previews: this demo never persists a customer choice.
const requests = JSON.parse(await readFile(new URL('../fixtures/saved-plan-requests.json', import.meta.url), 'utf8'));
const outputs = [];
for (const name of ['feasible', 'twoRecoveryOptions', 'neitherOptionFits']) {
  const result = await fetchFinancialPlan(requests[name]);
  outputs.push({ name, coach: createFinancialCoachResponse(result) });
}
if (process.argv.includes('--json')) console.log(JSON.stringify(outputs, null, 2));
else {
  for (const { name, coach } of outputs) {
    console.log(`\n${name} — ${coach.customerId}\n${coach.insight.explanation}`);
    console.log(`Locked known expenses: ${coach.lockedCommitments.map((e) => `${e.label}: ${e.amountCents} cents on ${e.date}`).join(', ')}`);
    for (const option of coach.alternatives) {
      console.log(`${option.title}\n${option.explanation}${option.reason ? ` ${option.reason}` : ''}`);
      if (option.available) for (const change of option.categoryChanges.filter((c) => c.changeCents !== 0)) console.log(change.explanation);
    }
  }
  console.log('\nNo option was selected or saved. To verify save/restart/matching, run npm run check:saved-plans.');
}
