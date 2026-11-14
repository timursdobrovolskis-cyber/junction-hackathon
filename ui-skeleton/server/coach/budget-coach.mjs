import { cents, date, evidenceIds, identifier, requireValue, unique } from './validation.mjs';

const money = (value) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value / 100);
const copy = (value) => structuredClone(value);
const statuses = ['withheld', 'infeasible', 'needs_confirmation', 'conditional_plan'];
const object = (value, name) => requireValue(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);

function validate({ budget: b, originalForecast: f }) {
  requireValue(b && f, 'budget and originalForecast are required');
  identifier(f.customerId); date(f.asOf);
  requireValue(b.customerId === f.customerId && b.asOf === f.asOf, 'budget and forecast must belong to the same customer and reference date');
  requireValue(b.currency === 'EUR' && f.currency === 'EUR', 'only EUR is supported');
  requireValue(statuses.includes(b.status) && b.movesMoney === false, 'expected a non-executing budget engine result');
  cents(b.bufferCents, 'bufferCents'); cents(b.savingsTargetCents, 'savingsTargetCents');
  requireValue(Array.isArray(b.categories), 'categories must be an array');
  unique(b.categories.map((c) => c.category), 'categories');
  for (const c of b.categories) {
    identifier(c.category); evidenceIds(c.evidenceIds);
    for (const field of ['historicalForecastCents', 'protectedCents', 'previewLimitCents']) cents(c[field], field);
    cents(c.changeFromHistoryCents, 'changeFromHistoryCents', { signed: true });
    requireValue(typeof c.adjustable === 'boolean', 'adjustable must be a boolean');
    requireValue(['user_override', 'history_and_constraints', 'accepted_plan'].includes(c.source), 'unknown category source');
    if (b.status === 'conditional_plan') {
      cents(c.suggestedLimitCents, 'suggestedLimitCents');
      requireValue(c.suggestedLimitCents === c.previewLimitCents, 'suggested limit must match the confirmed preview');
    } else requireValue(c.suggestedLimitCents === null, 'unconfirmed or infeasible limits cannot be recommendations');
  }
  requireValue(f.evidence === undefined || Array.isArray(f.evidence), 'forecast evidence must be an array');
  unique((f.evidence ?? []).map((r) => r.id), 'evidence IDs');
  for (const row of f.evidence ?? []) {
    identifier(row.id); date(row.date); cents(row.amountCents, 'evidence amount', { signed: true });
    requireValue(row.date <= f.asOf, 'evidence cannot follow the reference date');
    if (row.customerId !== undefined) requireValue(row.customerId === f.customerId, 'evidence belongs to another customer');
  }
  if (b.status === 'withheld') {
    requireValue(b.preview === null && b.categories.length === 0, 'withheld budget must not include a plan');
    identifier(b.reason, 'withheld reason');
    return;
  }
  const eligibleScenario = f.scenarioBasis === 'known_expense_plan' && f.calibrationCoverageClaimApplies === false
    && f.sourceEligibility?.baseStatus === 'estimated' && f.sourceEligibility?.calibrated === true;
  requireValue(f.status === 'estimated' && (f.calibration || eligibleScenario) && Array.isArray(f.cashFlowComponents), 'a budget plan requires an eligible forecast with category components');
  requireValue(b.feasible === (b.status !== 'infeasible'), 'budget status and feasibility disagree');
  requireValue(typeof b.savingsConfirmed === 'boolean' && typeof b.commitmentsConfirmed === 'boolean', 'confirmation fields must be booleans');
  const confirmed = b.savingsConfirmed && b.commitmentsConfirmed;
  requireValue(b.confirmationRequired === !confirmed && (b.status === 'infeasible' || (b.status === 'conditional_plan') === confirmed), 'budget confirmation state disagrees');
  date(b.periodStart); date(b.periodEnd);
  requireValue(b.periodStart === f.daily?.[0]?.date && b.periodEnd === f.daily?.at(-1)?.date, 'budget and forecast windows must match');
  for (const key of ['expectedIncomeCents', 'otherAccountOutflowsCents', 'futureCostReserveCents', 'totalHistoricalSpendingCents', 'totalPlannedSpendingCents']) cents(b[key], key);
  const p = b.preview;
  requireValue(p && p.assumesPlanFollowed === true && p.calibrationCoverageClaimApplies === false, 'budget preview must retain counterfactual uncertainty');
  for (const key of ['bufferShortfallCents', 'incomeShortfallCents']) cents(p[key], key);
  for (const key of ['startingBalanceAfterSavingsCents', 'endingExpectedBalanceCents', 'lowestConditionalBalanceCents']) cents(p[key], key, { signed: true });
  date(p.lowestConditionalBalanceDate);
  requireValue(p.lowestConditionalBalanceDate >= f.asOf && p.lowestConditionalBalanceDate <= b.periodEnd, 'preview minimum date is outside its window');
  requireValue(Array.isArray(p.daily) && p.daily.length === f.daily.length, 'preview must cover the original forecast');
  p.daily.forEach((row, i) => {
    requireValue(row.date === f.daily[i].date, 'preview dates must match the original forecast');
    for (const key of ['expectedBalanceCents', 'conditionalLowerBalanceCents', 'conditionalUpperBalanceCents']) cents(row[key], key, { signed: true });
  });
  requireValue(b.feasible === (p.bufferShortfallCents === 0 && p.incomeShortfallCents === 0), 'preview shortfalls disagree with feasibility');
}

/** Browser-safe explanation of Timurs's returned plan; no financial arithmetic. */
export function createBudgetCoachResponse(result) {
  validate(result);
  const { budget: b, originalForecast: f } = result;
  let insight, followUp;
  if (b.status === 'withheld') {
    const missing = f.status === 'insufficient_history'
      ? ' The engine needs at least three complete months of payment history per account.'
      : f.status === 'needs_review' ? ' The forecast inputs need review before a budget can be offered. Check the supplied warnings.' : '';
    insight = { kind: 'budget_withheld', title: 'A budget preview is not available yet', explanation: b.reason + missing };
    followUp = null;
  } else if (!b.feasible) {
    const reasons = [];
    if (b.preview.incomeShortfallCents > 0) reasons.push(`After allowing for your savings target, other account outflows and reserved costs, expected income falls ${money(b.preview.incomeShortfallCents)} short of the selected protected spending and category choices. Existing cash and investment withdrawals do not count as recurring income.`);
    if (b.preview.bufferShortfallCents > 0) reasons.push(`The lower balance estimate in this scenario falls ${money(b.preview.bufferShortfallCents)} short of the cash buffer plus money reserved for later costs. Its lowest conditional balance is ${money(b.preview.lowestConditionalBalanceCents)}, estimated for ${b.preview.lowestConditionalBalanceDate}.`);
    insight = { kind: 'infeasible_budget', title: 'This plan does not fit the current constraints',
      explanation: `With a ${money(b.savingsTargetCents)} savings target and ${money(b.bufferCents)} cash buffer, this plan does not fit. ${reasons.join(' ')} The category amounts show why the plan does not fit; zero amounts are not advice to stop spending.` };
    followUp = { kind: 'revise_constraints', question: `Would you like to change the ${money(b.savingsTargetCents)} savings target, or review which category amounts you need to protect?`, inputFields: ['savingsTargetCents', 'adjustableCategories', 'minimumCategoryCents'] };
  } else {
    const reduction = [...b.categories].filter((c) => c.changeFromHistoryCents < 0).sort((a, z) => a.changeFromHistoryCents - z.changeFromHistoryCents)[0];
    const context = reduction
      ? `For example, ${reduction.category} is projected at ${money(reduction.historicalForecastCents)} from payment history; this plan previews a ${money(reduction.previewLimitCents)} limit.`
      : 'No category reductions are needed from the spending projected from payment history.';
    const unconfirmed = [!b.savingsConfirmed ? 'the savings target' : '', !b.commitmentsConfirmed ? 'upcoming expenses' : ''].filter(Boolean).join(' and ');
    insight = { kind: reduction ? 'budget_adjustments' : 'budget_fits',
      title: reduction ? 'A conditional plan with spending adjustments' : 'Your projected spending fits this preview',
      explanation: `For ${b.periodStart}–${b.periodEnd}, this plan previews ${money(b.totalPlannedSpendingCents)} in category spending with a ${money(b.savingsTargetCents)} savings target and ${money(b.bufferCents)} cash buffer. ${context} ${b.status === 'needs_confirmation' ? `These are draft amounts pending confirmation of ${unconfirmed}.` : 'Even with those inputs confirmed, this plan depends on future income and following the spending limits.'}` };
    followUp = !b.savingsConfirmed
      ? { kind: 'confirm_savings_target', question: `Is ${money(b.savingsTargetCents)} the savings target you want to use for this preview?`, inputFields: ['savingsTargetCents', 'savingsConfirmed'] }
      : !b.commitmentsConfirmed
        ? { kind: 'check_commitments', question: 'Have you checked that upcoming expenses are included in the forecast and later costs are reserved?', inputFields: ['futureCommitments', 'commitmentsConfirmed'] }
        : reduction
          ? { kind: 'protect_category', question: `Is the ${money(reduction.previewLimitCents)} preview for ${reduction.category} realistic for you?`, inputFields: ['categoryOverrides', 'minimumCategoryCents'] }
          : null;
  }
  // Funding and liquidity explanations also need income and other cash-movement evidence.
  const ids = evidenceIds([...b.categories.flatMap((c) => c.evidenceIds),
    ...(b.preview ? (f.cashFlowComponents ?? []).flatMap((c) => evidenceIds(c.evidenceIds)) : [])]);
  const records = (f.evidence ?? []).filter((row) => ids.includes(row.id));
  const found = new Set(records.map((row) => row.id));
  return copy({
    schemaVersion: '1.0.0', customerId: b.customerId, asOf: b.asOf, currency: b.currency,
    status: b.status, insight, followUp, period: b.preview ? { start: b.periodStart, end: b.periodEnd, kind: 'rolling_forecast_window' } : null,
    facts: ['bufferCents', 'savingsTargetCents', 'expectedIncomeCents', 'otherAccountOutflowsCents', 'futureCostReserveCents', 'lockedCommitmentsCents', 'totalPlannedSpendingCents']
      .filter((key) => b[key] !== undefined).map((key) => ({ key, amountCents: b[key], sourcePath: `budget.${key}` })),
    categories: b.categories.map((c, i) => ({ ...c, previewLimitCents: b.feasible ? c.previewLimitCents : null,
      diagnosticLimitCents: b.feasible ? null : c.previewLimitCents,
      displayMode: b.feasible ? b.status === 'needs_confirmation' ? 'draft' : 'conditional' : 'diagnostic',
      sourcePath: `budget.categories[${i}]` })),
    balancePreview: b.preview ? { ...b.preview, displayMode: b.feasible ? 'conditional' : 'diagnostic' } : null,
    evidence: { ids, records, unresolvedIds: ids.filter((id) => !found.has(id)) },
    uncertainty: { calibrationCoverageClaimApplies: false,
      explanation: 'Payment dates and balances are estimates. Budget previews assume the plan is followed and retain the original error allowance; their coverage has not been calibrated for changed spending. Savings remain uncertain.' },
    warnings: [...(f.warnings ?? [])], assumptions: [...(b.assumptions ?? [])],
    calculationState: 'engine_result', movesMoney: false,
  });
}

/** Patch preferences, preserving prior choices. Only an engine response may replace the preview. */
export function captureBudgetInputs(result, answer, previousInputs) {
  validate(result); object(answer, 'answer');
  const allowed = ['bufferCents', 'savingsTargetCents', 'categoryOverrides', 'removeCategoryOverrides', 'adjustableCategories', 'minimumCategoryCents', 'futureCommitments', 'savingsConfirmed', 'commitmentsConfirmed'];
  requireValue(Object.keys(answer).length > 0 && Object.keys(answer).every((k) => allowed.includes(k)), 'unsupported or empty budget answer');
  const { budget: b, originalForecast: f } = result;
  if (previousInputs) requireValue(previousInputs.customerId === b.customerId && previousInputs.asOf === b.asOf, 'previous inputs belong to another customer or reference date');
  // Without persisted preferences, retain every supplied protection conservatively.
  const initial = {
    customerId: b.customerId, asOf: b.asOf, bufferCents: b.bufferCents, savingsTargetCents: b.savingsTargetCents,
    categoryOverrides: Object.fromEntries(b.categories.filter((c) => c.source === 'user_override').map((c) => [c.category, c.previewLimitCents])),
    adjustableCategories: b.categories.filter((c) => c.adjustable).map((c) => c.category),
    minimumCategoryCents: Object.fromEntries(b.categories.map((c) => [c.category, c.protectedCents])),
    futureCommitments: b.futureCommitments ?? [], savingsConfirmed: b.savingsConfirmed ?? false, commitmentsConfirmed: b.commitmentsConfirmed ?? false,
  };
  const inputs = copy({ ...initial, ...previousInputs });
  const known = new Set(b.categories.map((c) => c.category));
  const checkCategory = (key) => requireValue(known.has(key), `unknown projected category: ${key}`);
  for (const field of ['bufferCents', 'savingsTargetCents']) if (Object.hasOwn(answer, field)) inputs[field] = cents(answer[field], field);
  for (const field of ['categoryOverrides', 'minimumCategoryCents']) {
    if (Object.hasOwn(answer, field)) {
      object(answer[field], field);
      for (const [key, value] of Object.entries(answer[field])) {
        checkCategory(key); cents(value, `${field}.${key}`);
        inputs[field] = { ...inputs[field], [key]: value };
      }
    }
  }
  if (Object.hasOwn(answer, 'removeCategoryOverrides')) {
    requireValue(Array.isArray(answer.removeCategoryOverrides), 'override removals must be an array');
    unique(answer.removeCategoryOverrides, 'override removals');
    for (const key of answer.removeCategoryOverrides) {
      checkCategory(key);
      requireValue(!Object.hasOwn(answer.categoryOverrides ?? {}, key), 'cannot update and remove the same category override');
      delete inputs.categoryOverrides[key];
    }
  }
  if (Object.hasOwn(answer, 'adjustableCategories')) {
    requireValue(Array.isArray(answer.adjustableCategories), 'adjustableCategories must be an array');
    unique(answer.adjustableCategories, 'adjustableCategories'); answer.adjustableCategories.forEach(checkCategory);
    inputs.adjustableCategories = [...answer.adjustableCategories];
  }
  if (Object.hasOwn(answer, 'futureCommitments')) {
    requireValue(Array.isArray(answer.futureCommitments), 'futureCommitments must be an array');
    inputs.futureCommitments = copy(answer.futureCommitments);
  }
  const blockers = [];
  unique(inputs.futureCommitments.map((cost) => cost.id), 'future commitment IDs');
  for (const cost of inputs.futureCommitments) {
    identifier(cost.id); date(cost.date); cents(cost.amountCents, 'commitment amount');
    requireValue(cost.date > f.asOf, 'commitments must be future dated');
    if (!f.daily?.length || cost.date <= f.daily.at(-1).date) blockers.push('in_horizon_expenses_need_forecast_update');
  }
  const preferenceChanged = allowed.slice(0, 7).some((key) => Object.hasOwn(answer, key));
  if (preferenceChanged) { inputs.savingsConfirmed = false; inputs.commitmentsConfirmed = false; }
  for (const field of ['savingsConfirmed', 'commitmentsConfirmed']) if (Object.hasOwn(answer, field)) {
    requireValue(typeof answer[field] === 'boolean', `${field} must be a boolean`); inputs[field] = answer[field];
  }
  if (b.status === 'withheld') blockers.push('forecast_needs_review_or_regeneration');
  const engineInputs = {
    buffer_cents: inputs.bufferCents, savings_target_cents: inputs.savingsTargetCents,
    category_overrides: inputs.categoryOverrides, adjustable_categories: inputs.adjustableCategories,
    minimum_category_cents: inputs.minimumCategoryCents, future_commitments: inputs.futureCommitments,
    savings_confirmed: inputs.savingsConfirmed, commitments_confirmed: inputs.commitmentsConfirmed,
  };
  return copy({ status: 'awaiting_recalculation', inputs, engineRequest: { ready: blockers.length === 0, blockers: [...new Set(blockers)], engineInputs },
    message: 'Your choices are captured. The displayed budget and forecast have not changed; a new engine result is required.',
    budgetChanged: false, forecastChanged: false, movesMoney: false });
}

