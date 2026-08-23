// Browser replacement for server/db.js — sql.js (SQLite WASM) + localStorage persistence.
const SQL = window.__SQL;
const KEY = 'puffwatt.db.v1';
let db;
try { const saved = localStorage.getItem(KEY); db = saved ? new SQL.Database(Uint8Array.from(atob(saved), c => c.charCodeAt(0))) : new SQL.Database(); } catch { db = new SQL.Database(); }
let saveT; const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { const u8 = db.export(); let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); localStorage.setItem(KEY, btoa(s)); } catch (e) { console.warn('persist failed', e); } }, 300); };
window.__resetPuffwatt = () => { localStorage.removeItem(KEY); location.reload(); };
const fix = (p) => p.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const q = {
  get: (sql, ...p) => { const st = db.prepare(sql); st.bind(fix(p)); const r = st.step() ? st.getAsObject() : undefined; st.free(); return r; },
  all: (sql, ...p) => { const st = db.prepare(sql); st.bind(fix(p)); const rows = []; while (st.step()) rows.push(st.getAsObject()); st.free(); return rows; },
  run: (sql, ...p) => { db.run(sql, fix(p)); const changes = db.getRowsModified(); const id = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]; persist(); return { changes, lastInsertRowid: id }; },
};
const nowIso = () => new Date().toISOString();
let depth = 0;
function tx(fn) { if (depth++ === 0) db.exec('BEGIN'); try { const r = fn(); if (--depth === 0) { db.exec('COMMIT'); persist(); } return r; } catch (e) { if (--depth === 0) db.exec('ROLLBACK'); throw e; } }
