const el = id => document.getElementById(id);
const money = cents => cents === null ? '—' : new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(cents/100);
const date = iso => new Date(iso+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const palette = {Housing:'#007841',Lifestyle:'#97be9b',Transportation:'#d1af60',Entertainment:'#829cc1',Groceries:'#476b57',Health:'#a18cae',Utilities:'#a6bdc5'};
const color = category => palette[category] ?? '#969c96';
const node = (tag,text,cls) => {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
let mode='plan', request=0;
const cache=new Map();
function ring(target,rows,key) {
  const total=rows.reduce((sum,c)=>sum+(c[key]??0),0);let start=0;
  const stops=rows.filter(c=>c[key]>0).map(c=>{const end=start+c[key]/total*100;const stop=`${color(c.category)} ${start}% ${end}%`;start=end;return stop;});
  target.style.background=stops.length?`conic-gradient(${stops.join(',')})`:'#e6ece7';
  target.setAttribute('aria-label',rows.filter(c=>c[key]>0).map(c=>`${c.category}: ${money(c[key])}`).join('; ') || 'No spending recorded');
}
function paintHome(data) {
  el('home-budget-total').textContent=money(data.totalPlannedCents);
  ring(el('home-budget-ring'),data.categories,'plannedCents');
  el('home-budget-categories').replaceChildren();
  for(const c of data.categories.slice(0,3)){
    const row=node('a',undefined,'home-budget-row');row.href='#budget';
    const dot=node('span',undefined,'category-dot');dot.style.background=color(c.category);dot.setAttribute('aria-hidden','true');
    row.append(dot,node('span',c.category),node('strong',money(c.plannedCents)));el('home-budget-categories').append(row);
  }
  el('home-budget-note').textContent='Suggested limits · based on your history';
}
function render(data) {
  const planned=data.mode==='plan', key=planned?'plannedCents':'spentCents', total=planned?data.totalPlannedCents:data.spentCents;
  ring(el('budget-ring'),data.categories,key);
  el('budget-ring-label').replaceChildren(node('strong',String(data.categories.length)),node('span','categories'));
  el('budget-total-label').textContent=planned?'Planned spending':'Recorded spending';
  el('budget-total').textContent=money(total);el('budget-dates').textContent=`${date(data.period.start)} – ${date(data.period.end)} ${data.period.end.slice(0,4)}`;
  el('budget-badge').textContent=planned?'Suggested plan':data.accountLabel;
  const totals=el('budget-totals');totals.replaceChildren();totals.hidden=!planned;
  for(const [label,value] of [['Planned',data.totalPlannedCents],['Spent',data.spentCents],['Left in plan',data.remainingCents]]){
    const cell=node('div');cell.append(node('span',label),node('strong',money(value)));totals.append(cell);
  }
  const largest=data.categories[0];
  el('budget-insight').textContent=planned
    ? data.activityAvailable ? `Spending through ${date(data.through)}. These limits still need your confirmation.` : 'Your October limits are ready to review. Spent and left will appear when October transactions arrive.'
    : largest && total>0 ? `${largest.category} was your largest category: ${money(largest.spentCents)}, or ${Math.round(largest.spentCents/total*100)}% of recorded spending.` : 'No spending was recorded in this period.';
  el('budget-list-caption').textContent=planned?'Proposed limits':'Recorded payments';
  el('budget-categories').replaceChildren();
  for(const c of data.categories){
    const details=node('details',undefined,'budget-category');const summary=node('summary');
    const dot=node('span',undefined,'category-dot');dot.style.background=color(c.category);dot.setAttribute('aria-hidden','true');
    const label=node('div',undefined,'category-label');label.append(node('strong',c.category),node('small',planned?(c.adjustable?'Flexible spending':'Protected in this plan'):`${c.transactions.filter(t=>t.amountCents<0).length} recorded payment${c.transactions.filter(t=>t.amountCents<0).length === 1 ? '' : 's'}`));
    const value=node('div',undefined,'category-value');
    value.append(node('strong',money(c[key])));
    value.append(node('small',planned?(c.remainingCents===null?'Proposed limit':c.remainingCents<0?`${money(-c.remainingCents)} over`:`${money(c.remainingCents)} left`):`${total?Math.round(c.spentCents/total*100):0}% of spending`));
    summary.append(dot,label,value,node('span','⌄','category-chevron'));details.append(summary);
    if(planned && c.spentCents!==null && c.plannedCents!==null){
      const progress=node('progress');progress.max=Math.max(1,c.plannedCents);progress.value=Math.min(c.spentCents,progress.max);progress.setAttribute('aria-label',`${c.category}: ${money(c.spentCents)} spent of ${money(c.plannedCents)} planned`);details.append(progress);
    }
    const body=node('div',undefined,'category-detail');
    if(planned){body.append(node('p',c.spentCents===null?'No transactions for this budget period yet.':`${money(c.spentCents)} spent against ${money(c.plannedCents)} planned.`));body.append(node('p',c.adjustable?'This proposed limit follows your past spending after reserving essentials and planned savings.':'The plan keeps this category’s expected spending before allocating flexible spending.'));}
    if(c.transactions.length){
      const list=node('ul',undefined,'budget-transactions');
      for(const tx of c.transactions){const item=node('li');const copy=node('div');copy.append(node('span',`${date(tx.date)} · ${tx.type==='purchase'?'Purchase':tx.type==='housing_payment'?'Housing payment':'Utilities payment'}`));item.append(copy,node('strong',`${tx.amountCents>0?'+':'−'}${money(Math.abs(tx.amountCents))}`));list.append(item);}body.append(list);
    }
    if(c.refundCents>0)body.append(node('p',`${money(c.refundCents)} in refunds shown separately.`));
    details.append(body);el('budget-categories').append(details);
  }
  el('budget-method-copy').textContent=data.calculation;
  el('budget-method-period').textContent=planned?'October is a proposed 30-day budget. September spending is shown separately; it is not subtracted from October’s limits.':'September contains recorded transactions for this account. No September budget was saved, so there is no invented planned-versus-actual comparison.';
  el('budget-method-assumptions').textContent=planned?`The engine reserves a ${money(data.savingsTargetCents)} savings target and a ${money(data.bufferCents)} buffer. These choices still need confirmation. This page does not change your plan or move money.`:'Source: bank-provided synthetic transactions, with coverage through 30 September 2026. Open a category to see its payments.';
  el('budget-loading').hidden=true;el('budget-content').hidden=false;
}
async function load(next=mode){
  mode=next;const requestedMode=next;const version=++request;
  document.querySelectorAll('[data-budget-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.budgetPeriod===mode)));
  el('budget-content').hidden=true;el('budget-loading').hidden=false;el('budget-loading').textContent='Loading your budget…';el('budget-retry').hidden=true;
  try{
    let data=cache.get(requestedMode);if(!data){const response=await fetch(`/api/budget?period=${requestedMode}`);if(!response.ok)throw new Error();data=await response.json();if(!Array.isArray(data.categories))throw new Error();cache.set(requestedMode,data);}
    if(data.mode==='plan')paintHome(data);if(version!==request)return;render(data);
  }catch{if(version!==request)return;el('budget-loading').textContent='Your budget couldn’t load. Please try again.';el('budget-retry').hidden=false;el('home-budget-note').textContent='Open your budget to reconnect.';}
}
document.querySelectorAll('[data-budget-period]').forEach(b=>b.addEventListener('click',()=>load(b.dataset.budgetPeriod)));
el('budget-retry').addEventListener('click',()=>load());
load();
