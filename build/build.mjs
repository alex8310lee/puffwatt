import { readFileSync, writeFileSync } from 'node:fs';
const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const strip = (s) => s.replace(/^import [^;]*;\s*$/gm, '').replace(/^export default /gm, '').replace(/^export (const|function|class|let|async function)/gm, '$1').replace(/^export \{[^}]*\};?\s*$/gm, '');
const svcNames = [...R('server/services.js').matchAll(/^export function (\w+)/gm)].map(m => m[1]);
const seedSrc = strip(R('server/seed.js')).replace(/if \(process\.argv[\s\S]*$/, '');
const server = [
  '/* ===== PUFFWATT in-browser server (same domain/services/routes as Node build) ===== */',
  strip(R('server/domain.js')), R('build/browser-db.js'), '{ const BASE = ' + R('server/db.js').match(/const BASE = (.*);/)[1] + ';', 'db.exec(`' + R('server/db.js').match(/db\.exec\(`([\s\S]*?)`\);/)[1] + '`); }', R('build/browser-auth.js'),
  strip(R('server/services.js')), `const S = {${svcNames.join(',')}};`,
  '(() => {', seedSrc, 'window.__seed = seed; window.__DEMO_PW = DEMO_PW; })();', 'const seed = window.__seed, DEMO_PW = window.__DEMO_PW;',
  strip(R('server/routes.js')).replace(/^const JOB_TOKEN.*$/m, ''),
  R('build/browser-fetch.js'),
].join('\n');
const html = R('public/index.html')
  .replace('<link rel="stylesheet" href="/styles.css">', () => `<style>${R('public/styles.css')}</style>`)
  .replace('<script src="/icons.js"></script>\n<script src="/app.js"></script>\n<script src="/admin.js"></script>', () =>
`<script>${R('build/sql-wasm.js')}</script>
<script>
(() => { const b64 = "${R('build/sql-wasm.wasm.b64').trim()}"; const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
window.__boot = initSqlJs({ wasmBinary: bin }).then(SQL => { window.__SQL = SQL; }); })();
</script>
<script>${R('public/icons.js')}</script>
<script>
window.__boot.then(() => {
${server}
window.__serverReady = true;
const s1 = document.createElement('script'); s1.textContent = ${JSON.stringify(R('public/app.js'))}; document.body.appendChild(s1);
const s2 = document.createElement('script'); s2.textContent = ${JSON.stringify(R('public/admin.js'))}; document.body.appendChild(s2);
}).catch(e => { document.getElementById('app').innerHTML = '<div class="main"><div class="empty"><div class="display h3">SQLite 엔진을 불러오지 못했습니다.</div><p>' + e.message + '</p></div></div>'; });
</script>`)
  .replace('<title>PUFFWATT — Private Access Club</title>', '<title>PUFFWATT — Private Access Club (standalone)</title>');
writeFileSync(new URL('../dist/puffwatt-standalone.html', import.meta.url), html);
console.log('built dist/puffwatt-standalone.html', (html.length / 1024).toFixed(0), 'KB');
