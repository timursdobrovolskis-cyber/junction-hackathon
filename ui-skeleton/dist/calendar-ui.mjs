import { eventsInRange, monthDays, shiftMonth, validateCalendar } from './calendar-model.mjs';

const $ = (id) => document.getElementById(id);
const page = $('calendar-page');
const euro = (amount) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(amount / 100);
const dateLabel = (day, options = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const create = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let data, month, selectedDay = null, filter = 'all', activeSource = 'engine', controller, busy = false;
const statusLabel = (event) => event.status === 'planned' ? 'Planned' : event.status === 'needs_review' ? 'Check details' : 'Estimated';
const period = (event) => event.earliestDate === event.latestDate ? dateLabel(event.earliestDate)
  : `${dateLabel(event.earliestDate)} – ${dateLabel(event.latestDate)}`;

function openEvent(event, returnFocus) {
  const dialog = $('calendar-detail');
  $('calendar-detail-title').textContent = event.title;
  const body = $('calendar-detail-body'); body.replaceChildren();
  body.append(create('p', `${event.direction === 'inflow' ? '+' : '−'}${euro(event.amountCents)}`, 'calendar-detail-amount'));
  body.append(create('p', `${period(event)} · ${statusLabel(event)}`));
  body.append(create('p', event.cadence === 'yearly' ? 'Possible yearly renewal' : event.cadence === 'monthly' ? 'Possible monthly recurrence' : event.cadence === 'once' ? 'One-off planned cost' : 'From the cash-flow forecast'));
  body.append(create('p', event.explanation));
  body.append(create('p', event.alreadyIncludedInForecast === true ? 'Already included in the forecast. Showing it here does not deduct it again.' : 'This calendar entry is not an additional deduction. Its effect on balances has not been separately calculated.', 'calendar-detail-note'));
  if (event.scope === 'account_type_category_aggregate') body.append(create('p', 'This is a category/payment group, which may cover several providers. It is not an identified subscription.'));
  if (event.merchantId) body.append(create('p', `Merchant reference: ${event.merchantId}`));
  const evidence = data.evidence.filter((row) => event.evidenceIds.includes(row.id));
  body.append(create('h3', 'Why it appears here'));
  if (!evidence.length) body.append(create('p', event.source === 'customer' ? 'Added as a planned cost by the customer.' : 'No transaction details are available in this example.'));
  else {
    const list = create('ul', undefined, 'calendar-evidence');
    for (const row of evidence) {
      const item = create('li'); item.append(create('span', `${dateLabel(row.date, { day: 'numeric', month: 'short', year: 'numeric' })} · ${euro(row.amountCents)}`), create('small', row.id)); list.append(item);
    }
    body.append(list);
  }
  dialog.onclose = () => returnFocus?.focus(); dialog.showModal(); $('calendar-detail-close').focus();
}

function render() {
  if (!data) return;
  $('calendar-month').textContent = dateLabel(`${month}-01`, { month: 'long', year: 'numeric' });
  $('calendar-prev').disabled = busy || month <= data.rangeStart.slice(0, 7);
  $('calendar-next').disabled = busy || month >= data.rangeEnd.slice(0, 7);
  const days = monthDays(month); const lastDay = days.at(-1);
  const monthEvents = eventsInRange(data.events, `${month}-01`, lastDay, filter);
  const grid = $('calendar-grid'); grid.replaceChildren();
  for (const day of days) {
    if (!day) { grid.append(create('span', '', 'calendar-spacer')); continue; }
    const entries = eventsInRange(monthEvents, day, day);
    const button = create('button', undefined, 'calendar-day'); button.type = 'button';
    button.disabled = busy || day < data.rangeStart || day > data.rangeEnd;
    button.append(create('span', String(Number(day.slice(-2)))));
    button.setAttribute('aria-pressed', String(selectedDay === day));
    if (day === today) { button.classList.add('is-today'); button.setAttribute('aria-current', 'date'); }
    const risk = data.belowBufferDates?.includes(day) ? 'below' : data.possibleBelowBufferDates?.includes(day) ? 'possible' : null;
    if (risk) button.classList.add(`risk-${risk}`);
    const dots = create('span', undefined, 'calendar-dots');
    for (const kind of [...new Set(entries.map((entry) => entry.kind))].slice(0, 3)) dots.append(create('i', '', `dot-${kind}`));
    button.append(dots);
    button.setAttribute('aria-label', `${dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}, ${entries.length} payment windows${risk ? risk === 'below' ? ', estimated below buffer' : ', possible buffer risk' : ''}`);
    button.addEventListener('click', () => { selectedDay = selectedDay === day ? null : day; render(); });
    grid.append(button);
  }
  $('calendar-selection').textContent = selectedDay ? dateLabel(selectedDay, { weekday: 'long', day: 'numeric', month: 'short' }) : 'This month';
  $('calendar-clear-day').hidden = !selectedDay;
  const balance = $('calendar-balance'); balance.replaceChildren();
  if (selectedDay) {
    const daily = data.daily.find((day) => day.date === selectedDay);
    if (daily) {
      balance.append(create('span', 'Estimated end-of-day balance'), create('strong', euro(daily.expectedBalanceCents)));
      if (data.belowBufferDates?.includes(selectedDay)) balance.append(create('small', `Estimated below your ${euro(data.bufferCents)} buffer.`, 'calendar-risk-text'));
      else if (data.possibleBelowBufferDates?.includes(selectedDay)) balance.append(create('small', 'Some forecast scenarios fall below the buffer. Timing and amounts remain uncertain.', 'calendar-risk-text'));
      if (data.forecastStatus !== 'estimated') balance.append(create('small', 'The forecast needs review; do not rely on this amount alone.'));
    } else balance.append(create('p', 'No balance forecast for this date. Recurring reminders do not extend the cash-flow forecast.'));
  }
  const agenda = $('calendar-agenda'); agenda.replaceChildren();
  const events = selectedDay ? eventsInRange(monthEvents, selectedDay, selectedDay) : monthEvents;
  $('calendar-count').textContent = `${events.length} ${events.length === 1 ? 'entry' : 'entries'}`;
  if (!events.length) agenda.append(create('p', 'No payments identified for this selection. This does not mean no spending will occur.', 'calendar-empty'));
  for (const event of events) {
    const button = create('button', undefined, `calendar-event event-${event.kind}`); button.type = 'button';
    const icon = create('span', undefined, 'calendar-event-icon');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('icon'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', event.cadence === 'yearly' ? '#i-calendar' : '#i-arrow');
    svg.append(use); if (event.cadence !== 'yearly') svg.style.transform = event.kind === 'income' ? 'rotate(45deg)' : 'rotate(-45deg)'; icon.append(svg);
    const text = create('span', undefined, 'calendar-event-copy'); text.append(create('strong', event.title), create('small', `${period(event)} · ${statusLabel(event)}`));
    const amount = create('span', undefined, 'calendar-event-value'); amount.append(create('strong', `${event.direction === 'inflow' ? '+' : '−'}${euro(event.amountCents)}`), create('small', event.cadence === 'yearly' ? 'Yearly' : event.cadence === 'monthly' ? 'Monthly' : event.source === 'forecast' ? 'Forecast' : 'One-off'));
    button.append(icon, text, amount); button.addEventListener('click', () => openEvent(event, button)); agenda.append(button);
  }
  $('calendar-coverage').textContent = data.forecastThrough ? `Balance forecast through ${dateLabel(data.forecastThrough, { day: 'numeric', month: 'short', year: 'numeric' })}. Later entries are recurring reminders only.` : 'Not enough history for a balance forecast. Recurring candidates still need checking.';
}

async function load(source) {
  controller?.abort(); const request = new AbortController(); controller = request; busy = true;
  page.setAttribute('aria-busy', 'true'); $('calendar-error').hidden = true; $('calendar-status').textContent = 'Loading your calendar…';
  render();
  try {
    const response = await fetch(`/api/calendar?source=${encodeURIComponent(source)}`, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]), cache: 'no-store' });
    if (!response.ok) throw new Error('Calendar unavailable');
    const result = validateCalendar(await response.json(), source === 'engine' ? 'CUST00005' : 'CALENDAR-DEMO');
    if (request !== controller) return;
    data = result; activeSource = source; month = data.rangeStart.slice(0, 7); selectedDay = null;
    $('calendar-source-note').textContent = data.sourceNotice;
    $('calendar-status').textContent = data.connection === 'engine' ? 'Calculated by your financial engine' : 'Saved engine example · no live bank connection';
    $('calendar-warning').textContent = data.forecastStatus === 'needs_review' ? 'This forecast needs review. Check its assumptions and payment evidence before relying on the estimates.' : data.notice;
  } catch {
    if (request !== controller || request.signal.aborted) return;
    $('calendar-error').hidden = false;
    $('calendar-error').textContent = data ? 'Could not load the new calendar. Your previous example is still displayed.' : 'Could not load the calendar. Please retry.';
    $('calendar-source').value = activeSource;
    $('calendar-status').textContent = data ? 'Previous calendar retained' : 'Calendar unavailable';
  } finally {
    if (request === controller) { busy = false; page.setAttribute('aria-busy', 'false'); render(); }
  }
}

$('calendar-source').addEventListener('change', (event) => load(event.target.value));
$('calendar-retry').addEventListener('click', () => load($('calendar-source').value));
$('calendar-prev').addEventListener('click', () => { month = shiftMonth(month, -1); selectedDay = null; render(); });
$('calendar-next').addEventListener('click', () => { month = shiftMonth(month, 1); selectedDay = null; render(); });
$('calendar-reset-month').addEventListener('click', () => { if (data) { month = data.rangeStart.slice(0, 7); selectedDay = null; render(); } });
$('calendar-clear-day').addEventListener('click', () => { selectedDay = null; render(); });
document.querySelectorAll('[data-calendar-filter]').forEach((button) => button.addEventListener('click', () => {
  filter = button.dataset.calendarFilter;
  document.querySelectorAll('[data-calendar-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item === button))); render();
}));
$('calendar-detail-close').addEventListener('click', () => $('calendar-detail').close());
function activate() { if (location.hash === '#calendar' && !data && !busy) load($('calendar-source').value); }
window.addEventListener('hashchange', activate); activate();
