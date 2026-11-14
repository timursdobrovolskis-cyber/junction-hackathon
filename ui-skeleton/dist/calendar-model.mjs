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
  const cents = (amount) => Number.isSafeInteger(amount);
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
  return value;
}
