import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowRight, Bell, Check, ChevronRight, ExternalLink, House, Leaf, Menu, MessageCircle, PiggyBank, ShieldCheck, Sparkles, X } from 'lucide-react';
import fixture from '../../fixtures/coach-demo.json';
import { calculateGoalPlan } from '../coach.mjs';

const STORAGE_KEY = 'smobiili-goals-v1';
const formatEuro = (cents) => `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
const formatDate = (date) => new Intl.DateTimeFormat('fi-FI', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
const formatMonth = (month) => new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(`${month}-01T12:00:00`));
const dateLabel = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${fixture.asOf}T12:00:00`));
const defaults = {
  shortTermGoals: [
    { id: 'goal-student-savings', label: 'Student savings', targetCents: fixture.goal.targetCents, savedCents: fixture.goal.savedCents, targetDate: fixture.goal.targetDate, complete: false },
    { id: 'goal-emergency-buffer', label: 'Emergency buffer', targetCents: 50000, savedCents: 48000, targetDate: '2027-05-14', complete: false },
    { id: 'goal-weekend-trip', label: 'Weekend trip', targetCents: 30000, savedCents: 27000, targetDate: '2027-04-14', complete: false },
  ],
  longTermGoals: [
    { id: 'long-home-fund', label: 'First home down payment', targetCents: fixture.longTermGoal.targetCents, savedCents: fixture.longTermGoal.savedCents, monthlyCents: fixture.longTermGoal.monthlyContributionCents, accountType: fixture.longTermGoal.accountType, years: fixture.longTermGoal.horizonYears, bonusSavings: false, bonusMonthlyCents: 0, cardMicroSaving: false, microCentsPerTransaction: 10, fixedRateBps: 200, termYears: 1, complete: false },
    { id: 'long-security-reserve', label: 'Long-term security reserve', targetCents: 1000000, savedCents: 200000, monthlyCents: 0, accountType: 'S-Määräaikaistili', years: 5, bonusSavings: false, bonusMonthlyCents: 0, cardMicroSaving: false, microCentsPerTransaction: 5, fixedRateBps: 150, termYears: 1, complete: false },
  ],
};
const TUOTTOTILI_RATE_TIERS = [
  { maximumCents: 499999, annualRateBps: 1, label: '0.01%', range: '€0–4,999' },
  { maximumCents: 1999999, annualRateBps: 50, label: '0.50%', range: '€5,000–19,999' },
  { maximumCents: 9999999, annualRateBps: 150, label: '1.50%', range: '€20,000–99,999' },
  { maximumCents: Number.MAX_SAFE_INTEGER, annualRateBps: 175, label: '1.75%', range: '€100,000+' },
];

function loadGoals() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    const shortTermGoals = Array.isArray(saved?.shortTermGoals) ? saved.shortTermGoals : saved?.shortTerm ? [{ id: 'goal-demo-1', ...saved.shortTerm, complete: false }] : defaults.shortTermGoals;
    const legacyLong = saved?.longTerm ?? saved?.longTermGoal;
    const longTermGoals = Array.isArray(saved?.longTermGoals) ? saved.longTermGoals : legacyLong ? [{ ...defaults.longTermGoals[0], ...legacyLong }] : defaults.longTermGoals;
    return {
      ...defaults,
      shortTermGoals: shortTermGoals.map(goal => ({ complete: false, ...goal })),
      longTermGoals: longTermGoals.map(goal => ({ ...defaults.longTermGoals.find(item => item.id === goal.id) ?? defaults.longTermGoals[0], ...goal, complete: Boolean(goal.complete) })),
    };
  } catch {
    return defaults;
  }
}

function euroToCents(value) {
  const match = String(value).match(/^(\d+)(?:\.(\d{0,2}))?$/);
  if (!match) return 0;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

function monthsUntil(date) {
  const [year, month] = date.split('-').map(Number);
  const [baseYear, baseMonth] = fixture.asOf.split('-').map(Number);
  return Math.max(1, (year - baseYear) * 12 + month - baseMonth + 1);
}

function dateAfterMonths(months) {
  const date = new Date(`${fixture.asOf}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function makePlanResult(mode, goal) {
  return calculateGoalPlan({ goal, periods: fixture.periods, deliveryHistory: fixture.deliveryHistory, newExpenses: fixture.scenarios[mode].newExpenses });
}

function safeSurplusCents() {
  const expectedSavingsCents = fixture.periods.reduce((sum, period) => sum + period.availableToSaveCents, 0);
  const unexpectedExpenseCents = fixture.scenarios.afterExpense.newExpenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  return Math.max(0, Math.round((expectedSavingsCents - unexpectedExpenseCents) / fixture.periods.length));
}

function Header() {
  return <header className="app-header">
    <div className="header-row">
      <button className="icon-button header-menu" aria-label="Open menu"><Menu size={22} /></button>
      <div className="brand"><span className="brand-mark"><span /></span><span>s-mobiili</span></div>
      <button className="icon-button notification" aria-label="Notifications"><Bell size={20} /><i /></button>
    </div>
    <div className="header-context"><span className="demo-label">PERSONAL SAVING PLAN</span><span className="profile-slot" aria-label="Demo customer profile"><span>1</span></span></div>
  </header>;
}

function GoalProgress({ progress, label }) {
  return <div className="progress-ring playful-ring" style={{ '--progress': `${progress}%` }}><div className="ring-inner"><span className="ring-check"><PiggyBank size={16} /></span><span className="ring-caption">SAVING FOR</span><strong>{label || 'Your goal'}</strong></div></div>;
}

function ShortTermGoal({ goal, updateGoal, removeGoal, result, baseline, mode, onEvidence, preview, setPreview }) {
  const isFunded = goal.savedCents >= goal.targetCents;
  const displayedCents = preview && result.recoveryOption ? result.recoveryOption.projectedSavedIfFollowedCents : result.projectedSavedCents;
  const progress = Math.max(0, Math.min(100, Math.round(displayedCents / Math.max(1, goal.targetCents) * 100)));
  const remainingCents = Math.max(0, goal.targetCents - goal.savedCents);
  const neededMonthly = Math.ceil(remainingCents / monthsUntil(goal.targetDate));
  const recovered = preview && result.recoveryOption;
  return <section className={`card goal-card short-goal-card ${goal.complete ? 'goal-achieved' : ''}`}>
    <div className="goal-section-heading"><span className="goal-icon">{goal.complete ? <Check size={20}/> : <Leaf size={20}/>}</span><div><div className="eyebrow">{goal.complete ? 'COMPLETED SHORT-TERM GOAL' : 'SHORT-TERM GOAL'}</div><h2>{goal.label || 'Your next little big thing'}</h2></div>{removeGoal && <button className="goal-remove" onClick={removeGoal} aria-label={`Remove ${goal.label || 'goal'}`}><X size={17}/></button>}</div>
    <p className="goal-description">Make it something you want. Set the amount and date, then update your saved balance as you go.</p>
    <div className="goal-edit-grid">
      <label className="field-label">What are you saving for?<input value={goal.label} maxLength={32} onChange={(event) => updateGoal({ label: event.target.value })} placeholder="e.g. A weekend trip" /></label>
      <div className="goal-field-row">
        <label className="field-label">Target amount<input type="number" min="1" step="0.01" value={(goal.targetCents / 100).toFixed(2)} onChange={(event) => updateGoal({ targetCents: euroToCents(event.target.value) })} /></label>
        <label className="field-label">Saved so far<input type="number" min="0" step="0.01" value={(goal.savedCents / 100).toFixed(2)} onChange={(event) => updateGoal({ savedCents: euroToCents(event.target.value) })} /></label>
      </div>
      <label className="field-label">When would you like it?<input type="date" min={fixture.asOf} max="2027-11-14" value={goal.targetDate} onChange={(event) => event.target.value && updateGoal({ targetDate: event.target.value })} /></label>
    </div>
    <div className="goal-preview-row"><GoalProgress progress={progress} label={goal.label}/><div className="goal-numbers"><span className="eyebrow">DEMO CASH-FLOW PREVIEW</span><div className="projection">{formatEuro(displayedCents)}</div><div className="goal-target">toward your {formatEuro(goal.targetCents)} goal</div><div className="goal-badge"><span />{formatEuro(goal.savedCents)} already saved</div></div></div>
    <div className={`insight ${mode === 'afterExpense' ? 'alert-insight' : ''}`}><span className="insight-icon">{mode === 'afterExpense' ? <Sparkles size={18} /> : <Leaf size={18} />}</span><p>{mode === 'afterExpense' ? <>The unexpected €60 expense brings this preview from <strong>{formatEuro(baseline.projectedSavedCents)}</strong> to <strong>{formatEuro(result.projectedSavedCents)}</strong>. You can try trimming three €10 delivery purchases to recover <strong>€30</strong>.</> : <>The current cash-flow preview reaches <strong>{formatEuro(result.projectedSavedCents)}</strong>. Keep adjusting your goal and timing to find a plan that feels right.</>}</p></div>
    <div className="contribution-line"><span>To reach your goal by {formatDate(goal.targetDate)}</span><strong>{formatEuro(neededMonthly)} / month · {formatEuro(Math.ceil(neededMonthly * 12 / 52))} / week</strong></div>
    <div className="goal-completion-row"><button type="button" className={`goal-check-button ${goal.complete ? 'checked' : ''}`} disabled={!isFunded && !goal.complete} aria-pressed={Boolean(goal.complete)} onClick={() => updateGoal({ complete: !goal.complete })}><span>{goal.complete && <Check size={15}/>}</span>{goal.complete ? 'Goal complete!' : isFunded ? 'Tick off this goal' : `Add ${formatEuro(remainingCents)} more to tick it off`}</button></div>
    <div className="card-actions">{result.recoveryOption && <button className={`primary-button ${recovered ? 'active-preview' : ''}`} aria-pressed={Boolean(recovered)} onClick={() => setPreview(recovered ? null : goal.id)}>{recovered ? <><Check size={18} /> Recovery preview on</> : <>Try recovery idea <ArrowRight size={18} /></>}</button>}<button className="text-button" onClick={onEvidence}>Inspect Evidence <ChevronRight size={17} /></button></div>
    {recovered && <div className="preview-note" role="status"><span className="preview-dot" /> Preview only: {result.recoveryOption.months.length} monthly delivery trims could add {formatEuro(result.recoveryOption.estimatedSavingsCents)} to the projection. No money moves.</div>}
    <div className="safety-check"><ShieldCheck size={17}/><span><strong>Daily safety buffer check</strong><br/>A €500 floor is illustrative. This demo has no daily balance feed; confirm your live cash balance before saving.</span></div>
    <div className="recovery-summary"><strong>What changed in the preview?</strong><span>Unexpected expense: −€60</span><span>Suggested category trim: 3 × €10 = +€30</span><span>Example projection: {formatEuro(result.projectedSavedCents)} → {formatEuro(result.recoveryOption?.projectedSavedIfFollowedCents ?? result.projectedSavedCents)}</span></div>
  </section>;
}

function getGoalMonthlyContribution(goal) {
  const bonus = goal.bonusSavings ? Math.max(0, goal.bonusMonthlyCents ?? 0) : 0;
  const card = goal.cardMicroSaving ? Math.max(0, goal.microCentsPerTransaction ?? 0) * (fixture.detectedMonthlyCardTransactionCount ?? 0) : 0;
  return Math.max(0, goal.monthlyCents ?? 0) + bonus + card;
}

function tuottotiliRate(balanceCents) {
  return TUOTTOTILI_RATE_TIERS.find((tier) => balanceCents <= tier.maximumCents) ?? TUOTTOTILI_RATE_TIERS.at(-1);
}

function projectLongGoal(goal, monthCount) {
  let balanceCents = Math.max(0, goal.savedCents ?? 0);
  let principalCents = balanceCents;
  const contributionCents = getGoalMonthlyContribution(goal);
  const points = [{ month: 0, balanceCents, principalCents, interestCents: 0 }];
  let targetMonth = balanceCents >= goal.targetCents ? 0 : null;
  for (let month = 1; month <= monthCount; month += 1) {
    const balanceBeforeDeposit = balanceCents;
    balanceCents += contributionCents;
    principalCents += contributionCents;
    const rateBps = goal.accountType === 'S-Tuottotili' ? tuottotiliRate(balanceCents).annualRateBps : Math.max(0, goal.fixedRateBps ?? 0);
    const interestCents = Math.max(0, Math.round((balanceBeforeDeposit + Math.round(contributionCents / 2)) * rateBps / 120000));
    balanceCents += interestCents;
    points.push({ month, balanceCents, principalCents, interestCents: balanceCents - principalCents });
    if (targetMonth === null && balanceCents >= goal.targetCents) targetMonth = month;
  }
  return { points, targetMonth, contributionCents };
}

function LongTermGoal({ goal, updateGoal, removeGoal }) {
  const [selectedMonth, setSelectedMonth] = useState(goal.years * 12);
  const horizonMonths = goal.years * 12;
  const projection = projectLongGoal(goal, horizonMonths);
  const targetProjection = projectLongGoal(goal, 600);
  const { points, contributionCents } = projection;
  const totalPrincipal = points.at(-1).principalCents;
  const estimatedBalance = points.at(-1).balanceCents;
  const estimatedInterest = Math.max(0, estimatedBalance - totalPrincipal);
  const activeMonth = Math.min(selectedMonth, horizonMonths);
  const activePoint = points[activeMonth];
  const maxValue = Math.max(1, points[horizonMonths].balanceCents);
  const chartWidth = 320;
  const chartHeight = 150;
  const pointX = (month) => (month / horizonMonths) * chartWidth;
  const pointY = (cents) => chartHeight - (cents / maxValue) * chartHeight;
  const principalPath = points.map((point, index) => `${index ? 'L' : 'M'} ${pointX(point.month).toFixed(2)} ${pointY(point.principalCents).toFixed(2)}`).join(' ');
  const growthPath = points.map((point, index) => `${index ? 'L' : 'M'} ${pointX(point.month).toFixed(2)} ${pointY(point.balanceCents).toFixed(2)}`).join(' ');
  const principalAreaPath = `${principalPath} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`;
  const cursorX = pointX(activeMonth);
  const periodLabel = activeMonth === 0 ? 'Starting point' : `Year ${Math.ceil(activeMonth / 12)} · Month ${activeMonth}`;
  const pointerSelect = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setSelectedMonth(Math.round(ratio * horizonMonths));
  };
  const targetDate = targetProjection.targetMonth === null ? 'Beyond 50 years at this pace' : targetProjection.targetMonth === 0 ? 'Already reached' : formatDate(dateAfterMonths(targetProjection.targetMonth));
  const selectedRate = goal.accountType === 'S-Tuottotili' ? tuottotiliRate(activePoint.balanceCents) : null;
  const complete = goal.savedCents >= goal.targetCents;
  return <section className={`card goal-card long-term-card long-goal-card ${goal.complete ? 'goal-achieved' : ''}`}>
    <div className="goal-section-heading"><span className="goal-icon"><PiggyBank size={20}/></span><div><div className="eyebrow">{goal.complete ? 'COMPLETED S-PANKKI SAVINGS GOAL' : 'S-PANKKI SAVINGS GOAL'}</div><h3>{goal.label || 'Name this savings goal'}</h3></div>{removeGoal && <button className="goal-remove" onClick={removeGoal} aria-label={`Remove ${goal.label || 'long-term goal'}`}><X size={17}/></button>}</div>
    <div className="goal-edit-grid long-goal-edit">
      <label className="field-label">What are you saving for?<input value={goal.label} maxLength={42} onChange={(event) => updateGoal({ label: event.target.value })} placeholder="e.g. First home deposit"/></label>
      <div className="goal-field-row"><label className="field-label">Target amount<input type="number" min="1" step="1" value={(goal.targetCents / 100).toFixed(2)} onChange={(event) => updateGoal({ targetCents: euroToCents(event.target.value) })}/></label><label className="field-label">Saved so far<input type="number" min="0" step="1" value={(goal.savedCents / 100).toFixed(2)} onChange={(event) => updateGoal({ savedCents: euroToCents(event.target.value) })}/></label></div>
    </div>
    <label className="field-label account-type-field">Savings account<select value={goal.accountType} onChange={(event) => updateGoal({ accountType: event.target.value })}><option>S-Tuottotili</option><option>S-Määräaikaistili</option></select></label>
    <div className="account-mechanics"><strong>{goal.accountType === 'S-Tuottotili' ? 'Flexible access · interest paid monthly' : 'Fixed term · funds locked for the selected term'}</strong><span>{goal.accountType === 'S-Tuottotili' ? 'Withdrawals and deposits are flexible. The displayed rate depends on the full account balance tier; the simulation estimates monthly interest from an average balance.' : 'S-Määräaikaistili requires at least €500 in a separate fixed deposit. Pick a 1 month–5 year term; the rate is quoted for your amount and term.'}</span><a href={goal.accountType === 'S-Tuottotili' ? 'https://www.s-pankki.fi/fi/tilit/s-tuottotili/' : 'https://www.s-pankki.fi/fi/tilit/s-maaraaikaistili/'} target="_blank" rel="noreferrer">Check S-Pankki terms <ExternalLink size={13}/></a></div>
    <div className="goal-field-row long-monthly-row"><label className="field-label">Monthly auto-transfer<input type="number" min="0" step="1" value={(goal.monthlyCents / 100).toFixed(2)} onChange={(event) => updateGoal({ monthlyCents: euroToCents(event.target.value) })}/></label><label className="field-label">Projection horizon<select value={goal.years} onChange={(event) => { updateGoal({ years: Number(event.target.value) }); setSelectedMonth(Number(event.target.value) * 12); }}>{[2,5,10,15,20,25,30].map(year => <option key={year} value={year}>{year} years</option>)}</select></label></div>
    {goal.accountType === 'S-Määräaikaistili' ? <div className="fixed-term-fields"><label className="field-label">Term for a qualifying deposit<select value={goal.termYears} onChange={(event) => updateGoal({ termYears: Number(event.target.value) })}><option value={1 / 12}>1 month</option><option value={0.25}>3 months</option><option value={0.5}>6 months</option><option value={1}>1 year</option><option value={2}>2 years</option><option value={3}>3 years</option><option value={5}>5 years</option></select></label><label className="field-label assumed-rate">Illustrative fixed annual rate (%)<input type="number" min="0" max="10" step="0.1" value={(goal.fixedRateBps / 100).toFixed(2)} onChange={(event) => updateGoal({ fixedRateBps: Math.round(Number(event.target.value || 0) * 100) })}/><span>Enter an example rate; the live offer varies with market conditions, deposit size and term.</span></label></div> : <div className="tier-rate-note"><span>Estimated Tuottotili rate at the selected point: <strong>{selectedRate?.label}</strong>. Current published tiers vary with balance:</span><div className="rate-tier-list">{TUOTTOTILI_RATE_TIERS.map(tier => <span key={tier.range}>{tier.range}<strong>{tier.label}</strong></span>)}</div></div>}
    <fieldset className="savings-boosters"><legend>Optional savings boosters</legend>
      <label className="booster-toggle"><input type="checkbox" checked={Boolean(goal.bonusSavings)} onChange={(event) => updateGoal({ bonusSavings: event.target.checked })}/><span><strong>Bonus säästöön</strong><small>Route an estimated monthly S-Group Bonus to savings</small></span></label>
      {goal.bonusSavings && <label className="field-label booster-amount">Estimated Bonus per month<input type="number" min="0" step="1" value={((goal.bonusMonthlyCents ?? 0) / 100).toFixed(2)} onChange={(event) => updateGoal({ bonusMonthlyCents: euroToCents(event.target.value) })}/></label>}
      <label className="booster-toggle"><input type="checkbox" checked={Boolean(goal.cardMicroSaving)} onChange={(event) => updateGoal({ cardMicroSaving: event.target.checked })}/><span><strong>Card micro-saving</strong><small>{fixture.detectedMonthlyCardTransactionCount} detected card transactions per month in this demo</small></span></label>
      {goal.cardMicroSaving && <label className="field-label booster-amount">Save per card purchase<input type="number" min="0" step="0.01" value={((goal.microCentsPerTransaction ?? 0) / 100).toFixed(2)} onChange={(event) => updateGoal({ microCentsPerTransaction: euroToCents(event.target.value) })}/><span>Adds about {formatEuro((goal.microCentsPerTransaction ?? 0) * fixture.detectedMonthlyCardTransactionCount)} each month at the detected transaction count.</span></label>}
    </fieldset>
    <div className="long-contribution-summary"><span>Planned total from this goal</span><strong>{formatEuro(contributionCents)} / month</strong></div>
    <div className="savings-timeline"><div className="savings-timeline-heading"><strong>{goal.years}-year balance projection</strong><span>Simulation only · not guaranteed</span></div>
      <div className="savings-compare"><div><small>Total contributed</small><strong>{formatEuro(totalPrincipal)}</strong></div><div><small>Estimated interest</small><strong>{formatEuro(estimatedInterest)}</strong></div><div><small>Projected balance</small><strong>{formatEuro(estimatedBalance)}</strong></div></div>
      <div className="savings-chart-wrap"><div className="chart-cursor-tooltip" style={{ left: `${Math.max(18, Math.min(82, activeMonth / horizonMonths * 100))}%` }} aria-live="polite"><strong>{periodLabel}</strong><span>Balance {formatEuro(activePoint.balanceCents)}</span><span>Contributed {formatEuro(activePoint.principalCents)}</span><span>Interest {formatEuro(activePoint.interestCents)}</span></div>
        <svg className="savings-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label={`${goal.years}-year principal and estimated savings account interest simulation`} onPointerMove={pointerSelect} onPointerDown={pointerSelect}>
          {[0.25,0.5,0.75,1].map(fraction => <line key={fraction} x1="0" x2={chartWidth} y1={chartHeight * (1 - fraction)} y2={chartHeight * (1 - fraction)} className="chart-gridline"/>)}
          <path d={principalAreaPath} className="chart-savings-area"/><path d={principalPath} className="chart-principal-line"/><path d={growthPath} className="chart-savings-line"/>
          <line x1={cursorX} x2={cursorX} y1="0" y2={chartHeight} className="chart-cursor-line"/><circle cx={cursorX} cy={pointY(activePoint.balanceCents)} r="4.5" className="chart-cursor-savings"/>
        </svg>
      </div>
      <div className="chart-axis-labels"><span>Now</span><span>Year {goal.years}</span></div><input className="chart-scrubber" type="range" min="0" max={horizonMonths} value={activeMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))} aria-label="Explore principal and projected interest by month"/>
      <div className="savings-legend"><span><i className="principal-legend"/>Total contributed</span><span><i className="interest-legend"/>Estimated balance including interest</span></div>
      <div className="target-date-line"><span>Estimated target date</span><strong>{targetDate}</strong></div>
      <small className="simulation-note">Projection only, with no account opening or money movement. This is not a guarantee or financial advice. Tuottotili uses its currently displayed balance tiers and approximates monthly interest. The fixed-term option uses your editable assumed rate across this goal balance; a real S-Määräaikaistili deposit of at least €500 is separate and locked for the selected term. Actual terms and rates may differ.</small>
    </div>
    <div className="goal-completion-row"><button type="button" className={`goal-check-button ${goal.complete ? 'checked' : ''}`} disabled={!complete && !goal.complete} aria-pressed={Boolean(goal.complete)} onClick={() => updateGoal({ complete: !goal.complete })}><span>{goal.complete && <Check size={15}/>}</span>{goal.complete ? 'Goal complete!' : complete ? 'Tick off this goal' : `Add ${formatEuro(Math.max(0, goal.targetCents - goal.savedCents))} more to mark saved`}</button></div>
  </section>;
}

function GoalPlanner({ goals, updateShort, removeShort, addShort, updateLong, removeLong, addLong, mode, openEvidence, previewId, setPreviewId }) {
  const [selectedSection, setSelectedSection] = useState('short');
  const shortMonthlyCents = goals.shortTermGoals.filter(goal => !goal.complete).reduce((sum, goal) => sum + Math.ceil(Math.max(0, goal.targetCents - goal.savedCents) / monthsUntil(goal.targetDate)), 0);
  const longMonthlyCents = goals.longTermGoals.filter(goal => !goal.complete).reduce((sum, goal) => sum + getGoalMonthlyContribution(goal), 0);
  const plannedMonthlyCents = shortMonthlyCents + longMonthlyCents;
  const safeMonthlyCents = safeSurplusCents();
  const remainingSurplusCents = safeMonthlyCents - plannedMonthlyCents;
  const sortedShortGoals = [...goals.shortTermGoals].sort((a, b) => Number(Boolean(a.complete)) - Number(Boolean(b.complete)));
  return <div className="goal-sections">
    <div className="goals-intro"><strong>Make a plan around what matters to you</strong><p>Set near-term targets, then build long-term savings at a monthly pace that feels manageable.</p><span><Check size={14}/> Your goals stay saved on this device for Coach</span></div>
    <div className="goal-horizon-switch" role="tablist" aria-label="Choose a goal section">
      <button id="short-goals-tab" type="button" role="tab" className={selectedSection === 'short' ? 'selected' : ''} aria-selected={selectedSection === 'short'} aria-controls="short-goals-panel" onClick={() => setSelectedSection('short')}><span className="horizon-icon"><Leaf size={19}/></span><span className="horizon-option-copy"><strong>Short-term goals</strong><small>Weeks to 12 months · {goals.shortTermGoals.length} goals</small></span><ChevronRight size={18}/></button>
      <button id="long-goals-tab" type="button" role="tab" className={selectedSection === 'long' ? 'selected' : ''} aria-selected={selectedSection === 'long'} aria-controls="long-goals-panel" onClick={() => setSelectedSection('long')}><span className="horizon-icon"><PiggyBank size={19}/></span><span className="horizon-option-copy"><strong>Long-term savings</strong><small>S-Pankki accounts · {goals.longTermGoals.length} goals</small></span><ChevronRight size={18}/></button>
    </div>
    <div className="goal-budget-strip"><div><small>ACTIVE MONTHLY CONTRIBUTIONS</small><strong>{formatEuro(plannedMonthlyCents)}</strong></div><span>Demo safe surplus<br/><b>{formatEuro(safeMonthlyCents)} / month</b></span><div className={`remaining-surplus ${remainingSurplusCents < 0 ? 'over-budget' : ''}`}><small>LEFT AFTER GOALS</small><strong>{formatEuro(remainingSurplusCents)}</strong></div></div>
    {plannedMonthlyCents > safeMonthlyCents && <div className="surplus-warning budget-warning" role="status"><ShieldCheck size={17}/><span><strong>Protect your daily cash buffer.</strong> The €60 unexpected expense is included in the {formatEuro(safeMonthlyCents)} safe monthly estimate. Your goals plan is {formatEuro(plannedMonthlyCents - safeMonthlyCents)} above it. Coach suggests temporarily pausing or lowering a flexible long-term transfer first. You can also try three €10 delivery trims for €30 total or extend a short-term date.</span></div>}
    {selectedSection === 'short' && <section id="short-goals-panel" role="tabpanel" aria-labelledby="short-goals-tab" className="short-goals-section"><div className="list-section-heading"><div><div className="eyebrow">PART 1 · 1–12 MONTHS</div><h2>Short-term goals</h2><p>Everyday plans you choose, like a trip or a cash buffer.</p></div><span className="goals-count">{goals.shortTermGoals.length} {goals.shortTermGoals.length === 1 ? 'goal' : 'goals'}</span></div><div className="short-goals-list">
      {sortedShortGoals.map((goal) => {
        const result = makePlanResult(mode, goal);
        const baseline = makePlanResult('beforeExpense', goal);
        return <ShortTermGoal key={goal.id} goal={goal} updateGoal={(patch) => updateShort(goal.id, patch)} removeGoal={goals.shortTermGoals.length > 1 ? () => removeShort(goal.id) : null} result={result} baseline={baseline} mode={mode} onEvidence={() => openEvidence(goal, result)} preview={previewId === goal.id} setPreview={setPreviewId}/>;
      })}
      <button className="add-goal-button" onClick={addShort}><span>＋</span>Add another short-term goal</button>
    </div></section>}
    {selectedSection === 'long' && <section id="long-goals-panel" role="tabpanel" aria-labelledby="long-goals-tab" className="long-goals-section"><div className="list-section-heading"><div><div className="eyebrow">PART 2 · 1+ YEARS</div><h2>Long-term S-Pankki savings</h2><p>Choose an account and monthly amount for each goal. These previews do not set up transfers or move money.</p></div><span className="goals-count">{goals.longTermGoals.length} {goals.longTermGoals.length === 1 ? 'goal' : 'goals'}</span></div><div className="long-goals-list">{[...goals.longTermGoals].sort((a, b) => Number(Boolean(a.complete)) - Number(Boolean(b.complete))).map(goal => <LongTermGoal key={goal.id} goal={goal} updateGoal={(patch) => updateLong(goal.id, patch)} removeGoal={goals.longTermGoals.length > 1 ? () => removeLong(goal.id) : null}/>)}<button className="add-goal-button" onClick={addLong}><span>＋</span>Add another long-term savings goal</button></div></section>}
  </div>;
}

function CoachPage({ goals, onOpenGoals }) {
  const [question, setQuestion] = useState('');
  const shortGoals = goals.shortTermGoals;
  const longGoals = goals.longTermGoals;
  const plannedShortCents = shortGoals.filter(goal => !goal.complete).reduce((sum, goal) => sum + Math.ceil(Math.max(0, goal.targetCents - goal.savedCents) / monthsUntil(goal.targetDate)), 0);
  const plannedLongCents = longGoals.filter(goal => !goal.complete).reduce((sum, goal) => sum + getGoalMonthlyContribution(goal), 0);
  const plannedMonthlyCents = plannedShortCents + plannedLongCents;
  const safeMonthlyCents = safeSurplusCents();
  const response = question === 'monthly' ? `You have ${longGoals.length} long-term savings ${longGoals.length === 1 ? 'goal' : 'goals'}: ${longGoals.map(goal => `${formatEuro(getGoalMonthlyContribution(goal))} a month for ${goal.label || 'your goal'} via ${goal.accountType}`).join('; ')}. It’s saved here for next time.` : `You have ${shortGoals.length} short-term ${shortGoals.length === 1 ? 'goal' : 'goals'}: ${shortGoals.map(goal => `${goal.label || 'Untitled'} (${formatEuro(goal.targetCents)} by ${formatDate(goal.targetDate)}${goal.complete ? ', complete' : ''})`).join('; ')}. I’ll remember them on this device.`;
  return <div className="coach-page">
    <section className="coach-welcome"><div className="coach-avatar"><Sparkles size={20}/></div><div><div className="eyebrow">YOUR MONEY COACH</div><h2>Hi! I remember your goals.</h2><p>Your saved plan is here whenever we talk.</p></div></section>
    <div className="coach-bubble"><span className="coach-bubble-icon"><MessageCircle size={17}/></span><p>{response}</p></div>
    {plannedMonthlyCents > safeMonthlyCents && <div className="coach-buffer-alert" role="status"><ShieldCheck size={18}/><span><strong>Cash buffer check after the €60 expense</strong>Your active goals add up to {formatEuro(plannedMonthlyCents)} per month, compared with a demo safe surplus of {formatEuro(safeMonthlyCents)}. Consider temporarily pausing or lowering a flexible long-term S-Pankki transfer first. Three €10 delivery trims would add €30 over the preview, or you can move a short-term target date.</span></div>}
    <div className="coach-prompts"><button onClick={() => setQuestion('short')}>What am I saving for?</button><button onClick={() => setQuestion('monthly')}>What’s my monthly fund amount?</button></div>
    <section className="card remembered-goals"><div className="card-heading"><div><div className="eyebrow">SAVED GOALS</div><h2>What we’re working toward</h2></div><span className="remembered-sparkle">✦</span></div>
      {shortGoals.map(goal => <div className="remembered-goal-row" key={goal.id}><span className="remembered-emoji">{goal.complete ? <Check size={18}/> : <Leaf size={18}/>}</span><div><small>SHORT-TERM{goal.complete ? ' · COMPLETE' : ''}</small><strong>{goal.label || 'Your short-term goal'}</strong><span>{formatEuro(goal.targetCents)} target · {formatDate(goal.targetDate)} · {formatEuro(goal.savedCents)} saved</span></div></div>)}
      {longGoals.map(goal => <div className="remembered-goal-row" key={goal.id}><span className="remembered-emoji"><PiggyBank size={18}/></span><div><small>LONG-TERM SAVING{goal.complete ? ' · COMPLETE' : ''}</small><strong>{goal.label} · {formatEuro(getGoalMonthlyContribution(goal))} / month</strong><span>{goal.accountType} · {goal.years}-year projection</span></div></div>)}
      <button className="text-button edit-goals-button" onClick={onOpenGoals}>Adjust my goals <ChevronRight size={17}/></button>
    </section>
    <div className="coach-memory-note"><ShieldCheck size={16}/><span>Saved in this browser on this device. A secure bank account sync is not connected in this demo.</span></div>
  </div>;
}

function BottomNav({ activeTab, setActiveTab }) {
  return <nav className="bottom-nav"><button className={`nav-item ${activeTab === 'home' ? 'selected' : ''}`} onClick={() => setActiveTab('home')}><House size={20}/><span>Home</span></button><button className={`nav-item ${activeTab === 'coach' ? 'selected' : ''}`} onClick={() => setActiveTab('coach')}><MessageCircle size={20}/><span>Coach</span></button><button className={`nav-item center-nav ${activeTab === 'goals' ? 'selected' : ''}`} onClick={() => setActiveTab('goals')}><span><PiggyBank size={21}/></span><span>Goals</span></button></nav>;
}

function EvidenceModal({ result, goal, mode, onClose }) {
  const expenseIds = new Set(result.breakdown.flatMap((period) => period.expenseIds));
  const expenses = fixture.scenarios[mode].newExpenses;
  const history = fixture.deliveryHistory;
  const safeMonthly = safeSurplusCents();
  const observedSavingsCents = fixture.periods.reduce((sum, period) => sum + period.availableToSaveCents, 0);
  const unexpectedExpenseCents = expenses.reduce((sum, item) => sum + item.amountCents, 0);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="evidence-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
    <div className="modal-grabber"/><div className="modal-header"><div><div className="eyebrow">THE DETAILS BEHIND YOUR PLAN</div><h2 id="evidence-title">Why {formatEuro(result.projectedSavedCents)}?</h2></div><button className="close-button" onClick={onClose} aria-label="Close evidence"><X size={20}/></button></div>
    <p className="modal-intro">Here’s what the three-month demo projection uses for {goal.label || 'your goal'}.</p>
    <div className="evidence-group"><div className="group-title">CASH-FLOW & SURPLUS BASIS<span>{fixture.periods.length} monthly periods</span></div>{result.breakdown.map(period => <div className="evidence-summary" key={period.month}><span>{formatMonth(period.month)} · available to save</span><strong>{formatEuro(period.availableToSaveCents)}</strong></div>)}<div className="evidence-summary"><span>Available to save · period total</span><strong>{formatEuro(observedSavingsCents)}</strong></div><div className="evidence-summary"><span>Unexpected expense · {expenses.length} transaction{expenses.length === 1 ? '' : 's'}</span><strong>−{formatEuro(unexpectedExpenseCents)}</strong></div><div className="evidence-summary"><span>Estimated safe surplus after expense · monthly</span><strong>{formatEuro(safeMonthly)}</strong></div></div>
    <div className="evidence-group"><div className="group-title">{mode === 'afterExpense' ? 'UNEXPECTED EXPENSE' : 'YOUR PLAN'}<span>{expenses.length ? `${expenses.length} item` : 'Based on your plan'}</span></div>{expenses.length ? expenses.filter((item) => expenseIds.has(item.id)).map((item) => <EvidenceRow key={item.id} item={item} negative/>) : result.breakdown.map((period) => <div className="evidence-summary" key={period.month}><span>Planned savings · {formatMonth(period.month)}</span><strong>{formatEuro(period.availableToSaveCents)}</strong></div>)}</div>
    {history.length > 0 && <div className="evidence-group"><div className="group-title">DELIVERY SPENDING HISTORY<span>{history.length} transactions</span></div>{history.map((item) => <EvidenceRow key={item.id} item={item}/>)}</div>}
    <div className="assumption-box"><div className="assumption-icon"><ShieldCheck size={17}/></div><div><strong>Assumptions & missing inputs</strong><p>This conditional preview uses the supplied demo transactions. It doesn’t include other accounts or future costs.</p></div></div>
    {result.recoveryOption && <div className="evidence-footnote">Recovery trims are based on three delivery transactions, with median monthly spend of {formatEuro(result.recoveryOption.estimatedSavingsPerDeliveryCents)}.</div>}
    <button className="modal-done" onClick={onClose}>Got it</button>
  </section></div>;
}

function EvidenceRow({ item, negative }) {
  return <div className="evidence-row"><div className={`transaction-icon ${negative ? 'expense' : ''}`}>{negative ? <ArrowDownLeft size={17}/> : <span>↗</span>}</div><div className="transaction-info"><strong>{item.merchant || item.label || 'Planned savings'}</strong><span>{formatDate(item.date)} <i>·</i> <small>{item.id}</small></span></div><strong className={`transaction-amount ${negative ? 'negative' : ''}`}>{negative ? '−' : ''}{formatEuro(item.amountCents)}</strong></div>;
}

export default function App() {
  const [goals, setGoals] = useState(loadGoals);
  const [activeTab, setActiveTab] = useState('home');
  const mode = 'afterExpense';
  const [previewGoalId, setPreviewGoalId] = useState(null);
  const [evidenceData, setEvidenceData] = useState(null);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(goals)); } catch { /* storage is optional in private browsing */ }
  }, [goals]);
  useEffect(() => {
    if (!evidenceData) return undefined;
    const handleKeyDown = (event) => event.key === 'Escape' && setEvidenceData(null);
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [evidenceData]);

  const updateShort = (id, patch) => setGoals((current) => ({ ...current, shortTermGoals: current.shortTermGoals.map((goal) => {
    if (goal.id !== id) return goal;
    const updated = { ...goal, ...patch };
    if (updated.complete && updated.savedCents < updated.targetCents) updated.complete = false;
    return updated;
  }) }));
  const addShort = () => setGoals((current) => ({ ...current, shortTermGoals: [...current.shortTermGoals, { id: `goal-${Date.now()}`, label: '', targetCents: 5000, savedCents: 0, targetDate: '2027-02-14', complete: false }] }));
  const removeShort = (id) => setGoals((current) => ({ ...current, shortTermGoals: current.shortTermGoals.filter((goal) => goal.id !== id) }));
  const addLong = () => setGoals((current) => ({ ...current, longTermGoals: [...current.longTermGoals, { id: `long-${Date.now()}`, label: '', targetCents: 500000, savedCents: 0, monthlyCents: 0, accountType: 'S-Tuottotili', years: 5, bonusSavings: false, bonusMonthlyCents: 0, cardMicroSaving: false, microCentsPerTransaction: 10, fixedRateBps: 200, termYears: 1, complete: false }] }));
  const removeLong = (id) => setGoals((current) => ({ ...current, longTermGoals: current.longTermGoals.filter((goal) => goal.id !== id) }));
  const updateLong = (id, patch) => setGoals((current) => ({ ...current, longTermGoals: current.longTermGoals.map((goal) => {
    if (goal.id !== id) return goal;
    const updated = { ...goal, ...patch };
    if (updated.savedCents < updated.targetCents) updated.complete = false;
    return updated;
  }) }));
  const title = activeTab === 'goals' ? 'Your goals' : activeTab === 'coach' ? 'Coach' : 'Your money plan';

  return <div className="page-shell">
    <Header/>
    <main className="main-content">
      <div className="welcome-row"><div><span className="welcome-overline">DEMO CUSTOMER · {dateLabel.toUpperCase()}</span><h1>{title}</h1></div><div className="avatar" aria-hidden="true">1</div></div>
      {activeTab === 'goals' ? <GoalPlanner goals={goals} updateShort={updateShort} removeShort={removeShort} addShort={addShort} updateLong={updateLong} removeLong={removeLong} addLong={addLong} mode={mode} openEvidence={(goal, result) => setEvidenceData({ goal, result, mode })} previewId={previewGoalId} setPreviewId={setPreviewGoalId}/>
        : activeTab === 'coach' ? <CoachPage goals={goals} onOpenGoals={() => setActiveTab('goals')}/>
          : <div className="home-page"><section className="home-hero"><div className="home-hero-copy"><span className="eyebrow">A PLAN THAT FITS YOU</span><h2>Small steps. Bigger plans.</h2><p>Tell us what matters, then make a monthly plan that feels doable.</p><button className="primary-button" onClick={() => setActiveTab('goals')}>Set my goals <ArrowRight size={18}/></button></div><div className="home-illustration" aria-hidden="true"><PiggyBank size={34}/></div></section><section className="card home-summary"><div className="eyebrow">YOUR SAVED GOALS</div>{goals.shortTermGoals.map(goal => <div className="home-summary-item" key={goal.id}><span>{goal.complete ? <Check size={17}/> : <Leaf size={17}/>}</span><div><strong>{goal.label || 'Short-term goal'}</strong><small>{formatEuro(goal.targetCents)} by {formatDate(goal.targetDate)}{goal.complete ? ' · Complete' : ''}</small></div></div>)}{goals.longTermGoals.map(goal => <div className="home-summary-item" key={goal.id}><span><PiggyBank size={17}/></span><div><strong>{formatEuro(getGoalMonthlyContribution(goal))} monthly · {goal.label}</strong><small>{goal.accountType} · {goal.years}-year timeline</small></div></div>)}<button className="text-button" onClick={() => setActiveTab('coach')}>Ask Coach to recall my goals <ChevronRight size={17}/></button></section></div>}
    </main>
    <BottomNav activeTab={activeTab} setActiveTab={setActiveTab}/>
    {evidenceData && <EvidenceModal result={evidenceData.result} goal={evidenceData.goal} mode={evidenceData.mode} onClose={() => setEvidenceData(null)}/>}
  </div>;
}
