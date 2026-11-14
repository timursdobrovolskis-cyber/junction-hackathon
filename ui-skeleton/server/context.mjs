import { readFileSync } from 'node:fs';
import { account } from './account.mjs';
import { createFinancialCoachResponse } from './coach/financial-coach-client.mjs';

const result = JSON.parse(readFileSync(new URL('./coach/financial-plan-demo.json', import.meta.url)));
const coach = createFinancialCoachResponse(result);
export const contexts = {
  design: {
    id: 'design', label: 'Current plan', source: 'Sample data · November 2026.',
    title: 'Your essentials have their own space.',
    explanation: '€240 is set aside for bills, €160 for savings and €300 as a cash buffer. You have €640 left until your expected payday on 28 November.',
    question: 'What would you like to understand about this plan?',
    facts: [{label:'Spending room',value:'€640'}, {label:'Planned savings',value:'€160'}, {label:'Cash buffer',value:'€300'}],
    details: ['Opening balance: €1,340.', 'Bills: €240. Savings: €160. Buffer: €300. Spending: €640.', 'Expected payday: 28 November. Bills, savings and buffer are excluded from spending room.'],
  },
  engine: {
    id: 'engine', label: 'Another profile', source: 'Synthetic customer CUST00005. Transactions through 30 Sep 2026; plan for 1–30 Oct. Separate from the Home example.',
    title: 'A draft plan, ready to explore.', explanation: coach.insight.explanation,
    question: coach.followUp?.question ?? coach.followUp?.prompt,
    facts: [{label:'Category spending',value:'€1,793.99'}, {label:'Savings target',value:'€100'}, {label:'Cash buffer',value:'€500'}],
    details: [coach.cashFlow.insight.explanation, coach.budget.uncertainty?.message, ...(coach.budget.warnings ?? [])].filter(Boolean),
    engineSource: { customerId: coach.customerId, asOf: coach.asOf, modelVersion: coach.modelVersion, calculationState: coach.calculationState },
    savingsEstimate: {
      targetCents: result.budget.savingsTargetCents,
      suggestedOneTimeCents: result.savings.suggestedSavingsCents,
      conditionalOneTimeCapacityCents: result.savings.conditionalCapacityCents,
      cashBufferCents: result.savings.bufferCents,
      through: result.savings.horizonEnd,
      status: result.savings.status,
    },
  },
};
// Render the engine's figures, never a second frontend calculation.
contexts.engine.facts = [
  { label:'Category spending', value:new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(result.budget.totalPlannedSpendingCents/100) },
  { label:'Savings target', value:new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(result.budget.savingsTargetCents/100) },
  { label:'Cash buffer', value:new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(result.budget.bufferCents/100) },
];

contexts.engine.account = account;
contexts.engine.title = 'Your account, in focus.';
contexts.engine.label = account.label;
contexts.engine.source = `Bank-provided sample account ${account.accounts[0].accountId}. Balance observed ${account.observedDate}; forecast 1–30 October 2026. No live bank connection.`;
