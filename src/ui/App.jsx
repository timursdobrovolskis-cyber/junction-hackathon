import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowRight, Bell, Check, ChevronRight, House, Leaf, Menu, MessageCircle, PiggyBank, ShieldCheck, Sparkles, TrendingUp, X } from 'lucide-react';
import fixture from '../../fixtures/coach-demo.json';
import { calculateGoalPlan } from '../coach.mjs';

const STORAGE_KEY = 'smobiili-goals-v1';
const formatEuro = (cents) => `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
const formatDate = (date) => new Intl.DateTimeFormat('fi-FI', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
const formatMonth = (month) => new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(`${month}-01T12:00:00`));
const dateLabel = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${fixture.asOf}T12:00:00`));
const defaults = {
  shortTerm: { label: fixture.goal.label, targetCents: fixture.goal.targetCents, savedCents: fixture.goal.savedCents, targetDate: fixture.goal.targetDate },
  longTerm: { monthlyCents: 2000, risk: fixture.longTermGoal.risk, years: fixture.longTermGoal.horizonYears },
};
const annualRates = { Conservative: 0.03, Balanced: 0.06, Growth: 0.09 };

function loadGoals() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    return saved?.shortTerm && saved?.longTerm ? saved : defaults;
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

function Header({ mode, setMode }) {
  return <header className="app-header">
    <div className="header-row">
      <button className="icon-button header-menu" aria-label="Open menu"><Menu size={22} /></button>
      <div className="brand"><span className="brand-mark"><span /></span><span>s-mobiili</span></div>
      <button className="icon-button notification" aria-label="Notifications"><Bell size={20} /><i /></button>
    </div>
    <div className="demo-switch" aria-label="Demo scenario">
      <span className="demo-label">DEMO VIEW</span>
      <div className="switch-track" role="group" aria-label="Choose projection scenario">
        <button aria-pressed={mode === 'beforeExpense'} className={mode === 'beforeExpense' ? 'selected' : ''} onClick={() => setMode('beforeExpense')}>Before · €270</button>
        <button aria-pressed={mode === 'afterExpense'} className={mode === 'afterExpense' ? 'selected' : ''} onClick={() => setMode('afterExpense')}>After · €210</button>
      </div>
      <div className="profile-slot" aria-label="Demo customer 1 of 2"><span>1</span><span className="profile-total">/ 2</span></div>
    </div>
  </header>;
}

function GoalProgress({ progress, label }) {
  return <div className="progress-ring playful-ring" style={{ '--progress': `${progress}%` }}><div className="ring-inner"><span className="ring-check"><PiggyBank size={16} /></span><span className="ring-caption">SAVING FOR</span><strong>{label || 'Your goal'}</strong></div></div>;
}

function ShortTermGoal({ goal, updateGoal, result, baseline, mode, onEvidence, preview, setPreview }) {
  const displayedCents = preview && result.recoveryOption ? result.recoveryOption.projectedSavedIfFollowedCents : result.projectedSavedCents;
  const progress = Math.max(0, Math.min(100, Math.round(displayedCents / Math.max(1, goal.targetCents) * 100)));
  const remainingCents = Math.max(0, goal.targetCents - goal.savedCents);
  const neededMonthly = Math.ceil(remainingCents / monthsUntil(goal.targetDate));
  const recovered = preview && result.recoveryOption;
  return <section className="card goal-card short-goal-card">
    <div className="goal-section-heading"><span className="goal-emoji">🌱</span><div><div className="eyebrow">SHORT-TERM · WEEKS TO 12 MONTHS</div><h2>Your next little big thing</h2></div></div>
    <p className="goal-description">Choose something you want, set a date, and we’ll help you make a steady plan.</p>
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
    <div className="contribution-line"><span>To reach your goal by {formatDate(goal.targetDate)}</span><strong>{formatEuro(neededMonthly)} / month · {formatEuro(Math.ceil(neededMonthly / 4))} / week</strong></div>
    <div className="card-actions">{result.recoveryOption && <button className={`primary-button ${recovered ? 'active-preview' : ''}`} aria-pressed={Boolean(recovered)} onClick={() => setPreview(!preview)}>{recovered ? <><Check size={18} /> Recovery preview on</> : <>Try recovery idea <ArrowRight size={18} /></>}</button>}<button className="text-button" onClick={onEvidence}>Inspect Evidence <ChevronRight size={17} /></button></div>
    {recovered && <div className="preview-note" role="status"><span className="preview-dot" /> Preview only: {result.recoveryOption.months.length} monthly delivery trims could add {formatEuro(result.recoveryOption.estimatedSavingsCents)} to the projection. No money moves.</div>}
    <div className="safety-check"><ShieldCheck size={17}/><span><strong>Daily safety buffer check</strong><br/>A €500 floor is illustrative. This demo has no daily balance feed; confirm your live cash balance before saving.</span></div>
    <div className="recovery-summary"><strong>What changed in the preview?</strong><span>Unexpected expense: −€60</span><span>Suggested category trim: 3 × €10 = +€30</span><span>Example projection: {formatEuro(result.projectedSavedCents)} → {formatEuro(result.recoveryOption?.projectedSavedIfFollowedCents ?? result.projectedSavedCents)}</span></div>
  </section>;
}

function LongTermGoal({ goal, updateGoal, mode }) {
  const safeSurplusCents = Math.max(0, Math.round((fixture.periods.reduce((sum, period) => sum + period.availableToSaveCents, 0) - (mode === 'afterExpense' ? fixture.scenarios.afterExpense.newExpenses.reduce((sum, expense) => sum + expense.amountCents, 0) : 0)) / fixture.periods.length));
  const monthlyCents = Math.max(0, goal.monthlyCents);
  const contributedCents = monthlyCents * 12 * goal.years;
  const projectedCents = Array.from({ length: goal.years * 12 }).reduce((total) => Math.round(total * (1 + annualRates[goal.risk] / 12) + monthlyCents), 0);
  const aboveSurplus = monthlyCents > safeSurplusCents;
  return <section className="card goal-card long-term-card">
    <div className="goal-section-heading"><span className="goal-emoji">🌳</span><div><div className="eyebrow">LONG-TERM · 2+ YEARS</div><h2>Build your future, month by month</h2></div></div>
    <p className="goal-description">Choose a fixed monthly amount for an S-Pankki fund. Change it whenever your plans change.</p>
    <div className="fund-banner"><span className="fund-icon"><TrendingUp size={19}/></span><span><strong>S-Pankki funds</strong><small>Illustrative in-app investment plan · no transfer is made</small></span></div>
    <label className="field-label contribution-field">Monthly contribution<input type="number" min="0" step="1" value={(monthlyCents / 100).toFixed(2)} onChange={(event) => updateGoal({ monthlyCents: euroToCents(event.target.value) })} /><span>Set the amount you want to invest each month.</span></label>
    <label className="range-label">Adjust amount <strong>{formatEuro(monthlyCents)} / month</strong><input type="range" min="0" max="1000" step="5" value={Math.min(monthlyCents, 100000)} onChange={(event) => updateGoal({ monthlyCents: Number(event.target.value) * 100 })} aria-label="Monthly investment contribution in euros" /></label>
    <div className="surplus-line"><span>Demo safe monthly surplus</span><strong>{formatEuro(safeSurplusCents)}</strong></div>
    {aboveSurplus && <div className="surplus-warning" role="status"><Sparkles size={16}/><span>Your chosen contribution is above this demo’s detected surplus. Check your cash buffer and adjust if needed.</span></div>}
    <div className="goal-field-row long-controls"><label className="field-label">Risk level<select value={goal.risk} onChange={(event) => updateGoal({ risk: event.target.value })}><option>Conservative</option><option>Balanced</option><option>Growth</option></select></label><label className="field-label">Time to grow<select value={goal.years} onChange={(event) => updateGoal({ years: Number(event.target.value) })}>{[2,5,10,15,20,25,30].map(year => <option key={year} value={year}>{year} years</option>)}</select></label></div>
    <div className="auto-options"><label><input type="checkbox" checked readOnly/>Monthly recurring contribution selected</label><small>In the real bank app, you would confirm or change this standing instruction before any transfer.</small></div>
    <div className="growth-box"><div className="growth-heading"><strong>{goal.years}-year illustration</strong><span>Non-guaranteed simulation</span></div><div className="growth-compare"><div><small>Cash contributed</small><strong>{formatEuro(contributedCents)}</strong></div><div><small>Projected fund value</small><strong>{formatEuro(projectedCents)}</strong></div></div><div className="growth-bar"><span style={{ width: `${projectedCents ? Math.min(100, Math.round(contributedCents / projectedCents * 100)) : 0}%` }}/></div><div className="growth-legend"><span><i className="contributed-dot"/>Total contributed {formatEuro(contributedCents)}</span><span><i/>Estimated market growth {formatEuro(Math.max(0, projectedCents-contributedCents))}</span></div><small className="simulation-note">Assumes {Math.round(annualRates[goal.risk] * 100)}% annual return, compounded monthly. Returns are not guaranteed and can be negative. No money moves.</small></div>
    {mode === 'afterExpense' && <div className="insight alert-insight"><span className="insight-icon"><Sparkles size={18}/></span><p>After the unexpected expense, protect your cash buffer first. If needed, pause or lower this monthly investment before changing essential spending.</p></div>}
  </section>;
}

function GoalPlanner({ goals, updateShort, updateLong, result, baseline, mode, onEvidence, preview, setPreview }) {
  return <div className="goal-sections"><div className="goals-intro playful-intro"><strong>Two horizons, one plan ✨</strong><p>Make a near-term goal your own, then set a steady monthly amount for your future.</p><span><Check size={14}/> Your goals are saved on this device for Coach</span></div><ShortTermGoal goal={goals.shortTerm} updateGoal={updateShort} result={result} baseline={baseline} mode={mode} onEvidence={onEvidence} preview={preview} setPreview={setPreview}/><LongTermGoal goal={goals.longTerm} updateGoal={updateLong} mode={mode}/></div>;
}

function CoachPage({ goals, onOpenGoals }) {
  const [question, setQuestion] = useState('');
  const shortGoal = goals.shortTerm;
  const longGoal = goals.longTerm;
  const response = question === 'monthly' ? `You chose ${formatEuro(longGoal.monthlyCents)} a month for S-Pankki funds over ${longGoal.years} years. I’ll use that as your long-term plan when you come back.` : `You’re saving for ${shortGoal.label || 'your short-term goal'}: ${formatEuro(shortGoal.targetCents)} by ${formatDate(shortGoal.targetDate)}. You’ve saved ${formatEuro(shortGoal.savedCents)} so far. I’ll remember these details on this device.`;
  return <div className="coach-page">
    <section className="coach-welcome"><div className="coach-avatar"><Sparkles size={20}/></div><div><div className="eyebrow">YOUR MONEY COACH</div><h2>Hi! I remember your goals.</h2><p>Your saved plan is here whenever we talk.</p></div></section>
    <div className="coach-bubble"><span className="coach-bubble-icon"><MessageCircle size={17}/></span><p>{response}</p></div>
    <div className="coach-prompts"><button onClick={() => setQuestion('short')}>What am I saving for?</button><button onClick={() => setQuestion('monthly')}>What’s my monthly fund amount?</button></div>
    <section className="card remembered-goals"><div className="card-heading"><div><div className="eyebrow">SAVED GOALS</div><h2>What we’re working toward</h2></div><span className="remembered-sparkle">✦</span></div>
      <div className="remembered-goal-row"><span className="remembered-emoji">🌱</span><div><small>SHORT-TERM</small><strong>{shortGoal.label || 'Your short-term goal'}</strong><span>{formatEuro(shortGoal.targetCents)} target · {formatDate(shortGoal.targetDate)}</span></div></div>
      <div className="remembered-goal-row"><span className="remembered-emoji">🌳</span><div><small>LONG-TERM</small><strong>{formatEuro(longGoal.monthlyCents)} each month in funds</strong><span>{longGoal.risk} simulation · {longGoal.years} years</span></div></div>
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

export default function App() {
  const [goals, setGoals] = useState(loadGoals);
  const [activeTab, setActiveTab] = useState('home');
  const [mode, setMode] = useState('afterExpense');
  const [preview, setPreview] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const goal = goals.shortTerm;
  const result = useMemo(() => makePlanResult(mode, goal), [mode, goal]);
  const baseline = useMemo(() => makePlanResult('beforeExpense', goal), [goal]);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(goals)); } catch { /* storage is optional in private browsing */ }
  }, [goals]);
  useEffect(() => {
    if (!evidenceOpen) return undefined;
    const handleKeyDown = (event) => event.key === 'Escape' && setEvidenceOpen(false);
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [evidenceOpen]);

  const updateShort = (patch) => setGoals((current) => ({ ...current, shortTerm: { ...current.shortTerm, ...patch } }));
  const updateLong = (patch) => setGoals((current) => ({ ...current, longTerm: { ...current.longTerm, ...patch } }));
  const title = activeTab === 'goals' ? 'Your goals' : activeTab === 'coach' ? 'Coach' : 'Your money plan';

  return <div className="page-shell">
    <Header mode={mode} setMode={(value) => { setMode(value); setPreview(false); }}/>
    <main className="main-content">
      <div className="welcome-row"><div><span className="welcome-overline">DEMO CUSTOMER · {dateLabel.toUpperCase()}</span><h1>{title}</h1></div><div className="avatar" aria-hidden="true">1</div></div>
      {activeTab === 'goals' ? <GoalPlanner goals={goals} updateShort={updateShort} updateLong={updateLong} result={result} baseline={baseline} mode={mode} onEvidence={() => setEvidenceOpen(true)} preview={preview} setPreview={setPreview}/>
        : activeTab === 'coach' ? <CoachPage goals={goals} onOpenGoals={() => setActiveTab('goals')}/>
          : <div className="home-page"><section className="home-hero"><div className="home-hero-copy"><span className="eyebrow">A PLAN THAT FITS YOU</span><h2>Small steps. Big plans. 🌈</h2><p>Tell us what matters, then make a monthly plan that feels doable.</p><button className="primary-button" onClick={() => setActiveTab('goals')}>Set my goals <ArrowRight size={18}/></button></div><div className="home-illustration" aria-hidden="true">🌱</div></section><section className="card home-summary"><div className="eyebrow">YOUR SAVED GOALS</div><div className="home-summary-item"><span>🌱</span><div><strong>{goals.shortTerm.label || 'Short-term goal'}</strong><small>{formatEuro(goals.shortTerm.targetCents)} by {formatDate(goals.shortTerm.targetDate)}</small></div></div><div className="home-summary-item"><span>🌳</span><div><strong>{formatEuro(goals.longTerm.monthlyCents)} / month into funds</strong><small>{goals.longTerm.years}-year illustration · {goals.longTerm.risk}</small></div></div><button className="text-button" onClick={() => setActiveTab('coach')}>Ask Coach about my goals <ChevronRight size={17}/></button></section></div>}
    </main>
    <BottomNav activeTab={activeTab} setActiveTab={setActiveTab}/>
    {evidenceOpen && <EvidenceModal result={result} goal={goal} mode={mode} onClose={() => setEvidenceOpen(false)}/>}
  </div>;
}
