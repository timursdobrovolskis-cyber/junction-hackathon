const el = id => document.getElementById(id);
const money = cents => cents === null ? '—' : new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(cents/100);
const date = iso => new Date(iso+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const palette = {Housing:'#007841',Lifestyle:'#97be9b',Transportation:'#d1af60',Entertainment:'#829cc1',Groceries:'#476b57',Health:'#a18cae',Utilities:'#a6bdc5'};
const color = category => palette[category] ?? '#969c96';
const node = (tag,text,cls) => {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
let mode='plan', request=0, currentData;
const cache=new Map();
function ring(target,rows,key) {
  const total=rows.reduce((sum,c)=>sum+(c[key]??0),0);let start=0;
  const stops=rows.filter(c=>c[key]>0).map(c=>{const end=start+c[key]/total*100;const stop=`${color(c.category)} ${start}% ${end}%`;start=end;return stop;});
  target.style.background=stops.length?`conic-gradient(${stops.join(',')})`:'#e6ece7';
  target.setAttribute('aria-label',rows.filter(c=>c[key]>0).map(c=>`${c.category}: ${money(c[key])}`).join('; ') || 'No spending recorded');
}
function paintHome(data) {
  const live=data.live;
  document.querySelectorAll('.pace-note,.budget-demo-label,.alert-action').forEach(n=>n.remove());
  ring(el('home-budget-ring'),data.categories,'plannedCents');
  el('home-budget-categories').replaceChildren();
  if(!live){
    el('home-budget-total').textContent=money(data.totalPlannedCents);
    for(const c of data.categories.slice(0,3)){
      const row=node('a',undefined,'home-budget-row');row.href='#budget';
      const dot=node('span',undefined,'category-dot');dot.style.background=color(c.category);dot.setAttribute('aria-hidden','true');
      row.append(dot,node('span',c.category),node('strong',money(c.plannedCents)));el('home-budget-categories').append(row);
    }
    el('home-budget-status').textContent=data.explanation.label;
    el('home-budget-note').textContent=data.activityAvailable?'Review your category limits and planned costs.':'Confirm upcoming costs. Spending for this period is not available yet.';
    return;
  }
  const eyebrow=document.querySelector('.home-budget-overview .budget-eyebrow');
  if(eyebrow)eyebrow.textContent='Safe to spend today';
  el('home-budget-total').innerHTML='';
  el('home-budget-total').append(document.createTextNode(money(live.safePerDayCents)),node('small','/day','per-day'));
  const sub=document.querySelector('.home-budget-overview p:last-child');
  if(sub)sub.textContent=`${money(live.everydayLeftCents)} left · ${live.daysLeft} days to go`;
  const basketColor={fixed:'#c8ddce',setAside:'#d1af60',everyday:'#91fa9b'};
  let at=0;const sum=live.baskets.reduce((s,b)=>s+b.plannedCents,0);
  const ringEl=el('home-budget-ring');
  ringEl.style.background=`conic-gradient(${live.baskets.map(b=>{const end=at+b.plannedCents/sum*100;const stop=`${basketColor[b.id]} ${at}% ${end}%`;at=end;return stop;}).join(',')})`;
  ringEl.setAttribute('aria-label',live.baskets.map(b=>`${b.label}: ${money(b.plannedCents)}`).join('; '));
  const ringLabel=ringEl.querySelector('span');if(ringLabel)ringLabel.textContent=new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(sum/100);
  for(const b of live.baskets){
    const row=node('a',undefined,'home-basket');row.href='#budget';
    const dot=node('span',undefined,'basket-dot dot-'+b.id);dot.setAttribute('aria-hidden','true');
    const value=b.id==='setAside'?money(b.plannedCents):money(Math.max(0,b.remainingCents));
    const meta=b.id==='setAside'?'saved first':'left';
    const amt=node('strong',value);amt.append(node('small',' '+meta));
    row.append(dot,node('span',b.label,'basket-name'),amt);
    el('home-budget-categories').append(row);
  }
  const status=el('home-budget-status'), note=el('home-budget-note');
  const o=live.overspend, p=live.pace;
  const box=status.parentElement;box.classList.add('live-alert');
  if(o){
    status.textContent=`${o.category} is ${money(o.overCents)} over`;
    note.textContent=o.move?`Cover it from ${o.move.from}. Your total stays the same.`:'Review this category.';
    if(o.move){const btn=node('a',`Review moving ${money(o.move.amountCents)}`,'alert-action');btn.href='#budget';note.after(btn);}
  } else {status.textContent='On track';note.textContent='Every category is within its limit.';}
  if(p.driver){
    const pace=node('p',`At this pace, ${p.driver.category.toLowerCase()} uses ${money(p.savingsTargetCents-p.savingsAfterPaceCents)} of your savings.`,'pace-note');
    box.append(pace);
  }
  const demo=node('p',`Demo · 14 Oct, replaying your August spending`,'budget-demo-label');
  document.querySelector('.budget-hero-link')?.before(demo);
}
function render(data) {
  currentData=data;
  const planned=data.mode==='plan', unavailable=data.mode==='unavailable', key=planned?'plannedCents':'spentCents', total=planned?data.totalPlannedCents:data.spentCents;
  const select=el('budget-month');select.replaceChildren();
  for(const item of data.catalog){const option=node('option',item.label+(item.kind==='plan'?' · Plan':item.kind==='unavailable'?' · No plan yet':''));option.value=item.month;select.append(option);}select.value=data.selectedMonth;
  const index=data.catalog.findIndex(c=>c.month===data.selectedMonth);el('budget-prev').disabled=index===0;el('budget-next').disabled=index===data.catalog.length-1;
  el('budget-status-title').textContent=data.explanation.label;
  el('budget-status-kicker').textContent=planned?'YOUR PLAN STATUS':unavailable?'LOOKING AHEAD':'WHAT CHANGED';
  el('budget-status-card').dataset.tone=data.explanation.tone;
  el('budget-insight').textContent=data.explanation.reason;
  el('budget-status-action').textContent=data.explanation.action.label+' →';
  el('budget-overview').hidden=unavailable;
  el('budget-total-label').textContent=planned?'Planned spending':'Recorded spending';
  el('budget-total').textContent=money(total);el('budget-dates').textContent=`${date(data.period.start)} – ${date(data.period.end)} ${data.period.end.slice(0,4)}`;
  el('budget-badge').textContent=planned?'Suggested plan':data.accountLabel;
  el('budget-comparison').hidden=!data.comparison;
  if(data.comparison){el('budget-comparison-label').textContent=data.comparison.label;el('budget-comparison-total').textContent=money(data.comparison.spentCents);el('budget-comparison-change').textContent=data.comparison.changePercent===null?'No percentage baseline':`${data.comparison.changePercent>0?'+':''}${data.comparison.changePercent}% this month`;}
  const totals=el('budget-totals');totals.replaceChildren();totals.hidden=!planned;
  for(const [label,value] of [['Planned',data.totalPlannedCents],['Spent',data.spentCents],['Left in plan',data.remainingCents]]){
    const cell=node('div');cell.append(node('span',label),node('strong',money(value)));totals.append(cell);
  }
  el('budget-payment-insight').hidden=!data.paymentInsight;
  el('budget-payment-insight').textContent=data.paymentInsight?.text??'';
  el('budget-trend').hidden=!data.series?.length;el('budget-trend').open=false;
  el('budget-month-bars').replaceChildren();
  const maximum=Math.max(1,...(data.series??[]).map(m=>m.spentCents??0));
  for(const month of data.series??[]){
    const button=node('button');button.type='button';button.setAttribute('aria-label',`${month.label}: ${money(month.spentCents)} spent`);button.setAttribute('aria-pressed',String(month.month===data.selectedMonth));
    const bar=node('span',undefined,'month-bar');bar.style.height=`${Math.max(3,(month.spentCents??0)/maximum*66)}px`;bar.setAttribute('aria-hidden','true');
    button.append(node('small',money(month.spentCents)),bar,node('span',new Date(month.month+'-01T12:00:00Z').toLocaleDateString('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'})));
    button.addEventListener('click',()=>load(month.month));el('budget-month-bars').append(button);
  }
  el('budget-list-title').parentElement.hidden=unavailable;
  el('budget-list-title').textContent=planned?'By category':data.comparison?'Changes by category':'Recorded categories';
  el('budget-list-caption').textContent=planned?'Proposed limits':data.comparison?'vs previous month':'Recorded payments';
  el('budget-categories').replaceChildren();
  const categories=[...data.categories];
  if(data.comparison)categories.sort((a,b)=>Math.abs(data.comparison.categories.find(c=>c.category===b.category)?.changeCents??0)-Math.abs(data.comparison.categories.find(c=>c.category===a.category)?.changeCents??0));
  for(const c of categories){
    const details=node('details',undefined,'budget-category');details.dataset.category=c.category;const summary=node('summary');
    const dot=node('span',undefined,'category-dot');dot.style.background=color(c.category);dot.setAttribute('aria-hidden','true');
    const label=node('div',undefined,'category-label');label.append(node('strong',c.category),node('small',planned?(c.adjustable?'Flexible spending':'Protected in this plan'):`${c.transactions.filter(t=>t.amountCents<0).length} recorded payment${c.transactions.filter(t=>t.amountCents<0).length === 1 ? '' : 's'}`));
    const value=node('div',undefined,'category-value');
    value.append(node('strong',money(c[key])));
    const change=data.comparison?.categories.find(row=>row.category===c.category);
    value.append(node('small',!planned&&change?change.changeCents===0?'Unchanged':`${money(Math.abs(change.changeCents))} ${change.changeCents>0?'more':'less'}`:planned?(c.remainingCents===null?'Proposed limit':c.remainingCents<0?`${money(-c.remainingCents)} over`:`${money(c.remainingCents)} left`):`${total?Math.round(c.spentCents/total*100):0}% of spending`));
    summary.append(dot,label,value,node('span','⌄','category-chevron'));details.append(summary);
    if(planned && c.spentCents!==null && c.plannedCents!==null){
      const progress=node('progress');progress.max=Math.max(1,c.plannedCents);progress.value=Math.min(c.spentCents,progress.max);progress.setAttribute('aria-label',`${c.category}: ${money(c.spentCents)} spent of ${money(c.plannedCents)} planned`);details.append(progress);
    }
    const body=node('div',undefined,'category-detail');
    if(planned){body.append(node('p',c.spentCents===null?'No transactions for this budget period yet.':`${money(c.spentCents)} spent against ${money(c.plannedCents)} planned.`));body.append(node('p',c.adjustable?'This proposed limit follows your past spending after reserving essentials and planned savings.':'The plan keeps this category’s expected spending before allocating flexible spending.'));}
    if(!planned&&change)body.append(node('p',`${money(change.previousCents)} in ${data.comparison.label}; ${money(c.spentCents)} in the selected month.`));
    if(!planned&&!c.transactions.length)body.append(node('p','No spending recorded in this category this month.'));
    if(c.transactions.length){
      const list=node('ul',undefined,'budget-transactions');
      for(const tx of c.transactions){const item=node('li');const copy=node('div');copy.append(node('span',`${date(tx.date)} · ${tx.type==='purchase'?'Purchase':tx.type==='housing_payment'?'Housing payment':'Utilities payment'}`));item.append(copy,node('strong',`${tx.amountCents>0?'+':'−'}${money(Math.abs(tx.amountCents))}`));list.append(item);}body.append(list);
    }
    if(c.refundCents>0)body.append(node('p',`${money(c.refundCents)} in refunds shown separately.`));
    details.append(body);el('budget-categories').append(details);
  }
  document.querySelector('.budget-method').hidden=unavailable;document.querySelector('.budget-coach-link').hidden=unavailable;
  el('budget-method-copy').textContent=data.calculation??'';
  el('budget-method-period').textContent=planned?'October is a proposed 30-day budget. September spending is shown separately; it is not subtracted from October’s limits.':'This view compares complete calendar months of recorded spending. No historical budget was saved, so changes are compared with the previous month, not a made-up target.';
  el('budget-method-assumptions').textContent=planned?`The engine reserves a ${money(data.savingsTargetCents)} savings target and a ${money(data.bufferCents)} buffer. These choices still need confirmation. This page does not change your plan or move money.`:'Source: bank-provided synthetic transactions, with coverage through 30 September 2026. Open a category to see its payments.';
  el('budget-loading').hidden=true;el('budget-content').hidden=false;
}
async function load(next=mode){
  mode=next;const requestedMode=next;const version=++request;
  el('budget-prev').disabled=true;el('budget-next').disabled=true;
  el('budget-content').hidden=true;el('budget-loading').hidden=false;el('budget-loading').textContent='Loading your budget…';el('budget-retry').hidden=true;
  try{
    let data=cache.get(requestedMode);if(!data){const response=await fetch(`/api/budget?period=${requestedMode}`);if(!response.ok)throw new Error();data=await response.json();if(!Array.isArray(data.categories))throw new Error();cache.set(requestedMode,data);}
    if(data.mode==='plan')paintHome(data);if(version!==request)return;render(data);if(location.hash==='#budget')window.scrollTo({top:0,behavior:'instant'});
  }catch{if(version!==request)return;el('budget-loading').textContent='Your budget couldn’t load. Please try again.';el('budget-retry').hidden=false;if(!cache.has('plan')){el('home-budget-status').textContent='Plan unavailable';el('home-budget-note').textContent='Open your budget to reconnect.';}}
}
el('budget-month').addEventListener('change',event=>load(event.target.value));
for(const [id,offset] of [['budget-prev',-1],['budget-next',1]])el(id).addEventListener('click',()=>{if(!currentData)return;const i=currentData.catalog.findIndex(c=>c.month===currentData.selectedMonth);const target=currentData.catalog[i+offset];if(target)load(target.month);});
el('budget-status-action').addEventListener('click',()=>{
  const action=currentData?.explanation.action;if(!action)return;
  if(action.period){load(action.period);return;}
  const category=[...document.querySelectorAll('.budget-category')].find(row=>row.dataset.category===action.category);
  if(category){category.open=true;category.querySelector('summary').focus({preventScroll:true});category.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
  else el('budget-list-title').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
});
el('budget-retry').addEventListener('click',()=>load());
load();
