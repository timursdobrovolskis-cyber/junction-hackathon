import { calendarExamples, usesLiveEngine } from '../server/calendar-data.mjs';
import { calendarICS } from '../server/calendar-ics.mjs';

export default async function calendarFeed(req, res) {
  const error = (status, message) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify({ error: message })); };
  if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return error(405, 'Use GET or HEAD'); }
  const url = new URL(req.url, 'http://localhost');
  const source = url.searchParams.get('source') ?? 'regular';
  if (!Object.hasOwn(calendarExamples, source)) return error(400, 'Unknown calendar example');
  // This unguessability-free URL is suitable only for the public synthetic demos.
  // A live account must have an authenticated, revocable feed instead.
  if (usesLiveEngine(source)) return error(409, 'Live customer data needs a private calendar connection. Public export is disabled.');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="junction-${source}.ics"`);
  res.end(req.method === 'HEAD' ? '' : calendarICS(calendarExamples[source]));
}
