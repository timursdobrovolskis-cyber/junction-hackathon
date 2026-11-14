import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowRight, Bell, Check, ChevronRight, ExternalLink, House, Leaf, Menu, MessageCircle, PiggyBank, ShieldCheck, Sparkles, X } from 'lucide-react';
import fixture from './coach-demo.json';
import { calculateGoalPlan } from './coach.mjs';
import { GoalArt, QUICK_PICKS, themeFor } from './GoalArt.jsx';

const STORAGE_KEY = 'smobiili-goals-v1';
const formatEuro = (cents) => '€' + (cents / 100).toLocaleString('en-IE', { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });
const formatDate = (date) => new Intl.DateTimeFormat('fi-FI', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
const formatMonth = (month) => new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(`${month}-01T12:00:00`));
const dateLabel = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${fixture.asOf}T12:00:00`));
const HORIZONS = {
  short: { max: '2027-11-14', defaultDate: '2027-02-14', placeholder: 'e.g. Concert tickets, new phone, trip to Tallinn', empty: 'a trip, a gadget, a gift' },
  long: { max: '2056-12-31', defaultDate: '2031-10-01', placeholder: 'e.g. Car, home deposit, emergency fund', empty: 'a car, a home deposit, a safety cushion' },
};
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

const shortDate = (date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`));

function ShortTermGoal({ goal, horizon = 'short', updateGoal, removeGoal, completeGoal, expanded, onToggle, leaving }) {
  const [editing, setEditing] = useState(false);
  const [deposit, setDeposit] = useState('');
  const isFunded = goal.savedCents >= goal.targetCents;
  const progress = Math.max(0, Math.min(100, Math.round(goal.savedCents / Math.max(1, goal.targetCents) * 100)));
  const remainingCents = Math.max(0, goal.targetCents - goal.savedCents);
  const months = monthsUntil(goal.targetDate);
  const neededMonthly = Math.ceil(remainingCents / months);
  const theme = themeFor(goal.label);
  const addDeposit = (event) => {
    event.preventDefault();
    const cents = euroToCents(deposit);
    if (cents > 0) quickAdd(cents);
    setDeposit('');
  };
  const [lastAdd, setLastAdd] = useState(null);
  useEffect(() => { if (!lastAdd) return undefined; const timer = setTimeout(() => setLastAdd(null), 4000); return () => clearTimeout(timer); }, [lastAdd]);
  const quickAdd = (cents) => { if (cents <= 0) return; updateGoal({ savedCents: goal.savedCents + cents }); setLastAdd({ cents, id: Date.now() }); };
  const undoAdd = () => { if (!lastAdd) return; updateGoal({ savedCents: Math.max(0, goal.savedCents - lastAdd.cents) }); setLastAdd(null); };
  const startYear = Number(fixture.asOf.slice(0, 4)); const endYear = Number(goal.targetDate.slice(0, 4));
  const whenText = horizon === 'long' ? `by ${new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(new Date(`${goal.targetDate}T12:00:00`))}` : `by ${shortDate(goal.targetDate)}`;
  if (!expanded) return <article className={`g2-card g2-compact g2-${horizon} ${isFunded ? 'g2-funded' : ''} ${leaving ? 'g2-leaving' : ''}`}>
    <button type="button" className="g2-row-delete" onClick={removeGoal} aria-label={`Delete ${goal.label || 'goal'}`}><X size={14} strokeWidth={2.6}/></button>
    <button type="button" className="g2-compact-main" aria-expanded="false" onClick={onToggle}>
      <span className="g2-thumb"><GoalArt theme={theme}/></span>
      <span className="g2-compact-text"><strong>{goal.label || 'New goal'}</strong><small>{formatEuro(goal.savedCents)} of {formatEuro(goal.targetCents)} · {whenText}</small><span className="g2-track g2-mini"><span style={{ width: `${progress}%` }}/></span></span>
      <ChevronRight size={18} className="g2-chev"/>
    </button>
    {isFunded && <button type="button" className="g2-tick g2-tick-compact" onClick={completeGoal}><Check size={15}/> Fully saved — tick it off</button>}
  </article>;
  return <article className={`g2-card g2-${horizon} ${isFunded ? 'g2-funded' : ''} ${leaving ? 'g2-leaving' : ''}`}>
    <div className="g2-band">
      <button type="button" className="g2-collapse" aria-expanded="true" aria-label={`Collapse ${goal.label || 'goal'}`} onClick={onToggle}/>
      <div className="g2-band-copy"><span className="g2-when">{horizon === 'long' ? `${months >= 24 ? `${Math.round(months / 12)} years` : `${months} months`} · by ${new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(new Date(`${goal.targetDate}T12:00:00`))}` : `By ${shortDate(goal.targetDate)}`}</span>{isFunded && <span className="g2-badge"><Check size={12}/> Fully saved</span>}</div>
      <GoalArt theme={theme}/>
      <button className="g2-delete" onClick={removeGoal} aria-label={`Delete ${goal.label || 'goal'}`}><X size={15}/></button>
    </div>
    <div className="g2-body">
      <h3>{goal.label || 'New goal'}</h3>
      <div className="g2-amounts"><strong>{formatEuro(goal.savedCents)}</strong><span>of {formatEuro(goal.targetCents)}</span><em>{progress}%</em></div>
      <div className="g2-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={`${goal.label || 'Goal'} progress`}><span style={{ width: `${progress}%` }}/><i style={{ left: '25%' }}/><i style={{ left: '50%' }}/><i style={{ left: '75%' }}/></div>
      {horizon === 'long' && <div className="g2-years"><span>{startYear}</span><span>{endYear}</span></div>}
      {isFunded
        ? <button type="button" className="g2-tick" onClick={completeGoal}><Check size={16}/> Tick it off</button>
        : <>
            <div className="g2-stats" role="group" aria-label="Tap an amount to add it to your savings">
              {[['Monthly', neededMonthly], ['Weekly', Math.ceil(neededMonthly / 4)], ['To go', remainingCents]].map(([name, cents]) => <button type="button" key={name} onClick={() => quickAdd(cents)} aria-label={`Add ${formatEuro(cents)} (${name.toLowerCase()} amount) to ${goal.label || 'goal'}`}><span>{name}</span><strong>{formatEuro(cents)}</strong><em>+ Add</em></button>)}
            </div>
            <form className="g2-deposit" onSubmit={addDeposit}><input inputMode="decimal" type="number" min="0" step="0.01" value={deposit} onChange={(event) => setDeposit(event.target.value)} placeholder="Add money saved, €" aria-label={`Add money saved toward ${goal.label || 'goal'}`}/><button type="submit" disabled={!euroToCents(deposit)}>Add</button></form>
          </>}
      {lastAdd && <div className="g2-toast" role="status" key={lastAdd.id}><Check size={14}/><span>Added {formatEuro(lastAdd.cents)}</span><button type="button" onClick={undoAdd}>Undo</button></div>}
      <button type="button" className="g2-edit-toggle" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit goal'}</button>
      {editing && <div className="g2-edit">
        <label>Name<input value={goal.label} maxLength={32} onChange={(event) => updateGoal({ label: event.target.value })}/></label>
        <div className="g2-row">
          <label>Target €<input type="number" min="1" step="0.01" value={(goal.targetCents / 100).toFixed(2)} onChange={(event) => updateGoal({ targetCents: euroToCents(event.target.value) })}/></label>
          <label>Saved €<input type="number" min="0" step="0.01" value={(goal.savedCents / 100).toFixed(2)} onChange={(event) => updateGoal({ savedCents: euroToCents(event.target.value) })}/></label>
        </div>
        <label>Date<input type="date" min={fixture.asOf} max={HORIZONS[horizon].max} value={goal.targetDate} onChange={(event) => event.target.value && updateGoal({ targetDate: event.target.value })}/></label>
      </div>}
    </div>
  </article>;
}

function NewGoalForm({ horizon, onAdd, onCancel }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(HORIZONS[horizon].defaultDate);
  const targetCents = euroToCents(amount);
  const submit = (event) => {
    event.preventDefault();
    if (!label.trim() || targetCents <= 0) return;
    onAdd({ label: label.trim(), targetCents, targetDate: date, horizon });
  };
  return <form className={`g2-card g2-new g2-${horizon}`} onSubmit={submit}>
    <div className="g2-band"><div className="g2-band-copy"><span className="g2-when">New {horizon === 'long' ? 'long-term' : 'short-term'} goal</span></div><GoalArt theme={themeFor(label)}/></div>
    <div className="g2-body">
      <label className="g2-big-label">What are you saving for?<input autoFocus value={label} maxLength={32} onChange={(event) => setLabel(event.target.value)} placeholder={HORIZONS[horizon].placeholder}/></label>
      <div className="g2-chips">{QUICK_PICKS[horizon].map(pick => <button type="button" key={pick} className={label === pick ? 'on' : ''} onClick={() => setLabel(pick)}>{pick}</button>)}</div>
      <div className="g2-row">
        <label>Amount €<input inputMode="decimal" type="number" min="1" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={horizon === 'long' ? '8000' : '300'}/></label>
        <label>By<input type="date" min={fixture.asOf} max={HORIZONS[horizon].max} value={date} onChange={(event) => event.target.value && setDate(event.target.value)}/></label>
      </div>
      {targetCents > 0 && <p className="g2-preview-line">That’s about <strong>{formatEuro(Math.ceil(targetCents / monthsUntil(date)))} a month</strong> until {shortDate(date)}.</p>}
      <div className="g2-form-actions"><button type="button" className="g2-ghost" onClick={onCancel}>Cancel</button><button type="submit" className="g2-primary" disabled={!label.trim() || targetCents <= 0}>Add goal</button></div>
    </div>
  </form>;
}

const ACCOUNTS = [
  { id: 'S-Tuottotili', name: 'S-Tuottotili', blurb: 'Flexible — add or withdraw any time', url: 'https://www.s-pankki.fi/fi/tilit/s-tuottotili/' },
  { id: 'S-Määräaikaistili', name: 'S-Määräaikaistili', blurb: 'Fixed term — set it and leave it', url: 'https://www.s-pankki.fi/fi/tilit/s-maaraaikaistili/' },
];
const MONTHLY_PICKS = [2000, 5000, 10000, 20000];

function SavingsAccountPlan({ plan, updatePlan }) {
  const [custom, setCustom] = useState('');
  const [open, setOpen] = useState(false);
  const account = ACCOUNTS.find(item => item.id === plan.accountType) ?? ACCOUNTS[0];
  const monthly = plan.monthlyCents;
  const points = [1, 3, 5, 10].map(years => ({ years, cents: monthly * 12 * years }));
  const max = Math.max(1, points[points.length - 1].cents);
  const setMonthly = (cents) => cents > 0 && updatePlan({ monthlyCents: cents });
  if (!open) return <article className={`g2-card g2-compact g2-long g2-account-plan ${plan.active ? 'is-active' : ''}`}>
    <button type="button" className="g2-compact-main" aria-expanded="false" onClick={() => setOpen(true)}>
      <span className="g2-thumb"><GoalArt theme="seed"/></span>
      <span className="g2-compact-text"><strong>Just save into S-Pankki</strong><small>{plan.active ? `${formatEuro(monthly)} a month · ${account.name} · active` : 'No target — set aside a monthly amount'}</small></span>
      <ChevronRight size={18} className="g2-chev"/>
    </button>
  </article>;
  return <article className={`g2-card g2-long g2-account-plan ${plan.active ? 'is-active' : ''}`}>
    <div className="g2-band">
      <button type="button" className="g2-collapse" aria-expanded="true" aria-label="Collapse savings plan" onClick={() => setOpen(false)}/>
      <div className="g2-band-copy"><span className="g2-when">No target · just save</span>{plan.active && <span className="g2-badge"><Check size={12}/> Plan active</span>}</div>
      <GoalArt theme="seed"/>
    </div>
    <div className="g2-body">
      <h3>Save regularly into S-Pankki</h3>
      <p className="g2-sub">Don’t have a specific goal? Put a set amount aside every month and watch it build up.</p>
      <div className="g2-account-pick" role="radiogroup" aria-label="Savings account">
        {ACCOUNTS.map(item => <button type="button" role="radio" aria-checked={account.id === item.id} key={item.id} className={account.id === item.id ? 'on' : ''} onClick={() => updatePlan({ accountType: item.id })}><strong>{item.name}</strong><span>{item.blurb}</span></button>)}
      </div>
      <div className="g2-field-title">Every month</div>
      <div className="g2-chips g2-amount-chips">{MONTHLY_PICKS.map(cents => <button type="button" key={cents} className={monthly === cents ? 'on' : ''} onClick={() => setMonthly(cents)}>{formatEuro(cents)}</button>)}
        <form onSubmit={(event) => { event.preventDefault(); setMonthly(euroToCents(custom)); setCustom(''); }}><input inputMode="decimal" type="number" min="1" step="1" value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Other €" aria-label="Other monthly amount"/></form>
      </div>
      <div className="g2-growth" aria-label={`Saving ${formatEuro(monthly)} a month`}>
        {points.map(point => <div key={point.years}><div className="g2-bar"><span style={{ height: `${Math.max(6, Math.round(point.cents / max * 100))}%` }}/></div><strong>{formatEuro(point.cents)}</strong><small>{point.years} {point.years === 1 ? 'year' : 'years'}</small></div>)}
      </div>
      <p className="g2-fineprint">Your own deposits only — interest isn’t included. This is a plan; it won’t open an account or move money. <a href={account.url} target="_blank" rel="noreferrer">Current {account.name} terms <ExternalLink size={11}/></a></p>
      {plan.active
        ? <button type="button" className="g2-ghost g2-stop" onClick={() => updatePlan({ active: false })}>Stop this plan</button>
        : <button type="button" className="g2-tick" onClick={() => updatePlan({ active: true })}>Save {formatEuro(monthly)} a month into {account.name}</button>}
    </div>
  </article>;
}

function GoalPlanner({ goals, updateShort, removeShort, insertShort, addShort, completeShort, restoreShort, updateLong, mode, openEvidence, previewId, setPreviewId }) {
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [leavingId, setLeavingId] = useState(null);
  const [deleted, setDeleted] = useState(null);
  useEffect(() => { if (!deleted) return undefined; const timer = setTimeout(() => setDeleted(null), 5000); return () => clearTimeout(timer); }, [deleted]);
  const deleteGoal = (goal) => {
    if (leavingId) return;
    setLeavingId(goal.id);
    setTimeout(() => { const index = goals.shortTermGoals.findIndex(item => item.id === goal.id); removeShort(goal.id); setDeleted({ goal, index }); setLeavingId(null); if (openId === goal.id) setOpenId(null); }, 240);
  };
  const [showAchieved, setShowAchieved] = useState(false);
  const [horizon, setHorizon] = useState(() => { try { return sessionStorage.getItem('goals-horizon') || 'short'; } catch { return 'short'; } });
  const chooseHorizon = (value) => { setHorizon(value); setAdding(false); setShowAchieved(false); try { sessionStorage.setItem('goals-horizon', value); } catch { /* optional */ } };
  const inHorizon = goals.shortTermGoals.filter(goal => (goal.horizon ?? 'short') === horizon);
  const active = inHorizon.filter(goal => !goal.complete);
  const achieved = inHorizon.filter(goal => goal.complete);
  const monthlyCents = active.reduce((sum, goal) => sum + Math.ceil(Math.max(0, goal.targetCents - goal.savedCents) / monthsUntil(goal.targetDate)), 0) + (horizon === 'long' && goals.longTerm.active ? goals.longTerm.monthlyCents : 0);
  return <div className="goal-sections">
    <div className="horizon-switch" role="tablist" aria-label="Goal horizon">
      <button type="button" role="tab" aria-selected={horizon === 'short'} className={horizon === 'short' ? 'active' : ''} onClick={() => chooseHorizon('short')}><strong>Short term</strong><small>Weeks to 12 months</small></button>
      <button type="button" role="tab" aria-selected={horizon === 'long'} className={horizon === 'long' ? 'active' : ''} onClick={() => chooseHorizon('long')}><strong>Long term</strong><small>Years ahead</small></button>
    </div>
    <section className="short-goals-list" role="tabpanel" aria-label={horizon === 'long' ? 'Long-term goals' : 'Short-term goals'}>
      <div className="list-section-heading"><div><h2>{horizon === 'long' ? 'Your big plans' : 'Your goals, your way'}</h2></div><span className="goals-count">{active.length} active{achieved.length ? ` · ${achieved.length} done` : ''}</span></div>
      {active.length > 0 && <div className="g2-summary"><span>Together</span><strong>{formatEuro(monthlyCents)}<small> / month</small></strong><span>to stay on track</span></div>}
      {active.length === 0 && !adding && <div className={`g2-empty g2-${horizon}`}><GoalArt theme={horizon === 'long' ? 'home' : 'travel'}/><strong>{horizon === 'long' ? 'What’s your big plan?' : 'What do you want next?'}</strong><p>Write down anything you’re saving for — {HORIZONS[horizon].empty}. Add as many as you like.</p></div>}
      {active.map((goal) => {
        return <ShortTermGoal key={goal.id} horizon={horizon} goal={goal} updateGoal={(patch) => updateShort(goal.id, patch)} removeGoal={() => deleteGoal(goal)} leaving={leavingId === goal.id} completeGoal={() => completeShort(goal.id)} expanded={openId === goal.id} onToggle={() => setOpenId(openId === goal.id ? null : goal.id)}/>;
      })}
      {deleted && <div className="g2-toast g2-undo-toast" role="status"><X size={14}/><span>Deleted “{deleted.goal.label || 'goal'}”</span><button type="button" onClick={() => { insertShort(deleted.goal, deleted.index); setDeleted(null); }}>Undo</button></div>}
      {adding
        ? <NewGoalForm key={horizon} horizon={horizon} onAdd={(goal) => { const id = `goal-${Date.now()}`; addShort({ ...goal, id }); setOpenId(id); setAdding(false); }} onCancel={() => setAdding(false)}/>
        : <button className="g2-add" onClick={() => setAdding(true)}><span>+</span>Add a {horizon === 'long' ? 'long-term' : 'short-term'} goal</button>}
      {achieved.length > 0 && <div className="achieved-goals">
        <button type="button" className="achieved-toggle" aria-expanded={showAchieved} onClick={() => setShowAchieved(!showAchieved)}>Achieved ({achieved.length}) <ChevronRight size={15}/></button>
        {showAchieved && <ul>{achieved.map(goal => <li key={goal.id}><Check size={14}/><span>{goal.label || 'Goal'} · {formatEuro(goal.targetCents)}</span><button type="button" className="text-button" onClick={() => restoreShort(goal.id)}>Undo</button></li>)}</ul>}
      </div>}
      {horizon === 'long' && <><div className="g2-or"><span>or</span></div><SavingsAccountPlan plan={goals.longTerm} updatePlan={updateLong}/></>}
    </section>
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
  const addShort = (goal) => setGoals((current) => ({ ...current, shortTermGoals: [...current.shortTermGoals, { id: `goal-${Date.now()}`, savedCents: 0, complete: false, horizon: 'short', ...goal }] }));
  const removeShort = (id) => setGoals((current) => ({ ...current, shortTermGoals: current.shortTermGoals.filter((goal) => goal.id !== id) }));
  const insertShort = (goal, index) => setGoals((current) => { const list = [...current.shortTermGoals]; list.splice(Math.max(0, Math.min(index, list.length)), 0, goal); return { ...current, shortTermGoals: list }; });
  const completeShort = (id) => updateShort(id, { complete: true });
  const restoreShort = (id) => setGoals((current) => ({ ...current, shortTermGoals: current.shortTermGoals.map((goal) => goal.id === id ? { ...goal, complete: false } : goal) }));
  const updateLong = (patch) => setGoals((current) => ({ ...current, longTerm: { ...current.longTerm, ...patch } }));
  return <>
    <GoalPlanner goals={goals} updateShort={updateShort} removeShort={removeShort} insertShort={insertShort} addShort={addShort} completeShort={completeShort} restoreShort={restoreShort} updateLong={updateLong} mode={mode} openEvidence={(goal, result) => setEvidenceData({ goal, result, mode })} previewId={previewGoalId} setPreviewId={setPreviewGoalId}/>
    {evidenceData && <EvidenceModal result={evidenceData.result} goal={evidenceData.goal} mode={evidenceData.mode} onClose={() => setEvidenceData(null)}/>}
  </>;
}
