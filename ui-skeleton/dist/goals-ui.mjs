const $ = id => document.getElementById(id);
const euro = n => new Intl.NumberFormat('en-IE', { style:'currency',currency:'EUR',maximumFractionDigits:2 }).format(n/100);
let data, preview = false, mode = 'short', controller;
function render() {
  if (!data) return;
  const result = data.result; const amount = preview && result.recoveryOption ? result.recoveryOption.projectedSavedIfFollowedCents : result.projectedSavedCents;
  $('goal-projection').textContent = euro(amount); $('goal-target').textContent = `of your ${euro(data.goal.targetCents)} goal`;
  $('goal-saved').textContent = `${euro(data.goal.savedCents)} saved so far`;
  $('goal-progress').max = data.goal.targetCents; $('goal-progress').value = Math.min(data.goal.targetCents, amount);
  $('goal-insight').textContent = data.scenario === 'afterExpense' ? `The €60 bike repair brings your projection from ${euro(data.baseline.projectedSavedCents)} to ${euro(result.projectedSavedCents)}.` : `You’re projected to reach ${euro(result.projectedSavedCents)} by 31 January if the planned contributions are made.`;
  $('goal-recovery').hidden = !result.recoveryOption;
  $('goal-recovery').setAttribute('aria-pressed',String(preview));
  $('goal-recovery').textContent = preview ? 'Undo adjustment preview' : 'Explore a small adjustment';
  $('goal-recovery-copy').hidden = !preview;
  if (preview) $('goal-recovery-copy').textContent = `Reducing delivery spending by ${euro(result.recoveryOption.estimatedSavingsPerDeliveryCents)} in each of ${result.recoveryOption.months.length} months would bring the projection to ${euro(amount)}. Your savings haven’t changed.`;
  $('goal-evidence').replaceChildren();
  for (const item of data.evidence) { const li=document.createElement('li');li.textContent=`${item.date} · ${item.merchant || item.label} · ${euro(item.amountCents)}`;$('goal-evidence').append(li); }
  $('goal-periods').replaceChildren();
  for (const period of result.breakdown) { const p=document.createElement('p');p.textContent=`${period.month}: ${euro(period.projectedContributionCents)} planned contribution`;$('goal-periods').append(p); }
  $('growth-value').textContent = euro(data.growth.projectedCents); $('growth-contributed').textContent = euro(data.growth.contributedCents);
  $('growth-title').textContent = `After ${data.growth.years} years`;
  $('goal-assumptions').textContent = data.assumptions;
  $('goals-status').textContent = mode === 'short' ? 'Projection · no money moved' : 'Illustration · not a fund forecast';
}
async function load(custom=false) {
  controller?.abort(); const request=new AbortController();controller=request;
  $('goals-error').hidden=true;$('goals-status').textContent='Updating your projection…';
  const params=new URLSearchParams({scenario:$('goals-scenario').value});
  if(custom){
    const amount=$('growth-monthly').value.trim().replace(',','.');
    if(!/^\d+(?:\.\d{1,2})?$/.test(amount)){ $('goals-error').textContent='Enter a monthly amount in euros.';$('goals-error').hidden=false;return; }
    params.set('monthly',String(Math.round(Number(amount)*100)));params.set('years',$('growth-years').value);params.set('rate',String(Number($('growth-rate').value)/100));
  }
  try{const r=await fetch('/api/goals?'+params,{signal:request.signal});const next=await r.json();if(request!==controller)return;if(!r.ok)throw new Error(next.error);data=next;preview=false;
    if(!custom){$('growth-monthly').value=String(data.growth.monthlyCents/100);$('growth-years').value=String(data.growth.years);$('growth-rate').value=String(data.growth.annualRate*100);}
    render();
  }catch(e){if(request.signal.aborted)return;$('goals-error').textContent=e.message||'Couldn’t load your goals. Please retry.';$('goals-error').hidden=false;$('goals-status').textContent=data?'Previous projection kept':'Goals unavailable';}
}
$('goals-scenario').addEventListener('change',()=>load());
$('goal-recovery').addEventListener('click',()=>{preview=!preview;render();});
$('goals-retry').addEventListener('click',()=>load());
$('growth-form').addEventListener('submit',e=>{e.preventDefault();load(true);});
document.querySelectorAll('[data-goal-mode]').forEach(button=>button.addEventListener('click',()=>{
  mode=button.dataset.goalMode;
  document.querySelectorAll('[data-goal-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  $('short-goal').hidden=mode!=='short';$('long-goal').hidden=mode!=='long';render();
}));
function activate(){if(location.hash==='#goals'&&!data)load();}window.addEventListener('hashchange',activate);activate();
