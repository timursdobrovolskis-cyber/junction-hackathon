import { readFile } from 'node:fs/promises';
import { profilesFromSBankExtract } from '../src/sbank.mjs';
import { createCoachAction } from '../src/planning.mjs';

const file = process.argv[2] ?? new URL('../fixtures/sbank-history-extract.json', import.meta.url);
const extract = JSON.parse(await readFile(file, 'utf8'));
const money = (value) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value / 100);
for (const profile of profilesFromSBankExtract(extract)) {
  const result = createCoachAction(profile);
  console.log(`\n${profile.customerId} — historical synthetic data, reference ${profile.asOf}`);
  console.log(result.action.title);
  console.log(result.action.explanation);
  console.log(result.action.suggestedAction);
  console.log('\nOther observations:');
  for (const insight of result.historicalAnalysis.insights.filter((item) => item.explanation !== result.action.explanation).slice(0, 3)) console.log(`- ${insight.explanation}`);
  const income = result.historicalAnalysis.incomeSummary;
  if (income) console.log(`\nRecorded monthly income: median ${money(income.medianMonthlyCents)}, range ${money(income.minimumMonthlyCents)}–${money(income.maximumMonthlyCents)}.`);
  for (const balance of result.historicalAnalysis.observedBalances) {
    console.log(`${balance.accountId}: lowest observed post-transaction balance ${money(balance.minimumObservedCents)} on ${balance.date}.`);
  }
  console.log(`\nComplete months: ${result.historicalAnalysis.coverage.completeMonths.join(', ')}`);
  console.log(`Excluded financial movements: ${result.historicalAnalysis.dataQuality.excludedMovementCount}`);
  console.log(`Supporting transaction references for main action: ${result.evidenceIds.length}`);
}
