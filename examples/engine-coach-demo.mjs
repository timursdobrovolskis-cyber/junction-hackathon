import { readFile } from 'node:fs/promises';
import { createEngineCoachResponse, captureCoachInputs } from '../src/engine-coach.mjs';

const { examples } = JSON.parse(await readFile(new URL('../fixtures/savings-demo.json', import.meta.url)));
const responses = examples.map((example) => createEngineCoachResponse(example));
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(responses, null, 2));
} else {
  for (const response of responses) {
    console.log(`\n${response.customerId} — historical reference ${response.asOf}`);
    console.log(response.insight.title);
    console.log(response.insight.explanation);
    console.log(response.uncertainty.message);
    console.log(`Question: ${response.followUp.prompt}`);
    console.log(`Supporting transactions: ${response.evidence.transactionIds.length}`);
  }
  const pending = captureCoachInputs(examples[0], {
    bufferCents: 75000,
    upcomingExpenses: [{ id: 'customer-repair', label: 'Repair', date: '2026-10-20', amountCents: 15000, inclusion: 'additional' }],
  });
  console.log('\nExample customer answer: keep €750 and add a €150 repair.');
  console.log(pending.message);
  console.log(`State: ${pending.status}. Engine blockers: ${pending.engineRequest.blockers.join(', ')}.`);
}
