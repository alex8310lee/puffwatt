// In-browser "server": intercept fetch('/api/...') and dispatch to the shared route table.
const JOB_TOKEN = 'dev-job-token';
if (!q.get('SELECT 1 FROM users LIMIT 1')) { seed(); }
let TOKEN = localStorage.getItem('puffwatt.session') || null;
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);
  const u = new URL(url, location.origin);
  const method = (init.method || 'GET').toUpperCase();
  let status = 200, payload;
  try {
    const body = init.body ? JSON.parse(init.body) : {};
    const r = await handleApi(method, u.pathname, Object.fromEntries(u.searchParams), body, TOKEN, {}, 'local');
    payload = r.out;
    const sc = r.headers['Set-Cookie']; if (sc) { const m = sc.match(/pw_session=([^;]*)/); TOKEN = m && m[1] ? m[1] : null; if (TOKEN) localStorage.setItem('puffwatt.session', TOKEN); else localStorage.removeItem('puffwatt.session'); }
  } catch (e) { status = e.status || 500; payload = { error: e.code || 'INTERNAL', message: e.message }; if (status >= 500) console.error(e); }
  return { ok: status < 400, status, json: async () => payload, text: async () => JSON.stringify(payload) };
};
