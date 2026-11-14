import { readFileSync } from 'node:fs';
import { calculateGoalPlan } from '../server/goals/coach.mjs';
const fixture = JSON.parse(readFileSync(new URL('../server/goals/fixture.json', import.meta.url)));
export function growthIllustration(monthlyCents, years, annualRate) {
  if (!Number.isSafeInteger(monthlyCents) || monthlyCents < 0 || monthlyCents > 1000000
    || !Number.isInteger(years) || years < 2 || years > 40 || !Number.isFinite(annualRate) || annualRate < -0.1 || annualRate > 0.1) throw new Error('Invalid assumption');
  let projectedCents = 0;
  for (let m = 0; m < years * 12; m++) projectedCents = Math.round(projectedCents * (1 + annualRate / 12) + monthlyCents);
  return { monthlyCents, years, annualRate, contributedCents: monthlyCents * years * 12, projectedCents };
}
export default function goals(req, res) {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(405, { error: 'Use GET' }); }
  const query = new URL(req.url, 'http://localhost').searchParams;
  const scenario = query.get('scenario') ?? 'afterExpense';
  if (!Object.hasOwn(fixture.scenarios, scenario)) return send(400, { error: 'Unknown goal scenario' });
  const calculate = name => calculateGoalPlan({ goal: fixture.goal, periods: fixture.periods, deliveryHistory: fixture.deliveryHistory, newExpenses: fixture.scenarios[name].newExpenses });
  try {
    const result = calculate(scenario);
    const averageContribution = Math.max(0, Math.round(result.breakdown.reduce((sum, row) => sum + row.projectedContributionCents, 0) / fixture.periods.length));
    const monthlyCents = query.has('monthly') ? Number(query.get('monthly')) : averageContribution;
    const years = query.has('years') ? Number(query.get('years')) : fixture.longTermGoal.horizonYears;
    const annualRate = query.has('rate') ? Number(query.get('rate')) : fixture.longTermGoal.annualReturnAssumption;
    return send(200, { scenario, goal: fixture.goal, asOf: fixture.asOf, result, baseline: calculate('beforeExpense'),
      evidence: [...fixture.scenarios[scenario].newExpenses, ...fixture.deliveryHistory],
      growth: growthIllustration(monthlyCents, years, annualRate), movesMoney: false,
      dataNotice: 'Savings sample · separate from the Home and calendar profiles.',
      assumptions: 'Long-term contributions are hypothetical and separate from the trip plan, not extra money available to invest. Returns vary and can be negative; fees, tax and inflation are excluded. No transfer or investment is enabled.' });
  } catch { return send(400, { error: 'Choose a monthly amount from €0 to €10,000, 2–40 years and an annual assumption between −10% and 10%.' }); }
}
