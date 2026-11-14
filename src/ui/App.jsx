import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowRight, Bell, Check, ChevronRight, CircleHelp, House, Leaf, Menu, MoreHorizontal, PiggyBank, ShieldCheck, Sparkles, X, TrendingUp } from 'lucide-react';
import fixture from '../../fixtures/coach-demo.json';
import { calculateGoalPlan } from '../coach.mjs';

const formatEuro = (cents) => `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
const formatDate = (date) => new Intl.DateTimeFormat('fi-FI', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));
const formatMonth = (month) => new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(`${month}-01T12:00:00`));
const dateLabel = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${fixture.asOf}T12:00:00`));

function calculateScenario(scenario) {
  return calculateGoalPlan({ goal: fixture.goal, periods: fixture.periods, deliveryHistory: fixture.deliveryHistory, newExpenses: scenario.newExpenses });
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

function ProgressRing({ progress }) {
  return <div className="progress-ring" style={{ '--progress': `${progress}%` }}><div className="ring-inner"><span className="ring-check"><Check size={16} /></span><span className="ring-caption">SAVING FOR</span><strong>Your trip</strong></div></div>;
}

function GoalCard({ result, baseline, mode, onEvidence, preview, setPreview, risk, setRisk, autoInvest, setAutoInvest }) {
  const displayedCents = preview && result.recoveryOption ? result.recoveryOption.projectedSavedIfFollowedCents : result.projectedSavedCents;
  const progress = Math.min(100, Math.round(displayedCents / fixture.goal.targetCents * 100));
  const recovered = preview && result.recoveryOption;
  const surplusCents = Math.max(0, fixture.periods.reduce((sum, period) => sum + period.availableToSaveCents, 0) - (mode === 'afterExpense' ? fixture.scenarios.afterExpense.newExpenses.reduce((sum, expense) => sum + expense.amountCents, 0) : 0));
  const monthlyCents = Math.round(surplusCents / fixture.periods.length);
  const annualRates = { Conservative: 0.03, Balanced: 0.06, Growth: 0.09 };
  const years = fixture.longTermGoal.horizonYears;
  const contributedCents = monthlyCents * 12 * years;
  const projectedCents = Array.from({ length: years * 12 }).reduce((total) => Math.round(total * (1 + annualRates[risk] / 12) + monthlyCents), 0);
  return <div className="goal-sections">
    <section className="card goal-card">
    <div className="card-heading"><div><div className="eyebrow">SHORT-TERM · WEEKS TO 12 MONTHS</div><h2>That trip is getting closer</h2></div><button className="help-button" aria-label="About short-term goals"><CircleHelp size={19} /></button></div>
    <div className="goal-content">
      <ProgressRing progress={progress} />
      <div className="goal-numbers"><span className="eyebrow">PROJECTED BY 31 JAN</span><div className="projection">{formatEuro(displayedCents)}</div><div className="goal-target">of {formatEuro(fixture.goal.targetCents)} goal</div><div className="goal-badge"><span />{formatEuro(fixture.goal.savedCents)} saved so far</div></div>
    </div>
    <div className={`insight ${mode === 'afterExpense' ? 'alert-insight' : ''}`}>
      <span className="insight-icon">{mode === 'afterExpense' ? <Sparkles size={18} /> : <Leaf size={18} />}</span>
      <p>{mode === 'afterExpense' ? <>The {fixture.scenarios.afterExpense.newExpenses[0].label.toLowerCase()} reduced your projection from <strong>{formatEuro(baseline.projectedSavedCents)}</strong> to <strong>{formatEuro(result.projectedSavedCents)}</strong>.</> : <>Your projection is <strong>{formatEuro(result.projectedSavedCents)}</strong> by {new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long' }).format(new Date(`${fixture.goal.targetDate}T12:00:00`))}, against your {formatEuro(fixture.goal.targetCents)} goal.</>}</p>
    </div>
    <div className="card-actions">
      {result.recoveryOption && <button className={`primary-button ${recovered ? 'active-preview' : ''}`} aria-pressed={Boolean(recovered)} onClick={() => setPreview(!preview)}>{recovered ? <><Check size={18} /> Preview on</> : <>Try this <ArrowRight size={18} /></>}</button>}
      <button className="text-button" onClick={onEvidence}>Inspect Evidence <ChevronRight size={17} /></button>
    </div>
    <div className="contribution-line"><span>Needed to reach €240 in 3 months</span><strong>{formatEuro(Math.ceil(Math.max(0, fixture.goal.targetCents - fixture.goal.savedCents) / fixture.periods.length))}/month · {formatEuro(Math.ceil(Math.max(0, fixture.goal.targetCents - fixture.goal.savedCents) / fixture.periods.length / 4))}/week</strong></div>
    {recovered && <div className="preview-note" role="status"><span className="preview-dot" /> Preview only: {result.recoveryOption.months.length} monthly delivery adjustments of {formatEuro(result.recoveryOption.estimatedSavingsPerDeliveryCents)} would bring the projection to {formatEuro(displayedCents)}. No money moves.</div>}
    <div className="safety-check"><ShieldCheck size={17}/><span><strong>Daily safety buffer check</strong><br/>€500 illustrative floor · daily cash-balance data isn’t included in this demo, so confirm your live balance before saving.</span></div>
    <div className="recovery-summary"><strong>Recovery preview</strong><span>Unexpected expense: −€60</span><span>Trim delivery: 3 × €10 = +€30</span><span>Goal projection: {formatEuro(result.projectedSavedCents)} → {formatEuro(result.recoveryOption?.projectedSavedIfFollowedCents ?? result.projectedSavedCents)}</span></div>
    </section>
    <section className="card goal-card long-term-card">
      <div className="card-heading"><div><div className="eyebrow">LONG-TERM · 2+ YEARS</div><h2>Grow your long-term wealth</h2></div><button className="help-button" aria-label="About long-term goals"><CircleHelp size={19} /></button></div>
      <div className="long-intro"><span className="long-icon"><TrendingUp size={20}/></span><div><strong>Invest in S-Pankki funds</strong><small>From detected available-to-save cash · projection only</small></div></div>
      <div className="surplus-line"><span>Detected safe monthly surplus</span><strong>{formatEuro(monthlyCents)}</strong></div>
      <label className="risk-label">Risk level<select value={risk} onChange={event => setRisk(event.target.value)}><option>Conservative</option><option>Balanced</option><option>Growth</option></select></label>
      <div className="auto-options">{[['recurring','Recurring monthly transfer'],['roundups','Card round-ups & micro-saving'],['bonus','Route S-Group Bonus to funds']].map(([key,label])=><label key={key}><input type="checkbox" checked={autoInvest[key]} onChange={event => setAutoInvest({...autoInvest,[key]:event.target.checked})}/>{label}</label>)}</div>
      <div className="growth-box"><div className="growth-heading"><strong>{years}-year illustration</strong><span>Non-guaranteed simulation</span></div><div className="growth-compare"><div><small>Cash only</small><strong>{formatEuro(contributedCents)}</strong></div><div><small>Projected fund value</small><strong>{formatEuro(projectedCents)}</strong></div></div><div className="growth-bar"><span style={{width:`${Math.min(100,Math.round(contributedCents/projectedCents*100))}%`}}/></div><div className="growth-legend"><span><i className="contributed-dot"/>Total contributed {formatEuro(contributedCents)}</span><span><i/>Estimated market growth {formatEuro(Math.max(0,projectedCents-contributedCents))}</span></div><small className="simulation-note">Assumes {Math.round(annualRates[risk]*100)}% annual return, compounded monthly; actual returns vary and may be negative. No money moves.</small></div>
      {mode === 'afterExpense' && <div className="insight alert-insight"><span className="insight-icon"><Sparkles size={18}/></span><p>After the unexpected expense, protect your cash buffer first. Consider temporarily pausing or lowering this long-term contribution.</p></div>}
      <div className="card-actions"><button className="text-button" onClick={onEvidence}>Inspect Evidence <ChevronRight size={17}/></button></div>
    </section>
  </div>;
}

function BottomNav({ activeTab, setActiveTab }) {
  return <nav className="bottom-nav"><button className={`nav-item ${activeTab === 'home' ? 'selected' : ''}`} onClick={() => setActiveTab('home')}><House size={20} /><span>Home</span></button><button className="nav-item" onClick={() => setActiveTab('money')}><Wallet size={20} /><span>Money</span></button><button className={`nav-item center-nav ${activeTab === 'goals' ? 'selected' : ''}`} onClick={() => setActiveTab('goals')}><span><PiggyBank size={21} /></span><span>Goals</span></button><button className="nav-item" onClick={() => setActiveTab('benefits')}><Sparkles size={20} /><span>Benefits</span></button><button className="nav-item" onClick={() => setActiveTab('profile')}><MoreHorizontal size={20} /><span>More</span></button></nav>;
}

function EvidenceModal({ result, mode, onClose }) {
  const expenseIds = new Set(result.breakdown.flatMap((period) => period.expenseIds));
  const expenses = fixture.scenarios[mode].newExpenses;
  const history = fixture.deliveryHistory.filter((item) => result.recoveryOption?.evidenceIds.includes(item.id));
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="evidence-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
    <div className="modal-grabber" /><div className="modal-header"><div><div className="eyebrow">THE DETAILS BEHIND YOUR PLAN</div><h2 id="evidence-title">Why {formatEuro(result.projectedSavedCents)}?</h2></div><button className="close-button" onClick={onClose} aria-label="Close evidence"><X size={20} /></button></div>
    <p className="modal-intro">Here’s what the projection uses. You can review each item that shaped your plan.</p>
    <div className="evidence-group"><div className="group-title">{mode === 'afterExpense' ? 'UNEXPECTED EXPENSE' : 'YOUR PLAN'}<span>{expenses.length ? '1 item' : 'Based on your plan'}</span></div>
      {expenses.length ? expenses.filter((item) => expenseIds.has(item.id)).map((item) => <EvidenceRow key={item.id} item={item} negative />) : result.breakdown.map((period) => <div className="evidence-summary" key={period.month}><span>Planned savings · {formatMonth(period.month)}</span><strong>{formatEuro(period.availableToSaveCents)}</strong></div>)}
    </div>
    {history.length > 0 && <div className="evidence-group"><div className="group-title">DELIVERY SPENDING HISTORY<span>{history.length} transactions</span></div>{history.map((item) => <EvidenceRow key={item.id} item={item} />)}</div>}
    <div className="assumption-box"><div className="assumption-icon"><ShieldCheck size={17} /></div><div><strong>Assumptions & missing inputs</strong><p>This is a conditional projection based on your available-to-save plan and the transactions shown. Other accounts or future costs may not be included.</p></div></div>
    {result.recoveryOption && <div className="evidence-footnote">Your preview estimate is based on the median of these three delivery transactions: {formatEuro(result.recoveryOption.estimatedSavingsPerDeliveryCents)} per month.</div>}
    <button className="modal-done" onClick={onClose}>Got it</button>
  </section></div>;
}

function EvidenceRow({ item, negative }) {
  const idLabel = item.id;
  return <div className="evidence-row"><div className={`transaction-icon ${negative ? 'expense' : ''}`}>{negative ? <ArrowDownLeft size={17} /> : <span>↗</span>}</div><div className="transaction-info"><strong>{item.merchant || item.label || 'Planned savings'}</strong><span>{formatDate(item.date)} <i>·</i> <small>{idLabel}</small></span></div><strong className={`transaction-amount ${negative ? 'negative' : ''}`}>{negative ? '−' : ''}{formatEuro(item.amountCents)}</strong></div>;
}

export default function App() {
  const [risk, setRisk] = useState(fixture.longTermGoal.risk);
  const [autoInvest, setAutoInvest] = useState({ recurring: true, roundups: false, bonus: false });
  const [activeTab, setActiveTab] = useState('home');
  const [mode, setMode] = useState('afterExpense');
  const [preview, setPreview] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const result = useMemo(() => calculateScenario(fixture.scenarios[mode]), [mode]);
  const baseline = useMemo(() => calculateScenario(fixture.scenarios.beforeExpense), []);
  useEffect(() => {
    if (!evidenceOpen) return undefined;
    const handleKeyDown = (event) => event.key === 'Escape' && setEvidenceOpen(false);
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [evidenceOpen]);
  return <div className="page-shell"><Header mode={mode} setMode={(value) => { setMode(value); setPreview(false); }} /><main className="main-content"><div className="welcome-row"><div><span className="welcome-overline">DEMO CUSTOMER · {dateLabel.toUpperCase()}</span><h1>{activeTab === 'goals' ? 'Goals & plans' : 'Your money plan'}</h1></div><div className="avatar" aria-hidden="true">1</div></div>{activeTab === 'goals' ? <><div className="goals-intro"><strong>Plan for what matters to you</strong><p>Build a cash cushion for goals coming up soon, or explore how investing your safe monthly surplus could grow over time.</p></div><GoalCard result={result} baseline={baseline} mode={mode} onEvidence={() => setEvidenceOpen(true)} preview={preview} setPreview={setPreview} risk={risk} setRisk={setRisk} autoInvest={autoInvest} setAutoInvest={setAutoInvest} /><div className="trust-line"><ShieldCheck size={15} /><span>Projection only · no money moves</span></div></> : <section className="card home-goals-card"><div className="eyebrow">YOUR GOALS</div><h2>Short-term savings and long-term investing</h2><p>Explore a savings plan for the next 12 months and a fund growth illustration for the years ahead.</p><button className="primary-button" onClick={() => setActiveTab('goals')}>Open Goals <ArrowRight size={18}/></button></section>}</main><BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />{evidenceOpen && <EvidenceModal result={result} mode={mode} onClose={() => setEvidenceOpen(false)} />}</div>;
}
