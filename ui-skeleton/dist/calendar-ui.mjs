import { eventsInRange, monthDays, shiftMonth, validateCalendar } from './calendar-model.mjs';

const $ = (id) => document.getElementById(id);
const page = $('calendar-page');
const customers = { engine: 'CUST00005', regular: 'CUST00003', recurring: 'CALENDAR-DEMO', subscriptions: 'SUBSCRIPTIONS-DEMO' };
const euro = (amount) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(amount / 100);
const dateLabel = (day, options = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const create = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const read = (key) => { try { return localStorage.getItem(`calendar-v2:${key}`); } catch { return null; } };
const remember = (key, value) => { try { localStorage.setItem(`calendar-v2:${key}`, value); } catch { /* Storage is optional. */ } };
let data, month, selectedDay = null, filter = 'all', activeSource = 'regular', controller, busy = false;

function showDialog(title, content, returnFocus) {
  const dialog = $('calendar-detail');
  $('calendar-detail-title').textContent = title;
  $('calendar-detail-body').replaceChildren(...content);
  dialog.onclose = () => returnFocus?.focus();
  if (!dialog.open) dialog.showModal();
  $('calendar-detail-close').focus();
}

function openEvent(event, returnFocus, back) {
  const content = [];
  if (back) { const button = create('button', '← All payments on this date', 'calendar-subtle'); button.type = 'button'; button.addEventListener('click', back); content.push(button); }
  content.push(create('p', `${event.direction === 'inflow' ? '+' : '−'}${euro(event.amountCents)}`, 'calendar-detail-amount'));
  content.push(create('p', `${dateLabel(event.date, { day: 'numeric', month: 'long', year: 'numeric' })} · Estimated ${event.cadence} payment`));
  content.push(create('p', event.explanation));
  if (event.accountId) content.push(create('p', `Account: ${event.accountId}`));
  if (event.merchantId) content.push(create('p', `Merchant reference: ${event.merchantId}`));
  if (event.scope === 'account_type_category_aggregate') content.push(create('p', 'The data identifies the payment category, but does not name the payee.'));
  content.push(create('h3', event.source === 'subscription_schedule' ? 'Subscription payment history' : 'Supporting transactions'));
  const evidence = data.evidence.filter((row) => event.evidenceIds.includes(row.id));
  if (!evidence.length) content.push(create('p', 'This date comes from the supplied schedule; no historical transactions are available.'));
  else {
    const list = create('ul', undefined, 'calendar-evidence');
    for (const row of evidence) {
      const item = create('li'); item.append(create('span', `${dateLabel(row.date, { day: 'numeric', month: 'short', year: 'numeric' })} · ${euro(row.amountCents)}`), create('small', row.id)); list.append(item);
    }
    content.push(list);
  }
  content.push(create('p', 'Calendar reminders do not move money or change your balance forecast.', 'calendar-detail-note'));
  showDialog(event.title, content, returnFocus);
}

function eventButton(event, onClick) {
  const button = create('button', undefined, `calendar-event event-${event.kind}`); button.type = 'button';
  const icon = create('span', undefined, 'calendar-event-icon'); icon.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', event.cadence === 'yearly' ? '#i-calendar' : '#i-arrow');
  svg.append(use); if (event.cadence !== 'yearly') svg.style.transform = event.kind === 'income' ? 'rotate(45deg)' : 'rotate(-45deg)'; icon.append(svg);
  const text = create('span', undefined, 'calendar-event-copy'); text.append(create('strong', event.title), create('small', `${dateLabel(event.date)} · Estimated`));
  const amount = create('span', undefined, 'calendar-event-value'); amount.append(create('strong', `${event.direction === 'inflow' ? '+' : '−'}${euro(event.amountCents)}`), create('small', event.cadence === 'yearly' ? 'Yearly' : 'Monthly'));
  button.append(icon, text, amount); button.addEventListener('click', () => onClick(button)); return button;
}

function openDay(day) {
  // Always show all payments on the date, even when the month has a filter.
  const entries = eventsInRange(data.events, day, day);
  const list = create('div', undefined, 'calendar-day-payments');
  const returnFocus = document.querySelector(`[data-calendar-date="${day}"]`);
  if (!entries.length) list.append(create('p', 'No regular payments scheduled on this date. Irregular spending is not shown in this calendar.', 'calendar-empty'));
  for (const event of entries) list.append(eventButton(event, () => openEvent(event, returnFocus, () => openDay(day))));
  showDialog(dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), [list], returnFocus);
}

function render() {
  if (!data) return;
  $('calendar-month').textContent = dateLabel(`${month}-01`, { month: 'long', year: 'numeric' });
  $('calendar-prev').disabled = busy || month <= data.rangeStart.slice(0, 7);
  $('calendar-next').disabled = busy || month >= data.rangeEnd.slice(0, 7);
  const jump = $('calendar-jump'); jump.replaceChildren(); jump.disabled = busy;
  for (let optionMonth = data.rangeStart.slice(0, 7); optionMonth <= data.rangeEnd.slice(0, 7); optionMonth = shiftMonth(optionMonth, 1)) {
    const option = create('option', dateLabel(`${optionMonth}-01`, { month: 'long', year: 'numeric' })); option.value = optionMonth; option.selected = optionMonth === month; jump.append(option);
  }
  const days = monthDays(month); const lastDay = days.at(-1);
  const monthEvents = eventsInRange(data.events, `${month}-01`, lastDay, filter);
  const grid = $('calendar-grid'); grid.replaceChildren();
  for (const day of days) {
    if (!day) { grid.append(create('span', '', 'calendar-spacer')); continue; }
    const entries = eventsInRange(monthEvents, day, day);
    const button = create('button', undefined, 'calendar-day'); button.type = 'button'; button.dataset.calendarDate = day;
    button.disabled = busy || day < data.rangeStart || day > data.rangeEnd;
    button.append(create('span', String(Number(day.slice(-2)))));
    button.setAttribute('aria-pressed', String(selectedDay === day));
    if (day === today) { button.classList.add('is-today'); button.setAttribute('aria-current', 'date'); }
    const dots = create('span', undefined, 'calendar-dots');
    for (const kind of [...new Set(entries.map((entry) => entry.kind))]) dots.append(create('i', '', `dot-${kind}`));
    button.append(dots);
    button.setAttribute('aria-label', `${dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}, ${entries.length} matching payments. Open date details`);
    button.addEventListener('click', () => { selectedDay = day; render(); openDay(day); });
    grid.append(button);
  }
  $('calendar-selection').textContent = selectedDay ? dateLabel(selectedDay, { weekday: 'long', day: 'numeric', month: 'short' }) : 'This month';
  $('calendar-clear-day').hidden = !selectedDay;
  const agenda = $('calendar-agenda'); agenda.replaceChildren();
  const events = selectedDay ? eventsInRange(monthEvents, selectedDay, selectedDay) : monthEvents;
  $('calendar-count').textContent = `${events.length} ${events.length === 1 ? 'payment' : 'payments'}`;
  if (!events.length) agenda.append(create('p', 'No regular payments with predictable dates in this selection. Irregular spending is not shown.', 'calendar-empty'));
  for (const event of events) agenda.append(eventButton(event, (button) => openEvent(event, button)));
  const omissions = data.omittedPatterns ?? [];
  $('calendar-warning').textContent = data.notice + (omissions.length ? ` Not scheduled: ${[...new Set(omissions.map((item) => item.title))].join(', ')} — the history does not establish a consistent date or amount.` : '');
  $('calendar-coverage').textContent = `History / schedule as of ${dateLabel(data.asOf, { day: 'numeric', month: 'short', year: 'numeric' })}. Monthly view through ${dateLabel(data.rangeEnd, { month: 'long', year: 'numeric' })}.`;
}

async function load(source) {
  controller?.abort(); const request = new AbortController(); controller = request; busy = true;
  $('calendar-detail').close(); page.setAttribute('aria-busy', 'true'); $('calendar-error').hidden = true; $('calendar-status').textContent = 'Loading your calendar…'; render();
  try {
    const response = await fetch(`/api/calendar?source=${encodeURIComponent(source)}`, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]), cache: 'no-store' });
    if (!response.ok) throw new Error('Calendar unavailable');
    const result = validateCalendar(await response.json(), customers[source]);
    if (request !== controller) return;
    const previousMonth = source === activeSource && month ? month : read(`${source}:month`);
    data = result; activeSource = source;
    month = previousMonth && previousMonth >= data.rangeStart.slice(0, 7) && previousMonth <= data.rangeEnd.slice(0, 7) ? previousMonth : data.rangeStart.slice(0, 7);
    selectedDay = null; remember('source', source); $('calendar-source').value = source;
    $('calendar-source-note').textContent = data.sourceNotice;
    $('calendar-status').textContent = data.connection === 'engine' ? 'Refreshed from your financial engine' : 'Saved customer / demo data · no live bank connection';
  } catch {
    if (request !== controller || request.signal.aborted) return;
    $('calendar-error').hidden = false;
    $('calendar-error').textContent = data ? 'Could not load the new calendar. Your previous customer remains displayed.' : 'Could not load the calendar. Please retry.';
    $('calendar-source').value = activeSource;
    $('calendar-status').textContent = data ? 'Previous calendar retained' : 'Calendar unavailable';
  } finally {
    if (request === controller) { busy = false; page.setAttribute('aria-busy', 'false'); render(); }
  }
}
function changeMonth(next) {
  if (!data || busy || next < data.rangeStart.slice(0, 7) || next > data.rangeEnd.slice(0, 7)) return;
  month = next; selectedDay = null; remember(`${activeSource}:month`, month); render();
}
$('calendar-source').addEventListener('change', (event) => load(event.target.value));
$('calendar-retry').addEventListener('click', () => load($('calendar-source').value));
$('calendar-prev').addEventListener('click', () => changeMonth(shiftMonth(month, -1)));
$('calendar-next').addEventListener('click', () => changeMonth(shiftMonth(month, 1)));
$('calendar-jump').addEventListener('change', (event) => changeMonth(event.target.value));
$('calendar-reset-month').addEventListener('click', () => { if (data) changeMonth(data.rangeStart.slice(0, 7)); });
$('calendar-clear-day').addEventListener('click', () => { selectedDay = null; render(); });
document.querySelectorAll('[data-calendar-filter]').forEach((button) => button.addEventListener('click', () => {
  filter = button.dataset.calendarFilter;
  document.querySelectorAll('[data-calendar-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item === button))); render();
}));
$('calendar-detail-close').addEventListener('click', () => $('calendar-detail').close());
const savedSource = read('source'); if (Object.hasOwn(customers, savedSource)) $('calendar-source').value = savedSource;
function activate() { if (location.hash === '#calendar' && !data && !busy) load($('calendar-source').value); }
window.addEventListener('hashchange', activate); activate();
