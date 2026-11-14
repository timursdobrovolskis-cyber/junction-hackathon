import { readFile } from 'node:fs/promises';
import { calculatePurchaseScenario, calculateRecoveryScenario, createCoachAction } from '../src/planning.mjs';

const profiles = JSON.parse(await readFile(new URL('../fixtures/planning-profiles.json', import.meta.url)));
for (const profile of profiles) {
  console.log(JSON.stringify(createCoachAction(profile), null, 2));
}
console.log(JSON.stringify(calculateRecoveryScenario(profiles[0]), null, 2));
console.log(JSON.stringify(calculatePurchaseScenario(profiles[0], {
  id: 'demo-weekend-trip', date: '2026-12-05', amountCents: 20000,
}), null, 2));
