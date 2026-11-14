import { appCustomer, calendarCustomers, goalsStorageKey, normalizeGoals, normalizeCalendar, validateAppState } from './app-context-contract.mjs';
import { readEdits } from './calendar-edits.mjs';
let goals, calendar, budgetPeriod='plan';
export function shareGoals(value) { goals={status:'available',data:normalizeGoals(value)}; }
export function shareCalendar(value) { calendar={status:'available',...normalizeCalendar(value)}; }
export function unavailableCalendar() { calendar={status:'unavailable'}; }
export function shareBudget(period) { budgetPeriod=period; }
export function collectAppState(customerId, storage) {
  if (customerId!==appCustomer) return {version:1,customerId};
  if (!storage) { try { storage=localStorage; } catch { storage={getItem(){throw new Error('Storage unavailable');}}; } }
  let goalState=goals, calendarState=calendar;
  if (!goalState) {
    try { const raw=storage.getItem(goalsStorageKey);goalState=raw===null?{status:'default'}:{status:'available',data:normalizeGoals(JSON.parse(raw))}; }
    catch { goalState={status:'unavailable'}; }
  }
  if (!calendarState) {
    try {
      const source=storage.getItem('calendar-v3:source')??'risk';
      const saved=JSON.parse(storage.getItem(`calendar-v3:${source}:view`)??'null');
      calendarState={status:'available',...normalizeCalendar({source,view:saved?.view??'month',anchor:saved?.anchor??null,visibility:saved?.visibility,edits:readEdits(storage,calendarCustomers[source])})};
    } catch { calendarState={status:'unavailable'}; }
  }
  return validateAppState({version:1,customerId,goals:goalState,calendar:calendarState,budget:{period:budgetPeriod}},customerId);
}
// This module is shared by the app's ES modules and the coach's dynamic import.
if (typeof window!=='undefined') window.addEventListener('storage',event=>{if(event.key===goalsStorageKey || event.key===null)goals=undefined;});
