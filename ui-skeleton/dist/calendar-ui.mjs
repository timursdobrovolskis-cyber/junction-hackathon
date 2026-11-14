import { eventsInRange, shiftMonth, validateCalendar, isDate, visibleEvents, eventGroup, calendarPeriod, movePeriod, restoreCalendarView, visibilityDefaults } from './calendar-model.mjs';

import { emptyEdits, editsKey, readEdits, writeEdits, amountInCents, calendarWithEdits, deletedEvents } from './calendar-edits.mjs';

const $ = (id) => document.getElementById(id);
const page = $('calendar-page');
const customers = { risk: 'RISK-DEMO', engine: 'CUST00005', regular: 'CUST00003', recurring: 'CALENDAR-DEMO', subscriptions: 'SUBSCRIPTIONS-DEMO' };
const euro = (amount) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(amount / 100);
const dateLabel = (day, options = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const create = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const read = (key) => { try { return localStorage.getItem(`calendar-v3:${key}`); } catch { return null; } };
const remember = (key, value) => { try { localStorage.setItem(`calendar-v3:${key}`, value); } catch { /* Storage is optional. */ } };
let edits = emptyEdits('RISK-DEMO'), editsBlocked = false, undoEdit;
let data, anchor, view = 'month', visibility = { ...visibilityDefaults }, activeSource = 'risk', controller, busy = false;

function currentEvents() { return calendarWithEdits(data, edits); }
function editMessage(message, error = false) {
  $('calendar-edit-message').textContent = message;
  $('calendar-edit-message').classList.toggle('is-error', error);
  $('calendar-edit-status').hidden = false;
  if (error && $('calendar-detail').open) {
    let detailError = $('calendar-dialog-edit-error');
    if (!detailError) { detailError = create('p', '', 'calendar-form-error'); detailError.id = 'calendar-dialog-edit-error'; detailError.setAttribute('role', 'alert'); $('calendar-detail-body').prepend(detailError); }
    detailError.textContent = message;
  }
}
function changeEdits(change, message) {
  if (!data || busy || editsBlocked) return false;
  try {
    const previous = readEdits(localStorage, data.customerId);
    const next = structuredClone(previous); change(next); writeEdits(localStorage, next);
    undoEdit = { previous, expected: JSON.stringify(next) }; edits = next;
    render(); editMessage(message); $('calendar-undo').hidden = false; return true;
  } catch (error) {
    editMessage(error.message === 'Reminder limit' ? 'This customer has reached the limit of 100 personal reminders.' : 'Could not save this change on your device. Nothing was changed. Check browser storage and try again.', true);
    return false;
  }
}
function deleteEvent(event, series = false) {
  if (changeEdits(next => {
    const list = series ? next.removedSeries : next.removed;
    const id = series ? event.localId : event.id;
    if (!list.includes(id)) list.push(id);
  }, `${event.title}${series ? ' and its repeats' : ` on ${dateLabel(event.date)}`} deleted from this calendar. Payments and forecasts are unchanged.`)) {
    $('calendar-detail').close(); $('calendar-add').focus();
  }
}
function openDeleted() {
  if (!data || busy) return;
  const entries = deletedEvents(data, edits);
  const list = create('div');
  if (!entries.length) list.append(create('p', 'No deleted events in this calendar.'));
  for (const event of entries) {
    const row = create('div', undefined, 'calendar-deleted-row');
    const copy = create('span'); copy.append(create('strong', event.title), create('small', event.series ? 'All repeats' : dateLabel(event.date, {day:'numeric',month:'short',year:'numeric'})));
    const restore = create('button', 'Restore', 'calendar-outline'); restore.type = 'button'; restore.setAttribute('aria-label', `Restore ${event.title}`);
    restore.addEventListener('click', () => {
      if (changeEdits(next => {
        if (event.series) next.removedSeries = next.removedSeries.filter(id => id !== event.id);
        else next.removed = next.removed.filter(id => id !== event.id);
      }, `${event.title} restored.`)) openDeleted();
    });
    row.append(copy, restore); list.append(row);
  }
  showDialog('Deleted events', [list], $('calendar-deleted'));
}
function openAdd(day = anchor, returnFocus = $('calendar-add')) {
  if (!data || busy || editsBlocked) return;
  const form = create('form', undefined, 'calendar-event-form'); form.id = 'calendar-event-form';
  function field(label, name, type, options) {
    const wrapper = create('label', undefined, 'calendar-form-field'); wrapper.append(create('span', label));
    const input = create(options ? 'select' : 'input'); input.id = `calendar-event-${name}`; input.name = name;
    if (options) for (const [value, text] of options) { const option = create('option', text); option.value = value; input.append(option); }
    else input.type = type;
    input.required = true; wrapper.append(input); form.append(wrapper); return input;
  }
  const title = field('Event name', 'title', 'text'); title.maxLength = 80; title.placeholder = 'e.g. Dentist or gym membership';
  const date = field('Date', 'date', 'date'); date.value = day; date.min = data.rangeStart; date.max = data.rangeEnd;
  const amount = field('Amount (€)', 'amount', 'text'); amount.inputMode = 'decimal'; amount.placeholder = '0.00'; amount.maxLength = 11;
  const kind = field('Category', 'kind', null, [['bill','Bill / expense'],['subscription','Subscription'],['income','Income']]);
  const cadence = field('Repeat', 'cadence', null, [['once','Does not repeat'],['monthly','Every month'],['yearly','Every year']]);
  const error = create('p', '', 'calendar-form-error'); error.id = 'calendar-form-error'; error.setAttribute('role','alert'); error.hidden = true;
  form.append(create('p', 'Saved for this customer on this device. A reminder does not change your forecast, budget or Google subscription.', 'calendar-form-note'), error);
  const submit = create('button', 'Add event', 'calendar-primary'); submit.type = 'submit'; form.append(submit);
  form.addEventListener('submit', event => {
    event.preventDefault(); error.hidden = true;
    try {
      if (!title.value.trim()) throw new Error('Give your event a name.');
      if (!isDate(date.value) || date.value < data.rangeStart || date.value > data.rangeEnd) throw new Error('Choose a date within the available calendar range.');
      const item = {id: crypto.randomUUID(), title: title.value.trim(), date: date.value, amountCents: amountInCents(amount.value), kind: kind.value, cadence: cadence.value};
      if (!changeEdits(next => { if (next.items.length >= 100) throw new Error('Reminder limit'); next.items.push(item); }, `${item.title} added. Saved on this device.`)) {
        error.textContent = $('calendar-edit-message').textContent; error.hidden = false; return;
      }
      anchor = item.date; visibility[eventGroup(item)] = true; saveView(); render();
      $('calendar-detail').close(); $('calendar-add').focus();
    } catch (problem) { error.textContent = problem.message; error.hidden = false; }
  });
  showDialog('Add an event', [form], returnFocus); title.focus();
}

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
  if (back) { const button = create('button', '← Back to payments', 'calendar-subtle'); button.type = 'button'; button.addEventListener('click', back); content.push(button); }
  content.push(create('p', `${event.direction === 'inflow' ? '+' : '−'}${euro(event.amountCents)}`, 'calendar-detail-amount'));
  content.push(create('p', `${dateLabel(event.date, { day: 'numeric', month: 'long', year: 'numeric' })} · ${event.source === 'manual' ? 'Added by you' : 'Estimated payment'} · ${event.cadence === 'once' ? 'One-off' : event.cadence}`));
  content.push(create('p', event.explanation));
  if (event.observedDayRange) content.push(create('p', `Observed payment days: ${event.observedDayRange[0]}–${event.observedDayRange[1]} of the month. The calendar uses one estimated date; the actual posting date can differ.`));
  if (event.historicalAmountRange) content.push(create('p', `Recent payments ranged from ${euro(event.historicalAmountRange.minCents)} to ${euro(event.historicalAmountRange.maxCents)}.`));
  if (event.accountId) content.push(create('p', `Account: ${event.accountId}`));
  if (event.merchantId) content.push(create('p', `Merchant reference: ${event.merchantId}`));
  if (event.scope === 'account_type_category_aggregate') content.push(create('p', 'The data identifies the payment category, but does not name the payee.'));
  if (event.source !== 'manual') {
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
  }
  const remove = create('button', event.cadence === 'once' ? 'Delete from calendar' : 'Delete this date', 'calendar-delete'); remove.type = 'button'; remove.id = 'calendar-delete-event';
  remove.addEventListener('click', () => deleteEvent(event)); content.push(remove);
  if (event.localId && event.cadence !== 'once') {
    const series = create('button', 'Delete all repeats', 'calendar-delete'); series.type = 'button'; series.id = 'calendar-delete-series';
    series.addEventListener('click', () => deleteEvent(event, true)); content.push(series);
  }
  content.push(create('p', 'Deleting a reminder does not cancel the payment or subscription. You can restore it from Deleted events.', 'calendar-form-note'));
  content.push(create('p', 'Calendar reminders do not move money or change your balance forecast.', 'calendar-detail-note'));
  showDialog(event.title, content, returnFocus);
}

function eventButton(event, onClick) {
  const button = create('button', undefined, `calendar-event event-${event.kind} category-${eventGroup(event)}`); button.type = 'button';
  const icon = create('span', undefined, 'calendar-event-icon'); icon.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', event.cadence === 'yearly' ? '#i-calendar' : '#i-arrow');
  svg.append(use); if (event.cadence !== 'yearly') svg.style.transform = event.kind === 'income' ? 'rotate(45deg)' : 'rotate(-45deg)'; icon.append(svg);
  const text = create('span', undefined, 'calendar-event-copy'); text.append(create('strong', event.title), create('small', `${dateLabel(event.date)} · ${event.source === 'manual' ? 'Added by you' : 'Estimated'}`));
  const amount = create('span', undefined, 'calendar-event-value'); amount.append(create('strong', `${event.direction === 'inflow' ? '+' : '−'}${euro(event.amountCents)}`), create('small', event.cadence === 'yearly' ? 'Yearly' : event.cadence === 'once' ? 'One-off' : 'Monthly'));
  button.append(icon, text, amount); button.addEventListener('click', () => onClick(button)); return button;
}

function openDay(day) {
  const entries = eventsInRange(visibleEvents(currentEvents(), visibility), day, day);
  const list = create('div', undefined, 'calendar-day-payments');
  const returnFocus = document.querySelector(`[data-calendar-date="${day}"]`);
  if (!entries.length) list.append(create('p', 'No payments match the checked categories on this date. You can add your own reminder below.', 'calendar-empty'));
  for (const event of entries) list.append(eventButton(event, () => openEvent(event, returnFocus, () => openDay(day))));
  const add = create('button', '+ Add event on this date', 'calendar-outline'); add.type = 'button'; add.addEventListener('click', () => openAdd(day, returnFocus)); list.append(add);
  showDialog(dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), [list], returnFocus);
}

function openAllPayments() {
  const period = calendarPeriod(view, anchor);
  const entries = eventsInRange(visibleEvents(currentEvents(), visibility), period.start, period.end);
  const list = create('div', undefined, 'calendar-day-payments');
  for (const event of entries) list.append(eventButton(event, () => openEvent(event, $('calendar-all-payments'), openAllPayments)));
  showDialog(`${entries.length} payments · ${$('calendar-month').textContent}`, [create('p', 'Selected categories · personal reminders and estimated payments', 'calendar-detail-note'), list], $('calendar-all-payments'));
}

function openNotice(notice, button) {
  const content = [create('p', notice.summary, 'calendar-detail-note'), create('p', notice.explanation)];
  if (notice.isIllustrative) content.unshift(create('p', 'ILLUSTRATIVE SCENARIO · FICTIONAL DATA', 'calendar-demo-badge'));
  if (notice.timeline?.length) {
    content.push(create('h3', 'The dates that matter'));
    const timeline = create('ol', undefined, 'calendar-timeline');
    for (const item of notice.timeline) {
      const row = create('li');
      row.append(create('small', dateLabel(item.date, { day: 'numeric', month: 'short', year: 'numeric' })), create('span', item.label), create('strong', `${item.direction === 'inflow' ? '+' : item.direction === 'outflow' ? '−' : ''}${euro(item.amountCents)}`)); timeline.append(row);
    }
    content.push(timeline);
  }
  if (notice.monthlyTotals?.length) {
    content.push(create('h3', 'How your spending changed'));
    const list = create('dl', undefined, 'calendar-notice-facts');
    for (const item of notice.monthlyTotals) list.append(create('dt', dateLabel(`${item.month}-01`, { month: 'long', year: 'numeric' })), create('dd', euro(item.amountCents)));
    content.push(list);
  }
  if (notice.metrics?.length) {
    const list = create('dl', undefined, 'calendar-notice-facts');
    for (const metric of notice.metrics) list.append(create('dt', metric.label), create('dd', metric.percent !== undefined ? `${metric.percent}%` : euro(metric.amountCents)));
    content.push(list);
  }
  content.push(create('h3', 'A useful next step'), create('p', notice.action));
  content.push(create('p', `Based on data through ${dateLabel(notice.asOf, { day: 'numeric', month: 'long', year: 'numeric' })}. This assessment does not change when you browse a different month.`, 'calendar-detail-note'));
  const evidence = data.evidence.filter(row => notice.evidenceIds.includes(row.id));
  if (evidence.length) {
    content.push(create('h3', 'Recent supporting transactions'));
    const list = create('ul', undefined, 'calendar-evidence');
    for (const row of evidence) { const item = create('li'); item.append(create('span', `${dateLabel(row.date)} · ${row.category ?? 'Payment'} · ${euro(row.amountCents)}`), create('small', row.id)); list.append(item); }
    content.push(list);
  }
  showDialog(notice.title, content, button);
}

function renderNotices() {
  const list = $('calendar-notifications'); list.replaceChildren();
  $('calendar-notifications-section').hidden = !visibility.alerts;
  $('calendar-analysis-date').textContent = `${data.isIllustrative ? 'Fictional scenario · ' : ''}Analysis through ${dateLabel(data.asOf, { day: 'numeric', month: 'short', year: 'numeric' })} · selected customer only`;
  const notices = (data.notifications ?? []).filter(notice => notice.kind !== 'bill_timing_uncertain');
  if (!notices.length) list.append(create('p', 'No spending-pattern alerts identified in the available data. This does not guarantee that future spending is affordable.', 'calendar-empty'));
  for (const notice of notices) {
    const button = create('button', undefined, `calendar-notification notification-${notice.severity}`); button.type = 'button'; button.disabled = busy;
    button.dataset.noticeKind = notice.kind;
    button.append(create('span', notice.isIllustrative ? 'DEMO · POSSIBLE CASH SHORTFALL' : notice.severity === 'warning' ? 'SPENDING ALERT' : 'WORTH CHECKING', 'calendar-notification-label'), create('strong', notice.title), create('span', notice.summary), create('small', 'View details →'));
    button.addEventListener('click', () => openNotice(notice, button)); list.append(button);
  }
}

function connectCalendar() {
  if (!data || busy) return;
  const content = [];
  if (!data.exportAvailable) {
    content.push(create('p', 'A private calendar connection is needed for live account data. This demo only exports its public sample calendars.'));
  } else {
    const feed = new URL('/api/calendar-feed', 'https://junction-money-ui.vercel.app'); feed.searchParams.set('source', activeSource);
    content.push(create('p', `Connect “${data.label}” as a separate calendar. This public sample feed uses the original automatic events. Your added and deleted reminders on this device are not synced to Google. All original categories are included regardless of filters; balances and transaction IDs are not shared.`));
    const google = create('a', 'Open Google Calendar', 'calendar-connect');
    const destination = new URL('https://calendar.google.com/calendar/u/0/r'); destination.searchParams.set('cid', feed.href);
    google.href = destination.href; google.target = '_blank'; google.rel = 'noopener noreferrer'; google.id = 'calendar-google-link'; content.push(google);
    content.push(create('p', 'In Google Calendar, confirm Add. If it does not open the add-calendar screen, use Other calendars → + → From URL and paste the link below. Adding a URL may require Google Calendar in a desktop browser.'));
    const label = create('label', 'Calendar subscription URL', 'calendar-jump-label'); label.htmlFor = 'calendar-feed-url';
    const input = create('input'); input.id = 'calendar-feed-url'; input.readOnly = true; input.value = feed.href; input.className = 'calendar-source-select';
    const copy = create('button', 'Copy subscription URL', 'calendar-connect'); copy.type = 'button';
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(feed.href); copy.textContent = 'Link copied'; } catch { input.focus(); input.select(); copy.textContent = 'Select and copy the link above'; } });
    content.push(label, input, copy);
    const download = create('a', 'Download .ics file instead', 'calendar-subtle'); download.href = `/api/calendar-feed?source=${encodeURIComponent(activeSource)}&download=1`; download.id = 'calendar-download'; content.push(download);
    content.push(create('p', 'The URL is a one-way subscription: Google decides when to refresh it, so changes are not immediate. A downloaded file is a snapshot and does not update. Add a separate calendar for each sample and remove an old one in Google when you no longer need it.'));
  }
  showDialog('Connect to Google Calendar', content, $('calendar-connect'));
}

function saveView() { remember(`${activeSource}:view`, JSON.stringify({ view, anchor, visibility })); }
function clampDate(day) { return day < data.rangeStart ? data.rangeStart : day > data.rangeEnd ? data.rangeEnd : day; }
function canMove(offset) {
  const period = calendarPeriod(view, movePeriod(view, anchor, offset));
  return period.end >= data.rangeStart && period.start <= data.rangeEnd;
}
function render() {
  if (!data) return;
  $('calendar-connect').disabled = busy;
  $('calendar-add').disabled = busy || editsBlocked;
  $('calendar-deleted').disabled = busy || editsBlocked;
  $('calendar-deleted').textContent = `Deleted events (${deletedEvents(data, edits).length})`;
  $('calendar-personal-note').hidden = !edits.items.length && !edits.removed.length;
  $('calendar-data-label').textContent = data.isIllustrative ? 'Demo household · fictional transactions' : data.sourceNotice;
  $('calendar-data-label').classList.toggle('is-demo', Boolean(data.isIllustrative));
  renderNotices();
  const period = calendarPeriod(view, anchor);
  const heading = view === 'month' ? dateLabel(anchor, { month: 'long', year: 'numeric' })
    : view === 'week' ? `${dateLabel(period.start)} – ${dateLabel(period.end, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : dateLabel(anchor, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  $('calendar-month').textContent = heading;
  for (const [id, offset, label] of [['calendar-prev', -1, 'Previous'], ['calendar-next', 1, 'Next']]) {
    $(id).disabled = busy || !canMove(offset); $(id).setAttribute('aria-label', `${label} ${view}`);
  }
  document.querySelectorAll('[data-calendar-view]').forEach(button => { button.disabled = busy; button.setAttribute('aria-pressed', String(button.dataset.calendarView === view)); });
  document.querySelectorAll('[data-calendar-show]').forEach(input => { input.disabled = busy; input.checked = visibility[input.dataset.calendarShow]; });
  $('calendar-jump-wrap').hidden = view !== 'month'; $('calendar-date-wrap').hidden = view === 'month';
  const dateInput = $('calendar-date'); dateInput.value = anchor; dateInput.min = data.rangeStart; dateInput.max = data.rangeEnd; dateInput.disabled = busy;
  const jump = $('calendar-jump'); jump.replaceChildren(); jump.disabled = busy;
  for (let optionMonth = data.rangeStart.slice(0, 7); optionMonth <= data.rangeEnd.slice(0, 7); optionMonth = shiftMonth(optionMonth, 1)) {
    const option = create('option', dateLabel(`${optionMonth}-01`, { month: 'long', year: 'numeric' })); option.value = optionMonth; option.selected = optionMonth === anchor.slice(0, 7); jump.append(option);
  }
  const checked = Object.values(visibility).filter(Boolean).length;
  $('calendar-filter-count').textContent = checked === 5 ? 'All shown' : `${checked} of 5 shown`;
  const summary = $('calendar-month-summary'); summary.replaceChildren();
  const totals = data.monthSummaries?.[anchor.slice(0, 7)];
  summary.hidden = view !== 'month' || !totals;
  if (totals && view === 'month') {
    for (const [label, value] of [['Automatic scheduled in', euro(totals.incomeCents)], ['Automatic scheduled out', euro(totals.outflowCents)]]) {
      const item = create('div'); item.append(create('small', label), create('strong', value)); summary.append(item);
    }
    summary.append(create('p', `${totals.paymentCount} automatic payments · excludes your calendar edits and irregular spending`));
  }
  const shown = visibleEvents(currentEvents(), visibility);
  const events = eventsInRange(shown, period.start, period.end);
  const grid = $('calendar-grid'); grid.replaceChildren(); grid.dataset.view = view;
  page.querySelector('.calendar-weekdays').hidden = view === 'day';
  if (view === 'day') {
    const hero = create('div', undefined, 'calendar-day-summary');
    hero.append(create('strong', dateLabel(anchor, { weekday: 'long' })), create('span', `${events.length} ${events.length === 1 ? 'payment' : 'payments'} · estimated dates`)); grid.append(hero);
  } else for (const day of period.days) {
    if (!day) { grid.append(create('span', '', 'calendar-spacer')); continue; }
    const entries = eventsInRange(events, day, day);
    const button = create('button', undefined, 'calendar-day'); button.type = 'button'; button.dataset.calendarDate = day;
    button.disabled = busy || day < data.rangeStart || day > data.rangeEnd;
    button.append(create('span', String(Number(day.slice(-2)))));
    button.setAttribute('aria-pressed', String(anchor === day));
    if (day === today) { button.classList.add('is-today'); button.setAttribute('aria-current', 'date'); }
    const dots = create('span', undefined, 'calendar-dots');
    for (const kind of [...new Set(entries.map(eventGroup))]) dots.append(create('i', '', `dot-${kind}`));
    if (entries.length > 1) button.append(create('small', String(entries.length), 'calendar-payment-count'));
    if (entries.length) {
      const shortNames = { 'Home internet': 'Internet', 'Phone plan': 'Phone', 'Water bill': 'Water', 'Gym membership': 'Gym', 'Spotify Premium': 'Spotify', 'Home insurance renewal': 'Insurance', 'Adobe Creative Cloud': 'Adobe' };
      const first = entries.find(event => event.kind === 'income') ?? entries[0];
      button.append(create('small', shortNames[first.title] ?? first.title, 'calendar-cell-label'));
      button.title = entries.map(event => `${event.title} · ${euro(event.amountCents)}`).join(' / ');
    }
    button.append(dots);
    button.setAttribute('aria-label', `${dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}, ${entries.length} matching payments${entries.length ? `: ${entries.map(e => e.title).join(', ')}` : ''}. Open date details`);
    button.addEventListener('click', () => { anchor = day; saveView(); render(); openDay(day); });
    grid.append(button);
  }
  $('calendar-selection').textContent = view === 'day' ? 'Payments on this date' : view === 'week' ? 'Payments this week' : 'Payments this month';
  const agenda = $('calendar-agenda'); agenda.replaceChildren();
  $('calendar-count').textContent = `${events.length} ${events.length === 1 ? 'payment' : 'payments'}`;
  if (!events.length) agenda.append(create('p', Object.entries(visibility).some(([key, checked]) => key !== 'alerts' && checked)
    ? 'No payments match your selection in this period. You can change the date or checked categories.'
    : 'No payment categories selected. Tick a box above to show payments.', 'calendar-empty'));
  for (const event of events.slice(0, 3)) agenda.append(eventButton(event, (button) => openEvent(event, button)));
  $('calendar-all-payments').hidden = events.length <= 3;
  $('calendar-all-payments').disabled = busy;
  $('calendar-all-payments').textContent = `All ${events.length} payments →`;
  const omissions = data.omittedPatterns ?? [];
  $('calendar-warning').textContent = data.notice + (omissions.length ? ` Not scheduled: ${[...new Set(omissions.map((item) => item.title))].join(', ')} — the history does not establish a consistent date or amount.` : '');
  $('calendar-coverage').textContent = `History / schedule as of ${dateLabel(data.asOf, { day: 'numeric', month: 'short', year: 'numeric' })}. Available through ${dateLabel(data.rangeEnd, { month: 'long', year: 'numeric' })}.`;
}

async function load(source) {
  controller?.abort(); const request = new AbortController(); controller = request; busy = true;
  $('calendar-detail').close(); page.setAttribute('aria-busy', 'true'); $('calendar-error').hidden = true; $('calendar-status').textContent = 'Loading your calendar…'; render();
  try {
    const response = await fetch(`/api/calendar?source=${encodeURIComponent(source)}`, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]), cache: 'no-store' });
    if (!response.ok) throw new Error('Calendar unavailable');
    const result = validateCalendar(await response.json(), customers[source]);
    if (request !== controller) return;
    if (data) saveView();
    data = result; activeSource = source; undoEdit = undefined; $('calendar-undo').hidden = true; $('calendar-edit-status').hidden = true;
    try { edits = readEdits(localStorage, data.customerId); editsBlocked = false; }
    catch { edits = emptyEdits(data.customerId); editsBlocked = true; editMessage('Your saved calendar edits could not be loaded. Try reloading or enabling browser storage. Existing saved entries have not been overwritten.', true); }
    ({ view, anchor, visibility } = restoreCalendarView(read(`${source}:view`), data.rangeStart, data.rangeEnd));
    remember('source', source); $('calendar-source').value = source;
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
function changeDate(next) {
  if (!data || busy || !isDate(next)) return;
  anchor = clampDate(next); saveView(); render();
  $('calendar-options').open = false;
}
$('calendar-add').addEventListener('click', () => openAdd());
$('calendar-deleted').addEventListener('click', openDeleted);
$('calendar-undo').addEventListener('click', () => {
  if (!undoEdit || busy) return;
  try {
    if (JSON.stringify(readEdits(localStorage, data.customerId)) !== undoEdit.expected) throw new Error('Changed in another tab');
    writeEdits(localStorage, undoEdit.previous); edits = undoEdit.previous; undoEdit = undefined;
    $('calendar-undo').hidden = true; render(); editMessage('Change undone.');
  } catch { editMessage('Could not undo safely. Your calendar may have changed in another tab. Reload to see the latest events.', true); }
});
window.addEventListener('storage', event => {
  if (data && (event.key === editsKey(data.customerId) || event.key === null)) {
    try { edits = readEdits(localStorage, data.customerId); editsBlocked = false; undoEdit = undefined; $('calendar-undo').hidden = true; if (!$('calendar-event-form')) $('calendar-detail').close(); render(); editMessage('Calendar updated from another tab.'); }
    catch { editsBlocked = true; render(); editMessage('Could not read calendar edits from another tab. Reload to try again.', true); }
  }
});
$('calendar-connect').addEventListener('click', connectCalendar);
$('calendar-all-payments').addEventListener('click', openAllPayments);
$('calendar-source').addEventListener('change', (event) => load(event.target.value));
$('calendar-retry').addEventListener('click', () => load($('calendar-source').value));
$('calendar-prev').addEventListener('click', () => { if (data && canMove(-1)) changeDate(movePeriod(view, anchor, -1)); });
$('calendar-next').addEventListener('click', () => { if (data && canMove(1)) changeDate(movePeriod(view, anchor, 1)); });
$('calendar-jump').addEventListener('change', (event) => changeDate(`${event.target.value}-01`));
$('calendar-date').addEventListener('change', (event) => changeDate(event.target.value));
$('calendar-reset-month').addEventListener('click', () => { if (data) changeDate(data.rangeStart); });
document.querySelectorAll('[data-calendar-view]').forEach(button => button.addEventListener('click', () => {
  if (!data || busy) return; view = button.dataset.calendarView; saveView(); render();
}));
document.querySelectorAll('[data-calendar-show]').forEach(input => input.addEventListener('change', () => {
  if (!data || busy) return; visibility[input.dataset.calendarShow] = input.checked; saveView(); render();
}));
document.addEventListener('click', event => { if (!$('calendar-options').contains(event.target)) $('calendar-options').open = false; });
$('calendar-options').addEventListener('keydown', event => { if (event.key === 'Escape') { $('calendar-options').open = false; $('calendar-options').querySelector('summary').focus(); } });
$('calendar-detail-close').addEventListener('click', () => $('calendar-detail').close());
const savedSource = read('source'); if (Object.hasOwn(customers, savedSource)) $('calendar-source').value = savedSource;
function activate() { if (location.hash === '#calendar' && !data && !busy) load($('calendar-source').value); }
window.addEventListener('hashchange', activate); activate();
