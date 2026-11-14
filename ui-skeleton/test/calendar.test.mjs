import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import calendar from '../api/calendar.js';
import { monthDays, shiftMonth, eventsInRange, validateCalendar } from '../dist/calendar-model.mjs';

const sample = JSON.parse(readFileSync(new URL('../server/calendar/engine.json', import.meta.url)));
async function call(url = '/api/calendar', method = 'GET') {
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(text) { this.body = JSON.parse(text); } };
  await calendar({ url, method }, res); return res;
}
test('API serves separate validated examples with their original source dates', async () => {
  const result = await call(); assert.equal(result.statusCode, 200);
  validateCalendar(result.body, 'CUST00005'); assert.equal(result.body.asOf, '2026-09-30');
  const annual = await call('/api/calendar?source=recurring'); validateCalendar(annual.body, 'CALENDAR-DEMO');
  assert.ok(annual.body.events.some((e) => e.cadence === 'yearly'));
  assert.equal((await call('/api/calendar?source=bad')).statusCode, 400);
  assert.equal((await call('/api/calendar', 'POST')).statusCode, 405);
});
test('calendar aligns Monday-first and handles leap years and year rollover', () => {
  assert.equal(monthDays('2026-11').filter(Boolean).length, 30);
  assert.equal(monthDays('2026-11').indexOf('2026-11-01'), 6);
  assert.equal(monthDays('2028-02').at(-1), '2028-02-29');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2027-01', -1), '2026-12');
  assert.throws(() => monthDays('2026-13'));
});
test('a payment window overlaps selected days but appears only once in the month agenda', () => {
  const event = sample.events.find((e) => e.earliestDate !== e.latestDate);
  assert.equal(eventsInRange([event], event.earliestDate, event.latestDate).length, 1);
  assert.equal(eventsInRange([event], event.latestDate, event.latestDate).length, 1);
  assert.equal(eventsInRange([event], '2028-01-01', '2028-01-31').length, 0);
  assert.ok(eventsInRange(sample.events, '2026-10-01', '2026-10-31', 'income').every((e) => e.kind === 'income'));
});
test('wrong customer, malformed dates, amounts, and duplicate records are rejected', () => {
  validateCalendar(sample, 'CUST00005');
  assert.throws(() => validateCalendar(sample, 'OTHER'));
  for (const patch of [{ earliestDate: '2026-02-30' }, { amountCents: NaN }, { status: 'paid' }]) {
    const changed = structuredClone(sample); Object.assign(changed.events[0], patch);
    assert.throws(() => validateCalendar(changed, 'CUST00005'));
  }
  const duplicate = structuredClone(sample); duplicate.events.push(duplicate.events[0]);
  assert.throws(() => validateCalendar(duplicate, 'CUST00005'));
});
test('calendar remains read-only and preserves engine balances', async () => {
  const response = await call(); assert.deepEqual(response.body.daily, sample.daily);
  assert.equal(response.body.forecastThrough, sample.forecastThrough);
  assert.ok(response.body.events.every((e) => e.isConfirmed === false));
});

test('optional live connection uses server-owned customer inputs and fails explicitly', async (t) => {
  const before = process.env.FINANCIAL_ENGINE_URL; const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; if (before === undefined) delete process.env.FINANCIAL_ENGINE_URL; else process.env.FINANCIAL_ENGINE_URL = before; });
  process.env.FINANCIAL_ENGINE_URL = 'http://localhost:8766';
  globalThis.fetch = async (url, options) => {
    assert.equal(url.toString(), 'http://localhost:8766/api/calendar');
    const request = JSON.parse(options.body);
    assert.equal(request.customerId, 'CUST00005'); assert.equal(request.asOf, '2026-09-30');
    return { ok: true, json: async () => structuredClone(sample) };
  };
  const response = await call('/api/calendar?source=engine&customerId=OTHER');
  assert.equal(response.statusCode, 200); assert.equal(response.body.connection, 'engine');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...sample, customerId: 'OTHER' }) });
  assert.equal((await call()).statusCode, 502);
  globalThis.fetch = async () => { throw new Error('secret upstream diagnostic'); };
  const failed = await call(); assert.equal(failed.statusCode, 502); assert.doesNotMatch(JSON.stringify(failed.body), /secret/);
});
