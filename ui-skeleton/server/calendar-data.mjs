import { readFileSync } from 'node:fs';
import { validateCalendar } from '../dist/calendar-model.mjs';

// Public synthetic examples only. Never add private account records to this map.
export const calendarExamples = Object.fromEntries(['engine', 'regular', 'recurring', 'subscriptions'].map((key) => [key,
  JSON.parse(readFileSync(new URL(`./calendar/${key}.json`, import.meta.url)))]));

export function usesLiveEngine(source) {
  return ['engine', 'regular'].includes(source) && Boolean(process.env.FINANCIAL_ENGINE_URL);
}
export async function loadCalendar(source) {
  if (!Object.hasOwn(calendarExamples, source)) throw new Error('Unknown calendar example');
  const sample = calendarExamples[source];
  if (usesLiveEngine(source)) {
    const response = await fetch(new URL('/api/calendar', process.env.FINANCIAL_ENGINE_URL), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(12000),
      body: JSON.stringify({ customerId: sample.customerId, asOf: sample.asOf, bufferCents: sample.bufferCents, savingsTargetCents: 10000 }),
    });
    if (!response.ok) throw new Error('Calendar calculation unavailable');
    const result = validateCalendar(await response.json(), sample.customerId);
    if (result.asOf !== sample.asOf || result.bufferCents !== sample.bufferCents) throw new Error('Unexpected calendar response');
    return { ...result, label: sample.label, sourceNotice: sample.sourceNotice, connection: 'engine', exportAvailable: false };
  }
  return { ...sample, connection: 'saved_engine_example', exportAvailable: true };
}
