// Demo "mid-month" view: the sample data ends 30 Sep, so October has no spending yet.
// To show the budget in use, we replay this customer's own spending from days 1–14 of
// the most recent month with activity in several categories, placed on October dates.
// All amounts come from real sample transactions; the date shift is labelled as a demo.
const SPENDING = new Set(['purchase', 'housing_payment', 'utilities_payment']);
const DEMO_DAY = 14;
const pad = n => String(n).padStart(2, '0');
const shiftMonth = (month, n) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const label = month => new Date(month + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

function pickReplayMonth(activity, planned) {
  const plannedNames = new Set(planned.map(c => c.category));
  let month = activity.coverage.end.slice(0, 7);
  for (let i = 0; i < 6; i++, month = shiftMonth(month, -1)) {
    const cats = new Set(activity.transactions
      .filter(t => t.date >= `${month}-01` && t.date <= `${month}-${pad(DEMO_DAY)}` && t.amountCents < 0 && SPENDING.has(t.type) && plannedNames.has(t.category))
      .map(t => t.category));
    if (cats.size >= 4) return month;
  }
  return activity.coverage.end.slice(0, 7);
}

export function buildLiveBudget(plan, activity) {
  const planned = plan.budget.categories;
  const periodStart = plan.budget.periodStart, periodEnd = plan.budget.periodEnd;
  const planMonth = periodStart.slice(0, 7);
  const daysInPeriod = Number(periodEnd.slice(8, 10)) - Number(periodStart.slice(8, 10)) + 1;
  const daysLeft = daysInPeriod - DEMO_DAY;
  const replayMonth = pickReplayMonth(activity, planned);
  const replayed = activity.transactions
    .filter(t => t.date >= `${replayMonth}-01` && t.date <= `${replayMonth}-${pad(DEMO_DAY)}` && SPENDING.has(t.type))
    .map(t => ({ ...t, sourceDate: t.date, date: `${planMonth}-${t.date.slice(8, 10)}` }));

  const categories = planned.map(c => {
    const rows = replayed.filter(t => t.category === c.category && t.amountCents < 0);
    const spentCents = rows.reduce((s, t) => s - t.amountCents, 0);
    const plannedCents = c.previewLimitCents;
    const fixed = !c.adjustable;
    return { category: c.category, plannedCents, spentCents, remainingCents: plannedCents - spentCents,
      basket: fixed ? 'fixed' : 'everyday', overCents: Math.max(0, spentCents - plannedCents), transactionIds: rows.map(t => t.id) };
  });

  // Three baskets (S-Pankki): fixed obligations, money set aside, everyday flexible spending.
  // Everyday = categories the customer can adjust; fixed = protected costs from the plan.
  const sum = (rows, key) => rows.reduce((s, c) => s + c[key], 0);
  const fixed = categories.filter(c => c.basket === 'fixed');
  const everyday = categories.filter(c => c.basket === 'everyday');
  const setAsideCents = plan.budget.savingsTargetCents;
  const baskets = [
    { id: 'fixed', label: 'Bills & essentials', note: 'Housing, utilities, travel, food, health', plannedCents: sum(fixed, 'plannedCents'), spentCents: sum(fixed, 'spentCents') },
    { id: 'setAside', label: 'Set aside', note: 'Savings target, reserved first', plannedCents: setAsideCents, spentCents: 0 },
    { id: 'everyday', label: 'Everyday spending', note: 'Lifestyle and entertainment — yours to use', plannedCents: sum(everyday, 'plannedCents'), spentCents: sum(everyday, 'spentCents') },
  ].map(b => ({ ...b, remainingCents: b.plannedCents - b.spentCents }));

  const everydayLeft = Math.max(0, baskets[2].remainingCents);
  const safePerDayCents = Math.floor(everydayLeft / daysLeft);

  // Overspend: the category furthest over its limit, covered from the adjustable category with most room.
  const over = [...categories].filter(c => c.overCents > 0).sort((a, b) => b.overCents - a.overCents)[0] ?? null;
  const donor = over ? [...everyday].filter(c => c.category !== over.category && c.remainingCents >= over.overCents)
    .sort((a, b) => b.remainingCents - a.remainingCents)[0] ?? null : null;

  // Pace: straight-line projection of spending so far, per category, for categories with spending.
  // Only everyday categories: bills arrive once a month and don't follow a daily pace.
  const pacing = everyday.map(c => ({ category: c.category, projectedCents: Math.round(c.spentCents / DEMO_DAY * daysInPeriod), plannedCents: c.plannedCents }))
    .map(c => ({ ...c, overCents: Math.max(0, c.projectedCents - c.plannedCents) }));
  const paceDriver = [...pacing].sort((a, b) => b.overCents - a.overCents)[0];
  const projectedOverCents = everyday.reduce((s, c) => {
    const projected = Math.round(c.spentCents / DEMO_DAY * daysInPeriod);
    return s + Math.max(0, projected - c.plannedCents);
  }, 0);
  const savingsAfterPaceCents = Math.max(0, setAsideCents - projectedOverCents);

  return {
    demo: true, demoDate: `${planMonth}-${pad(DEMO_DAY)}`, daysLeft, daysInPeriod,
    replayLabel: `Demo day: 14 ${label(planMonth)}. Spending replays your own 1–14 ${label(replayMonth)} transactions.`,
    totalPlannedCents: sum(categories, 'plannedCents'), spentCents: sum(categories, 'spentCents'),
    safePerDayCents, everydayLeftCents: everydayLeft, baskets, categories,
    overspend: over ? {
      category: over.category, overCents: over.overCents, plannedCents: over.plannedCents,
      move: donor ? { from: donor.category, amountCents: over.overCents, fromRemainingCents: donor.remainingCents } : null,
    } : null,
    pace: { projectedOverCents, driver: paceDriver?.overCents > 0 ? paceDriver : null, savingsTargetCents: setAsideCents, savingsAfterPaceCents },
    movesMoney: false,
  };
}
