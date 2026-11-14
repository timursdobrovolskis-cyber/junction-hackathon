import { readFile } from 'node:fs/promises';
import { createFinancialCoachResponse, fetchFinancialPlan, previewFinancialPlanChange } from '../src/financial-coach-client.mjs';

const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const request = await read('../fixtures/financial-plan-request.json');
const fixtureOnly = process.argv.includes('--fixture');
const result = fixtureOnly ? await read('../fixtures/financial-plan-demo.json') : await fetchFinancialPlan(request);
const coach = createFinancialCoachResponse(result);
const edit = fixtureOnly ? null : await previewFinancialPlanChange(result, { savingsTargetCents: 40000, savingsConfirmed: true });
if (edit && edit.status !== 'recalculated') throw new Error(edit.error ?? edit.message);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ source: fixtureOnly ? 'committed_fixture' : 'live_local_api', coach, edit }, null, 2));
} else {
  console.log(fixtureOnly ? 'Saved sample response (no live recalculation)' : 'Live local API: forecast, savings and budget received together');
  console.log(`\n${coach.customerId}: ${coach.insight.title}\n${coach.insight.explanation}`);
  if (coach.followUp) console.log(`Question: ${coach.followUp.question}`);
  if (edit) {
    console.log(`\nAfter choosing a €400 savings target:\n${edit.coach.insight.explanation}`);
    if (edit.coach.followUp) console.log(`Question: ${edit.coach.followUp.question}`);
  }
}
