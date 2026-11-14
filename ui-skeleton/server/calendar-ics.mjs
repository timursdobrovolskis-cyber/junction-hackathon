// RFC 5545 all-day reminders. No account balances or transaction evidence exported.
export function escapeICal(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}
export function foldICal(line) {
  let result = '', bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > 75) { result += '\r\n '; bytes = 1; }
    result += character; bytes += size;
  }
  return result;
}
const compactDate = (day) => day.replaceAll('-', '');
export function calendarICS(calendar) {
  const stamp = (calendar.generatedAt ?? `${calendar.asOf}T00:00:00Z`).replaceAll('-', '').replaceAll(':', '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Junction//Financial Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICal(`Money · ${calendar.label}`)}`, 'X-WR-CALDESC:Estimated recurring payments. Read-only calendar.'];
  for (const event of calendar.events) {
    const next = new Date(`${event.date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    lines.push('BEGIN:VEVENT', `UID:${escapeICal(event.id)}@junction-money-ui.vercel.app`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(event.date)}`, `DTEND;VALUE=DATE:${compactDate(next.toISOString().slice(0, 10))}`,
      `SUMMARY:${escapeICal(`${calendar.isIllustrative ? 'DEMO · ' : ''}${event.title} (estimated)`)}`,
      `DESCRIPTION:${escapeICal(`${calendar.isIllustrative ? 'Fictional demonstration, not your account data. ' : ''}Estimated ${event.cadence} payment. Dates and amounts may change. Check the app for details. This reminder does not move money.`)}`,
      'STATUS:TENTATIVE', 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldICal).join('\r\n') + '\r\n';
}
