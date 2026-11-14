import { isDate, visibilityDefaults } from './calendar-model.mjs';
import { emptyEdits, validateEdits } from './calendar-edits.mjs';
export const appCustomer = 'CUST00005';
export const goalsStorageKey = 'smobiili-goals-v1';
export const calendarCustomers = Object.freeze({risk:'RISK-DEMO',engine:'CUST00005',regular:'CUST00003',recurring:'CALENDAR-DEMO',subscriptions:'SUBSCRIPTIONS-DEMO'});
const cents = n => Number.isSafeInteger(n) && n >= 0 && n <= 9999999999;
const shortText = (s, max) => typeof s === 'string' && s.length <= max && !/[\u0000-\u001f]/.test(s);
export function initialGoals(fixture) {
  return {shortTermGoals:[{id:'goal-demo-1',...fixture.goal,complete:false}],longTerm:{monthlyCents:fixture.longTermGoal.monthlyContributionCents,accountType:fixture.longTermGoal.accountType,years:fixture.longTermGoal.horizonYears}};
}
export function normalizeGoals(value) {
  const items = value?.shortTermGoals ?? (value?.shortTerm ? [{id:'goal-demo-1',...value.shortTerm,complete:false}] : null);
  if (!Array.isArray(items) || items.length > 100 || !value.longTerm) throw new Error('Invalid goals');
  const shortTermGoals = items.map(g => {
    if (!g || !shortText(g.id,100) || !g.id || !shortText(g.label,120) || !cents(g.targetCents) || !cents(g.savedCents)
      || !isDate(g.targetDate) || typeof g.complete !== 'boolean' || !['short','long',undefined].includes(g.horizon)) throw new Error('Invalid goal');
    return {id:g.id,label:g.label,targetCents:g.targetCents,savedCents:g.savedCents,targetDate:g.targetDate,complete:g.complete,horizon:g.horizon??'short'};
  });
  if (new Set(shortTermGoals.map(g=>g.id)).size !== items.length) throw new Error('Duplicate goals');
  const p=value.longTerm;
  if (!cents(p.monthlyCents) || !['S-Tuottotili','S-Määräaikaistili',undefined].includes(p.accountType)
    || !Number.isInteger(p.years) || p.years<1 || p.years>40 || ![true,false,undefined].includes(p.active)) throw new Error('Invalid savings plan');
  return {shortTermGoals,longTerm:{monthlyCents:p.monthlyCents,accountType:p.accountType??'S-Tuottotili',years:p.years,active:p.active===true}};
}
export function normalizeCalendar(value) {
  if (!value || !Object.hasOwn(calendarCustomers,value.source) || !['day','week','month'].includes(value.view)
    || !(value.anchor===null || isDate(value.anchor))) throw new Error('Invalid calendar selection');
  const customerId=calendarCustomers[value.source];
  const edits=validateEdits(value.edits??emptyEdits(customerId),customerId);
  return {source:value.source,view:value.view,anchor:value.anchor,
    visibility:Object.fromEntries(Object.keys(visibilityDefaults).map(key=>[key,typeof value.visibility?.[key]==='boolean'?value.visibility[key]:true])),
    edits:{version:1,customerId,items:edits.items.map(i=>({id:i.id,title:i.title,date:i.date,amountCents:i.amountCents,kind:i.kind,cadence:i.cadence})),removed:[...edits.removed],removedSeries:[...edits.removedSeries]}};
}
export function validateAppState(value, customerId) {
  if (!value || JSON.stringify(value).length>90000 || value.version!==1 || value.customerId!==customerId) throw new Error('Invalid app context');
  if (customerId!==appCustomer) {
    if (value.goals || value.calendar || value.budget) throw new Error('Sections belong to another profile');
    return {version:1,customerId};
  }
  const goals=value.goals?.status==='available'?{status:'available',data:normalizeGoals(value.goals.data)}
    : ['default','unavailable'].includes(value.goals?.status)?{status:value.goals.status}:null;
  const calendar=value.calendar?.status==='available'?{status:'available',...normalizeCalendar(value.calendar)}
    : value.calendar?.status==='unavailable'?{status:'unavailable'}:null;
  const period=value.budget?.period;
  if (!goals || !calendar || !(period==='plan'||period==='history'||/^\d{4}-(0[1-9]|1[0-2])$/.test(period))) throw new Error('Invalid app sections');
  return {version:1,customerId,goals,calendar,budget:{period}};
}
