import { readFile } from 'node:fs/promises';
import { createBudgetCoachResponse } from '../src/budget-coach.mjs';
import { previewBudgetChange } from '../src/budget-engine-client.mjs';

const { examples } = JSON.parse(await readFile(new URL('../fixtures/budget-demo.json', import.meta.url), 'utf8'));
const customers = examples.map(createBudgetCoachResponse);
const edited = await previewBudgetChange(examples[3], { categoryOverrides: { Entertainment: 20509 } });
if (edited.status !== 'recalculated') throw new Error(edited.error ?? edited.message);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ customers, categoryEdit: edited }, null, 2));
} else {
  for (const customer of customers) {
    console.log(`\n${customer.customerId} — ${customer.status}\n${customer.insight.title}\n${customer.insight.explanation}`);
    if (customer.followUp) console.log(`Question: ${customer.followUp.question}`);
    console.log(`Evidence: ${customer.evidence.ids.slice(0, 3).join(', ')} (${customer.evidence.ids.length} transactions available)`);
  }
  const after = edited.engineResult.budget;
  console.log('\nCUST00005 — real engine recalculation: Entertainment changed to €205.09');
  for (const name of ['Entertainment', 'Lifestyle']) {
    const before = examples[3].budget.categories.find((c) => c.category === name);
    const next = after.categories.find((c) => c.category === name);
    console.log(`${name}: ${before.previewLimitCents} → ${next.previewLimitCents} cents`);
  }
  console.log(`New engine total: ${after.totalPlannedSpendingCents} cents. Status: ${after.status}.`);
  console.log('The original forecast is preserved. This is a conditional budget preview; no money moved.');
}
