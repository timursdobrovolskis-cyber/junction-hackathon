import { readFileSync } from 'node:fs';
import { account } from './account.mjs';
import { getBudgetView } from './budget.mjs';
import { loadCalendar, usesLiveEngine } from './calendar-data.mjs';
import { initialGoals, normalizeGoals, calendarCustomers, appCustomer } from '../dist/app-context-contract.mjs';
import { calendarWithEdits, deletedEvents } from '../dist/calendar-edits.mjs';
import { calendarPeriod, eventGroup, isDate } from '../dist/calendar-model.mjs';

const plannerFixture=JSON.parse(readFileSync(new URL('./goals/planner-fixture.json',import.meta.url)));
export const defaultGoalState=normalizeGoals(initialGoals(plannerFixture));
const money=n=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(n/100);
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
function requestedPeriod(message, calendar, selection) {
  const anchor=selection.anchor && selection.anchor>=calendar.rangeStart && selection.anchor<=calendar.rangeEnd?selection.anchor:calendar.rangeStart;
  const iso=message.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (isDate(iso)) return {start:iso,end:iso,explicit:true};
  const named=message.toLowerCase().match(/\b(?:(\d{1,2})\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/);
  if (named) {
    const year=named[3]??anchor.slice(0,4),month=String(months.indexOf(named[2])+1).padStart(2,'0');
    const date=`${year}-${month}-${String(named[1]??1).padStart(2,'0')}`;
    if(isDate(date))return named[1]?{start:date,end:date,explicit:true}:{...calendarPeriod('month',date),explicit:true};
  }
  return calendarPeriod(selection.view,anchor);
}
const compactEvent=e=>({id:e.id,title:e.title,date:e.date,amountCents:e.amountCents,direction:e.direction,cadence:e.cadence,kind:e.kind,source:e.source,evidenceIds:e.evidenceIds});
function compactBudget(b) {
  return {status:'available',customerId:b.customerId,period:b.period,selectedMonth:b.selectedMonth,activityAvailable:b.activityAvailable,
    totalPlannedCents:b.totalPlannedCents,spentCents:b.spentCents,remainingCents:b.remainingCents,savingsTargetCents:b.savingsTargetCents,bufferCents:b.bufferCents,
    explanation:b.explanation,comparison:b.comparison,series:b.series,
    categories:b.categories.map(c=>({category:c.category,plannedCents:c.plannedCents,spentCents:c.spentCents,remainingCents:c.remainingCents,transactionIds:c.transactions.map(t=>t.id)})),
    liveDemo:b.live};
}
export async function buildAppContext(input, {calendarLoader=loadCalendar}={}) {
  const customerId=input.scenario==='engine'?appCustomer:'home-sample';
  if(customerId!==appCustomer)return {customerId,home:{status:'not_attached'},budget:{status:'not_attached'},goals:{status:'not_attached'},calendar:{status:'not_attached'}};
  const state=input.appState;
  const homeBudget=getBudgetView('plan');
  const context={customerId,
    home:{status:'available',customerId,observedAccount:account,period:homeBudget.period,display:homeBudget.live,
      basis:'Home displays a labelled October demo using replayed historical transactions. The per-day figure is not a live affordability guarantee.'},
    budget:compactBudget(homeBudget),goals:{status:'not_connected'},calendar:{status:'not_connected'}};
  try { if(state?.budget)context.budget=compactBudget(getBudgetView(state.budget.period)); } catch { context.budget={status:'unavailable'}; }
  if(state?.goals)context.goals=state.goals.status==='unavailable'?{status:'unavailable'}:{status:'available',
    basis:state.goals.status==='default'?'Default Goals sample':'Goals entries on this device',
    bankVerified:false,affordabilityCalculated:false,asOf:plannerFixture.asOf,
    ...(state.goals.status==='default'?defaultGoalState:state.goals.data)};
  if(state?.calendar?.status==='unavailable')context.calendar={status:'unavailable'};
  else if(state?.calendar?.status==='available'){
    const selected=state.calendar;
    if(usesLiveEngine(selected.source) && calendarCustomers[selected.source]!==customerId){context.calendar={status:'different_customer'};return context;}
    try {
      const data=await calendarLoader(selected.source);
      if(data.customerId!==calendarCustomers[selected.source])throw new Error('Calendar identity mismatch');
      const period=requestedPeriod(input.message,data,selected);
      const all=calendarWithEdits(data,selected.edits);
      const named=all.find(e=>e.title.length>=3 && input.message.toLowerCase().includes(e.title.toLowerCase()));
      const lookupFuture=named&&!period.explicit;
      const entries=named?all.filter(e=>e.title===named.title && e.date>=period.start && (lookupFuture || e.date<=period.end)):all.filter(e=>e.date>=period.start&&e.date<=period.end);
      const removed=deletedEvents(data,selected.edits);
      context.calendar={status:'available',source:selected.source,customerId:data.customerId,sameCustomer:data.customerId===customerId,
        label:data.label,sourceNotice:data.sourceNotice,isIllustrative:!!data.isIllustrative,asOf:data.asOf,coverage:{start:data.rangeStart,end:data.rangeEnd},
        queryPeriod:lookupFuture?{start:period.start,end:data.rangeEnd}: {start:period.start,end:period.end},
        covered:period.start>=data.rangeStart&&period.end<=data.rangeEnd,
        events:entries.slice(0,60).map(e=>({...compactEvent(e),visible:selected.visibility[eventGroup(e)]===true})),totalEvents:entries.length,truncated:entries.length>60,
        deletedCount:removed.length,deleted:removed.slice(0,30).map(compactEvent),
        warnings:(data.notifications??[]).filter(n=>n.kind!=='bill_timing_uncertain').map(n=>({title:n.title,summary:n.summary,explanation:n.explanation,asOf:n.asOf,evidenceIds:n.evidenceIds})),
        basis:'Personal reminders and deletions change only the calendar; engine forecasts, automatic totals, bank payments and Google feed remain unchanged. A separate calendar sample must never be combined with the Home account.'};
    }catch{context.calendar={status:'unavailable'};}
  }
  return context;
}
const response=(summary,bullets=[],evidence=[],sections=[])=>({title:'',summary,bullets,nextQuestion:'',evidence,sections});
const readQuestion=text=>/^(show|list|what|which|when|how|tell|do i|have i|can you (see|read|show|tell)|remind|explain|summari[sz]e)\b/i.test(text);
export function appSectionAnswer(message, context) {
  if(!context)return null;
  const text=message.trim().toLowerCase();if(!readQuestion(text))return null;
  if(/\b(draft|add|delete|remove|change|update|create|cancel)\b/.test(text) && !/\bdeleted\b/.test(text))return null;
  const goalAsked=/\b(goals?|savings plan)\b/.test(text) || context.goals.shortTermGoals?.some(g=>g.label && text.includes(g.label.toLowerCase()));
  const calendarAsked=/\b(calendar|reminders?)\b/.test(text) || [...(context.calendar.events??[]),...(context.calendar.deleted??[])].some(e=>text.includes(e.title.toLowerCase()));
  const homeAsked=/\b(home|first page|dashboard|spend today|per day|daily (spending|allowance))\b/.test(text);
  const budgetAsked=/\b(budget page|selected budget|this budget month)\b/.test(text);
  if([goalAsked,calendarAsked,homeAsked,budgetAsked].filter(Boolean).length>1){
    if(calendarAsked && context.calendar.status==='available' && !context.calendar.sameCustomer)return response('The selected calendar is a separate sample from Home; its payments cannot be used to judge whether your goals fit your account.',[],[],['home','goals','calendar']);
    return null;
  }
  if(goalAsked){
    const g=context.goals;if(g.status!=='available')return response('I couldn’t read the Goals section for this profile. Open Goals to check its saved entries, then try again.',[],[],['goals']);
    if(/\b(savings plan|regular|monthly|long.term)\b/.test(text) && !/\bgoals\b/.test(text))return response(`Your Goals savings plan is ${money(g.longTerm.monthlyCents)} monthly into ${g.longTerm.accountType}, ${g.longTerm.active?'marked active':'not activated'} in the app.`,['This is a local plan; no account has been opened or money moved.'],[],['goals']);
    let goals=g.shortTermGoals;
    const named=goals.filter(i=>i.label && text.includes(i.label.toLowerCase()));if(named.length)goals=named;
    if(!goals.length)return response('Your Goals section has no saved goals.',[],[],['goals']);
    if(/\blong.term\b/.test(text))goals=goals.filter(i=>i.horizon==='long');
    if(/\bshort.term\b/.test(text))goals=goals.filter(i=>i.horizon==='short');
    if(!goals.length)return response('There are no goals in that timeframe in your Goals section.',[],[],['goals']);
    const rows=goals.map(i=>({label:i.label||'Unnamed goal',value:`${money(i.savedCents)} recorded of ${money(i.targetCents)} · by ${i.targetDate}${i.complete?' · marked complete':''}`,id:`goal:${i.id}`}));
    return response(goals.length===1?`${rows[0].label}: ${rows[0].value}.`:`Your Goals section has ${goals.length} goals; the first ${Math.min(3,goals.length)} are below.`,
      goals.length===1?['Saved amounts are recorded in Goals, not verified bank savings.']:rows.slice(0,3).map(r=>`${r.label}: ${r.value}`),rows.slice(0,12),['goals']);
  }
  if(calendarAsked){
    const c=context.calendar;if(c.status!=='available')return response('I couldn’t read the selected calendar. Open Calendar to check its source or retry loading it.',[],[],['calendar']);
    const prefix=c.sameCustomer?'Your selected calendar':`The ${c.isIllustrative?'fictional demo':'separate sample'} calendar`;
    if(/\b(warning|alert|risk|shortfall)\b/.test(text))return response(c.warnings[0]?`${prefix}: ${c.warnings[0].summary}`:`${prefix} has no current spending alert.`,c.warnings.slice(0,1).map(n=>`Analysis through ${n.asOf}. ${n.title}`),[],['calendar']);
    const deletedNamed=c.deleted.find(e=>text.includes(e.title.toLowerCase()));
    if(deletedNamed && !c.events.some(e=>e.title===deletedNamed.title))return response(`${deletedNamed.title} is deleted from the selected calendar.`,['Deleting its reminder does not cancel the payment. You can restore it in Calendar.'],[],['calendar']);
    if(/\bdeleted\b/.test(text))return response(`${prefix} has ${c.deletedCount} deleted reminders.`,['Deleting a reminder does not cancel its payment.'],c.deleted.map(e=>({label:e.title,value:e.date,id:e.id})).slice(0,12),['calendar']);
    if(!c.covered)return response(`The selected calendar covers ${c.coverage.start} to ${c.coverage.end}; I can’t confirm events outside that range.`,[],[],['calendar']);
    const named=c.events.some(e=>text.includes(e.title.toLowerCase()));
    const entries=named?c.events:c.events.filter(e=>e.visible);
    const rows=entries.map(e=>({label:e.title,value:`${e.date} · ${money(e.amountCents)} · ${e.source==='manual'?'added by you':'estimated'}${e.visible?'':' · hidden by filter'}`,id:e.id}));
    return response(rows.length?`${prefix} shows ${rows[0].label} on ${rows[0].value}.`:`${prefix} has no matching visible events for ${c.queryPeriod.start} to ${c.queryPeriod.end}.`,
      [c.sameCustomer?'Dates are reminders or estimates; calendar edits do not recalculate your forecast.':'This sample is separate from your Home account.',...(c.truncated?['This is a partial list; narrow the date range to see more.']:[])],rows.slice(0,12),['calendar']);
  }
  if(homeAsked){
    const h=context.home;if(h.status!=='available')return response('Home is attached to a different profile.',[],[],['home']);
    const d=h.display;
    return response(`Home’s demo shows ${money(d.safePerDayCents)} per day, with ${money(d.everydayLeftCents)} everyday spending left over ${d.daysLeft} days.`,
      [d.replayLabel+' This is not a live affordability check.'],d.baskets.map(b=>({label:b.label,value:`Planned ${money(b.plannedCents)} · remaining ${money(b.remainingCents)}`})),['home']);
  }
  if(budgetAsked){const b=context.budget;if(b.status!=='available')return response('The selected budget month is unavailable.',[],[],['budget']);
    return response(`Budget is showing ${b.selectedMonth}: ${b.explanation.label}.`,[b.spentCents===null?'Recorded spending is unavailable for this period.':`Recorded spending: ${money(b.spentCents)}.`],b.categories.slice(0,12).map(c=>({label:c.category,value:c.spentCents===null?'No recorded activity for this period':money(c.spentCents)})),['budget']);}
  return null;
}
