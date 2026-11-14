import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowRight, Bell, Check, ChevronRight, ExternalLink, House, Leaf, Menu, MessageCircle, PiggyBank, ShieldCheck, Sparkles, X } from 'lucide-react';
import fixture from './coach-demo.json';
import { calculateGoalPlan } from './coach.mjs';

const STORAGE_KEY = 'smobiili-goals-v1';
const formatEuro = (cents) => `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
const formatDate = (date) => new Intl.DateTimeFormat('fi-FI', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
const formatMonth = (month) => new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(`${month}-01T12:00:00`));
const dateLabel = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${fixture.asOf}T12:00:00`));
const defaults = {
  shortTermGoals: [{ id: 'goal-demo-1', label: fixture.goal.label, targetCents: fixture.goal.targetCents, savedCents: fixture.goal.savedCents, targetDate: fixture.goal.targetDate, complete: false }],
  longTerm: { monthlyCents: fixture.longTermGoal.monthlyContributionCents, accountType: fixture.longTermGoal.accountType, years: fixture.longTermGoal.horizonYears },
};

function loadGoals() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    if (!saved?.longTerm) return defaults;
    const shortTermGoals = saved.shortTermGoals ?? (saved.shortTerm ? [{ id: 'goal-demo-1', ...saved.shortTerm, complete: false }] : defaults.shortTermGoals);
    return { ...defaults, ...saved, shortTermGoals, longTerm: { ...defaults.longTerm, ...saved.longTerm, accountType: saved.longTerm.accountType ?? 'S-Tuottotili' } };
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

function makePlanResult(mode, goal) {
  return calculateGoalPlan({ goal, periods: fixture.periods, deliveryHistory: fixture.deliveryHistory, newExpenses: fixture.scenarios[mode].newExpenses });
}

function safeSurplusCents(mode) {
  return Math.max(0, Math.round((fixture.periods.reduce((sum, period) => sum + period.availableToSaveCents, 0) - (mode === 'afterExpense' ? fixture.scenarios.afterExpense.newExpenses.reduce((sum, expense) => sum + expense.amountCents, 0) : 0)) / fixture.periods.length));
}

function GoalProgress({ progress, label }) {
  return <div className="progress-ring playful-ring" style={{ '--progress': `${progress}%` }}><div className="ring-inner"><span className="ring-check"><PiggyBank size={16} /></span><span className="ring-caption">SAVING FOR</span><strong>{label || 'Your goal'}</strong></div></div>;
}

function ShortTermGoal({ goal, updateGoal, removeGoal, completeGoal, result, baseline, mode, onEvidence, preview, setPreview }) {
  const [editing, setEditing] = useState(!goal.label);
  const [showDetails, setShowDetails] = useState(false);
  const [deposit, setDeposit] = useState('');
  const isFunded = goal.savedCents >= goal.targetCents;
  const progress = Math.max(0, Math.min(100, Math.round(goal.savedCents / Math.max(1, goal.targetCents) * 100)));
  const remainingCents = Math.max(0, goal.targetCents - goal.savedCents);
  const neededMonthly = Math.ceil(remainingCents / monthsUntil(goal.targetDate));
  const recovered = preview && result.recoveryOption;
  const addDeposit = (event) => {
    event.preventDefault();
    const cents = euroToCents(deposit);
    if (cents > 0) updateGoal({ savedCents: goal.savedCents + cents });
    setDeposit('');
  };
  return <section className={`card goal-card short-goal-card compact-goal ${isFunded ? 'is-funded' : ''}`}>
    <div className="goal-section-heading"><span className="goal-emoji">{isFunded ? '🎉' : '🌱'}</span><div><div className="eyebrow">BY {formatDate(goal.targetDate).toUpperCase()}</div><h2>{goal.label || 'New goal'}</h2></div><button className="goal-remove" onClick={removeGoal} aria-label={`Delete ${goal.label || 'goal'}`}><X size={17}/></button></div>
    <div className="stack-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={`${goal.label || 'Goal'} progress`}><span style={{ width: `${progress}%` }}/></div>
    <div className="stack-amounts"><strong>{formatEuro(goal.savedCents)}</strong><span>of {formatEuro(goal.targetCents)} · {progress}%</span></div>
    {isFunded
      ? <button type="button" className="tick-off-button" onClick={completeGoal}><Check size={16}/> You made it — tick it off</button>
      : <>
          <div className="contribution-line"><span>{formatEuro(remainingCents)} to go</span><strong>{formatEuro(neededMonthly)} / month · {formatEuro(Math.ceil(neededMonthly / 4))} / week</strong></div>
          <form className="deposit-row" onSubmit={addDeposit}><input inputMode="decimal" type="number" min="0" step="0.01" value={deposit} onChange={(event) => setDeposit(event.target.value)} placeholder="Add saved €" aria-label={`Add money saved toward ${goal.label || 'goal'}`}/><button type="submit" disabled={!euroToCents(deposit)}>Add</button></form>
        </>}
    <div className="goal-toggles"><button type="button" className="text-button" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit goal'}</button><button type="button" className="text-button" aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}>{showDetails ? 'Hide plan details' : 'Plan details'} <ChevronRight size={15}/></button></div>
    {editing && <div className="goal-edit-grid">
      <label className="field-label">What are you saving for?<input value={goal.label} maxLength={32} onChange={(event) => updateGoal({ label: event.target.value })} placeholder="e.g. A weekend trip" /></label>
      <div className="goal-field-row">
        <label className="field-label">Target amount<input type="number" min="1" step="0.01" value={(goal.targetCents / 100).toFixed(2)} onChange={(event) => updateGoal({ targetCents: euroToCents(event.target.value) })} /></label>
        <label className="field-label">Saved so far<input type="number" min="0" step="0.01" value={(goal.savedCents / 100).toFixed(2)} onChange={(event) => updateGoal({ savedCents: euroToCents(event.target.value) })} /></label>
      </div>
      <label className="field-label">When would you like it?<input type="date" min={fixture.asOf} max="2027-11-14" value={goal.targetDate} onChange={(event) => event.target.value && updateGoal({ targetDate: event.target.value })} /></label>
    </div>}
    {showDetails && <div className="goal-details">
      <div className="goal-preview-row"><div className="goal-numbers"><span className="eyebrow">DEMO CASH-FLOW PREVIEW</span><div className="projection">{formatEuro(recovered ? result.recoveryOption.projectedSavedIfFollowedCents : result.projectedSavedCents)}</div><div className="goal-target">projected toward your {formatEuro(goal.targetCents)} goal</div></div></div>
      <div className={`insight ${mode === 'afterExpense' ? 'alert-insight' : ''}`}><span className="insight-icon">{mode === 'afterExpense' ? <Sparkles size={18} /> : <Leaf size={18} />}</span><p>{mode === 'afterExpense' ? <>The unexpected €60 expense brings this preview from <strong>{formatEuro(baseline.projectedSavedCents)}</strong> to <strong>{formatEuro(result.projectedSavedCents)}</strong>. You can try trimming three €10 delivery purchases to recover <strong>€30</strong>.</> : <>The current cash-flow preview reaches <strong>{formatEuro(result.projectedSavedCents)}</strong>. Keep adjusting your goal and timing to find a plan that feels right.</>}</p></div>
      <div className="card-actions">{result.recoveryOption && <button className={`primary-button ${recovered ? 'active-preview' : ''}`} aria-pressed={Boolean(recovered)} onClick={() => setPreview(recovered ? null : goal.id)}>{recovered ? <><Check size={18} /> Recovery preview on</> : <>Try recovery idea <ArrowRight size={18} /></>}</button>}<button className="text-button" onClick={onEvidence}>Inspect Evidence <ChevronRight size={17} /></button></div>
      {recovered && <div className="preview-note" role="status"><span className="preview-dot" /> Preview only: {result.recoveryOption.months.length} monthly delivery trims could add {formatEuro(result.recoveryOption.estimatedSavingsCents)} to the projection. No money moves.</div>}
      <div className="safety-check"><ShieldCheck size={17}/><span><strong>Daily safety buffer check</strong><br/>A €500 floor is illustrative. This demo has no daily balance feed; confirm your live cash balance before saving.</span></div>
    </div>}
  </section>;
}

function NewGoalForm({ onAdd, onCancel }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('2027-02-14');
  const targetCents = euroToCents(amount);
  const submit = (event) => {
    event.preventDefault();
    if (!label.trim() || targetCents <= 0) return;
    onAdd({ label: label.trim(), targetCents, targetDate: date });
  };
  return <form className="card new-goal-form" onSubmit={submit}>
    <div className="eyebrow">NEW SHORT-TERM GOAL</div>
    <label className="field-label">What do you want?<input autoFocus value={label} maxLength={32} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Concert tickets, new phone, trip to Tallinn"/></label>
    <div className="goal-field-row">
      <label className="field-label">How much (€)?<input inputMode="decimal" type="number" min="1" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="300"/></label>
      <label className="field-label">By when?<input type="date" min={fixture.asOf} max="2027-11-14" value={date} onChange={(event) => event.target.value && setDate(event.target.value)}/></label>
    </div>
    <div className="new-goal-actions"><button type="button" className="text-button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-button" disabled={!label.trim() || targetCents <= 0}>Add goal <ArrowRight size={16}/></button></div>
  </form>;
}

function LongTermGoal({ goal, updateGoal, mode }) {
  const [selectedMonth, setSelectedMonth] = useState(goal.years * 12);
  const safeSurplus = safeSurplusCents(mode);
  const monthlyCents = Math.max(0, goal.monthlyCents);
  const monthCount = goal.years * 12;
  const chartData = Array.from({ length: monthCount + 1 }, (_, month) => ({ month, savedCents: monthlyCents * month }));
  const activeMonth = Math.min(selectedMonth, monthCount);
  const activePoint = chartData[activeMonth];
  const maxValue = Math.max(1, chartData[monthCount].savedCents);
  const chartWidth = 320;
  const chartHeight = 150;
  const pointX = (month) => (month / monthCount) * chartWidth;
  const pointY = (cents) => chartHeight - (cents / maxValue) * chartHeight;
  const savingsPath = chartData.map((point, index) => `${index ? 'L' : 'M'} ${pointX(point.month).toFixed(2)} ${pointY(point.savedCents).toFixed(2)}`).join(' ');
  const savingsAreaPath = `${savingsPath} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`;
  const cursorX = pointX(activeMonth);
  const cursorY = pointY(activePoint.savedCents);
  const periodLabel = activeMonth === 0 ? 'Starting point' : `Year ${Math.ceil(activeMonth / 12)} · Month ${activeMonth}`;
  const pointerSelect = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setSelectedMonth(Math.round(ratio * monthCount));
  };
  const aboveSurplus = monthlyCents > safeSurplus;
  return <section className="card goal-card long-term-card">
    <div className="goal-section-heading"><span className="goal-emoji">🌳</span><div><div className="eyebrow">LONG-TERM · 2+ YEARS</div><h2>Build your future, month by month</h2></div></div>
    <p className="goal-description">Explore S-Pankki savings accounts and set your own monthly saving amount. This plan is only a preview; it won’t open an account or move money.</p>
    <label className="field-label account-type-field">S-Pankki savings account<select value={goal.accountType} onChange={(event) => updateGoal({ accountType: event.target.value })}><option>S-Tuottotili</option><option>S-Määräaikaistili</option></select></label>
    <a className="fund-banner fund-link" href="https://www.s-pankki.fi/fi/tilit/saastotilit/" target="_blank" rel="noreferrer"><span className="fund-icon"><PiggyBank size={19}/></span><span><strong>Explore S-Pankki savings accounts</strong><small>Compare account types and current terms</small></span><ExternalLink size={16}/></a>
    <div className="account-product-links"><a href="https://www.s-pankki.fi/fi/tilit/s-tuottotili/" target="_blank" rel="noreferrer"><strong>S-Tuottotili</strong><span>Ongoing savings with flexible deposits and withdrawals</span><ExternalLink size={14}/></a><a href="https://www.s-pankki.fi/fi/tilit/s-maaraaikaistili/" target="_blank" rel="noreferrer"><strong>S-Määräaikaistili</strong><span>Deposit savings for an agreed term; check current terms</span><ExternalLink size={14}/></a></div>
    <label className="field-label contribution-field">Try a monthly saving amount<input type="number" min="0" step="1" value={(monthlyCents / 100).toFixed(2)} onChange={(event) => updateGoal({ monthlyCents: euroToCents(event.target.value) })} /><span>{goal.accountType === 'S-Määräaikaistili' ? 'Use this as a monthly savings target; a fixed-term deposit is set up separately for an agreed period.' : 'Use this as a monthly target for flexible savings; account deposits are set up separately with S-Pankki.'}</span></label>
    <label className="range-label">Adjust amount <strong>{formatEuro(monthlyCents)} / month</strong><input type="range" min="0" max="1000" step="5" value={Math.min(monthlyCents, 100000)} onChange={(event) => updateGoal({ monthlyCents: Number(event.target.value) * 100 })} aria-label="Monthly savings amount in euros" /></label>
    <div className="surplus-line"><span>Demo safe monthly surplus</span><strong>{formatEuro(safeSurplus)}</strong></div>
    {aboveSurplus && <div className="surplus-warning" role="status"><Sparkles size={16}/><span>Your chosen monthly amount is above this demo’s detected surplus. Check your cash buffer and adjust if needed.</span></div>}
    <label className="field-label time-horizon-field">Saving horizon<select value={goal.years} onChange={(event) => updateGoal({ years: Number(event.target.value) })}>{[2,5,10,15,20,25,30].map(year => <option key={year} value={year}>{year} years</option>)}</select></label>
    <div className="savings-timeline"><div className="savings-timeline-heading"><strong>{goal.years}-year savings timeline</strong><span>No interest included</span></div>
      <div className="savings-compare"><div><small>Monthly amount</small><strong>{formatEuro(monthlyCents)}</strong></div><div><small>Total deposits</small><strong>{formatEuro(chartData[monthCount].savedCents)}</strong></div></div>
      <div className="savings-chart-wrap">
        <div className="chart-cursor-tooltip" style={{ left: `${Math.max(18, Math.min(82, activeMonth / monthCount * 100))}%` }} aria-live="polite"><strong>{periodLabel}</strong><span>Saved by then {formatEuro(activePoint.savedCents)}</span><span>Monthly plan {formatEuro(monthlyCents)}</span></div>
        <svg className="savings-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label={`${goal.years}-year savings-account deposits timeline; interest is not included`} onPointerMove={pointerSelect} onPointerDown={pointerSelect}>
          {[0.25,0.5,0.75,1].map(fraction => <line key={fraction} x1="0" x2={chartWidth} y1={chartHeight * (1 - fraction)} y2={chartHeight * (1 - fraction)} className="chart-gridline"/>)}
          <path d={savingsAreaPath} className="chart-savings-area"/><path d={savingsPath} className="chart-savings-line"/>
          <line x1={cursorX} x2={cursorX} y1="0" y2={chartHeight} className="chart-cursor-line"/><circle cx={cursorX} cy={cursorY} r="4.5" className="chart-cursor-savings"/>
        </svg>
      </div>
      <div className="chart-axis-labels"><span>Now</span><span>Year {goal.years}</span></div>
      <input className="chart-scrubber" type="range" min="0" max={monthCount} value={activeMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))} aria-label="Explore savings account deposits by month"/>
      <div className="savings-legend"><span><i/>Monthly deposits · interest not included</span></div>
      <small className="simulation-note">This timeline multiplies your chosen monthly amount by the selected horizon. It does not estimate account interest, fees, or account terms. No account is opened and no money moves.</small>
    </div>
    {mode === 'afterExpense' && <div className="insight alert-insight"><span className="insight-icon"><Sparkles size={18}/></span><p>After the unexpected expense, protect your cash buffer first. If needed, lower this monthly saving plan before changing essential spending.</p></div>}
  </section>;
}

function GoalPlanner({ goals, updateShort, removeShort, addShort, completeShort, restoreShort, updateLong, mode, openEvidence, previewId, setPreviewId }) {
  const [adding, setAdding] = useState(false);
  const [showAchieved, setShowAchieved] = useState(false);
  const [horizon, setHorizon] = useState(() => { try { return sessionStorage.getItem('goals-horizon') || 'short'; } catch { return 'short'; } });
  const chooseHorizon = (value) => { setHorizon(value); try { sessionStorage.setItem('goals-horizon', value); } catch { /* optional */ } };
  const active = goals.shortTermGoals.filter(goal => !goal.complete);
  const achieved = goals.shortTermGoals.filter(goal => goal.complete);
  const shortMonthlyCents = active.reduce((sum, goal) => sum + Math.ceil(Math.max(0, goal.targetCents - goal.savedCents) / monthsUntil(goal.targetDate)), 0);
  const plannedMonthlyCents = shortMonthlyCents + goals.longTerm.monthlyCents;
  const safeMonthlyCents = safeSurplusCents(mode);
  return <div className="goal-sections">
    <div className="horizon-switch" role="tablist" aria-label="Goal horizon">
      <button type="button" role="tab" aria-selected={horizon === 'short'} className={horizon === 'short' ? 'active' : ''} onClick={() => chooseHorizon('short')}><strong>Short term</strong><small>Weeks to 12 months</small></button>
      <button type="button" role="tab" aria-selected={horizon === 'long'} className={horizon === 'long' ? 'active' : ''} onClick={() => chooseHorizon('long')}><strong>Long term</strong><small>2+ years</small></button>
    </div>
    <div className="goal-budget-strip"><div><small>GOALS’ MONTHLY PLAN</small><strong>{formatEuro(plannedMonthlyCents)}</strong></div><span>Demo safe surplus<br/><b>{formatEuro(safeMonthlyCents)} / month</b></span></div>
    {plannedMonthlyCents > safeMonthlyCents && <div className="surplus-warning" role="status"><Sparkles size={16}/><span>These goal amounts add up to more than the current demo surplus. Adjust the amounts or dates to keep your everyday cash buffer in mind.</span></div>}
    {horizon === 'short' && <section className="short-goals-list" role="tabpanel"><div className="list-section-heading"><div><h2>Your goals, your way</h2></div><span className="goals-count">{active.length} active{achieved.length ? ` · ${achieved.length} done` : ''}</span></div>
      <p className="horizon-hint">Write down anything you want. Stack as many as you like — when one is fully saved, tick it off.</p>
      {active.length === 0 && !adding && <div className="card goals-empty"><strong>No active goals</strong><p>Write down anything you want to save for — a trip, a gadget, a gift.</p></div>}
      {active.map((goal) => {
        const result = makePlanResult(mode, goal);
        const baseline = makePlanResult('beforeExpense', goal);
        return <ShortTermGoal key={goal.id} goal={goal} updateGoal={(patch) => updateShort(goal.id, patch)} removeGoal={() => removeShort(goal.id)} completeGoal={() => completeShort(goal.id)} result={result} baseline={baseline} mode={mode} onEvidence={() => openEvidence(goal, result)} preview={previewId === goal.id} setPreview={setPreviewId}/>;
      })}
      {adding
        ? <NewGoalForm onAdd={(goal) => { addShort(goal); setAdding(false); }} onCancel={() => setAdding(false)}/>
        : <button className="add-goal-button" onClick={() => setAdding(true)}><span>＋</span>Add a goal</button>}
      {achieved.length > 0 && <div className="achieved-goals">
        <button type="button" className="achieved-toggle" aria-expanded={showAchieved} onClick={() => setShowAchieved(!showAchieved)}>🏆 Achieved ({achieved.length}) <ChevronRight size={15}/></button>
        {showAchieved && <ul>{achieved.map(goal => <li key={goal.id}><Check size={14}/><span>{goal.label || 'Goal'} · {formatEuro(goal.targetCents)}</span><button type="button" className="text-button" onClick={() => restoreShort(goal.id)}>Undo</button></li>)}</ul>}
      </div>}
    </section>}
    {horizon === 'long' && <div role="tabpanel"><LongTermGoal goal={goals.longTerm} updateGoal={updateLong} mode={mode}/></div>}
  </div>;
}

function EvidenceModal({ result, goal, mode, onClose }) {
  const expenseIds = new Set(result.breakdown.flatMap((period) => period.expenseIds));
  const expenses = fixture.scenarios[mode].newExpenses;
  const history = fixture.deliveryHistory.filter((item) => result.recoveryOption?.evidenceIds.includes(item.id));
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="evidence-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
    <div className="modal-grabber"/><div className="modal-header"><div><div className="eyebrow">THE DETAILS BEHIND YOUR PLAN</div><h2 id="evidence-title">Why {formatEuro(result.projectedSavedCents)}?</h2></div><button className="close-button" onClick={onClose} aria-label="Close evidence"><X size={20}/></button></div>
    <p className="modal-intro">Here’s what the three-month demo projection uses for {goal.label || 'your goal'}.</p>
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

export default function App({ mode }) {
  const [goals, setGoals] = useState(loadGoals);
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
  const addShort = (goal) => setGoals((current) => ({ ...current, shortTermGoals: [...current.shortTermGoals, { id: `goal-${Date.now()}`, savedCents: 0, complete: false, ...goal }] }));
  const removeShort = (id) => setGoals((current) => ({ ...current, shortTermGoals: current.shortTermGoals.filter((goal) => goal.id !== id) }));
  const completeShort = (id) => updateShort(id, { complete: true });
  const restoreShort = (id) => setGoals((current) => ({ ...current, shortTermGoals: current.shortTermGoals.map((goal) => goal.id === id ? { ...goal, complete: false } : goal) }));
  const updateLong = (patch) => setGoals((current) => ({ ...current, longTerm: { ...current.longTerm, ...patch } }));
  return <>
    <GoalPlanner goals={goals} updateShort={updateShort} removeShort={removeShort} addShort={addShort} completeShort={completeShort} restoreShort={restoreShort} updateLong={updateLong} mode={mode} openEvidence={(goal, result) => setEvidenceData({ goal, result, mode })} previewId={previewGoalId} setPreviewId={setPreviewGoalId}/>
    {evidenceData && <EvidenceModal result={evidenceData.result} goal={evidenceData.goal} mode={evidenceData.mode} onClose={() => setEvidenceData(null)}/>}
  </>;
}
