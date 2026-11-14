import { validateCalendar } from '../dist/calendar-model.mjs';
import { readFileSync } from 'node:fs';

const examples = Object.fromEntries(['engine', 'regular', 'recurring', 'subscriptions'].map((key) => [key,
  JSON.parse(readFileSync(new URL(`../server/calendar/${key}.json`, import.meta.url)))]));

export default async function calendar(req, res) {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  const send = (code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(405, { error: 'Use GET' }); }
  const source = new URL(req.url, 'http://localhost').searchParams.get('source') ?? 'engine';
  if (!Object.hasOwn(examples, source)) return send(400, { error: 'Unknown calendar example' });
  const sample = examples[source];
  // Optional local integration. The browser never picks a remote URL or customer.
  if (['engine', 'regular'].includes(source) && process.env.FINANCIAL_ENGINE_URL) {
    try {
      const response = await fetch(new URL('/api/calendar', process.env.FINANCIAL_ENGINE_URL), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(12000),
        body: JSON.stringify({ customerId: sample.customerId, asOf: sample.asOf, bufferCents: sample.bufferCents, savingsTargetCents: 10000 }),
      });
      if (!response.ok) throw new Error('Calendar calculation unavailable');
      const result = await response.json();
      if (result.customerId !== sample.customerId || result.asOf !== sample.asOf || result.schemaVersion !== '2.0'
        || result.bufferCents !== sample.bufferCents || !Array.isArray(result.events)) throw new Error('Unexpected calendar response');
      validateCalendar(result, sample.customerId);
      return send(200, { ...result, label: sample.label, sourceNotice: sample.sourceNotice, connection: 'engine' });
    } catch { return send(502, { error: 'The financial engine could not return this calendar. Try again; no plan has changed.' }); }
  }
  return send(200, { ...sample, connection: 'saved_engine_example' });
}
