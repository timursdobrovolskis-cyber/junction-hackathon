import { isDate, monthDays, shiftMonth } from './calendar-model.mjs';

// Personal calendar reminders only. Forecasts and engine amounts remain untouched.
export const editsKey = customerId => `calendar-edits-v1:${customerId}`;
export const emptyEdits = customerId => ({version: 1, customerId, items: [], removed: [], removedSeries: []});
export function amountInCents(text) {
  const match = /^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(String(text).trim());
  if (!match) throw new Error('Enter an amount such as 15.99, with up to two decimal places.');
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (cents <= 0) throw new Error('Enter an amount greater than zero.');
  return cents;
}
export function validateEdits(value, customerId) {
  if (!value || value.version !== 1 || value.customerId !== customerId || !Array.isArray(value.items) || value.items.length > 100
    || !Array.isArray(value.removed) || value.removed.length > 5000 || !Array.isArray(value.removedSeries) || value.removedSeries.length > 100) throw new Error('Invalid saved calendar edits');
  for (const item of value.items) {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id)
      || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 80 || !isDate(item.date)
      || !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0 || item.amountCents > 9999999999
      || !['bill','subscription','income'].includes(item.kind) || !['once','monthly','yearly'].includes(item.cadence)) throw new Error('Invalid saved reminder');
  }
  if (new Set(value.items.map(item => item.id)).size !== value.items.length) throw new Error('Duplicate reminder');
  for (const list of [value.removed, value.removedSeries]) {
    if (list.some(id => typeof id !== 'string' || !id || id.length > 200) || new Set(list).size !== list.length) throw new Error('Invalid deleted events');
  }
  if (value.removedSeries.some(id => !value.items.some(item => item.id === id))) throw new Error('Unknown reminder series');
  return value;
}
export function readEdits(storage, customerId) {
  const raw = storage.getItem(editsKey(customerId));
  return raw === null ? emptyEdits(customerId) : validateEdits(JSON.parse(raw), customerId);
}
export function writeEdits(storage, edits) {
  validateEdits(edits, edits.customerId);
  storage.setItem(editsKey(edits.customerId), JSON.stringify(edits));
}
export function reminderEvents(edits, start, end) {
  if (!isDate(start) || !isDate(end) || end < start) throw new Error('Invalid reminder range');
  const events = [];
  for (const item of edits.items) {
    const originalDay = Number(item.date.slice(-2));
    let month = item.date.slice(0, 7);
    for (let count = 0; month <= end.slice(0, 7) && count < 1200; count++) {
      const day = Math.min(originalDay, Number(monthDays(month).at(-1).slice(-2)));
      const date = `${month}-${String(day).padStart(2, '0')}`;
      if (date >= start && date <= end) events.push({ ...item, id: `local:${item.id}:${date}`, localId: item.id, date,
        earliestDate: date, latestDate: date, direction: item.kind === 'income' ? 'inflow' : 'outflow', source: 'manual',
        status: 'planned', evidenceIds: [], explanation: 'A personal reminder added by you. It is not a detected bank transaction or a recalculated forecast.' });
      if (item.cadence === 'once') break;
      month = shiftMonth(month, item.cadence === 'monthly' ? 1 : 12);
    }
  }
  return events;
}
export function calendarWithEdits(data, edits) {
  if (edits.customerId !== data.customerId) throw new Error('Wrong calendar customer');
  return [...data.events, ...reminderEvents(edits, data.rangeStart, data.rangeEnd)]
    .filter(event => !edits.removed.includes(event.id) && !edits.removedSeries.includes(event.localId))
    .sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
export function deletedEvents(data, edits) {
  const singles = [...data.events, ...reminderEvents(edits, data.rangeStart, data.rangeEnd)]
    .filter(event => edits.removed.includes(event.id) && !edits.removedSeries.includes(event.localId));
  const series = edits.items.filter(item => edits.removedSeries.includes(item.id)).map(item => ({...item, series: true}));
  return [...singles, ...series];
}
