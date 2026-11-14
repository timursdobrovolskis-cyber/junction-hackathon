import { calendarExamples, loadCalendar } from '../server/calendar-data.mjs';

export default async function calendar(req, res) {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  const send = (code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(405, { error: 'Use GET' }); }
  const source = new URL(req.url, 'http://localhost').searchParams.get('source') ?? 'engine';
  if (!Object.hasOwn(calendarExamples, source)) return send(400, { error: 'Unknown calendar example' });
  try { return send(200, await loadCalendar(source)); }
  catch { return send(502, { error: 'The financial engine could not return this calendar. Try again; no plan has changed.' }); }
}
