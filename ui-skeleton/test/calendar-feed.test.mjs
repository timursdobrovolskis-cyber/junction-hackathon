import test from 'node:test';
import assert from 'node:assert/strict';
import feed from '../api/calendar-feed.js';
import { calendarICS, escapeICal, foldICal } from '../server/calendar-ics.mjs';
import { calendarExamples } from '../server/calendar-data.mjs';

async function call(url = '/api/calendar-feed?source=regular', method = 'GET') {
  const res = { headers: {}, setHeader(k,v) { this.headers[k]=v; }, end(text) { this.body=text; } };
  await feed({url,method},res); return res;
}
test('Google feed exports one all-day event per estimated payment without private evidence', async () => {
  const result = await call(); assert.equal(result.statusCode,200);
  assert.equal(result.headers['Content-Type'],'text/calendar; charset=utf-8');
  assert.match(result.body,/DTSTART;VALUE=DATE:20261003\r\nDTEND;VALUE=DATE:20261004/);
  assert.match(result.body,/Housing payment \(estimated\)/);
  assert.equal((result.body.match(/BEGIN:VEVENT/g)||[]).length,48);
  assert.doesNotMatch(result.body,/tx-49b|ACC000|CUST000|expectedBalance|50000/);
  assert.ok(result.body.split('\r\n').every(line => Buffer.byteLength(line,'utf8')<=75));
  assert.equal((await call()).body,result.body);
});
test('source selection, download, HEAD, and invalid requests are explicit', async () => {
  const subscriptions = await call('/api/calendar-feed?source=subscriptions&download=1');
  assert.match(subscriptions.headers['Content-Disposition'],/^attachment;/);
  assert.match(subscriptions.body,/Netflix/);
  assert.match(subscriptions.body,/DTSTART;VALUE=DATE:20270503/);
  assert.equal((await call(undefined,'HEAD')).body,'');
  assert.equal((await call('/api/calendar-feed?source=OTHER')).statusCode,400);
  assert.equal((await call('/api/calendar-feed?source=__proto__')).statusCode,400);
  assert.equal((await call(undefined,'POST')).statusCode,405);
});
test('live engine records cannot leak through public subscription URLs', async t => {
  const old=process.env.FINANCIAL_ENGINE_URL;
  t.after(()=>{ if(old===undefined) delete process.env.FINANCIAL_ENGINE_URL; else process.env.FINANCIAL_ENGINE_URL=old; });
  process.env.FINANCIAL_ENGINE_URL='http://localhost:8766';
  assert.equal((await call()).statusCode,409);
  assert.equal((await call('/api/calendar-feed?source=engine')).statusCode,409);
  assert.equal((await call('/api/calendar-feed?source=subscriptions')).statusCode,200);
});
test('ICS escapes line injection and folds Unicode without corrupting text', () => {
  assert.equal(escapeICal('Rent; hi,\\\r\nEND:VEVENT'), 'Rent\\; hi\\,\\\\\\nEND:VEVENT');
  const value='DESCRIPTION:'+ '€🙂'.repeat(50);
  const folded=foldICal(value);
  assert.ok(folded.split('\r\n').every(line=>Buffer.byteLength(line)<=75));
  assert.equal(folded.replaceAll('\r\n ',''),value);
  const changed=structuredClone(calendarExamples.regular);
  changed.events[0].title='Rent\r\nEND:VEVENT';
  assert.equal((calendarICS(changed).match(/\r\nEND:VEVENT\r\n/g)||[]).length,changed.events.length);
});
test('leap days and year boundaries use exclusive next-day end dates and stable UIDs', () => {
  const changed=structuredClone(calendarExamples.regular);
  changed.events=[{...changed.events[0],date:'2028-02-29'},{...changed.events[1],date:'2027-12-31'}];
  const result=calendarICS(changed);
  assert.match(result,/DTSTART;VALUE=DATE:20280229\r\nDTEND;VALUE=DATE:20280301/);
  assert.match(result,/DTSTART;VALUE=DATE:20271231\r\nDTEND;VALUE=DATE:20280101/);
  const before=result.match(/^UID:.*$/gm);
  changed.generatedAt='2026-11-20T12:00:00Z';
  assert.deepEqual(calendarICS(changed).match(/^UID:.*$/gm),before);
});
