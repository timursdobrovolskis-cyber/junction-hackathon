// Presentation helpers only. Amounts and balance forecasts come from Python.
export function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function monthDays(month) {
  if (!/^\d{4}-\d{2}$/.test(month) || !isDate(`${month}-01`)) throw new Error('Invalid calendar month');
  const first = new Date(`${month}-01T12:00:00Z`);
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)];
}
export function shiftMonth(month, amount) {
  if (!isDate(`${month}-01`) || !Number.isSafeInteger(amount)) throw new Error('Invalid month shift');
  const day = new Date(`${month}-01T12:00:00Z`); day.setUTCMonth(day.getUTCMonth() + amount);
  return day.toISOString().slice(0, 7);
}
export function eventsInRange(events, start, end, filter = 'all') {
  return events.filter((event) => event.date >= start && event.date <= end
    && (filter === 'all' || filter === 'income' && event.kind === 'income'
      || filter === 'bills' && ['bill', 'subscription'].includes(event.kind)
      || filter === 'subscriptions' && event.kind === 'subscription'
      || filter === 'yearly' && event.cadence === 'yearly'));
}
export function validateCalendar(value, expectedCustomer) {
  if (!value || value.schemaVersion !== '2.0' || value.customerId !== expectedCustomer || value.currency !== 'EUR'
    || !isDate(value.asOf) || !isDate(value.rangeStart) || !isDate(value.rangeEnd) || value.rangeStart <= value.asOf || value.rangeEnd < value.rangeStart
    || !['estimated', 'needs_review', 'insufficient_history'].includes(value.forecastStatus)
    || !Array.isArray(value.events) || value.events.length > 5000 || !Array.isArray(value.daily) || !Array.isArray(value.evidence)) throw new Error('Invalid calendar data');
  if (value.isIllustrative !== undefined && typeof value.isIllustrative !== 'boolean') throw new Error('Invalid illustration state');
  if (expectedCustomer === 'RISK-DEMO' && value.isIllustrative !== true) throw new Error('Demo must be labelled fictional');
  const cents = (amount) => Number.isSafeInteger(amount);
  if (value.monthSummaries !== undefined) {
    if (!value.monthSummaries || typeof value.monthSummaries !== 'object' || Array.isArray(value.monthSummaries)
      || Object.entries(value.monthSummaries).some(([month, summary]) => !isDate(`${month}-01`) || !summary
        || !['incomeCents', 'outflowCents', 'paymentCount'].every(key => cents(summary[key]) && summary[key] >= 0))) throw new Error('Invalid calendar summary');
  }
  if (!cents(value.bufferCents) || value.bufferCents < 0) throw new Error('Invalid buffer');
  for (const event of value.events) {
    if (typeof event.id !== 'string' || typeof event.title !== 'string' || !isDate(event.earliestDate) || !isDate(event.latestDate)
      || !isDate(event.date) || event.date !== event.earliestDate || event.date !== event.latestDate
      || event.date < value.rangeStart || event.date > value.rangeEnd || !cents(event.amountCents) || event.amountCents < 0
      || !['bill', 'income', 'subscription'].includes(event.kind) || !['estimated', 'needs_review', 'planned'].includes(event.status)
      || !['forecast', 'history_pattern', 'subscription_schedule'].includes(event.source) || !['inflow', 'outflow'].includes(event.direction)
      || !['monthly', 'yearly'].includes(event.cadence)
      || !Array.isArray(event.evidenceIds) || !event.evidenceIds.every((id) => typeof id === 'string')) throw new Error('Invalid calendar event');
  }
  if (new Set(value.events.map((event) => event.id)).size !== value.events.length) throw new Error('Duplicate calendar events');
  for (const day of value.daily) if (!isDate(day.date) || day.date <= value.asOf || !cents(day.expectedBalanceCents)) throw new Error('Invalid daily forecast');
  if (new Set(value.daily.map((day) => day.date)).size !== value.daily.length) throw new Error('Duplicate forecast days');
  if (value.exportAvailable !== undefined && typeof value.exportAvailable !== 'boolean') throw new Error('Invalid export state');
  if (value.notifications !== undefined) {
    if (!Array.isArray(value.notifications) || value.notifications.length > 50) throw new Error('Invalid notifications');
    for (const notice of value.notifications) {
      if (!notice || !['warning', 'info'].includes(notice.severity) || notice.asOf !== value.asOf
        || !['id', 'kind', 'title', 'summary', 'explanation', 'action'].every(key => typeof notice[key] === 'string')
        || !Array.isArray(notice.evidenceIds) || !notice.evidenceIds.every(id => typeof id === 'string')) throw new Error('Invalid notification');
      if (notice.timeline !== undefined && (!Array.isArray(notice.timeline) || notice.timeline.some(item => !item
        || !isDate(item.date) || typeof item.label !== 'string' || !cents(item.amountCents) || item.amountCents < 0
        || !['balance', 'inflow', 'outflow'].includes(item.direction)))) throw new Error('Invalid notification timeline');
      if (notice.metrics && (!Array.isArray(notice.metrics) || notice.metrics.some(m => typeof m.label !== 'string'
        || !(cents(m.amountCents) && m.amountCents >= 0 || cents(m.percent) && m.percent >= 0)))) throw new Error('Invalid notification metrics');
      if (notice.monthlyTotals && (!Array.isArray(notice.monthlyTotals) || notice.monthlyTotals.some(m => !isDate(`${m.month}-01`)
        || !cents(m.amountCents) || m.amountCents < 0))) throw new Error('Invalid monthly totals');
    }
    if (new Set(value.notifications.map(n => n.id)).size !== value.notifications.length) throw new Error('Duplicate notifications');
  }
  return value;
}

export const visibilityDefaults = Object.freeze({ income: true, bill: true, subscription: true, yearly: true, alerts: true });
export function eventGroup(event) { return event.cadence === 'yearly' ? 'yearly' : event.kind; }
export function visibleEvents(events, visibility) { return events.filter(event => visibility[eventGroup(event)] === true); }
export function shiftDay(day, offset) {
  if (!isDate(day) || !Number.isSafeInteger(offset)) throw new Error('Invalid day shift');
  const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10);
}
export function calendarPeriod(view, anchor) {
  if (!isDate(anchor) || !['day', 'week', 'month'].includes(view)) throw new Error('Invalid view');
  if (view === 'day') return { start: anchor, end: anchor, days: [anchor] };
  if (view === 'week') {
    const offset = (new Date(`${anchor}T12:00:00Z`).getUTCDay() + 6) % 7;
    const start = shiftDay(anchor, -offset); const days = Array.from({ length: 7 }, (_, n) => shiftDay(start, n));
    return { start, end: days[6], days };
  }
  const days = monthDays(anchor.slice(0, 7)); return { start: `${anchor.slice(0, 7)}-01`, end: days.at(-1), days };
}
export function movePeriod(view, anchor, offset) {
  if (!Number.isSafeInteger(offset)) throw new Error('Invalid period shift');
  calendarPeriod(view, anchor);
  if (view !== 'month') return shiftDay(anchor, offset * (view === 'week' ? 7 : 1));
  const month = shiftMonth(anchor.slice(0, 7), offset);
  const day = Math.min(Number(anchor.slice(-2)), Number(monthDays(month).at(-1).slice(-2)));
  return `${month}-${String(day).padStart(2, '0')}`;
}
export function restoreCalendarView(saved, rangeStart, rangeEnd) {
  let state; try { state = JSON.parse(saved); } catch { /* Use defaults. */ }
  return {
    view: ['day','week','month'].includes(state?.view) ? state.view : 'month',
    anchor: isDate(state?.anchor) && state.anchor >= rangeStart && state.anchor <= rangeEnd ? state.anchor : rangeStart,
    visibility: Object.fromEntries(Object.entries(visibilityDefaults).map(([key, fallback]) => [key, typeof state?.visibility?.[key] === 'boolean' ? state.visibility[key] : fallback])),
  };
}
