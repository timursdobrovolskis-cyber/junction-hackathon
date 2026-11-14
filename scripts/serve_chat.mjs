import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Deliberate allowlist: never serve raw bank data, plans, .git or .env files.
const assets = new Map([
  ['/', ['chat/index.html', 'text/html']], ['/chat/', ['chat/index.html', 'text/html']],
  ['/chat/style.css', ['chat/style.css', 'text/css']], ['/chat/app.mjs', ['chat/app.mjs', 'text/javascript']],
  ['/src/chat-coach.mjs', ['src/chat-coach.mjs', 'text/javascript']],
]);
const port = Number(process.env.CHAT_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CHAT_PORT must be a valid port');
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const asset = assets.get(path);
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  if (!asset) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const body = await readFile(new URL(`../${asset[0]}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(500); response.end('Could not load the chat prototype'); }
});
server.on('error', (error) => { console.error(`Could not start chat: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`BEFORE chat: http://localhost:${port} (demo mode; no API needed)`));
