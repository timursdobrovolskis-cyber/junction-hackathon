import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarPeriod, movePeriod, visibleEvents, restoreCalendarView, visibilityDefaults, eventGroup } from '../dist/calendar-model.mjs';
import { calendarExamples } from '../server/calendar-data.mjs';
import calendar from '../api/calendar.js';
import feed from '../api/calendar-feed.js';

test('day/week/month share an anchor and handle cross-year Monday weeks and leap days', () => {
  assert.deepEqual(calendarPeriod('day','2028-02-29').days,['2028-02-29']);
  const week=calendarPeriod('week','2027-01-01');
  assert.equal(week.start,'2026-12-28'); assert.equal(week.end,'2027-01-03'); assert.equal(week.days.length,7);
  assert.equal(calendarPeriod('month','2028-02-29').end,'2028-02-29');
  assert.equal(movePeriod('day','2028-02-29',1),'2028-03-01');
  assert.equal(movePeriod('week','2026-12-28',1),'2027-01-04');
  assert.equal(movePeriod('month','2028-01-31',1),'2028-02-29');
  assert.throws(()=>calendarPeriod('year','2027-01-01'));
  assert.throws(()=>movePeriod('week','2026-02-30',1));
});
test('checkboxes start checked and combine as independent non-overlapping categories', () => {
  const events=calendarExamples.risk.events;
  assert.equal(visibleEvents(events,visibilityDefaults).length,events.length);
  const selected={income:false,bill:true,subscription:false,yearly:true,alerts:false};
  const shown=visibleEvents(events,selected);
  assert.ok(shown.some(e=>e.kind==='bill')); assert.ok(shown.some(e=>e.cadence==='yearly'));
  assert.ok(shown.every(e=>['bill','yearly'].includes(eventGroup(e))));
  assert.equal(visibleEvents(events,{}).length,0);
  assert.equal(visibleEvents(events,{...visibilityDefaults,yearly:false}).some(e=>e.cadence==='yearly'),false);
});
test('saved view restores deselections but rejects corrupt dates and unknown values', () => {
  const initial=restoreCalendarView(null,'2026-11-01','2028-10-31');
  assert.equal(initial.view,'month'); assert.ok(Object.values(initial.visibility).every(Boolean));
  const saved=JSON.stringify({view:'week',anchor:'2027-01-01',visibility:{income:false,yearly:false,alerts:false}});
  const restored=restoreCalendarView(saved,'2026-11-01','2028-10-31');
  assert.equal(restored.anchor,'2027-01-01'); assert.equal(restored.visibility.income,false); assert.equal(restored.visibility.bill,true);
  const bad=restoreCalendarView('{"view":"year","anchor":"2030-01-01","visibility":{"income":"false"}}','2026-11-01','2028-10-31');
  assert.equal(bad.anchor,'2026-11-01'); assert.equal(bad.view,'month'); assert.equal(bad.visibility.income,true);
});
async function call(handler,url) { const res={setHeader(){},end(body){this.body=body}}; await handler({method:'GET',url},res); return res; }
test('risk scenario is explicitly fictional, isolated and exportable as its own calendar', async () => {
  const response=await call(calendar,'/api/calendar?source=risk');assert.equal(response.statusCode,200);
  const data=JSON.parse(response.body);assert.equal(data.customerId,'RISK-DEMO');assert.equal(data.isIllustrative,true);
  const warning=data.notifications.find(n=>n.kind==='demo_shortfall');assert.equal(warning.isIllustrative,true);
  assert.ok(warning.metrics.some(m=>m.amountCents>0));assert.ok(data.daily.some(d=>d.expectedBalanceCents<0));
  assert.ok(data.evidence.every(e=>e.id.startsWith('risk-demo-')));
  const bank=JSON.parse((await call(calendar,'/api/calendar?source=regular')).body);
  assert.ok(!bank.notifications.some(n=>n.kind==='demo_shortfall'));
  assert.ok(!bank.evidence.some(e=>e.id.startsWith('risk-demo-')));
  const exported=await call(feed,'/api/calendar-feed?source=risk');assert.equal(exported.statusCode,200);assert.match(exported.body,/BEGIN:VEVENT/);
});

test('full household includes named monthly costs and annual renewals without duplicate reminders', () => {
  const data = calendarExamples.risk;
  const november = data.events.filter(e => e.date.startsWith('2026-11'));
  assert.equal(november.length, 11);
  for (const name of ['Netflix', 'Spotify Premium', 'iCloud+', 'Gym membership', 'Home internet', 'Phone plan', 'Water bill', 'Rent', 'Home insurance renewal']) {
    assert.equal(november.filter(e => e.title === name).length, 1, name);
  }
  assert.deepEqual(data.monthSummaries['2026-11'], {incomeCents:240000, outflowCents:159576, paymentCount:11});
  const warning = data.notifications[0];
  assert.equal(warning.firstShortfallDate, '2026-11-03');
  assert.equal(warning.firstShortfallCents, 30000);
  assert.equal(warning.firstShortfallCents, -data.daily.find(d => d.date === warning.firstShortfallDate).expectedBalanceCents);
  assert.deepEqual(warning.timeline.map(t => t.date), ['2026-10-31','2026-11-03','2026-11-28']);
});

test('calendar rejects malformed summary or warning timeline before rendering', async () => {
  const {validateCalendar} = await import('../dist/calendar-model.mjs');
  assert.equal(validateCalendar(calendarExamples.risk, 'RISK-DEMO').isIllustrative, true);
  for (const change of [
    data => { data.monthSummaries['2026-11'].outflowCents = -1; },
    data => { data.monthSummaries['2026-13'] = data.monthSummaries['2026-11']; },
    data => { data.notifications[0].timeline[0].amountCents = 1.25; },
    data => { data.notifications[0].timeline[0].date = '2026-02-30'; },
    data => { data.notifications[0].timeline[0].direction = 'transfer'; },
  ]) {
    const data = structuredClone(calendarExamples.risk); change(data);
    assert.throws(() => validateCalendar(data, 'RISK-DEMO'));
  }
});
