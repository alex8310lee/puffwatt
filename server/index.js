import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, tx, nowIso } from './db.js';
import { seed, DEMO_PW } from './seed.js';
import { routes, handleApi } from './routes.js';
import { IS_PROD, ENV, hashPassword, verifyPassword, createSession, destroySession, userFromToken, parseCookies, cookieHeader, HttpError, flag, flags, hasRole, isAdmin, loadUser } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);

if (!q.get('SELECT 1 FROM users LIMIT 1') || process.env.PUFFWATT_SEED === '1') { seed(); console.log('[seed] demo data ready'); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
async function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/' || !path.extname(p)) p = '/index.html';
  const file = path.join(PUBLIC, path.normalize(p)); if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try { await stat(file); const data = await readFile(file); res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': p.startsWith('/assets') ? 'public, max-age=86400' : 'no-cache' }); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
}
const readBody = (req) => new Promise((ok, err) => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { ok({}); } }); req.on('error', err); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method === 'POST' && (req.headers['sec-fetch-site'] === 'cross-site')) throw new HttpError(403, 'CSRF');
    const token = parseCookies(req.headers.cookie).pw_session;
    const r = await handleApi(req.method, url.pathname, Object.fromEntries(url.searchParams), req.method === 'POST' ? await readBody(req) : {}, token, req.headers, req.socket.remoteAddress);
    for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
    const out = r.out;
    res.writeHead(200); res.end(JSON.stringify(out ?? { ok: true }));
  } catch (e) {
    const status = e.status || 500; if (status >= 500) console.error(e);
    res.writeHead(status); res.end(JSON.stringify({ error: e.code || 'INTERNAL', message: e.message || 'Unexpected error' }));
  }
}).listen(PORT, () => console.log(`PUFFWATT ${ENV} → http://localhost:${PORT}  (demo password: ${IS_PROD ? 'disabled' : DEMO_PW})`));
